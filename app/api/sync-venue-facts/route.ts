import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { isUnstableHost } from "@/lib/event-link";
import { isHttpUrl } from "@/lib/url";

export const maxDuration = 120;

// Pulls live venue facts (rating, review count, phone, website, hours, Google
// Maps URL) from the Google Places API (New) into hwy4_venues, which the event
// detail page renders as a facts strip. place_id is resolved once and cached
// indefinitely (allowed by Google); everything else is refreshed weekly, well
// within Google's ~30-day caching limit. Attribution: the UI links the rating
// to maps_url with a "via Google" label.

const PLACES_BASE = "https://places.googleapis.com/v1";

// Corridor center (Arnold-ish) + radius to bias Text Search so a venue name
// doesn't match a same-named place in another state.
const CORRIDOR_BIAS = {
  circle: {
    center: { latitude: 38.1846, longitude: -120.3517 },
    radius: 45000.0,
  },
};

interface VenueRow {
  venue_key: string;
  canonical: string;
  town: string;
  address: string | null;
  place_id: string | null;
}

interface PlaceDetails {
  rating?: number;
  userRatingCount?: number;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  // Factual attributes used to ground blurbs in real persona signals.
  primaryTypeDisplayName?: { text?: string };
  allowsDogs?: boolean;
  goodForChildren?: boolean;
  goodForGroups?: boolean;
  outdoorSeating?: boolean;
  servesBeer?: boolean;
  servesWine?: boolean;
  servesCocktails?: boolean;
  liveMusic?: boolean;
  menuForChildren?: boolean;
  restroom?: boolean;
  reservable?: boolean;
  parkingOptions?: Record<string, unknown>;
}

// Compact, blurb-friendly attribute bag persisted to hwy4_venues.places_attributes.
// Only includes attributes Google actually returned (undefined fields dropped).
function buildAttributes(d: PlaceDetails): Record<string, unknown> | null {
  const attrs: Record<string, unknown> = {};
  const pt = d.primaryTypeDisplayName?.text;
  if (pt) attrs.primary_type = pt;
  const bool: [keyof PlaceDetails, string][] = [
    ["allowsDogs", "allows_dogs"],
    ["goodForChildren", "good_for_children"],
    ["goodForGroups", "good_for_groups"],
    ["outdoorSeating", "outdoor_seating"],
    ["servesBeer", "serves_beer"],
    ["servesWine", "serves_wine"],
    ["servesCocktails", "serves_cocktails"],
    ["liveMusic", "live_music"],
    ["menuForChildren", "menu_for_children"],
    ["restroom", "restroom"],
    ["reservable", "reservable"],
  ];
  for (const [src, dest] of bool) {
    if (typeof d[src] === "boolean") attrs[dest] = d[src];
  }
  if (d.parkingOptions) attrs.parking = Object.keys(d.parkingOptions);
  return Object.keys(attrs).length > 0 ? attrs : null;
}

async function findPlaceId(
  apiKey: string,
  venue: VenueRow
): Promise<string | null> {
  const textQuery = `${venue.canonical}, ${venue.address || venue.town}, CA`;
  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id",
    },
    body: JSON.stringify({
      textQuery,
      locationBias: CORRIDOR_BIAS,
      maxResultCount: 1,
      regionCode: "US",
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    console.error(`[sync-venue-facts] searchText ${res.status} for ${venue.venue_key}`);
    return null;
  }
  const data = (await res.json()) as { places?: { id: string }[] };
  return data.places?.[0]?.id ?? null;
}

async function fetchDetails(
  apiKey: string,
  placeId: string
): Promise<PlaceDetails | null> {
  const fieldMask = [
    "rating",
    "userRatingCount",
    "nationalPhoneNumber",
    "websiteUri",
    "googleMapsUri",
    "regularOpeningHours.weekdayDescriptions",
    "primaryTypeDisplayName",
    "allowsDogs",
    "goodForChildren",
    "goodForGroups",
    "outdoorSeating",
    "servesBeer",
    "servesWine",
    "servesCocktails",
    "liveMusic",
    "menuForChildren",
    "restroom",
    "reservable",
    "parkingOptions",
  ].join(",");
  const res = await fetch(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    console.error(`[sync-venue-facts] details ${res.status} for ${placeId}`);
    return null;
  }
  return (await res.json()) as PlaceDetails;
}

export async function GET(request: Request) {
  const cronDenied = requireCronAuth(request);
  if (cronDenied) return cronDenied;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  }
  if (!placesKey) {
    return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500 });
  }

  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
    200
  );
  // `?only=new` onboards brand-new venues: sync ONLY never-synced rows
  // (places_synced_at IS NULL), skipping the weekly staleness refresh. A daily
  // cron uses this so a freshly-added venue gets its Places facts (and place_id,
  // which the blurb drafter needs) within a day instead of waiting for the
  // weekly full refresh — without re-billing the whole registry every day
  // (Google's free credit is sized to the weekly cadence). Once synced, the row
  // has a timestamp and drops out of this set; the weekly run maintains it.
  const onlyNew = url.searchParams.get("only") === "new";
  // Refresh anything never synced or synced more than a week ago.
  const staleBefore = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const supabase = createClient(supabaseUrl, serviceKey);

  let query = supabase
    .from("hwy4_venues")
    .select("venue_key, canonical, town, address, place_id, places_synced_at")
    // Locked venues (no correct Places listing — closed, or private/no distinct
    // listing) are never touched, so the sync can't re-populate a wrong match.
    .eq("places_locked", false);
  query = onlyNew
    ? query.is("places_synced_at", null)
    : query.or(`places_synced_at.is.null,places_synced_at.lt.${staleBefore}`);

  const { data: venuesRaw, error } = await query
    .order("places_synced_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const venues = (venuesRaw ?? []) as VenueRow[];
  if (venues.length === 0) {
    return NextResponse.json({ processed: 0, message: "No venues due for a Places refresh." });
  }

  const results: { venue_key: string; status: string }[] = [];
  for (const venue of venues) {
    const syncedAt = new Date().toISOString();
    try {
      const placeId = venue.place_id ?? (await findPlaceId(placesKey, venue));
      if (!placeId) {
        // Stamp so we don't hammer searchText every run for an unfindable venue.
        await supabase
          .from("hwy4_venues")
          .update({ places_synced_at: syncedAt, updated_at: syncedAt })
          .eq("venue_key", venue.venue_key);
        results.push({ venue_key: venue.venue_key, status: "no_match" });
        continue;
      }

      const details = await fetchDetails(placesKey, placeId);
      if (!details) {
        results.push({ venue_key: venue.venue_key, status: "details_failed" });
        continue;
      }

      await supabase
        .from("hwy4_venues")
        .update({
          place_id: placeId,
          rating: details.rating ?? null,
          user_ratings_total: details.userRatingCount ?? null,
          phone: details.nationalPhoneNumber ?? null,
          // Drop an aggregator/unstable-host website (Google sometimes returns a
          // GoCalaveras listing as a venue's "website" — e.g. Angels Camp Museum),
          // and any non-http(s) value (defense in depth — Places shouldn't return
          // one, but a stored javascript:/data: URL would render as a live href).
          // A churning aggregator is never a durable destination; mirrors
          // promotableVenueUrl's read-time guard so the STORED data stays clean too.
          website:
            details.websiteUri &&
            isHttpUrl(details.websiteUri) &&
            !isUnstableHost(details.websiteUri)
              ? details.websiteUri
              : null,
          maps_url: details.googleMapsUri ?? null,
          hours: details.regularOpeningHours?.weekdayDescriptions ?? null,
          places_attributes: buildAttributes(details),
          places_synced_at: syncedAt,
          updated_at: syncedAt,
        })
        .eq("venue_key", venue.venue_key);

      results.push({ venue_key: venue.venue_key, status: "ok" });
    } catch (err) {
      console.error(`[sync-venue-facts] error for ${venue.venue_key}:`, err);
      results.push({ venue_key: venue.venue_key, status: "error" });
    }
  }

  const tally = (s: string) => results.filter((r) => r.status === s).length;
  return NextResponse.json({
    processed: results.length,
    ok: tally("ok"),
    no_match: tally("no_match"),
    failed: tally("details_failed") + tally("error"),
    results,
  });
}

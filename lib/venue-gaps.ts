import type { SupabaseClient } from "@supabase/supabase-js";

// The "venue gap" worklist (PRD-live-music-experience.md Phase 1A): a real,
// specifically-named venue that isn't in the registry, so its events render with
// no venue section (no map pin, Google facts, or local-voice blurb). This is the
// venue analogue of lib/link-gaps.ts, and it drains into the SAME agent_actions
// queue via lib/agent/propose-venue-rows.ts.
//
// The signal is hwy4_events.venue_key IS NULL. That column is the materialized
// output of resolveVenueKey (scripts/lib/venue-matcher.ts), written on every
// scraper insert/changed-update — so a NULL key on a future, scraped event means
// the registry-driven matcher couldn't place the venue, i.e. it isn't registered.
// (We can't call resolveVenueKey here: the Next app and the scraper package have
// separate module roots, the same reason check-events duplicates the generic set.)

export const VENUE_GAP_THRESHOLD = 3;

// Generic / fallback venue names the scraper emits when it can't resolve a real
// venue. Mirrors scripts/lib/venues.ts GENERIC_VENUE_NAMES (duplicated for the
// same module-root reason as app/api/check-events/route.ts).
const GENERIC_VENUE_NAMES = new Set([
  "downtown murphys",
  "unknown venue",
  "unknown",
  "tbd",
  "angels camp",
  "murphys",
  "arnold",
  "copperopolis",
  "avery",
  "dorrington",
  "camp connell",
  "bear valley",
  "white pines",
]);
const POISONED_VENUE_PREFIX = /^(featuring|hosted by|with|feat\.?|w\/)\b/;

// True when venue_name names a real place worth a registry row — not a scraper
// fallback ("Unknown Venue", a bare town) or a poisoned string ("Featuring …").
export function isResolvableVenueName(venue: string | null | undefined): boolean {
  if (!venue) return false;
  const n = venue.toLowerCase().trim();
  if (!n) return false;
  if (GENERIC_VENUE_NAMES.has(n)) return false;
  if (POISONED_VENUE_PREFIX.test(n)) return false;
  return true;
}

export type VenueGap = {
  venue: string; // raw venue_name (the display name + the alias seed)
  count: number; // upcoming events that would gain a venue section
  town: string | null;
  sampleEventName: string | null;
};

export type VenueGapEventRow = {
  name: string;
  venue_name: string | null;
  town: string | null;
  status?: string | null;
};

// Pure aggregation, unit-tested in scripts/test/venue-gaps.test.ts. `registered`
// is the set of already-registered venue canonicals (lowercased) — a stale-NULL
// guard so a venue that IS registered but whose old rows were never backfilled
// doesn't get re-proposed.
export function aggregateVenueGaps(
  rows: VenueGapEventRow[],
  registered: Set<string>,
  threshold: number = VENUE_GAP_THRESHOLD
): VenueGap[] {
  const agg = new Map<string, { count: number; town: string | null; sampleEventName: string | null }>();
  for (const r of rows) {
    if (r.status === "cancelled") continue;
    if (!isResolvableVenueName(r.venue_name)) continue;
    const name = r.venue_name!.trim();
    if (registered.has(name.toLowerCase())) continue;
    const cur = agg.get(name) ?? { count: 0, town: r.town, sampleEventName: r.name };
    cur.count++;
    if (!cur.town && r.town) cur.town = r.town;
    agg.set(name, cur);
  }
  return [...agg.entries()]
    .filter(([, v]) => v.count >= threshold)
    .map(([venue, v]) => ({ venue, count: v.count, town: v.town, sampleEventName: v.sampleEventName }))
    .sort((a, b) => b.count - a.count);
}

// DB driver: fetch the small set of unkeyed future public events (well under the
// ~1000-row PostgREST cap — most events ARE keyed), plus the registered canonical
// set, and aggregate. Shared by the proposer and the audit so they can't drift.
export async function computeVenueGaps(supabase: SupabaseClient): Promise<VenueGap[]> {
  const today = new Date().toISOString().split("T")[0];
  const { data } = await supabase
    .from("hwy4_events")
    .select("name, venue_name, town, status")
    .is("venue_key", null)
    .gte("date", today)
    .eq("visibility", "public");
  const rows = (data ?? []) as VenueGapEventRow[];

  const { data: venueRows } = await supabase.from("hwy4_venues").select("canonical");
  const registered = new Set(
    (venueRows ?? []).map((v) => ((v as { canonical: string }).canonical ?? "").toLowerCase().trim())
  );

  return aggregateVenueGaps(rows, registered);
}

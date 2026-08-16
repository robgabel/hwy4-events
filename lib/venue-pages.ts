import type { Hwy4Event } from "./types";

// Pure helpers behind the /venues/[slug] hub pages (HWY-9) and the
// artist-aware event title tag (HWY-7). Kept out of the page files so the
// scripts/ test runner can lock them (scripts/test/venue-pages.test.ts).
//
// Relative (not "@/") imports so the scripts/ test runner can import this.

export type VenueMetaInput = {
  canonical: string;
  town: string;
};

/** True when any of the venue's upcoming slate is live music — the signal to
 *  put "Concerts" in the title tag, matching the query shape searchers use
 *  ("brice station concerts 2026", "ironstone concerts"). */
export function venueHasLiveMusic(
  events: Pick<Hwy4Event, "category">[]
): boolean {
  return events.some((e) => e.category === "live_music");
}

/** Title tag for a venue hub page. The root layout template appends
 *  "| Hwy 4 Events". Year only appears on music venues, where searchers
 *  type it ("brice station concerts 2026"). */
export function venueMetaTitle(
  venue: VenueMetaInput,
  events: Pick<Hwy4Event, "category">[],
  year: number
): string {
  return venueHasLiveMusic(events)
    ? `${venue.canonical} Concerts & Events ${year} | ${venue.town}, CA`
    : `${venue.canonical} | Upcoming Events in ${venue.town}, CA`;
}

export function venueMetaDescription(
  venue: VenueMetaInput,
  events: Pick<Hwy4Event, "category">[]
): string {
  const n = events.length;
  const what = venueHasLiveMusic(events) ? "concert and event" : "event";
  const countPhrase =
    n > 0
      ? `${n} upcoming ${what} date${n === 1 ? "" : "s"}`
      : `the current ${what} calendar`;
  return `${venue.canonical} in ${venue.town}, CA: ${countPhrase} with times and prices where stated, updated daily from the Highway 4 corridor calendar.`;
}

/**
 * The upcoming-events section's heading + optional lede on a venue hub page
 * (HWY-28). A live-music venue gets a concert-shaped heading with the year and a
 * one-sentence lede, so the page carries the surrounding text that concert-series
 * queries ("brice station concerts 2026") match; every other venue keeps the
 * plain heading and no lede. Copy is honest and voice-safe (no em dashes).
 */
export function venueListSection(
  venue: VenueMetaInput,
  events: Pick<Hwy4Event, "category">[],
  year: number
): { heading: string; lede: string | null } {
  if (venueHasLiveMusic(events)) {
    return {
      heading: `Upcoming Concerts at ${venue.canonical} ${year}`,
      lede: `Every upcoming concert at ${venue.canonical} in ${venue.town}, CA for ${year}, pulled from the Highway 4 corridor calendar and updated daily. Dates, acts, and ticket links are below.`,
    };
  }
  return { heading: `What's coming up at ${venue.canonical}`, lede: null };
}

/** Venue keys that earn a sitemap URL: at least MIN upcoming public events, so
 *  a young domain never advertises a thin venue page to crawlers. Every
 *  registry venue still renders at /venues/[key]; this only gates the sitemap. */
export const VENUE_SITEMAP_MIN_UPCOMING = 3;

export function sitemapVenueKeys(
  venueKeys: string[],
  events: Pick<Hwy4Event, "venue_key" | "visibility">[],
  minUpcoming: number = VENUE_SITEMAP_MIN_UPCOMING
): string[] {
  const counts = upcomingCountsByVenue(events);
  return venueKeys.filter((k) => (counts.get(k) ?? 0) >= minUpcoming);
}

function upcomingCountsByVenue(
  events: Pick<Hwy4Event, "venue_key" | "visibility">[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.visibility !== "public" || !e.venue_key) continue;
    counts.set(e.venue_key, (counts.get(e.venue_key) ?? 0) + 1);
  }
  return counts;
}

/** Candidate settings for the sitemap gate, evaluated weekly by the growth
 *  memo so the recommendation can name exact numbers ("raising to 5 would
 *  advertise 19 pages instead of 33"). */
export const VENUE_GATE_CANDIDATES = [1, 3, 5, 10];

/** How many venue pages the sitemap would advertise at each candidate gate.
 *  Keys are the gate values as strings (JSON-friendly for the signal pack). */
export function venueGateCounts(
  venueKeys: string[],
  events: Pick<Hwy4Event, "venue_key" | "visibility">[],
  gates: number[] = VENUE_GATE_CANDIDATES
): Record<string, number> {
  const counts = upcomingCountsByVenue(events);
  const perVenue = venueKeys.map((k) => counts.get(k) ?? 0);
  const out: Record<string, number> = {};
  for (const gate of gates) {
    out[String(gate)] = perVenue.filter((n) => n >= gate).length;
  }
  return out;
}

// A scraped artist name sometimes arrives fully shouted ("GENE SIMMONS BAND");
// title-case it for a title tag, leaving mixed-case names untouched.
function unshout(name: string): string {
  const t = name.trim();
  if (t !== t.toUpperCase()) return t;
  return t
    .toLowerCase()
    .replace(/(^|[\s\-'/])(\p{L})/gu, (m) => m.toUpperCase());
}

/**
 * Fold the headline act(s) into a series row's name for the title tag when the
 * name itself doesn't carry them: "Ironstone Summer Concert Series" +
 * [Lynyrd Skynyrd, Foghat, Molly Hatchet] ->
 * "Ironstone Summer Concert Series: Lynyrd Skynyrd & Foghat & more" (HWY-7 —
 * the generic series title sat at position 22 while the act names sat unused
 * in `artists`). No-op when the name already names an act (word overlap), so
 * "Gene Simmons – Murphys" never doubles into "…: Gene Simmons Band".
 */
export function nameWithArtists(
  name: string,
  artists: string[] | null | undefined,
  maxActs = 2
): string {
  const acts = (artists ?? []).map((a) => a.trim()).filter(Boolean);
  if (acts.length === 0) return name;
  const nameWords = new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((w) => w.length > 3)
  );
  const overlaps = acts.some((a) =>
    a
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .some((w) => w.length > 3 && nameWords.has(w))
  );
  if (overlaps) return name;
  const shown = acts.slice(0, maxActs).map(unshout);
  const suffix = shown.join(" & ") + (acts.length > maxActs ? " & more" : "");
  return `${name}: ${suffix}`;
}

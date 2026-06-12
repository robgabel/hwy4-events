/**
 * Venues whose listings are curated manually (e.g. once-a-year batch insert
 * from a printed flyer). Scrapers must skip events that match these so they
 * don't overwrite the hand-cleaned rows with messier auto-scraped versions.
 *
 * Match logic: case-insensitive substring against the event's name and
 * venue_name. Keep patterns broad enough to catch source-name variants
 * ("Cameo Plaza Merchants", "Cameo Plaza, Arnold", etc.) but narrow enough
 * to avoid false positives.
 */
const MANUAL_VENUE_PATTERNS: readonly string[] = [
  "cameo plaza",
  // The Lube Room Saloon's "Live at the Lube" summer series is transcribed from
  // an in-venue chalkboard (scripts/seed-lube-room-summer-2026.ts) and is not
  // published online. GoCalaveras re-lists it as a generic "Live Music @ The
  // Lube Room", which kept overwriting the hand-entered band titles on every
  // scrape. Matches via venue_name ("The Lube Room Saloon") on every variant.
  "lube room",
  // Calaveras Big Trees State Park publishes its interpretive program schedule as
  // recurrence rules in prose (https://www.parks.ca.gov/?page_id=25994), which the
  // scrapers can't parse. GoCalaveras re-lists the programs with wrong date ranges
  // and flattened times (Creek Critters as May 30 - Sept 5 when the park runs it
  // June 13 - Aug 15; astronomy nights at one fixed time when each date differs).
  // The canonical schedule is curated by hand (scripts/seed-bigtrees-programs-2026.ts)
  // and watched by /api/check-bigtrees-schedule. Both patterns match the venue_name
  // ("Calaveras Big Trees State Park") and the event names ("... @ Big Trees State Park").
  "big trees state park",
  "calaveras big trees",
  // The Camp Connell General Store's "Beer Garden" summer concert series is
  // transcribed from the venue's image-only season flyer
  // (scripts/seed-camp-connell-beer-garden-2026.ts) and isn't published in a
  // machine-readable form. GoCalaveras re-lists shows generically; this keeps the
  // auto-scrapers from overwriting the hand-entered lineup. Matches the
  // venue_name on every variant (store and beer-garden branding).
  "camp connell general store",
  "camp connell beer garden",
  // The Arnold Library's weekly "Storytime with Miss Debbie" came in as a
  // community submission and is hand-seeded as a recurring program
  // (scripts/seed-arnold-library-storytime-2026.ts). The county library has no
  // calendar the scrapers can read; this keeps an aggregator from later
  // re-listing storytime with wrong/flattened dates over the curated rows.
  "arnold library",
  // The Murphys Senior Center publishes its monthly schedule only as image files
  // (a calendar grid PNG + newsletter PNG on https://murphyscenter.com/calendar/),
  // which the scrapers can't parse. Its events are curated by hand and watched by
  // /api/check-murphys-senior-center-schedule. This keeps an aggregator from later
  // re-listing them with wrong/flattened dates over the curated rows. Matches the
  // venue_name ("Murphys Senior Center") on every variant.
  "murphys senior center",
  // The Lake Tulloch Lions Club's annual Hot Copper Car Show (Copperopolis Town
  // Square) is a hand-curated marquee pick: a Rob's Pick + America's-250th feature.
  // GoCalaveras lists it with a doubled title ("Hot Copper Car Show Show", slug
  // hot-copper-car-show-show) and a 23:50 placeholder end time, both of which we
  // correct by hand (the poster says 8 AM–3 PM). Blocklisting freezes those fixes
  // so a re-scrape can't revert them. Matches the event name ("Hot Copper Car
  // Show") regardless of the source's doubling.
  "hot copper car show",
  // Make and parTake (a maker/craft studio in Arnold's Meadowmont plaza) runs a
  // weekly "Summer Maker Sessions" schedule published only as a printed flyer.
  // The rows are hand-seeded as recurring programs
  // (scripts/seed-make-partake-summer-2026.ts); the studio has no calendar the
  // scrapers can read, so this keeps an aggregator from later re-listing the
  // sessions with wrong/flattened dates over the curated rows. Matches the
  // venue_name ("Make and parTake") on every variant.
  "make and partake",
  "make & partake",
];

export interface MatchableEvent {
  name?: string | null;
  venue_name?: string | null;
}

export function isManuallyManagedEvent(e: MatchableEvent): boolean {
  const haystack = `${e.name ?? ""} ${e.venue_name ?? ""}`.toLowerCase();
  return MANUAL_VENUE_PATTERNS.some((p) => haystack.includes(p));
}

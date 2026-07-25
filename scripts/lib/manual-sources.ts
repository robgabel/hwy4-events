/**
 * Venues whose listings are owned by something other than the general-purpose
 * scrapers — usually a hand-curated seed script (e.g. a once-a-year batch
 * insert from a printed flyer), sometimes a scraper that reads the organizer's
 * own calendar directly. Scrapers must skip events that match these so they
 * don't overwrite the authoritative rows with messier auto-scraped versions.
 *
 * Match logic: case-insensitive substring against the event's name and
 * venue_name. Keep patterns broad enough to catch source-name variants
 * ("Cameo Plaza Merchants", "Cameo Plaza, Arnold", etc.) but narrow enough
 * to avoid false positives.
 *
 * `owner` names the org_slug that legitimately writes these rows. That source
 * passes its own slug to `isManuallyManagedEvent` and is let through; every
 * other scraper is still blocked. A pattern with no `owner` is owned by a seed
 * script / human, so no scraper may write it.
 */
interface ManualPattern {
  pattern: string;
  owner?: string;
}

const MANUAL_VENUE_PATTERNS: readonly ManualPattern[] = [
  { pattern: "cameo plaza" },
  // The Lube Room Saloon's "Live at the Lube" summer series is transcribed from
  // an in-venue chalkboard (scripts/seed-lube-room-summer-2026.ts) and is not
  // published online. GoCalaveras re-lists it as a generic "Live Music @ The
  // Lube Room", which kept overwriting the hand-entered band titles on every
  // scrape. Matches via venue_name ("The Lube Room Saloon") on every variant.
  { pattern: "lube room" },
  // Calaveras Big Trees State Park publishes its interpretive program schedule as
  // recurrence rules in prose (https://www.parks.ca.gov/?page_id=25994), which the
  // scrapers can't parse. GoCalaveras re-lists the programs with wrong date ranges
  // and flattened times (Creek Critters as May 30 - Sept 5 when the park runs it
  // June 13 - Aug 15; astronomy nights at one fixed time when each date differs).
  // The canonical schedule is curated by hand (scripts/seed-bigtrees-programs-2026.ts)
  // and watched by /api/check-bigtrees-schedule. Both patterns match the venue_name
  // ("Calaveras Big Trees State Park") and the event names ("... @ Big Trees State Park").
  { pattern: "big trees state park" },
  { pattern: "calaveras big trees" },
  // The Camp Connell General Store's "Beer Garden" summer concert series is
  // transcribed from the venue's image-only season flyer
  // (scripts/seed-camp-connell-beer-garden-2026.ts) and isn't published in a
  // machine-readable form. GoCalaveras re-lists shows generically; this keeps the
  // auto-scrapers from overwriting the hand-entered lineup. Matches the
  // venue_name on every variant (store and beer-garden branding).
  { pattern: "camp connell general store" },
  { pattern: "camp connell beer garden" },
  // The Arnold Library's weekly "Storytime with Miss Debbie" came in as a
  // community submission and is hand-seeded as a recurring program
  // (scripts/seed-arnold-library-storytime-2026.ts). The county library has no
  // calendar the scrapers can read; this keeps an aggregator from later
  // re-listing storytime with wrong/flattened dates over the curated rows.
  { pattern: "arnold library" },
  // The Murphys Senior Center publishes its monthly schedule only as image files
  // (a calendar grid PNG + newsletter PNG on https://murphyscenter.com/calendar/),
  // which the scrapers can't parse. Its events are curated by hand and watched by
  // /api/check-murphys-senior-center-schedule. This keeps an aggregator from later
  // re-listing them with wrong/flattened dates over the curated rows. Matches the
  // venue_name ("Murphys Senior Center") on every variant.
  { pattern: "murphys senior center" },
  // The Lake Tulloch Lions Club's annual Hot Copper Car Show (Copperopolis Town
  // Square) is a hand-curated marquee pick: a Rob's Pick + America's-250th feature.
  // GoCalaveras lists it with a doubled title ("Hot Copper Car Show Show", slug
  // hot-copper-car-show-show) and a 23:50 placeholder end time, both of which we
  // correct by hand (the poster says 8 AM–3 PM). Blocklisting freezes those fixes
  // so a re-scrape can't revert them. Matches the event name ("Hot Copper Car
  // Show") regardless of the source's doubling.
  { pattern: "hot copper car show" },
  // Lake Alpine Lodge publishes its summer "Music Schedule" only as a season
  // graphic posted to Facebook (the lodge is off-grid, "just above the middle of
  // nowhere"), so the scrapers can't read it. The lineup is transcribed by hand
  // (scripts/seed-lake-alpine-lodge-2026.ts). This keeps an aggregator from later
  // re-listing the shows with wrong/flattened dates over the curated rows. Matches
  // the venue_name ("Lake Alpine Lodge") on every variant. Deliberately NOT the
  // bare "lake alpine": BVAC's events page has real non-lodge events at the lake
  // (e.g. "Lake Alpine Kid's Fishing Day") that a broader pattern would silently
  // drop — the seeded rows all carry venue_name "Lake Alpine Lodge", so the
  // narrower pattern still protects every one of them.
  { pattern: "lake alpine lodge" },
  // The Arnold Rim Trail Association owns its events on its own site, which we
  // read directly (scripts/scrapers/arnold-rim-trail.ts, The Events Calendar
  // REST API). Its guided hikes start at sunset, so the start time shifts ~40
  // minutes a month AND ART edits an occurrence as the date nears (the July 25,
  // 2026 hike moved 5:45 PM → 6:15 PM five days out). GoCalaveras snapshots a
  // listing once and never revisits it, so its copy goes stale and — because
  // every scraper writes start_time unconditionally — kept overwriting the
  // organizer's correct time on the same nightly run. These patterns keep the
  // aggregators off the rows; `owner` lets the ART scraper itself through.
  // Covers the event names ("Guided Sunset Hike to Cougar Rock", "Volunteer
  // Trail Workday", "… : Arnold Rim Trail", incl. the source's "Aronld" typo)
  // and the venue ("ART Trailhead – Valley View Dr.").
  { pattern: "arnold rim trail", owner: "arnold-rim-trail" },
  { pattern: "aronld rim trail", owner: "arnold-rim-trail" },
  { pattern: "cougar rock", owner: "arnold-rim-trail" },
  { pattern: "volunteer trail workday", owner: "arnold-rim-trail" },
  { pattern: "art trailhead", owner: "arnold-rim-trail" },
];

export interface MatchableEvent {
  name?: string | null;
  venue_name?: string | null;
}

/**
 * True when `e` belongs to a source other than the one asking, and so must not
 * be written by it.
 *
 * `askingOrgSlug` is the org_slug of the scraper making the call. Pass it from
 * a scraper that legitimately owns some blocklisted rows (it reads the
 * organizer's own calendar); omit it — as the general-purpose aggregators do —
 * to be blocked from every blocklisted event.
 */
export function isManuallyManagedEvent(
  e: MatchableEvent,
  askingOrgSlug?: string
): boolean {
  const haystack = `${e.name ?? ""} ${e.venue_name ?? ""}`.toLowerCase();
  return MANUAL_VENUE_PATTERNS.some(
    (p) =>
      haystack.includes(p.pattern) &&
      (p.owner === undefined || p.owner !== askingOrgSlug)
  );
}

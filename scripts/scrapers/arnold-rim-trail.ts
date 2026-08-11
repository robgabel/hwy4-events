import { decodeEventFields, type ExtractedEvent } from "../lib/extract.js";
import { beginOrganizerRun } from "../lib/organizer-source.js";
import { writeOrganizerBatch } from "../lib/organizer-source-exec.js";
import { applyVenueDetection } from "../lib/venue-matcher.js";
import { TOWNS } from "../../lib/towns.js";
import { classifyEventCategory } from "../../lib/categorize.js";
import {
  fetchAllTribeEvents,
  htmlToText,
  joinAddress,
  normalizeCost,
  splitDateTime,
  stripTitleDateSuffix,
  type TribeEvent,
} from "../lib/tribe.js";

/**
 * Arnold Rim Trail Association — the organizer's own events calendar.
 *
 * WHY THIS SCRAPER EXISTS (2026-07-25). ART's guided sunset hikes are scheduled
 * around the full moon and *start at sunset*, so the start time shifts by ~40
 * minutes month to month — and ART edits an occurrence's time as the date
 * approaches (the July 25, 2026 hike moved from 5:45 PM to 6:15 PM on July 20,
 * five days out). We were carrying these events only via GoCalaveras, which
 * snapshots a listing once and never revisits it, so the site showed a hike
 * time that was 30 minutes wrong on the day of the hike — the exact "trust
 * built on accuracy" failure the personas doc calls fatal.
 *
 * ART runs The Events Calendar (Tribe) WordPress plugin, so its own site
 * publishes exact start/end datetimes as structured JSON. Reading the organizer
 * directly means the times self-heal on every daily scrape, however often ART
 * moves them. It also picks up the Volunteer Trail Workday series, which the
 * aggregator never listed at all.
 *
 * Aggregator copies of these events are blocked in `scripts/lib/manual-sources.ts`
 * (owned by this org_slug) so GoCalaveras can't overwrite the organizer's times
 * with its stale snapshot on a later pass of the same nightly run.
 *
 * No stale sweep (see scripts/lib/organizer-source.ts). The Tribe endpoint is
 * queried forward from today with no upper bound, so the window would be
 * derivable — but ART runs a handful of events a year, and against a catalog
 * that small the sweep's floor cap (3 rows) is a large share of the whole
 * calendar. If ghosts ever appear here, supply a plan; don't assume one.
 */

const API_URL = "https://arnoldrimtrail.org/wp-json/tribe/events/v1/events";
const PAGE_URL = "https://arnoldrimtrail.org/events/";
const SOURCE_NAME = "Arnold Rim Trail";
const ORG_SLUG = "arnold-rim-trail";
const PER_PAGE = 50;
const MAX_PAGES = 6; // ART runs a handful of events a year — 300 is ample

const HWY4_TOWNS = new Set(TOWNS.map((t) => t.toLowerCase()));

/**
 * ART's trailheads and its Forest Service meeting point sit in unincorporated
 * spots that aren't canonical corridor towns. Map them to the town a reader
 * would filter by, matching the alias `lib/event-identity.ts` already uses when
 * matching rows (`hathaway pines` → `arnold`).
 */
const TOWN_ALIASES: Record<string, string> = {
  "hathaway pines": "Arnold",
  "white pines": "White Pines",
  avery: "Avery",
};

function pickTown(ev: TribeEvent): string | null {
  const city = ev.venue?.city?.trim();
  if (!city) return "Arnold"; // ART is an Arnold organization; its trail is the Arnold Rim Trail
  const canonical = TOWNS.find((t) => t.toLowerCase() === city.toLowerCase());
  if (canonical) return canonical;
  return TOWN_ALIASES[city.toLowerCase()] ?? city;
}

function mapTribeEvent(ev: TribeEvent): ExtractedEvent | null {
  if (ev.status !== "publish") return null;

  const { date, time: startTime } = splitDateTime(ev.start_date, ev.all_day);
  const { time: endTime } = splitDateTime(ev.end_date, ev.all_day);
  const town = pickTown(ev);
  if (!town) return null;

  // ART titles every occurrence with its own date ("… – July 25, 2026") so each
  // gets a distinct WordPress post. The date lives in its own column.
  const name = stripTitleDateSuffix(ev.title);

  return {
    name,
    description: ev.description ? htmlToText(ev.description) || null : null,
    date,
    start_time: startTime,
    end_time: endTime,
    venue_name: ev.venue?.venue?.trim() || "Arnold Rim Trail",
    town,
    address: joinAddress(ev.venue),
    category: classifyEventCategory(
      `${name} ${(ev.categories ?? []).map((c) => c.name).join(" ")}`
    ),
    price: normalizeCost(ev.cost),
    artists: null,
    event_url: ev.url,
    image_url: ev.image?.url || null,
    // Tribe post id — stable per occurrence, survives title/venue/time edits, so
    // a rescheduled hike updates in place instead of duplicating.
    source_event_id: String(ev.id),
  };
}

export async function scrapeArnoldRimTrail(): Promise<void> {
  const run = beginOrganizerRun({
    title: "Arnold Rim Trail (Tribe REST API)",
    sourceName: SOURCE_NAME,
    orgSlug: ORG_SLUG,
    pageUrl: PAGE_URL,
  });

  const tribeEvents = await fetchAllTribeEvents(API_URL, {
    startDate: run.today,
    perPage: PER_PAGE,
    maxPages: MAX_PAGES,
  });
  console.log(`\nFetched ${tribeEvents.length} events from Tribe API`);

  const mapped: ExtractedEvent[] = [];
  for (const ev of tribeEvents) {
    try {
      const m = mapTribeEvent(ev);
      if (m) mapped.push(decodeEventFields(m));
    } catch (err) {
      console.warn(`  Failed to map event ${ev.id} (${ev.title}):`, err);
    }
  }

  // Resolve trailhead / meeting-point names against the venue registry so they
  // pick up canonical naming + a street address where one is registered.
  let venueFixed = 0;
  for (const e of mapped) {
    if (applyVenueDetection(e)) venueFixed++;
  }
  if (venueFixed > 0) {
    console.log(`  Venue detection: resolved ${venueFixed}/${mapped.length} venues`);
  }

  const corridor = mapped.filter((e) => HWY4_TOWNS.has(e.town.toLowerCase().trim()));
  if (corridor.length < mapped.length) {
    const skipped = [
      ...new Set(
        mapped
          .filter((e) => !HWY4_TOWNS.has(e.town.toLowerCase().trim()))
          .map((e) => e.town)
      ),
    ];
    console.log(`  Skipped non-corridor towns: ${skipped.join(", ")}`);
  }

  // Future-only — never write past events.
  const future = corridor.filter((e) => e.date >= run.today);

  // NOTE: deliberately no `isManuallyManagedEvent` filter. ART's events ARE
  // blocklisted there, but this scraper is the owner the blocklist protects them
  // for — the guard exists to keep *aggregators* off these rows, not the
  // organizer's own feed.

  for (const e of future) {
    console.log(
      `  - ${e.name} | ${e.date} | ${e.start_time ?? "?"}–${e.end_time ?? "?"} | ${e.town} | ${e.venue_name} | ${e.category}`
    );
  }

  const { upsert, written } = await writeOrganizerBatch(run, { events: future });
  if (written === 0) {
    console.log("No future corridor events to upsert.");
    return;
  }

  console.log("\n=== Arnold Rim Trail Summary ===");
  console.log(`Fetched from Tribe API: ${tribeEvents.length}`);
  console.log(`Events in Hwy 4 corridor: ${corridor.length}`);
  console.log(`Future events: ${future.length}`);
  console.log(`Inserted: ${upsert.inserted}`);
  console.log(`Updated: ${upsert.updated}`);
  console.log(`Unchanged: ${upsert.unchanged}`);
}

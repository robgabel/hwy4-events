import { decodeEventFields, type ExtractedEvent } from "../lib/extract.js";
import { runOrganizerSource } from "../lib/organizer-source.js";
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
 * with its stale snapshot on a later pass of the same nightly run. This scraper
 * passes its own slug to the shared skeleton's blocklist check, so the five
 * `owner: "arnold-rim-trail"` patterns let it through while any OTHER curated
 * venue that turned up on ART's feed would still be protected.
 *
 * Everything around the mapping (venue detection, that blocklist, the future
 * filter, the upsert, the summary) is the shared
 * `scripts/lib/organizer-source.ts` skeleton. No stale sweep: ART's calendar is
 * sparse enough that a single thin fetch is indistinguishable from a quiet
 * season, and the times self-heal on every pass anyway.
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
  await runOrganizerSource({
    sourceName: SOURCE_NAME,
    orgSlug: ORG_SLUG,
    pageUrl: PAGE_URL,
    banner: "Arnold Rim Trail (Tribe REST API)",
    // Runs after the skeleton's venue detection so the corridor test sees the
    // registry-canonical town (a trailhead resolved from the registry can pull
    // its row into a corridor town the raw feed didn't name).
    refine(events) {
      const corridor = events.filter((e) => HWY4_TOWNS.has(e.town.toLowerCase().trim()));
      if (corridor.length < events.length) {
        const skipped = [
          ...new Set(
            events
              .filter((e) => !HWY4_TOWNS.has(e.town.toLowerCase().trim()))
              .map((e) => e.town)
          ),
        ];
        console.log(`  Skipped non-corridor towns: ${skipped.join(", ")}`);
      }
      console.log(`  Events in Hwy 4 corridor: ${corridor.length}`);
      return corridor;
    },
    async harvest({ today }) {
      const tribeEvents = await fetchAllTribeEvents(API_URL, {
        startDate: today,
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

      return {
        batches: [{ events: mapped }],
        context: undefined,
        summaryLines: [`Fetched from Tribe API: ${tribeEvents.length}`],
      };
    },
  });
}

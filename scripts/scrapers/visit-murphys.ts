import { decodeEventFields, type ExtractedEvent } from "../lib/extract.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";
import { applyVenueDetection } from "../lib/venue-matcher.js";
import { isManuallyManagedEvent } from "../lib/manual-sources.js";
import { TOWNS } from "../../lib/towns.js";
import { classifyEventCategory } from "../../lib/categorize.js";
import {
  fetchAllTribeEvents,
  htmlToText,
  joinAddress,
  normalizeCost,
  splitDateTime,
  type TribeEvent,
} from "../lib/tribe.js";

/**
 * Visit Murphys runs The Events Calendar (Tribe) WordPress plugin. Its REST
 * API returns clean structured event JSON (venue, organizer, dates, image,
 * categories) — far more reliable than Firecrawl-markdown + LLM extraction.
 *
 * This scraper replaces the previous `visit-murphys` Firecrawl source.
 *
 * The transport + field mappers live in `scripts/lib/tribe.ts`, shared with the
 * `arnold-rim-trail` source (the other corridor site on the same plugin). That
 * module also carries the bot-wall workaround this site needs: since late June
 * 2026 a direct `fetch` to the wp-json endpoint 403s, or 200s with an HTML
 * challenge page instead of JSON, so the client falls back to Firecrawl.
 */

const API_URL = "https://visitmurphys.com/wp-json/tribe/events/v1/events";
const PAGE_URL = "https://visitmurphys.com/events/";
const SOURCE_NAME = "Visit Murphys";
const ORG_SLUG = "visit-murphys";
const PER_PAGE = 50;
const MAX_PAGES = 20; // safety bound — 1000 events
const DEFAULT_VENUE = "Downtown Murphys";
const DEFAULT_TOWN = "Murphys";

const HWY4_TOWNS = new Set(TOWNS.map((t) => t.toLowerCase()));

// Venue names that signal a virtual/non-physical event and should be dropped.
const VIRTUAL_VENUES = new Set(["zoom", "online", "virtual", "google meet", "teams"]);

// ---------- Mapper ----------

function pickCategory(tribeCats: Array<{ name: string; slug: string }> | undefined, title: string): string {
  // Shared keyword classifier (lib/categorize.ts) is the single source of truth,
  // reused by the /admin/submissions publish default. Feed it the title + the
  // source's own category names.
  return classifyEventCategory(`${title} ${(tribeCats ?? []).map((c) => c.name).join(" ")}`);
}

function pickTown(v: TribeEvent["venue"]): string {
  const city = v?.city?.trim();
  if (city) return city;
  // Default for venueless/cityless events: most Visit Murphys events without a
  // venue are downtown Murphys (Main Street, parks, businesses). Default to Murphys.
  return DEFAULT_TOWN;
}

function mapTribeEvent(ev: TribeEvent): ExtractedEvent | null {
  if (ev.status !== "publish") return null;

  const { date: startDate, time: startTime } = splitDateTime(ev.start_date, ev.all_day);
  const { time: endTime } = splitDateTime(ev.end_date, ev.all_day);
  const town = pickTown(ev.venue);
  const venueName = ev.venue?.venue?.trim() || DEFAULT_VENUE;
  const description = ev.description ? htmlToText(ev.description) || null : null;

  return {
    name: ev.title,
    description,
    date: startDate,
    start_time: startTime,
    end_time: endTime,
    venue_name: venueName,
    town,
    address: joinAddress(ev.venue),
    category: pickCategory(ev.categories, ev.title),
    price: normalizeCost(ev.cost),
    artists: null,
    event_url: ev.url,
    image_url: ev.image?.url || null,
    // Tribe `id` is stable per event occurrence — survives title/venue edits.
    source_event_id: String(ev.id),
  };
}

// ---------- Main ----------

export async function scrapeVisitMurphys(): Promise<void> {
  console.log("=== Visit Murphys (Tribe REST API) ===");

  const today = new Date().toISOString().slice(0, 10);

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

  // Post-extraction venue resolution: clean up generic venue names ("Downtown
  // Murphys" stays, but anything matching a registered venue gets the canonical
  // name + address).
  let venueFixed = 0;
  for (const e of mapped) {
    if (applyVenueDetection(e)) venueFixed++;
  }
  if (venueFixed > 0) {
    console.log(`  Venue detection: resolved ${venueFixed}/${mapped.length} generic venues`);
  }

  // Drop virtual events — Visit Murphys lists Zoom-based business meetings that
  // are not physical events in the corridor.
  const physical = mapped.filter(
    (e) => !VIRTUAL_VENUES.has(e.venue_name.trim().toLowerCase())
  );
  const virtualSkipped = mapped.length - physical.length;
  if (virtualSkipped > 0) {
    console.log(`  Skipped ${virtualSkipped} virtual event(s) (Zoom/online)`);
  }

  // Filter to corridor towns (case-insensitive match against TOWNS list)
  const corridor = physical.filter((e) =>
    HWY4_TOWNS.has(e.town.toLowerCase().trim())
  );
  if (corridor.length < physical.length) {
    const skippedTowns = [
      ...new Set(
        physical
          .filter((e) => !HWY4_TOWNS.has(e.town.toLowerCase().trim()))
          .map((e) => e.town)
      ),
    ];
    console.log(`  Skipped non-corridor towns: ${skippedTowns.join(", ")}`);
  }

  // Skip manually-managed events (e.g. Rob's curated picks shouldn't be overwritten)
  const manualSkipped = corridor.filter((e) => isManuallyManagedEvent(e));
  const scrapable = corridor.filter((e) => !isManuallyManagedEvent(e));
  if (manualSkipped.length > 0) {
    console.log(
      `  Skipping ${manualSkipped.length} manually-managed event(s): ${manualSkipped
        .map((e) => `${e.name} @ ${e.venue_name}`)
        .join("; ")}`
    );
  }

  // Future-only — never write past events
  const future = scrapable.filter((e) => e.date >= today);

  console.log(
    `\nTotal: ${mapped.length} mapped, ${corridor.length} in corridor, ${future.length} future`
  );

  for (const e of future) {
    console.log(
      `  - ${e.name} | ${e.date} | ${e.town} | ${e.venue_name} | ${e.category}`
    );
  }

  if (future.length === 0) {
    console.log("No future corridor events to upsert.");
    return;
  }

  const result: UpsertResult = await upsertEvents(future, SOURCE_NAME, ORG_SLUG, PAGE_URL);

  console.log("\n=== Visit Murphys Summary ===");
  console.log(`Fetched from Tribe API: ${tribeEvents.length}`);
  console.log(`Events in Hwy 4 corridor: ${corridor.length}`);
  console.log(`Future events: ${future.length}`);
  console.log(`Inserted: ${result.inserted}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Unchanged: ${result.unchanged}`);
}

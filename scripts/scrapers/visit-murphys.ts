import Anthropic from "@anthropic-ai/sdk";
import { decodeEventFields, type ExtractedEvent } from "../lib/extract.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
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

const anthropic = new Anthropic();

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

// ---------- Cross-source dedup (mirrors gocalaveras) ----------

async function crossSourceDedup(
  newEvents: ExtractedEvent[]
): Promise<ExtractedEvent[]> {
  if (newEvents.length === 0) return [];

  const dates = newEvents.map((e) => e.date).sort();
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];

  const { data: existingEvents, error } = await supabaseAdmin
    .from("hwy4_events")
    .select("name, date, town, venue_name, source_name")
    .neq("source_name", SOURCE_NAME)
    .gte("date", minDate)
    .lte("date", maxDate);

  if (error) {
    console.warn("Failed to fetch existing events for dedup:", error.message);
    return newEvents;
  }

  if (!existingEvents || existingEvents.length === 0) {
    console.log("No existing events in date range — skipping cross-source dedup");
    return newEvents;
  }

  console.log(
    `\nCross-source dedup: checking ${newEvents.length} new events against ${existingEvents.length} existing events`
  );

  const existingList = existingEvents
    .map(
      (e, i) =>
        `E${i}: "${e.name}" on ${e.date} at ${e.venue_name}, ${e.town} (source: ${e.source_name})`
    )
    .join("\n");

  const newList = newEvents
    .map(
      (e, i) =>
        `N${i}: "${e.name}" on ${e.date} at ${e.venue_name}, ${e.town}`
    )
    .join("\n");

  const prompt = `You are deduplicating events. Below are EXISTING events already in our database (from venue-specific scrapers like Murphys Irish Pub, Brice Station, etc.) and NEW events from an aggregator site (visitmurphys.com).

Identify which NEW events are duplicates of EXISTING events. Two events are duplicates if they are clearly the same event — same date, same or very similar venue/location, and the names refer to the same thing (even if worded differently).

Examples of duplicates:
- "Live Music: John Smith" and "John Smith Live" on the same date at the same venue
- "Trivia Night" at "Murphys Irish Pub" appearing in both sources

Examples of NOT duplicates:
- Same name but different dates (these are separate occurrences)
- Same date but clearly different venues and event types

EXISTING events:
${existingList}

NEW events:
${newList}

Return a JSON array of the NEW event indices (just the numbers) that are DUPLICATES of existing events. If none are duplicates, return an empty array.
Return ONLY the JSON array, e.g. [0, 3, 5] — no other text.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";
    const jsonStr = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const duplicateIndices: number[] = JSON.parse(jsonStr);

    if (duplicateIndices.length > 0) {
      const dupSet = new Set(duplicateIndices);
      const duped = newEvents.filter((_, i) => dupSet.has(i));
      console.log(
        `Cross-source dedup removed ${duplicateIndices.length} duplicates:`
      );
      for (const e of duped) {
        console.log(`  ✕ ${e.name} | ${e.date} | ${e.venue_name}`);
      }
      return newEvents.filter((_, i) => !dupSet.has(i));
    }

    console.log("Cross-source dedup: no duplicates found");
    return newEvents;
  } catch (err) {
    console.warn("Cross-source dedup LLM call failed, proceeding without:", err);
    return newEvents;
  }
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

  const deduped = await crossSourceDedup(future);

  let result: UpsertResult = { inserted: 0, updated: 0, unchanged: 0, skippedFuzzy: 0, unpinned: 0 };
  if (deduped.length > 0) {
    result = await upsertEvents(deduped, SOURCE_NAME, ORG_SLUG, PAGE_URL);
  }

  console.log("\n=== Visit Murphys Summary ===");
  console.log(`Fetched from Tribe API: ${tribeEvents.length}`);
  console.log(`Events in Hwy 4 corridor: ${corridor.length}`);
  console.log(`Future events: ${future.length}`);
  console.log(`After cross-source dedup: ${deduped.length}`);
  console.log(`Inserted: ${result.inserted}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Unchanged: ${result.unchanged}`);
}

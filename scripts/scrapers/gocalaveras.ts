import Anthropic from "@anthropic-ai/sdk";
import { decodeEventFields, type ExtractedEvent } from "../lib/extract.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";

const EVENTS_URL = "https://www.gocalaveras.com/events/";
const AJAX_URL = "https://www.gocalaveras.com/wp-admin/admin-ajax.php";
const SOURCE_NAME = "GoCalaveras.com";
const ORG_SLUG = "gocalaveras";
const MONTHS_TO_SCRAPE = 6;

/** Towns along the Hwy 4 corridor that we care about */
const HWY4_TOWNS = new Set([
  "copperopolis",
  "angels camp",
  "murphys",
  "avery",
  "white pines",
  "arnold",
  "dorrington",
  "camp connell",
  "bear valley",
]);

const HWY4_TOWN_LIST = [
  "Copperopolis",
  "Angels Camp",
  "Murphys",
  "Avery",
  "White Pines",
  "Arnold",
  "Dorrington",
  "Camp Connell",
  "Bear Valley",
];

const anthropic = new Anthropic();

// ---------- Types for EventON AJAX response ----------

interface EventONEvent {
  ID: number;
  event_id: number;
  event_start_unix: number;
  event_end_unix: number;
  event_title: string;
  event_color: number | string;
  event_type: string;
  event_past: string;
  event_pmv: Record<string, string[]>;
}

interface EventONResponse {
  status: string;
  json: EventONEvent[];
  html: string;
  cal_month_title: string;
  SC: Record<string, string>;
}

// ---------- Main scraper ----------

export async function scrapeGoCalaveras(): Promise<void> {
  console.log("=== GoCalaveras Scraper ===");

  const today = new Date().toISOString().slice(0, 10);

  // Step 1: Fetch page to get nonce and shortcode config
  console.log("Fetching page to extract nonce and calendar config...");
  const pageResp = await fetch(EVENTS_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });
  const html = await pageResp.text();

  const nonceMatch = html.match(/postnonce["']?\s*:\s*["']([a-f0-9]+)["']/);
  const nonce = nonceMatch?.[1] || "";
  if (!nonce) {
    console.error("Could not extract nonce from page");
    return;
  }

  const dataSCMatch = html.match(/data-sc='([^']+)'/);
  if (!dataSCMatch) {
    console.error("Could not extract data-sc shortcode from page");
    return;
  }
  const baseShortcode = JSON.parse(dataSCMatch[1]);
  console.log(`Nonce: ${nonce}, Calendar: ${baseShortcode.cal_id}`);

  // Step 2: Build list of months to scrape
  const now = new Date();
  const monthsToScrape: {
    month: number;
    year: number;
    label: string;
    startUnix: number;
    endUnix: number;
  }[] = [];

  for (let i = 0; i < MONTHS_TO_SCRAPE; i++) {
    const start = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + i + 1, 0, 23, 59, 59);
    monthsToScrape.push({
      month: start.getMonth() + 1,
      year: start.getFullYear(),
      label: start.toLocaleString("en-US", { month: "long", year: "numeric" }),
      startUnix: Math.floor(start.getTime() / 1000),
      endUnix: Math.floor(end.getTime() / 1000),
    });
  }

  console.log(
    `Scraping ${MONTHS_TO_SCRAPE} months: ${monthsToScrape.map((m) => m.label).join(", ")}`
  );

  // Step 3: Fetch each month via direct AJAX POST
  const allEvents: ExtractedEvent[] = [];

  for (const { month, year, label, startUnix, endUnix } of monthsToScrape) {
    console.log(`\n--- Fetching ${label} ---`);

    try {
      const events = await fetchMonth(
        baseShortcode,
        nonce,
        month,
        year,
        startUnix,
        endUnix
      );
      console.log(`  ${label}: ${events.length} events extracted`);
      allEvents.push(...events);
    } catch (err) {
      console.error(`  ${label}: fetch failed:`, err);
    }
  }

  // Step 4: Filter to Hwy 4 corridor towns
  const corridorEvents = allEvents.filter((e) =>
    HWY4_TOWNS.has(e.town.toLowerCase().trim())
  );
  const futureEvents = corridorEvents.filter((e) => e.date >= today);

  console.log(
    `\nTotal: ${allEvents.length} events, ${corridorEvents.length} in corridor, ${futureEvents.length} future`
  );

  if (allEvents.length > corridorEvents.length) {
    const skipped = allEvents.filter(
      (e) => !HWY4_TOWNS.has(e.town.toLowerCase().trim())
    );
    const skippedTowns = [...new Set(skipped.map((e) => e.town))];
    console.log(`Skipped towns outside corridor: ${skippedTowns.join(", ")}`);
  }

  for (const e of corridorEvents) {
    console.log(
      `  - ${e.name} | ${e.date} | ${e.town} | ${e.venue_name} | ${e.category}`
    );
  }

  if (futureEvents.length === 0) {
    console.log("No future corridor events to upsert.");
    return;
  }

  // Step 5: Cross-source dedup
  const deduped = await crossSourceDedup(futureEvents);

  let totalResult: UpsertResult = { inserted: 0, updated: 0, unchanged: 0, skippedFuzzy: 0 };

  if (deduped.length > 0) {
    totalResult = await upsertEvents(deduped, SOURCE_NAME, ORG_SLUG, EVENTS_URL);
  }

  console.log("\n=== GoCalaveras Summary ===");
  console.log(`Months scraped: ${MONTHS_TO_SCRAPE}`);
  console.log(`Events extracted (all): ${allEvents.length}`);
  console.log(`Events in Hwy 4 corridor: ${corridorEvents.length}`);
  console.log(`Events after cross-source dedup: ${deduped.length}`);
  console.log(`Events inserted: ${totalResult.inserted}`);
  console.log(`Events updated: ${totalResult.updated}`);
  console.log(`Events unchanged: ${totalResult.unchanged}`);
}

// ---------- Direct AJAX month fetching ----------

/**
 * Fetch a single month of events via direct POST to EventON's AJAX endpoint.
 * This bypasses Firecrawl entirely — no headless browser needed.
 * The response includes structured JSON with full event data.
 */
async function fetchMonth(
  baseShortcode: Record<string, any>,
  nonce: string,
  month: number,
  year: number,
  startUnix: number,
  endUnix: number
): Promise<ExtractedEvent[]> {
  // Build shortcode with target month's date range
  const shortcode = {
    ...baseShortcode,
    fixed_month: String(month),
    fixed_year: String(year),
    fixed_day: "1",
    focus_start_date_range: String(startUnix),
    focus_end_date_range: String(endUnix),
  };

  // Build form data matching jQuery.ajax serialization
  const fd = new URLSearchParams();
  fd.append("action", "the_ajax_hook");
  fd.append("direction", "none");
  fd.append("ajaxtype", "initial");

  for (const [key, val] of Object.entries(shortcode)) {
    if (typeof val === "object" && val !== null) {
      fd.append(`shortcode[${key}]`, JSON.stringify(val));
    } else {
      fd.append(`shortcode[${key}]`, String(val));
    }
  }

  const resp = await fetch(AJAX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "X-Requested-With": "XMLHttpRequest",
      Referer: EVENTS_URL,
    },
    body: fd.toString(),
  });

  if (!resp.ok) {
    throw new Error(`AJAX request failed: ${resp.status}`);
  }

  const text = await resp.text();
  if (text.length <= 5) {
    console.log(`  Empty response (${text.length} chars) — no events this month`);
    return [];
  }

  let data: EventONResponse;
  try {
    data = JSON.parse(text);
  } catch {
    console.warn(`  Failed to parse AJAX response (${text.length} chars)`);
    return [];
  }

  if (data.status !== "GOOD" || !data.json || !Array.isArray(data.json)) {
    console.warn(`  Unexpected response status: ${data.status}`);
    return [];
  }

  console.log(
    `  AJAX response: ${data.json.length} events in JSON, ${data.html?.length || 0} chars HTML`
  );

  // Extract real event URLs from the HTML response
  const urlMap = extractUrlsFromHtml(data.html, data.json);

  // Parse structured event data directly from JSON and decode HTML entities
  const events = parseEventONEvents(data.json, year, urlMap).map(decodeEventFields);

  // Use LLM to classify categories and map towns for events that need it
  if (events.length > 0) {
    await classifyEvents(events);
  }

  return events;
}

// ---------- HTML URL extraction ----------

/**
 * Extract real event URLs from EventON's HTML response.
 * Each event div contains: <div class="evo_event_schema"><a href="..."></a></div>
 * We key by event_id to match against the JSON data.
 */
function extractUrlsFromHtml(
  html: string,
  events: EventONEvent[]
): Map<number, string> {
  const urlMap = new Map<number, string>();

  for (const ev of events) {
    // Match the event div by data-event_id, then extract the schema URL
    const eventDivRegex = new RegExp(
      `data-event_id="${ev.event_id}"[^>]*>\\s*<div[^>]*class="evo_event_schema"[^>]*>\\s*<a[^>]*href="([^"]+)"`,
      "i"
    );
    const match = html.match(eventDivRegex);
    if (match?.[1]) {
      urlMap.set(ev.event_id, match[1]);
    }
  }

  // Fallback: also try matching by event ID in the div id attribute
  // Format: id="event_191022_0"
  if (urlMap.size < events.length) {
    for (const ev of events) {
      if (urlMap.has(ev.event_id)) continue;
      const altRegex = new RegExp(
        `id="event_${ev.event_id}_\\d+"[^>]*>[\\s\\S]*?<a[^>]*href="(https://www\\.gocalaveras\\.com/events/[^"]+)"`,
        "i"
      );
      const match = html.match(altRegex);
      if (match?.[1]) {
        urlMap.set(ev.event_id, match[1]);
      }
    }
  }

  console.log(
    `  URL extraction: ${urlMap.size}/${events.length} real URLs found in HTML`
  );
  return urlMap;
}

// ---------- Structured event parsing ----------

/**
 * Parse EventON JSON events into our ExtractedEvent format.
 * Most fields are directly available — no LLM needed for basic extraction.
 */
function parseEventONEvents(
  events: EventONEvent[],
  year: number,
  urlMap: Map<number, string>
): ExtractedEvent[] {
  const results: ExtractedEvent[] = [];

  for (const ev of events) {
    try {
      const startDate = new Date(ev.event_start_unix * 1000);
      const endDate = new Date(ev.event_end_unix * 1000);

      const pmv = ev.event_pmv || {};

      // Extract location info from PMV metadata
      const subtitle = pmv.evcal_subtitle?.[0] || "";
      const locationName = pmv.evcal_location_name?.[0] || subtitle || "";
      const locationAddress = pmv.evcal_location_address?.[0] || pmv.evcal_location?.[0] || null;
      const eventUrl = pmv._evcal_exlink?.[0] || null;

      // Parse town from location address
      let town = "Unknown";
      if (locationAddress) {
        // Try to extract town from address string
        const addressLower = locationAddress.toLowerCase();
        for (const t of HWY4_TOWN_LIST) {
          if (addressLower.includes(t.toLowerCase())) {
            town = t;
            break;
          }
        }
        // If no match, try to extract from comma-separated parts
        if (town === "Unknown") {
          const parts = locationAddress.split(",").map((p: string) => p.trim());
          if (parts.length >= 2) {
            town = parts[parts.length - 2] || parts[0]; // Typically "City" is second-to-last
          }
        }
      }
      // Also check location name for town hints
      if (town === "Unknown" && locationName) {
        const nameLower = locationName.toLowerCase();
        for (const t of HWY4_TOWN_LIST) {
          if (nameLower.includes(t.toLowerCase())) {
            town = t;
            break;
          }
        }
      }

      // Extract price
      const price = pmv._evcal_ec_f?.[0] || null;

      // Format times
      const startTime = `${String(startDate.getHours()).padStart(2, "0")}:${String(startDate.getMinutes()).padStart(2, "0")}`;
      const endTime = `${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`;

      // Use real URL from HTML, PMV external link, or null
      const finalEventUrl =
        urlMap.get(ev.event_id) || eventUrl || null;

      results.push({
        name: ev.event_title,
        description: pmv.evcal_description?.[0]?.slice(0, 200) || null,
        date: startDate.toISOString().slice(0, 10),
        start_time: startTime !== "00:00" ? startTime : null,
        end_time: endTime !== "00:00" ? endTime : null,
        venue_name: locationName || "Unknown Venue",
        town,
        address: locationAddress,
        category: "other", // Will be classified by LLM
        price: price ? `$${price}` : null,
        artists: null, // Will be classified by LLM if applicable
        event_url: finalEventUrl,
      });
    } catch (err) {
      console.warn(`  Failed to parse event ${ev.event_id}: ${err}`);
    }
  }

  return results;
}

// ---------- LLM-based category classification ----------

/**
 * Use Claude to classify event categories and extract artists.
 * Much cheaper than full LLM extraction since we only need classification.
 */
async function classifyEvents(events: ExtractedEvent[]): Promise<void> {
  const eventList = events
    .map(
      (e, i) =>
        `${i}: "${e.name}" at ${e.venue_name}, ${e.town} on ${e.date}${e.description ? ` — ${e.description.slice(0, 100)}` : ""}`
    )
    .join("\n");

  const prompt = `Classify these events and extract performer names.

For each event, return a JSON array of objects with:
- i: event index number
- category: one of: live_music, festival, civic, resort, other
  - "live_music" for concerts, music nights, DJ sets, open mic
  - "festival" for multi-day community events, fairs, seasonal celebrations
  - "civic" for community meetings, government events, fundraisers
  - "resort" for resort/lodge-specific activities
  - "other" for everything else (dinners, wine events, theater, classes, etc.)
- artists: array of performer/artist names if it's live music, else null
- town: if the town is "Unknown", infer it from the venue name if possible. Use one of: ${HWY4_TOWN_LIST.join(", ")}. If you can't determine it, return "Unknown".

Events:
${eventList}

Return ONLY the JSON array, no other text.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";
    const jsonStr = text
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "");
    const classifications = JSON.parse(jsonStr) as Array<{
      i: number;
      category: string;
      artists: string[] | null;
      town?: string;
    }>;

    for (const c of classifications) {
      if (c.i >= 0 && c.i < events.length) {
        events[c.i].category = c.category;
        events[c.i].artists = c.artists;
        if (c.town && c.town !== "Unknown" && events[c.i].town === "Unknown") {
          events[c.i].town = c.town;
        }
      }
    }
  } catch (err) {
    console.warn("Category classification failed, using defaults:", err);
  }
}

// ---------- Cross-source deduplication ----------

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
    console.log(
      "No existing events in date range — skipping cross-source dedup"
    );
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

  const prompt = `You are deduplicating events. Below are EXISTING events already in our database (from venue-specific scrapers) and NEW events from an aggregator site (GoCalaveras.com).

Identify which NEW events are duplicates of EXISTING events. Two events are duplicates if they are clearly the same event — same date, same or very similar venue/location, and the names refer to the same thing (even if worded differently).

Examples of duplicates:
- "Live Music: John Smith" and "John Smith Live" on the same date at the same venue
- "Bear Valley Spring Concert" and "Spring Concert Series" on the same date at Bear Valley

Examples of NOT duplicates:
- Same name but different dates (these are separate occurrences)
- Same date but clearly different venues and event types

EXISTING events:
${existingList}

NEW events:
${newList}

Return a JSON array of the NEW event indices (N0, N1, etc.) that are DUPLICATES of existing events. If none are duplicates, return an empty array.
Return ONLY the JSON array, e.g. [0, 3, 5] — no other text.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";
    const jsonStr = text
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "");
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
    console.warn(
      "Cross-source dedup LLM call failed, proceeding without:",
      err
    );
    return newEvents;
  }
}

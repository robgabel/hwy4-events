import Anthropic from "@anthropic-ai/sdk";
import { decodeEventFields, type ExtractedEvent } from "../lib/extract.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { applyVenueDetection } from "../lib/venue-matcher.js";
import { isManuallyManagedEvent } from "../lib/manual-sources.js";
import { isNonCorridorAddress } from "../lib/corridor.js";

const EVENTS_URL = "https://www.gocalaveras.com/events/";
const AJAX_URL = "https://www.gocalaveras.com/wp-admin/admin-ajax.php";
const SOURCE_NAME = "GoCalaveras.com";
const ORG_SLUG = "gocalaveras";
const MONTHS_TO_SCRAPE = 6;

import { TOWNS } from "../../lib/towns.js";

/** Towns along the Hwy 4 corridor that we care about */
const HWY4_TOWNS = new Set(TOWNS.map((t) => t.toLowerCase()));

const HWY4_TOWN_LIST = TOWNS;

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
  const manualSkipped = corridorEvents.filter(isManuallyManagedEvent);
  const scrapableEvents = corridorEvents.filter((e) => !isManuallyManagedEvent(e));
  if (manualSkipped.length > 0) {
    console.log(
      `Skipping ${manualSkipped.length} manually-managed event(s): ${manualSkipped
        .map((e) => `${e.name} @ ${e.venue_name}`)
        .join("; ")}`
    );
  }
  const futureEvents = scrapableEvents.filter((e) => e.date >= today);

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

  // Enrich each event from its detail page — fills full description, image,
  // and merges organizer city into the address when location is street-only.
  if (events.length > 0) {
    await enrichEvents(events);
  }

  // Use LLM to classify categories and map towns for events that need it
  if (events.length > 0) {
    await classifyEvents(events);
  }

  // Address-driven town validation (authoritative): if the resolved address
  // contains a corridor town that disagrees with the current town, override
  // — the address is the ground truth, the prior town value was either an
  // LLM guess or a stale AJAX-side default.
  let townFixedFromAddr = 0;
  for (const event of events) {
    if (!event.address) continue;
    const addrTown = findCorridorTownInString(event.address);
    if (addrTown && addrTown !== event.town) {
      event.town = addrTown;
      townFixedFromAddr++;
    }
  }
  if (townFixedFromAddr > 0) {
    console.log(`  Town validation: corrected ${townFixedFromAddr} town(s) from address`);
  }

  // Drop events whose address is clearly outside the Hwy 4 corridor.
  // Without this, an LLM that guessed a corridor town for a non-corridor venue
  // (e.g. Renegade Winery in Mokelumne Hill → labeled "Copperopolis") leaks
  // through the HWY4_TOWNS filter in scrapeGoCalaveras().
  const dropped: ExtractedEvent[] = [];
  const kept: ExtractedEvent[] = [];
  for (const event of events) {
    if (isNonCorridorAddress(event.address)) {
      dropped.push(event);
    } else {
      kept.push(event);
    }
  }
  if (dropped.length > 0) {
    console.log(`  Dropped ${dropped.length} non-corridor event(s):`);
    for (const e of dropped) {
      console.log(`    ✕ ${e.name} | ${e.date} | ${e.address}`);
    }
  }

  // Post-extraction venue detection: resolve generic/unknown venue names
  let venueFixed = 0;
  for (const event of kept) {
    if (applyVenueDetection(event)) {
      venueFixed++;
    }
  }
  if (venueFixed > 0) {
    console.log(`  Venue detection: resolved ${venueFixed}/${kept.length} generic venues`);
  }

  return kept;
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

      // Extract location info from PMV metadata.
      // NOTE: do NOT fall back to evcal_subtitle for venue — on GoCalaveras
      // the subtitle is artist/host info ("Featuring …", "Hosted by …"), not a venue.
      // Using it as venue_name poisons downstream display + dedup.
      const locationName = pmv.evcal_location_name?.[0] || "";
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
        description: pmv.evcal_description?.[0] || null,
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
        image_url: null,
        // EventON gives us a stable event_id — write it so the upsert path
        // can re-find this row across runs even when name/town/venue change.
        source_event_id: String(ev.event_id),
      });
    } catch (err) {
      console.warn(`  Failed to parse event ${ev.event_id}: ${err}`);
    }
  }

  return results;
}

// ---------- Event detail page enrichment ----------

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate, br",
};

export interface EnrichedDetails {
  description: string | null;
  locationName: string | null;
  locationAddress: string | null;
  organizerAddress: string | null;
  imageUrl: string | null;
  /** Final merged address with city/state where derivable. */
  mergedAddress: string | null;
  /** Town parsed from the merged address (one of HWY4_TOWN_LIST), or null. */
  mergedTown: string | null;
}

/** Strip inline HTML tags, decode common entities, collapse whitespace. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "’")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Parse "1208 South Main Street, Angels Camp, CA 95222" into segments.
 * Returns null if the string doesn't look like a full street+city address.
 */
function parseAddress(
  addr: string
): { street: string; city: string; state: string; zip: string | null } | null {
  // Expect at least: street, city, state[ zip]
  const parts = addr.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  const street = parts[0];
  const city = parts[1];
  const stateZip = parts[2];
  const m = stateZip.match(/^([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/);
  if (!m) return null;
  return { street, city, state: m[1], zip: m[2] || null };
}

/** Normalize a street string for comparison (lowercase, collapse whitespace, strip trailing dot). */
function normStreet(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "").trim();
}

/** Match parsed town string against HWY4_TOWN_LIST. */
function matchCorridorTown(city: string | null): string | null {
  if (!city) return null;
  const cityLower = city.toLowerCase().trim();
  for (const t of HWY4_TOWN_LIST) {
    if (t.toLowerCase() === cityLower) return t;
  }
  return null;
}

/**
 * Scan an arbitrary string (address, venue text, anything) for a Hwy 4 corridor
 * town name. Used as the LAST-RESORT town signal when structured parsing fails.
 * Returns the canonical-cased town name if found, else null.
 */
function findCorridorTownInString(s: string | null | undefined): string | null {
  if (!s) return null;
  const lower = s.toLowerCase();
  for (const t of HWY4_TOWN_LIST) {
    if (lower.includes(t.toLowerCase())) return t;
  }
  return null;
}

/**
 * Fetch an EventON event page and extract the fields that the AJAX calendar feed leaves out:
 * full description, full address, organizer address, image.
 *
 * City-merge rule: if the location address has only a street (no city) but the organizer
 * address has both AND their street segments match, use the organizer's city/state.
 */
export async function fetchEventDetails(
  eventUrl: string
): Promise<EnrichedDetails | null> {
  let html: string;
  try {
    const resp = await fetch(eventUrl, { headers: BROWSER_HEADERS });
    if (!resp.ok) {
      console.warn(`  enrich: ${eventUrl} returned ${resp.status}`);
      return null;
    }
    html = await resp.text();
  } catch (err) {
    console.warn(`  enrich fetch failed for ${eventUrl}:`, err);
    return null;
  }

  // Description: <div class='eventon_desc_in' itemprop='description'>…</div>
  const descMatch = html.match(
    /class=['"]eventon_desc_in['"][^>]*itemprop=['"]description['"][^>]*>([\s\S]*?)<\/div>/
  );
  const description = descMatch ? htmlToText(descMatch[1]) || null : null;

  const locName = html.match(
    /class=['"]evo_location_name['"][^>]*>([^<]+)</
  )?.[1]?.trim() || null;
  const locAddr = html.match(
    /class=['"]evo_location_address['"][^>]*>([^<]+)</
  )?.[1]?.trim() || null;
  const orgAddr = html.match(
    /class=['"]evo_card_organizer_address['"][^>]*>([^<]+)</
  )?.[1]?.trim() || null;
  const imgMatch = html.match(
    /class=['"]evo_event_main_img['"][^>]*src=['"]([^'"]+)['"]/
  );
  let imageUrl = imgMatch?.[1] || null;
  if (imageUrl && imageUrl.startsWith("/")) {
    imageUrl = `https://www.gocalaveras.com${imageUrl}`;
  }

  // Compute merged address + town
  let mergedAddress: string | null = locAddr;
  let mergedTown: string | null = null;

  const orgParsed = orgAddr ? parseAddress(orgAddr) : null;
  const locParsed = locAddr ? parseAddress(locAddr) : null;

  if (locParsed) {
    // Location already has city
    mergedAddress = locAddr;
    mergedTown = matchCorridorTown(locParsed.city);
  } else if (locAddr && orgParsed && normStreet(locAddr) === normStreet(orgParsed.street)) {
    // Street matches; borrow city/state from organizer
    mergedAddress = orgParsed.zip
      ? `${orgParsed.street}, ${orgParsed.city}, ${orgParsed.state} ${orgParsed.zip}`
      : `${orgParsed.street}, ${orgParsed.city}, ${orgParsed.state}`;
    mergedTown = matchCorridorTown(orgParsed.city);
  } else if (orgParsed && !locAddr) {
    // No location address at all — fall back to organizer
    mergedAddress = orgAddr;
    mergedTown = matchCorridorTown(orgParsed.city);
  }

  // Last-resort town signal: if parseAddress failed (e.g. GoCalaveras writes
  // "1276 S. Main St Angels Camp, 95222" — only two comma-separated parts,
  // no state, no clean "street, city, ST zip" structure), still scan the raw
  // address text for a corridor town substring. Without this, an address that
  // clearly says "Angels Camp" can be ignored and the LLM's hallucinated town
  // (often "Murphys") wins downstream.
  if (!mergedTown) {
    mergedTown =
      findCorridorTownInString(locAddr) ?? findCorridorTownInString(orgAddr);
  }

  return {
    description,
    locationName: locName,
    locationAddress: locAddr,
    organizerAddress: orgAddr,
    imageUrl,
    mergedAddress,
    mergedTown,
  };
}

/** Enrich a single event in place from its detail page. */
async function enrichEventDetails(event: ExtractedEvent): Promise<void> {
  if (!event.event_url || !event.event_url.includes("gocalaveras.com")) return;
  const details = await fetchEventDetails(event.event_url);
  if (!details) return;

  if (details.description && details.description.length > (event.description?.length || 0)) {
    event.description = details.description;
  }
  if (details.locationName && event.venue_name === "Unknown Venue") {
    event.venue_name = details.locationName;
  }
  if (details.mergedAddress) {
    event.address = details.mergedAddress;
  }
  // mergedTown comes from a parsed "street, city, ST zip" — high-confidence,
  // so override even when current town is set (the original scraper's
  // fallback comma-split sometimes picks the wrong town).
  if (details.mergedTown) {
    event.town = details.mergedTown;
  }
  if (details.imageUrl) {
    event.image_url = details.imageUrl;
  }
}

/** Enrich a batch of events with simple throttling (~3 req/sec). */
async function enrichEvents(events: ExtractedEvent[]): Promise<void> {
  let enriched = 0;
  for (const e of events) {
    if (!e.event_url) continue;
    await enrichEventDetails(e);
    enriched++;
    await new Promise((r) => setTimeout(r, 350));
  }
  if (enriched > 0) {
    console.log(`  Enriched ${enriched}/${events.length} events from detail pages`);
  }
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
- category: one of: live_music, festival, civic, hike_walk, kids, wine, games, other
  (categories describe WHAT the event is, not WHERE it happens)
  - "live_music" for concerts, music nights, DJ sets, open mic, karaoke
  - "festival" for multi-day community events, fairs, seasonal celebrations
  - "civic" for community gatherings, meetings, markets, car shows, holiday meals, fundraisers
  - "hike_walk" for guided hikes, nature/bird walks, trail runs and fun runs
  - "kids" for kid-focused activities and camps (day camps, creek critters, kids' contests)
  - "wine" for wine tastings, wine blending, vineyard/winery events
  - "games" for social/pub games: bingo, trivia, pool, bocce, cribbage, card tournaments
  - "other" for everything else (theater, golf, sports, classes, etc.)
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

    const VALID_CATEGORIES = [
      "live_music",
      "festival",
      "civic",
      "hike_walk",
      "kids",
      "wine",
      "games",
      "other",
    ];
    for (const c of classifications) {
      if (c.i >= 0 && c.i < events.length) {
        events[c.i].category = VALID_CATEGORIES.includes(c.category)
          ? c.category
          : "other";
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
      // Sonnet, not Haiku: dedup decides whether to DROP a scraped event as a
      // duplicate. A false positive silently deletes a real event; a false
      // negative ships a visible dupe. Correctness-critical, so use the
      // stronger model even though this runs on every GoCalaveras scrape.
      model: "claude-sonnet-4-6",
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

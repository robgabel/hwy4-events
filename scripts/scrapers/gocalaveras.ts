import Anthropic from "@anthropic-ai/sdk";
import { decodeEventFields, type ExtractedEvent } from "../lib/extract.js";
import {
  classifyStatus,
  emptyTally,
  retryDelayMs,
  shouldTripCircuit,
  summarizeEnrichment,
  tallyOutcome,
  type EnrichOutcome,
} from "../lib/enrich-report.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { applyVenueDetection } from "../lib/venue-matcher.js";
import { isManuallyManagedEvent } from "../lib/manual-sources.js";
import { isNonCorridorAddress, isNonCorridorDescription } from "../lib/corridor.js";
import {
  classifyEventCategory,
  classifyEventCategoryDetailed,
  reconcileCategory,
} from "../../lib/categorize.js";
import {
  detectShortcodeCap,
  goCalaverasPresenceKeys,
  goCalaverasRowKeys,
  goCalaverasSweepWindows,
  ownsGoCalaverasRow,
  slugExtractionHealthy,
  type EnumeratedEvent,
  type MonthEnumeration,
} from "../lib/gocalaveras-sweep.js";
import { sweepStaleSourceRows } from "../lib/stale-sweep-exec.js";

const EVENTS_URL = "https://www.gocalaveras.com/events/";
const AJAX_URL = "https://www.gocalaveras.com/wp-admin/admin-ajax.php";
const SOURCE_NAME = "GoCalaveras.com";
const ORG_SLUG = "gocalaveras";
const MONTHS_TO_SCRAPE = 6;

/** Deletion budget per run for the retraction sweep, tighter than the shared
 *  relative cap (see the sweep block at the end of scrapeGoCalaveras). */
const SWEEP_MAX_PER_RUN = 10;

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

  // A shortcode that caps how many events a month view returns would truncate a
  // busy month, and a truncated tail looks exactly like a retracted one. Read
  // the cap off the shortcode the page just handed us and log it, so a month
  // that hits it can be excluded from the sweep window (and so the dry-run
  // reviewer can see why windows are missing).
  const detectedCap = detectShortcodeCap(baseShortcode);
  if (detectedCap) {
    console.log(
      `Shortcode declares a display cap: ${detectedCap.key}=${detectedCap.value} — months reaching it are not sweepable`
    );
  }
  const cap = detectedCap?.value ?? null;

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
  const monthEnumerations: MonthEnumeration[] = [];
  const enumeratedEntries: EnumeratedEvent[] = [];

  for (const { month, year, label, startUnix, endUnix } of monthsToScrape) {
    console.log(`\n--- Fetching ${label} ---`);

    try {
      const fetched = await fetchMonth(
        baseShortcode,
        nonce,
        month,
        year,
        startUnix,
        endUnix,
        label,
        cap
      );
      console.log(`  ${label}: ${fetched.events.length} events extracted`);
      allEvents.push(...fetched.events);
      monthEnumerations.push(fetched.month);
      enumeratedEntries.push(...fetched.entries);
    } catch (err) {
      console.error(`  ${label}: fetch failed:`, err);
      monthEnumerations.push({ requested: label, ok: false, dates: [], cap });
    }
  }

  // Step 4: Filter to Hwy 4 corridor towns
  const corridorEvents = allEvents.filter((e) =>
    HWY4_TOWNS.has(e.town.toLowerCase().trim())
  );
  const manualSkipped = corridorEvents.filter((e) => isManuallyManagedEvent(e));
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
    console.log("No future corridor events to upsert — nothing scraped, nothing swept.");
    return;
  }

  // Step 5: Cross-source dedup
  const deduped = await crossSourceDedup(futureEvents);

  let totalResult: UpsertResult = { inserted: 0, updated: 0, unchanged: 0, skippedFuzzy: 0, unpinned: 0 };

  if (deduped.length > 0) {
    totalResult = await upsertEvents(deduped, SOURCE_NAME, ORG_SLUG, EVENTS_URL);
  }

  // Step 6: Retraction — window-scoped stale sweep (HWY-21). An aggregator row
  // rots with no retraction: GoCalaveras drops a listing and our copy lives on
  // forever (stale_scrapes stood at 138 on 2026-08-08). The rules for which
  // rows are ours to retract, and which months we may claim to have read in
  // full, are all in scripts/lib/gocalaveras-sweep.ts — the ownership test is
  // deliberately much narrower than the organizer sweeps', because a merged or
  // organizer-linked row here is maintained by someone else.
  //
  // SHIPPED IN DRY-RUN: SWEEP_EXECUTE is per-source (sweepExecuteEnabled), so
  // this sweep reports what it would remove and deletes nothing until
  // "gocalaveras" is named in that repository variable — read a few days of
  // those logs first. Note the relative abort cap (maxSweepAllowed, ≤20 rows):
  // if the first honest report is a large backlog, that backlog needs a
  // reviewed one-off purge — the sweep is a steady-state maintainer, not a drain.
  const sweepWindows = goCalaverasSweepWindows(monthEnumerations, today);
  console.log(
    `\nSweep windows proven this run: ${
      sweepWindows.length === 0
        ? "none"
        : sweepWindows.map((w) => `${w.from}..${w.to}`).join(", ")
    } (of ${monthEnumerations.length} month(s) requested)`
  );
  const presentKeys = goCalaverasPresenceKeys(enumeratedEntries);
  // Numeric EventON ids come off the JSON and are always observed; permalinks
  // are regexed out of the response HTML and are not. When that extraction is
  // thin, rows keyed ONLY by their slug (id-less legacy rows) can't be proven
  // present, so they are not ours to retract this run.
  // HWY-26: a row a non-gocalaveras source was reconcile-merged into is not
  // sole-witnessed by GoCalaveras (reconcile keeps the gocal survivor's sid/URL),
  // so a dropped gocal listing is not proof the event ended. Read event_merge_log
  // once and exclude those survivors from the sweep. Bounded to recent merges — a
  // merge into an upcoming event happened recently — and conservative: a loser
  // that is not PROVABLY gocalaveras (any other or missing org_slug) protects the
  // survivor, since the whole risk here is deleting a real event.
  const coWitnessedRowIds = new Set<string>();
  {
    const since = new Date(Date.now() - 180 * 86_400_000).toISOString();
    const { data: mergeLog } = await supabaseAdmin
      .from("event_merge_log")
      .select("survivor_id, merged_snapshot")
      .gte("merged_at", since);
    for (const m of (mergeLog ?? []) as {
      survivor_id: string;
      merged_snapshot: Record<string, unknown> | null;
    }[]) {
      if ((m.merged_snapshot?.org_slug ?? null) !== "gocalaveras") {
        coWitnessedRowIds.add(m.survivor_id);
      }
    }
    if (coWitnessedRowIds.size > 0) {
      console.log(
        `  Sweep: ${coWitnessedRowIds.size} row(s) have a non-gocal merge witness — excluded from retraction (HWY-26).`
      );
    }
  }
  const observed = {
    slugs: slugExtractionHealthy(enumeratedEntries),
    coWitnessedRowIds,
  };
  if (!observed.slugs) {
    console.log(
      "  Sweep: permalink extraction was thin this run — id-less legacy rows are not sweepable."
    );
  }
  const swept = await sweepStaleSourceRows({
    orgSlug: ORG_SLUG,
    reason: "gocalaveras sweep (listing gone from the EventON feed)",
    windows: sweepWindows,
    presentKeys,
    keysOf: goCalaverasRowKeys,
    ownRow: (r) => ownsGoCalaverasRow(r, observed),
    // The relative cap is inert at this catalog size (169 resident rows already
    // pins it to the flat 20 ceiling, ~12% of the aggregator's future events
    // deletable nightly). A real mass retraction should take several nights and
    // stay legible in the logs.
    maxPerRun: SWEEP_MAX_PER_RUN,
  });

  console.log("\n=== GoCalaveras Summary ===");
  console.log(`Months scraped: ${MONTHS_TO_SCRAPE}`);
  console.log(`Events extracted (all): ${allEvents.length}`);
  console.log(`Events in Hwy 4 corridor: ${corridorEvents.length}`);
  console.log(`Events after cross-source dedup: ${deduped.length}`);
  console.log(`Events inserted: ${totalResult.inserted}`);
  console.log(`Events updated: ${totalResult.updated}`);
  console.log(`Events unchanged: ${totalResult.unchanged}`);
  console.log(`Feed listings enumerated: ${enumeratedEntries.length}, presence keys: ${presentKeys.size}`);
  console.log(`Swept stale: ${swept}`);
}

// ---------- Direct AJAX month fetching ----------

/** One month's fetch: the events we keep, plus the evidence the retraction
 *  sweep needs about what the feed itself asserted (see the sweep block at the
 *  end of scrapeGoCalaveras). */
interface MonthFetch {
  /** Corridor-filtered, enriched events destined for the upsert batch. */
  events: ExtractedEvent[];
  /** Whether this month's payload proved it covered the month we asked for. */
  month: MonthEnumeration;
  /** Every event the payload listed, BEFORE any of our filters — the raw
   *  material for the presence set. */
  entries: EnumeratedEvent[];
}

/** A month whose fetch failed: no events, no enumeration, no window. */
function failedMonth(requested: string, cap: number | null): MonthFetch {
  return { events: [], entries: [], month: { requested, ok: false, dates: [], cap } };
}

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
  endUnix: number,
  requestedLabel: string,
  cap: number | null
): Promise<MonthFetch> {
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
    // Name throttling explicitly (HWY-32). The detail-page enrichment was being
    // 429'd wholesale while these month calls kept succeeding, and telling those
    // two apart in a log is the difference between "the feed is down" and "we
    // are being rate-limited on detail pages only".
    if (resp.status === 429) {
      throw new Error(
        `AJAX request RATE-LIMITED (429) for ${requestedLabel}. The month feed itself is being throttled, not just detail pages.`
      );
    }
    throw new Error(`AJAX request failed: ${resp.status}`);
  }

  const text = await resp.text();
  if (text.length <= 5) {
    console.log(`  Empty response (${text.length} chars) — no events this month`);
    return failedMonth(requestedLabel, cap);
  }

  let data: EventONResponse;
  try {
    data = JSON.parse(text);
  } catch {
    console.warn(`  Failed to parse AJAX response (${text.length} chars)`);
    return failedMonth(requestedLabel, cap);
  }

  if (data.status !== "GOOD" || !data.json || !Array.isArray(data.json)) {
    console.warn(`  Unexpected response status: ${data.status}`);
    return failedMonth(requestedLabel, cap);
  }

  console.log(
    `  AJAX response: ${data.json.length} events in JSON, ${data.html?.length || 0} chars HTML`
  );

  // Extract real event URLs from the HTML response
  const urlMap = extractUrlsFromHtml(data.html, data.json);

  // Snapshot what the feed asserted for this month before we filter anything.
  // The sweep's presence test has to run against THIS, not against the batch we
  // end up writing: an event dropped by the corridor filter, the manual-source
  // blocklist, or the cross-source dedup is still an event GoCalaveras lists,
  // and treating our own filtering as the source's retraction would delete
  // every corridor event a venue scraper also covers.
  // Never throws: `new Date(NaN).toISOString()` is a RangeError, and this map
  // runs BEFORE parseEventONEvents' per-event try/catch, so one entry with a
  // missing or non-numeric event_start_unix would escape fetchMonth and cost
  // the WHOLE month's ingest — a strictly worse failure than the single event
  // the parser already tolerates losing. An unusable entry still contributes
  // PRESENCE (the feed asserted the event exists; withholding its key would
  // read as retraction — the delete direction) but no date, so it can only
  // make the month look less complete, never a resident row look stale.
  const entries: EnumeratedEvent[] = [];
  const enumeratedDates: string[] = [];
  for (const ev of data.json) {
    entries.push({ id: ev.event_id, url: urlMap.get(ev.event_id) ?? null });
    // Number(), not a bare Number.isFinite on the raw field: parseEventONEvents
    // coerces the same way (`ev.event_start_unix * 1000`), so a feed that ever
    // sends the timestamp as a numeric string must not enumerate as all-junk
    // here while parsing fine there. Seconds-scale epochs only — a µs/ns-scale
    // value would push toISOString() past its representable range and throw,
    // the exact whole-month failure this guard exists to prevent.
    const startUnix = Number(ev.event_start_unix);
    if (!Number.isFinite(startUnix) || startUnix <= 0 || startUnix >= 1e11) {
      console.warn(`  Enumeration: event ${ev.event_id} has no usable start — no date contributed`);
      continue;
    }
    enumeratedDates.push(new Date(startUnix * 1000).toISOString().slice(0, 10));
  }
  const monthEnumeration: MonthEnumeration = {
    requested: requestedLabel,
    ok: true,
    dates: enumeratedDates,
    cap,
  };

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

  // Drop events that are clearly outside the Hwy 4 corridor. Two signals:
  //   1. Address names a non-corridor city. Catches an LLM that guessed a
  //      corridor town for a non-corridor venue (e.g. Renegade Winery in
  //      Mokelumne Hill → labeled "Copperopolis"), which would otherwise leak
  //      through the HWY4_TOWNS filter in scrapeGoCalaveras().
  //   2. Description states an out-of-corridor location ("in San Andreas")
  //      while the structured town/venue/address were mislabeled to a corridor
  //      town — the county-wide aggregator's own data was wrong but its prose
  //      is right. This is the Calaveras Community Band July 4 / Turner Park,
  //      San Andreas case: town/venue/address said Murphys, description said
  //      San Andreas. Description-locative only, so "San Andreas Fault" trail
  //      listings are unaffected.
  const dropped: ExtractedEvent[] = [];
  const kept: ExtractedEvent[] = [];
  for (const event of events) {
    if (
      isNonCorridorAddress(event.address) ||
      isNonCorridorDescription(event.description)
    ) {
      dropped.push(event);
    } else {
      kept.push(event);
    }
  }
  if (dropped.length > 0) {
    console.log(`  Dropped ${dropped.length} non-corridor event(s):`);
    for (const e of dropped) {
      console.log(`    ✕ ${e.name} | ${e.date} | ${e.town} | ${e.address}`);
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

  return { events: kept, month: monthEnumeration, entries };
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
  return (await fetchEventDetailsResult(eventUrl)).details;
}

/** The same fetch, but reporting WHY it produced nothing (HWY-32). The plain
 *  `fetchEventDetails` above keeps the old signature for
 *  scripts/backfill-gocalaveras-details.ts; the scraper uses this one so a
 *  429 wall can be counted and reported instead of silently reading as a
 *  successful enrich. `retryAfterMs` is passed back so the caller can honor
 *  the server's own backoff request. */
export async function fetchEventDetailsResult(
  eventUrl: string
): Promise<{ details: EnrichedDetails | null; outcome: EnrichOutcome; retryAfterMs?: number }> {
  let html: string;
  try {
    const resp = await fetch(eventUrl, { headers: BROWSER_HEADERS });
    if (!resp.ok) {
      const outcome = classifyStatus(resp.status);
      console.warn(`  enrich: ${eventUrl} returned ${resp.status}`);
      return {
        details: null,
        outcome,
        retryAfterMs:
          outcome === "rate_limited"
            ? retryDelayMs(
                resp.headers.get("retry-after"),
                ENRICH_RETRY_FALLBACK_MS,
                ENRICH_RETRY_MAX_WAIT_MS
              )
            : undefined,
      };
    }
    html = await resp.text();
  } catch (err) {
    console.warn(`  enrich fetch failed for ${eventUrl}:`, err);
    return { details: null, outcome: "network_error" };
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

  // A 200 that parsed. Whether it actually GAINED the event anything is decided
  // by the caller (enrichEventDetails), which is what separates "enriched" from
  // "empty" in the tally.
  return {
    details: {
      description,
      locationName: locName,
      locationAddress: locAddr,
      organizerAddress: orgAddr,
      imageUrl,
      mergedAddress,
      mergedTown,
    },
    outcome: "enriched",
  };
}

/** Enrich a single event in place from its detail page, reporting what happened
 *  so the run can be counted honestly (HWY-32). */
async function enrichEventDetails(
  event: ExtractedEvent
): Promise<{ outcome: EnrichOutcome; retryAfterMs?: number }> {
  if (!event.event_url || !event.event_url.includes("gocalaveras.com")) {
    return { outcome: "empty" };
  }
  const res = await fetchEventDetailsResult(event.event_url);
  const details = res.details;
  if (!details) return { outcome: res.outcome, retryAfterMs: res.retryAfterMs };

  // "Enriched" means the page actually gave us something. A 200 that yields no
  // usable field is `empty`, not a success — otherwise a markup change would
  // read as a clean run forever.
  let gained = false;

  if (details.description && details.description.length > (event.description?.length || 0)) {
    event.description = details.description;
    gained = true;
  }
  if (details.locationName && event.venue_name === "Unknown Venue") {
    event.venue_name = details.locationName;
    gained = true;
  }
  if (details.mergedAddress) {
    event.address = details.mergedAddress;
    gained = true;
  }
  // mergedTown comes from a parsed "street, city, ST zip" — high-confidence,
  // so override even when current town is set (the original scraper's
  // fallback comma-split sometimes picks the wrong town).
  if (details.mergedTown) {
    event.town = details.mergedTown;
    gained = true;
  }
  if (details.imageUrl) {
    event.image_url = details.imageUrl;
    gained = true;
  }

  return { outcome: gained ? "enriched" : "empty" };
}

// Detail-page enrichment with bounded concurrency. enrichEvents runs on EVERY
// parsed event in a month (the whole county, before the corridor filter — see
// fetchMonth), so a 6-month run is hundreds of detail fetches; a strictly
// sequential loop spent 1-2 min in pure throttle wait. Fetching
// ENRICH_CONCURRENCY pages at once, with a pause between batches, caps
// simultaneous load on gocalaveras.com while keeping wall-clock sane. Mirrors
// the polite-batch pattern in lib/validate-urls.ts.
//
// Retuned 2026-09-05 (HWY-32) after a run where every request came back 429.
// Concurrency down 5 -> 3 and the pause up 350 -> 500ms, plus Retry-After, one
// gentle retry, and a circuit breaker. The breaker is what keeps the politeness
// affordable: when the site is refusing everything, continuing costs the
// Action's 20-minute budget and buys nothing, so we stop early and say so.
// Enrichment re-runs daily, so partial coverage is fine; a silent shortfall is not.
const ENRICH_CONCURRENCY = 3; // concurrent detail-page fetches
const ENRICH_BATCH_DELAY_MS = 500; // pause between batches (politeness throttle)
const ENRICH_RETRY_FALLBACK_MS = 1500; // wait before the single retry when no Retry-After
const ENRICH_RETRY_MAX_WAIT_MS = 5000; // cap, so one hostile header can't park the scrape

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Enrich a batch of events from their detail pages with bounded concurrency. */
async function enrichEvents(events: ExtractedEvent[]): Promise<void> {
  const toEnrich = events.filter((e) => e.event_url);
  if (toEnrich.length === 0) return;

  const tally = emptyTally();
  let consecutive429 = 0;
  let broken = false;

  for (let i = 0; i < toEnrich.length; i += ENRICH_CONCURRENCY) {
    if (broken) {
      // Breaker already tripped: count the rest as skipped without firing a
      // single further request.
      tally.skipped += toEnrich.length - i;
      break;
    }

    const batch = toEnrich.slice(i, i + ENRICH_CONCURRENCY);
    // enrichEventDetails mutates each event in place and never throws (its fetch
    // + parse are internally guarded), so Promise.all won't reject on a bad page.
    const results = await Promise.all(batch.map((e) => enrichEventDetails(e)));

    // One gentle retry for the throttled ones, honoring Retry-After. Serial and
    // bounded on purpose: retrying a rate-limited host in parallel is what got
    // us throttled in the first place.
    for (let j = 0; j < results.length; j++) {
      if (results[j].outcome !== "rate_limited") continue;
      await sleep(results[j].retryAfterMs ?? ENRICH_RETRY_FALLBACK_MS);
      results[j] = await enrichEventDetails(batch[j]);
    }

    for (const r of results) {
      tallyOutcome(tally, r.outcome);
      if (r.outcome === "rate_limited") {
        consecutive429++;
        if (shouldTripCircuit(consecutive429)) broken = true;
      } else {
        consecutive429 = 0;
      }
    }

    // Pause between batches to stay polite (skip after the last batch).
    if (!broken && i + ENRICH_CONCURRENCY < toEnrich.length) {
      await sleep(ENRICH_BATCH_DELAY_MS);
    }
  }

  // The honest summary. Before HWY-32 this line printed the ATTEMPT count, so a
  // run in which every request was rejected still reported "130/130".
  const { line, warning } = summarizeEnrichment(tally, toEnrich.length);
  console.log(line);
  if (warning) console.warn(`  ⚠ ${warning}`);
}

// ---------- LLM-based category classification ----------

/**
 * Use Claude to classify event categories and extract artists.
 * Much cheaper than full LLM extraction since we only need classification.
 */
async function classifyEvents(events: ExtractedEvent[]): Promise<void> {
  // Deterministic floor: seed every event from the shared keyword classifier
  // (lib/categorize.ts — the single source of truth, also used by Visit Murphys
  // and /admin/submissions). If the LLM call below fails, times out, or whiffs
  // an obvious one to "other", this baseline survives instead of a silent
  // batch-wide "other" fallback. The LLM then only *upgrades* to a more specific
  // category and adds artists.
  for (const e of events) {
    e.category = classifyEventCategory(`${e.name} ${e.description ?? ""}`);
  }

  const eventList = events
    .map(
      (e, i) =>
        `${i}: "${e.name}" at ${e.venue_name}, ${e.town} on ${e.date}${e.description ? ` — ${e.description.slice(0, 100)}` : ""}`
    )
    .join("\n");

  const prompt = `Classify these events and extract performer names.

For each event, return a JSON array of objects with:
- i: event index number
- category: one of: live_music, festival, civic, hike_walk, kids, wine, games, fine_arts, other
  (categories describe WHAT the event is, not WHERE it happens)
  - "live_music" for concerts, music nights, DJ sets, open mic, karaoke
  - "festival" for multi-day community events, fairs, seasonal celebrations
  - "civic" for community gatherings, meetings, markets, car shows, holiday meals, fundraisers
  - "hike_walk" for guided hikes, nature/bird walks, trail runs and fun runs
  - "kids" for kid-focused activities and camps (day camps, creek critters, kids' contests)
  - "wine" for wine tastings, wine blending, vineyard/winery events
  - "games" for social/pub games: bingo, trivia, pool, bocce, cribbage, card tournaments
  - "fine_arts" for theater/plays, comedy, and visual/craft arts (pottery, ceramics, painting, drawing classes)
  - "other" for everything else (golf, fitness, cooking classes, etc.)
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
        // Reconcile the LLM guess with the keyword floor: an authoritative
        // keyword (bingo, opera, karaoke, …) wins; otherwise the LLM may upgrade
        // a soft/"other" result to a specific category, but never downgrade a
        // specific keyword result to "other". (lib/categorize.reconcileCategory)
        events[c.i].category = reconcileCategory(
          classifyEventCategoryDetailed(
            `${events[c.i].name} ${events[c.i].description ?? ""}`,
          ),
          c.category,
        );
        events[c.i].artists = c.artists;
        if (c.town && c.town !== "Unknown" && events[c.i].town === "Unknown") {
          events[c.i].town = c.town;
        }
      }
    }
  } catch (err) {
    // Baseline from the deterministic floor already stands — log and move on.
    console.warn("Category classification (LLM) failed, using keyword floor:", err);
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

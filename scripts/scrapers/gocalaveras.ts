import FirecrawlApp from "@mendable/firecrawl-js";
import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedEvent } from "../lib/extract.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";

const EVENTS_URL = "https://www.gocalaveras.com/events/";
const SOURCE_NAME = "GoCalaveras.com";
const ORG_SLUG = "gocalaveras";
const MONTHS_TO_SCRAPE = 6;

/** Towns along the Hwy 4 corridor that we care about */
const HWY4_TOWNS = new Set([
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

const MONTH_NAMES = [
  "",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

export async function scrapeGoCalaveras(): Promise<void> {
  console.log("=== GoCalaveras Scraper ===");

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("Missing FIRECRAWL_API_KEY environment variable");
  }

  const firecrawl = new FirecrawlApp({ apiKey });
  const today = new Date().toISOString().slice(0, 10);

  // Build list of months to scrape: current month + next 8
  const now = new Date();
  const monthsToScrape: { month: number; year: number; label: string }[] = [];
  for (let i = 0; i < MONTHS_TO_SCRAPE; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    monthsToScrape.push({
      month: d.getMonth() + 1, // 1-indexed
      year: d.getFullYear(),
      label: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
    });
  }

  console.log(
    `Scraping ${MONTHS_TO_SCRAPE} months: ${monthsToScrape.map((m) => m.label).join(", ")}`
  );

  // Scrape each month and collect all events
  const allEvents: ExtractedEvent[] = [];

  for (const { month, year, label } of monthsToScrape) {
    console.log(`\n--- Scraping ${label} ---`);

    try {
      const events = await scrapeMonth(firecrawl, month, year);
      console.log(`  ${label}: ${events.length} events extracted`);
      allEvents.push(...events);
    } catch (err) {
      console.error(`  ${label}: scrape failed:`, err);
    }
  }

  // Filter to Hwy 4 corridor towns
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

  // Cross-source dedup
  const deduped = await crossSourceDedup(futureEvents);

  let totalResult: UpsertResult = { inserted: 0, updated: 0, unchanged: 0 };

  if (deduped.length > 0) {
    totalResult = await upsertEvents(
      deduped,
      SOURCE_NAME,
      ORG_SLUG,
      EVENTS_URL
    );
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

// ---------- Month-by-month scraping ----------

/**
 * Scrape a single month from GoCalaveras using Firecrawl actions.
 * Uses executeJavascript to trigger EventON's AJAX month navigation,
 * waits for content to load, then scrapes the updated page.
 */
async function scrapeMonth(
  firecrawl: FirecrawlApp,
  month: number,
  year: number
): Promise<ExtractedEvent[]> {
  const monthName = MONTH_NAMES[month];

  // Use Firecrawl actions to navigate to the target month:
  // 1. Page loads with default month
  // 2. Execute JS to trigger EventON's AJAX calendar reload for the target month
  // 3. Wait for AJAX content
  // 4. Scrape the updated DOM
  const result = await firecrawl.scrapeUrl(EVENTS_URL, {
    formats: ["markdown"],
    waitFor: 5000,
    onlyMainContent: true,
    timeout: 60000,
    actions: [
      {
        type: "executeJavascript" as any,
        script: `
          (function() {
            // EventON calendar uses jQuery AJAX to load months
            if (typeof jQuery !== 'undefined') {
              var $ = jQuery;
              var cal = $('.ajde_evcal_calendar');
              if (cal.length) {
                // Trigger EventON's built-in month navigation
                var data = {
                  action: 'the_ajax_hook',
                  direction: 'none',
                  sort_by: 'sort_date',
                  filters: [],
                  fixed_month: ${month},
                  fixed_year: ${year},
                  send_unix: 0,
                  shortcode: JSON.parse(cal.attr('data-shortcode') || '{"cal_id":"1"}')
                };
                data.shortcode.fixed_month = ${month};
                data.shortcode.fixed_year = ${year};

                $.ajax({
                  url: '/wp-admin/admin-ajax.php',
                  type: 'POST',
                  data: data,
                  success: function(response) {
                    // EventON returns HTML in the response - inject it
                    if (response && typeof response === 'object' && response.content) {
                      cal.find('.eventon_events_list').html(response.content);
                    } else if (typeof response === 'string') {
                      cal.find('.eventon_events_list').html(response);
                    }
                  }
                });
              }
            }

            // Also try clicking the month in the dropdown selector as fallback
            var monthItems = document.querySelectorAll('.evo_j_month, .eventon_dropdown li');
            monthItems.forEach(function(item) {
              if (item.textContent.toLowerCase().trim() === '${monthName}') {
                item.click();
              }
            });

            return '${monthName} ${year}';
          })();
        `,
      },
      { type: "wait" as any, milliseconds: 6000 },
      { type: "scrape" as any },
    ],
  } as any);

  // Get markdown from the scrape action result or the main response
  let markdown = "";

  const actionsResult = (result as any).actions;
  if (actionsResult?.scrapes?.length > 0) {
    // The scrape action captured the post-JS-execution state
    // Use the main markdown which reflects the final page state
    markdown = result.markdown || actionsResult.scrapes[0].html || "";
  } else if (result.success && result.markdown) {
    markdown = result.markdown;
  }

  if (!markdown || markdown.length < 100) {
    console.log(
      `  ${monthName} ${year}: content too short (${markdown.length} chars), skipping`
    );
    return [];
  }

  console.log(`  Markdown: ${markdown.length} chars`);

  const cleaned = cleanGoCalaverasContent(markdown);
  console.log(`  Cleaned: ${cleaned.length} chars`);

  return extractGoCalaverasEvents(cleaned, year);
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
    .lte("date", maxDate)
    .eq("is_past", false);

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

// ---------- Content cleaning ----------

function cleanGoCalaverasContent(markdown: string): string {
  const lines = markdown.split("\n");
  const cleaned: string[] = [];
  let inFilterSection = false;

  for (const line of lines) {
    const lower = line.toLowerCase().trim();

    if (
      lower === "event location" ||
      lower === "event organizer" ||
      lower === "visitor" ||
      lower === "community" ||
      lower === "jump monthscurrent month"
    ) {
      inFilterSection = true;
      continue;
    }

    if (
      inFilterSection &&
      (/^\d{1,2}\w{3}/.test(lower) ||
        /^#{1,3}\s/.test(line) ||
        lower.includes("featured") ||
        /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b.*\d{4}/i.test(
          line
        ))
    ) {
      inFilterSection = false;
    }

    if (inFilterSection) continue;

    if (
      lower === "all" ||
      lower === "" ||
      /^(januaryfebruary|20\d{2}20\d{2})/.test(lower) ||
      lower.startsWith("subscribe to calendar") ||
      lower.startsWith("add to google") ||
      lower.startsWith("add to ical") ||
      lower.startsWith("cookie") ||
      lower.startsWith("privacy policy")
    ) {
      continue;
    }

    cleaned.push(line);
  }

  return cleaned.join("\n");
}

// ---------- LLM extraction ----------

const MAX_CHUNK_CHARS = 40000;

async function extractGoCalaverasEvents(
  content: string,
  year: number
): Promise<ExtractedEvent[]> {
  if (content.length <= MAX_CHUNK_CHARS) {
    return extractChunk(content, year);
  }

  const chunks = splitIntoChunks(content, MAX_CHUNK_CHARS);
  console.log(`  Content too large — splitting into ${chunks.length} chunks`);

  const allEvents: ExtractedEvent[] = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(
      `    Chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`
    );
    const events = await extractChunk(chunks[i], year);
    allEvents.push(...events);
  }

  return allEvents;
}

function splitIntoChunks(content: string, maxChars: number): string[] {
  const lines = content.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const line of lines) {
    if (currentLen + line.length + 1 > maxChars && current.length > 0) {
      chunks.push(current.join("\n"));
      current = [];
      currentLen = 0;
    }
    current.push(line);
    currentLen += line.length + 1;
  }

  if (current.length > 0) {
    chunks.push(current.join("\n"));
  }

  return chunks;
}

async function extractChunk(
  content: string,
  year: number
): Promise<ExtractedEvent[]> {
  const prompt = `Extract all discrete events from this community events aggregator page.
This is GoCalaveras.com, an events calendar for Calaveras County, CA.

For each event, return JSON with these fields:

- name: Event name (clean up any run-together text, e.g. "01mayFeaturedBlending Nights" → "Blending Nights")
- description: 1-2 sentence description if available, else null
- date: ISO date (YYYY-MM-DD)
- start_time: HH:MM (24h) or null
- end_time: HH:MM (24h) or null
- venue_name: The specific venue name (e.g., "Murphys Wine Bar", "Murphys Creek Theatre")
- town: The town where the event takes place. Use one of these Hwy 4 corridor towns if it matches: ${HWY4_TOWN_LIST.join(", ")}. For events in "Downtown Murphys" use "Murphys". For other locations, use the town name as stated.
- address: Street address if mentioned, else null
- category: One of: live_music, festival, civic, resort, other. Use "festival" for multi-day community events, "live_music" for concerts/music nights, "civic" for community/government events, "other" for everything else (dinners, wine events, theater, etc.)
- price: Price string (e.g., "$30", "Free") or null
- artists: Array of performer names, or null
- event_url: Direct link to event detail page if available, else null

Rules:
- Only extract events with specific dates. Ignore vague mentions.
- If a date appears as "01may" or similar compact format, parse it correctly (May 1st).
- If marked "Featured", ignore that label — it's not part of the event name.
- If a post describes a date range, create ONE entry with the start date and note the range in the description.
- If no events are found, return an empty array.
- Use ${year} for dates unless the content clearly states a different year.
- Extract ALL events on the page, not just the first few.

Return a JSON array only, no other text.

Page content:
${content}`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";

  try {
    const jsonStr = text
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "");
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed as ExtractedEvent[];
  } catch {
    console.warn(
      `Failed to parse LLM response for GoCalaveras chunk:`,
      text.slice(0, 300)
    );
    return [];
  }
}

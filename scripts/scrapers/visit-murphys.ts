import Anthropic from "@anthropic-ai/sdk";
import FirecrawlApp from "@mendable/firecrawl-js";
import { decodeEventFields, type ExtractedEvent } from "../lib/extract.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import { applyVenueDetection } from "../lib/venue-matcher.js";
import { isManuallyManagedEvent } from "../lib/manual-sources.js";
import { TOWNS } from "../../lib/towns.js";
import { classifyEventCategory } from "../../lib/categorize.js";

/**
 * Visit Murphys runs The Events Calendar (Tribe) WordPress plugin. Its REST
 * API returns clean structured event JSON (venue, organizer, dates, image,
 * categories) — far more reliable than markdown + LLM extraction, so we still
 * read that structured JSON and map it deterministically.
 *
 * Transport, however, goes through Firecrawl. visitmurphys.com put the site
 * behind a Cloudflare "checking your browser" JS challenge (~2026-06): a plain
 * fetch first 403'd, then started returning HTTP 200 with an HTML interstitial
 * instead of the JSON body, which a non-browser client can't clear. So each
 * paginated Tribe API request is rendered through Firecrawl (the same
 * FIRECRAWL_API_KEY the other Firecrawl sources use), exactly like
 * scripts/scrapers/red-cross.ts does for its Akamai-walled SPA. Firecrawl runs a
 * real browser that solves the challenge and returns the raw JSON, which we then
 * parse. The request originates from Firecrawl's infrastructure, not the GitHub
 * Actions runner IP, so the runner IP no longer matters.
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

// ---------- Tribe REST API response shape (only the fields we read) ----------

interface TribeEvent {
  id: number;
  title: string;
  description: string | null;
  url: string;
  start_date: string; // "YYYY-MM-DD HH:MM:SS" in event timezone
  end_date: string;
  all_day: boolean;
  status: string;
  cost: string | null;
  venue?: {
    venue?: string;
    address?: string;
    city?: string;
    state?: string | null;
    zip?: string;
  };
  categories?: Array<{ name: string; slug: string }>;
  image?: { url?: string } | null;
}

interface TribeResponse {
  events: TribeEvent[];
  total: number;
  total_pages: number;
  next_rest_url?: string;
}

// ---------- HTML → plain text ----------

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
  "&hellip;": "…",
  "&ndash;": "–",
  "&mdash;": "—",
  "&lsquo;": "‘",
  "&rsquo;": "’",
  "&ldquo;": "“",
  "&rdquo;": "”",
};

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&\w+;/g, (e) => ENTITIES[e.toLowerCase()] ?? e)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- Mapper ----------

function pickCategory(tribeCats: Array<{ name: string; slug: string }> | undefined, title: string): string {
  // Shared keyword classifier (lib/categorize.ts) is the single source of truth,
  // reused by the /admin/submissions publish default. Feed it the title + the
  // source's own category names.
  return classifyEventCategory(`${title} ${(tribeCats ?? []).map((c) => c.name).join(" ")}`);
}

function splitDateTime(tribeDateTime: string, allDay: boolean): { date: string; time: string | null } {
  // Tribe format: "YYYY-MM-DD HH:MM:SS"
  const [d, t] = tribeDateTime.split(" ");
  if (!t || allDay || t.startsWith("00:00")) return { date: d, time: null };
  return { date: d, time: t.slice(0, 5) };
}

function joinAddress(v: TribeEvent["venue"]): string | null {
  if (!v) return null;
  const street = v.address?.trim();
  const city = v.city?.trim();
  const state = v.state?.trim() || "CA";
  const zip = v.zip?.trim();
  if (!street && !city) return null;
  const cityPart = city ? `${city}, ${state}${zip ? ` ${zip}` : ""}` : `${state}${zip ? ` ${zip}` : ""}`;
  return street ? `${street}, ${cityPart}` : cityPart;
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
  const cost = ev.cost?.trim();
  const price = cost ? (/^\d/.test(cost) ? `$${cost}` : cost) : null;

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
    price,
    artists: null,
    event_url: ev.url,
    image_url: ev.image?.url || null,
    // Tribe `id` is stable per event occurrence — survives title/venue edits.
    source_event_id: String(ev.id),
  };
}

// ---------- Pagination (via Firecrawl) ----------

const FIRECRAWL_WAIT_MS = 8000;
const FIRECRAWL_TIMEOUT_MS = 60000;

/**
 * Firecrawl's rawHtml for the Tribe endpoint is the raw JSON body verbatim (a
 * headless browser renders an `application/json` document as its body text, so
 * there's no `<pre>` wrapper to strip — confirmed live). Parse it directly; fall
 * back to the outermost {…} span only in case Firecrawl ever wraps the payload
 * in page chrome. Returns null when no JSON object can be recovered (e.g. the
 * Cloudflare interstitial was returned instead of the API body).
 */
function parseJsonFromBody(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* not verbatim JSON — try to recover an embedded object below */
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      /* a challenge page's inline JS braces won't parse as Tribe JSON — give up */
    }
  }
  return null;
}

/**
 * Render one paginated Tribe API page through Firecrawl and parse the JSON body.
 * Returns the parsed TribeResponse, or `{ data: null }` when the page yielded no
 * events array — with `error` set for a genuine failure (Firecrawl error or an
 * unparseable/challenge body) and `error: null` for a clean end-of-results (a
 * parseable non-events body, e.g. Tribe's 400 "page not found" past the last
 * page). The caller decides whether a null is fatal (page 1) or a stop signal.
 */
async function fetchTribePage(
  firecrawl: FirecrawlApp,
  url: string
): Promise<{ data: TribeResponse | null; error: string | null }> {
  // schema/params are a plain object; the SDK types want a Zod schema, but the
  // API accepts this and scripts/ is not type-checked (CI runs tsx without tsc).
  // Cast keeps intent clear. Mirrors scripts/scrapers/red-cross.ts.
  const params = {
    formats: ["rawHtml"],
    waitFor: FIRECRAWL_WAIT_MS,
    timeout: FIRECRAWL_TIMEOUT_MS,
    onlyMainContent: false,
  } as Parameters<typeof firecrawl.scrapeUrl>[1];

  let result;
  try {
    result = await firecrawl.scrapeUrl(url, params);
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }

  if (!result.success) {
    return {
      data: null,
      error: (result as { error?: string }).error ?? "unknown Firecrawl error",
    };
  }

  const raw = (result as { rawHtml?: string }).rawHtml ?? "";
  const parsed = parseJsonFromBody(raw);

  if (parsed && typeof parsed === "object" && Array.isArray((parsed as TribeResponse).events)) {
    return { data: parsed as TribeResponse, error: null };
  }
  // Parsed JSON but no events array → a Tribe error response (the natural
  // end-of-results past the last page). Clean stop, not a failure.
  if (parsed && typeof parsed === "object") {
    return { data: null, error: null };
  }
  // No JSON recovered → the challenge wasn't solved or the response was HTML.
  return {
    data: null,
    error: "response body was not parseable JSON (Cloudflare challenge not cleared?)",
  };
}

async function fetchAllEvents(): Promise<TribeEvent[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("Missing FIRECRAWL_API_KEY environment variable");
  }
  const firecrawl = new FirecrawlApp({ apiKey });

  const today = new Date().toISOString().slice(0, 10);
  const events: TribeEvent[] = [];
  // Bounded by the count Tribe reports on page 1 so we never request an
  // out-of-range page. Starts at MAX_PAGES until page 1 tells us the real total.
  let totalPages = MAX_PAGES;

  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
    const url = `${API_URL}?per_page=${PER_PAGE}&start_date=${today}&page=${page}`;
    console.log(`  fetching page ${page} via Firecrawl …`);

    const { data, error } = await fetchTribePage(firecrawl, url);

    if (!data) {
      // Page 1 must yield events. A failure here (challenge not cleared, Firecrawl
      // error, or API change) is a hard failure — throw so the orchestrator
      // records the source as `failed` (see the telemetry in scripts/scrape.ts).
      if (page === 1) {
        throw new Error(
          `Visit Murphys: Firecrawl returned no usable Tribe JSON on page 1` +
            (error ? ` — ${error}` : ` — empty result on the first page`)
        );
      }
      // Later pages: keep what we already have rather than failing the whole run.
      // A clean end-of-results (error === null) is expected; an unparseable body
      // is a transient miss we warn about but tolerate.
      if (error) {
        console.warn(`  page ${page}: ${error} — stopping with ${events.length} event(s) so far`);
      } else {
        console.log(`  page ${page}: end of results — stopping`);
      }
      break;
    }

    if (page === 1 && typeof data.total_pages === "number" && data.total_pages > 0) {
      totalPages = data.total_pages;
      console.log(`    Tribe reports ${data.total} event(s) across ${data.total_pages} page(s)`);
    }

    if (data.events.length === 0) {
      console.log(`  page ${page} empty — stopping`);
      break;
    }

    events.push(...data.events);
    console.log(`    +${data.events.length} (running total ${events.length})`);

    // Defensive secondary stop: a short page means there's no next one.
    if (data.events.length < PER_PAGE) break;
  }

  return events;
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

  const tribeEvents = await fetchAllEvents();
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
  const manualSkipped = corridor.filter(isManuallyManagedEvent);
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

  let result: UpsertResult = { inserted: 0, updated: 0, unchanged: 0, skippedFuzzy: 0 };
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

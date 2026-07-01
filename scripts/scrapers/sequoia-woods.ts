import FirecrawlApp from "@mendable/firecrawl-js";
import { decodeEventFields, type ExtractedEvent } from "../lib/extract.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";
import { classifyEventCategory } from "../../lib/categorize.js";

/**
 * Sequoia Woods Country Club calendar scraper.
 *
 * Why a hand-written scraper (not a FIRECRAWL_SOURCES config entry): the generic
 * runner writes ONE visibility for the whole batch, but this club's public
 * calendar mixes two audiences — members-only golf/club competitions and
 * public dining/music/social nights. Rob's rule (verified against live data):
 * a title containing "Private Event" is a third-party rental (wedding, buyout)
 * and is never recorded; a title containing "Member Event" is gated behind the
 * Clubs filter (visibility='private'); anything else is public.
 *
 * Source shape: the calendar is a Duda-built month-grid widget. Rather than
 * LLM-extracting the rendered text (which turned out to non-deterministically
 * mis-stamp the YEAR on each row), each day cell carries its events as an exact
 * base64-encoded JSON blob in a `data-day-events` attribute — so we fetch the
 * raw HTML and decode that directly. Zero LLM involvement in extraction, so the
 * year-hallucination bug class is gone for good, and it's cheaper per fetch.
 *
 * Multi-month coverage: the widget shows one month at a time (plus a few
 * spillover days from its neighbors). To reach July/August (not just the
 * current month), we page forward via Firecrawl `actions` (click the widget's
 * next-month arrow). Empirically verified live: the FIRST click in a fresh
 * session always overshoots by an extra month, but every click after that
 * behaves normally (+1). So the only way to land on next-month cleanly is
 * "click next, then click prev" (nets to +1); month+2 is a single "next" click.
 * See buildActionsForOffset. We fetch MONTHS_TO_FETCH consecutive month views
 * (current + next 2) and dedupe the overlapping spillover across them.
 *
 * There is deliberately NO stale sweep — a sweep keyed on last_scraped_at would
 * delete real future rows outside the fetched window. Insert/upsert only,
 * mirroring the Blue Lake Springs member scraper.
 */

const SOURCE_NAME = "Sequoia Woods Country Club";
const ORG_SLUG = "sequoia-woods";
const PAGE_URL = "https://www.sequoiawoods.com/calendar";
const VENUE_NAME = "Sequoia Woods Country Club";
const TOWN = "Arnold";
const ADDRESS = "1000 Cypress Point Drive, Arnold, CA 95223";

// Current month + the next 2 (covers e.g. "July and August" from whatever
// month is showing when the daily cron runs — self-adjusting, not hardcoded).
const MONTHS_TO_FETCH = 3;

// ─── Month-grid pagination (Firecrawl actions) ──────────────────────────

interface FirecrawlAction {
  type: string;
  selector?: string;
  milliseconds?: number;
}

/**
 * Click sequence to land on (current month + offset). Empirically verified
 * against the live widget: a fresh session's first click always overshoots by
 * one extra month; every click after the first behaves normally.
 *   offset 0: no clicks.
 *   offset 1: click next, then click prev — the ONLY way to net +1 (a lone
 *     next-click always overshoots to +2).
 *   offset >=2: (offset - 1) next-clicks (first click's +2 overshoot, plus
 *     (offset-2) further +1 clicks, nets to `offset`).
 */
function buildActionsForOffset(offset: number): FirecrawlAction[] | undefined {
  if (offset === 0) return undefined;
  if (offset === 1) {
    return [
      { type: "click", selector: ".right-arrow-container" },
      { type: "wait", milliseconds: 2500 },
      { type: "click", selector: ".left-arrow-container" },
      { type: "wait", milliseconds: 2500 },
    ];
  }
  const actions: FirecrawlAction[] = [];
  for (let i = 0; i < offset - 1; i++) {
    actions.push({ type: "click", selector: ".right-arrow-container" });
    actions.push({ type: "wait", milliseconds: 2500 });
  }
  return actions;
}

// ─── Deterministic day-cell decoding ─────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface RawDayEvent {
  date: string; // YYYY-MM-DD
  summary: string;
  start: string;
  end: string;
  isAllDayEvent: boolean;
}

interface ParsedMonth {
  monthLabel: string | null;
  events: RawDayEvent[];
}

interface DudaDayEvent {
  isAllDayEvent?: boolean;
  start?: string;
  end?: string;
  summary?: string;
}

/**
 * Parses one rendered month-grid page. Each day cell carries a
 * `data-day-events` attribute: base64 JSON, exact structured data (title,
 * time, all-day flag) straight from the widget — no LLM guessing. The month
 * header (current-month-text/current-year-text) anchors the grid; spillover
 * cells (data-auto="not-day-of-month-dayN") before the first real day belong
 * to the previous month, after the last real day belong to the next month.
 */
function parseMonthHtml(html: string): ParsedMonth {
  const monthM = html.match(/current-month-text">([^<]+)</);
  const yearM = html.match(/current-year-text">([^<]+)</);
  const monthLabel = monthM && yearM ? `${monthM[1].trim()} ${yearM[1].trim()}` : null;

  const anchorMonth = monthM
    ? MONTH_NAMES.findIndex((m) => m.toLowerCase() === monthM[1].trim().toLowerCase())
    : -1;
  const anchorYear = yearM ? parseInt(yearM[1].trim(), 10) : NaN;

  const events: RawDayEvent[] = [];
  if (anchorMonth < 0 || Number.isNaN(anchorYear)) return { monthLabel, events };

  const cellRe = /data-day-events="([^"]*)"[^>]*data-has-events="[^"]*"[^>]*data-auto="([^"]*)"/g;
  let m: RegExpExecArray | null;
  let seenCurrent = false;

  while ((m = cellRe.exec(html))) {
    const b64 = m[1];
    const dm = m[2].match(/^(not-day-of-month-)?day(\d+)$/);
    if (!dm) continue;
    const spillover = !!dm[1];
    const dayNum = parseInt(dm[2], 10);
    if (!spillover) seenCurrent = true;
    const monthOffset = !spillover ? 0 : seenCurrent ? 1 : -1;

    if (!b64 || b64 === "W10=") continue;
    let arr: DudaDayEvent[];
    try {
      arr = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(arr)) continue;

    const d = new Date(Date.UTC(anchorYear, anchorMonth + monthOffset, dayNum));
    const dateStr = d.toISOString().slice(0, 10);
    for (const ev of arr) {
      if (!ev.summary) continue;
      events.push({
        date: dateStr,
        summary: ev.summary,
        start: ev.start ?? "",
        end: ev.end ?? "",
        isAllDayEvent: ev.isAllDayEvent === true,
      });
    }
  }

  return { monthLabel, events };
}

async function fetchMonth(firecrawl: FirecrawlApp, offset: number): Promise<ParsedMonth> {
  // schema-less rawHtml fetch — no LLM, no jsonOptions. `actions` isn't in the
  // SDK's narrow scrapeUrl type but IS accepted by the API; scripts/ isn't
  // type-checked (tsx transpiles only), same idiom as the other scrapers' casts.
  const params = {
    formats: ["rawHtml"],
    waitFor: 8000,
    timeout: 60000,
    onlyMainContent: false,
    actions: buildActionsForOffset(offset),
  } as Parameters<typeof firecrawl.scrapeUrl>[1];

  try {
    const result = await firecrawl.scrapeUrl(PAGE_URL, params);
    if (!result.success) {
      console.warn(
        `  Firecrawl failed for offset +${offset}:`,
        (result as { error?: string }).error ?? "unknown error"
      );
      return { monthLabel: null, events: [] };
    }
    const html =
      (result as { rawHtml?: string }).rawHtml ?? (result as { html?: string }).html ?? "";
    return parseMonthHtml(html);
  } catch (err) {
    console.warn(`  Error fetching offset +${offset}:`, err);
    return { monthLabel: null, events: [] };
  }
}

// ─── Classification (Rob's rule, verified against live tagging) ─────────

// Third-party private rentals (e.g. "Private Event - Wedding (...)") — never
// recorded, regardless of anything else in the title.
const PRIVATE_EVENT_TAG = /private event/i;
// Members-only competitions/gatherings — gated behind the Clubs filter.
const MEMBER_EVENT_TAG = /member event/i;
// Strips a trailing "- Member Event" or "(Member Event)" tag for a clean title.
const MEMBER_EVENT_STRIP = /\s*[-(]?\s*member event\)?\s*$/i;

/** Accepts "9pm", "10:30pm", "12am", "7:30am" -> 24h "HH:MM" (or null). */
function parseClockTime(raw: string | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):?(\d{2})?\s*([ap]m)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ?? "00";
  const ap = m[3].toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 60);
}

interface MappedEvent {
  event: ExtractedEvent;
  visibility: "public" | "private";
}

function mapRawEvent(raw: RawDayEvent): MappedEvent | null {
  const rawSummary = raw.summary.trim();
  if (!rawSummary || !raw.date) return null;

  // Third-party private rentals — don't record at all.
  if (PRIVATE_EVENT_TAG.test(rawSummary)) return null;

  const isMember = MEMBER_EVENT_TAG.test(rawSummary);
  const name = rawSummary.replace(MEMBER_EVENT_STRIP, "").replace(/\s+/g, " ").trim();
  if (!name) return null;

  const event: ExtractedEvent = {
    name,
    description: null,
    date: raw.date,
    start_time: raw.isAllDayEvent ? null : parseClockTime(raw.start),
    end_time: raw.isAllDayEvent ? null : parseClockTime(raw.end),
    venue_name: VENUE_NAME,
    town: TOWN,
    address: ADDRESS,
    // Deterministic category floor, same pattern the other scrapers use, so
    // e.g. "Karaoke" / "Live Music …" land in live_music.
    category: classifyEventCategory(name),
    price: null,
    artists: null,
    event_url: null,
    image_url: null,
    // Stable id so a re-scrape updates the same row in place. Keyed on
    // date + slug(name) — matches the scheme the prior extraction used, so
    // already-recorded public rows update in place rather than duplicating.
    source_event_id: `sequoia-woods|${raw.date}|${slugify(name)}`,
  };

  return { event: decodeEventFields(event), visibility: isMember ? "private" : "public" };
}

// ─── Main ───────────────────────────────────────────────────────────────

export async function scrapeSequoiaWoods(): Promise<void> {
  console.log("=== Sequoia Woods Country Club (calendar) ===");

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("Missing FIRECRAWL_API_KEY environment variable");
  }
  const firecrawl = new FirecrawlApp({ apiKey });
  const today = new Date().toISOString().slice(0, 10);

  // 1. Fetch MONTHS_TO_FETCH consecutive clean month views (current + next 2).
  //    Each carries a few spillover days from its neighbors, so consecutive
  //    fetches overlap at the edges — deduped below.
  const rawEvents: RawDayEvent[] = [];
  for (let offset = 0; offset < MONTHS_TO_FETCH; offset++) {
    const { monthLabel, events } = await fetchMonth(firecrawl, offset);
    console.log(`  Month +${offset}: ${monthLabel ?? "(unresolved)"} — ${events.length} entr(ies)`);
    rawEvents.push(...events);
  }

  // 2. Dedupe exact repeats from overlapping spillover across fetches.
  const byRawKey = new Map<string, RawDayEvent>();
  for (const e of rawEvents) {
    const key = `${e.date}|${e.summary.trim().toLowerCase()}`;
    if (!byRawKey.has(key)) byRawKey.set(key, e);
  }
  const dedupedRaw = [...byRawKey.values()];

  // 3. Classify: Private Event -> skip, Member Event -> private, else public.
  const mapped: MappedEvent[] = [];
  for (const raw of dedupedRaw) {
    const m = mapRawEvent(raw);
    if (m) mapped.push(m);
  }

  console.log(
    `\n${rawEvents.length} raw entr(ies) across ${MONTHS_TO_FETCH} month(s), ` +
      `${dedupedRaw.length} after spillover dedup, ${mapped.length} recorded (private rentals skipped)`
  );
  console.log(`  Mapped ${mapped.length} event(s) (pre-future-filter):`);
  for (const m of mapped) {
    console.log(
      `    ${m.event.date} | ${m.visibility === "private" ? "MEMBERS" : "public "} | ${m.event.name}`
    );
  }

  // 4. Future only, then a final defensive dedup by stable source id.
  const future = mapped.filter((m) => m.event.date >= today);
  const byId = new Map<string, MappedEvent>();
  for (const m of future) {
    const key = m.event.source_event_id ?? `${m.event.name}|${m.event.date}`;
    if (!byId.has(key)) byId.set(key, m);
  }
  const deduped = [...byId.values()];

  const publicEvents = deduped.filter((m) => m.visibility === "public").map((m) => m.event);
  const privateEvents = deduped.filter((m) => m.visibility === "private").map((m) => m.event);

  console.log(
    `\n${future.length} future, ${deduped.length} after dedup (${publicEvents.length} public, ${privateEvents.length} members-only)`
  );
  for (const m of deduped) {
    console.log(
      `  - ${m.event.date} | ${m.visibility === "private" ? "MEMBERS" : "public "} | ${m.event.category.padEnd(11)} | ${m.event.name}`
    );
  }

  if (deduped.length === 0) {
    console.log("No future Sequoia Woods events to upsert.");
    return;
  }

  // 5. Upsert through the shared path once per visibility.
  const totals: UpsertResult = { inserted: 0, updated: 0, unchanged: 0, skippedFuzzy: 0 };
  for (const [events, visibility] of [
    [publicEvents, "public"],
    [privateEvents, "private"],
  ] as const) {
    if (events.length === 0) continue;
    const r = await upsertEvents(events, SOURCE_NAME, ORG_SLUG, PAGE_URL, visibility);
    totals.inserted += r.inserted;
    totals.updated += r.updated;
    totals.unchanged += r.unchanged;
    totals.skippedFuzzy += r.skippedFuzzy;
  }

  console.log("\n=== Sequoia Woods Summary ===");
  console.log(`Public events: ${publicEvents.length}, members-only: ${privateEvents.length}`);
  console.log(`Inserted: ${totals.inserted}`);
  console.log(`Updated: ${totals.updated}`);
  console.log(`Unchanged: ${totals.unchanged}`);
  console.log(`Merged (cross-source): ${totals.skippedFuzzy}`);
}

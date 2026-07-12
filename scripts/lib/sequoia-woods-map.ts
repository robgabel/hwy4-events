import type { ExtractedEvent } from "./extract.js";
import { classifyEventCategory } from "../../lib/categorize.js";

/**
 * Pure mapping core for the Sequoia Woods calendar scraper
 * (scripts/scrapers/sequoia-woods.ts) — split out so the timezone/
 * classification logic is importable without the scraper's Firecrawl/
 * Supabase/Anthropic module-load side effects. Locked by
 * scripts/test/sequoia-woods-time.test.ts.
 */

export const VENUE_NAME = "Sequoia Woods Country Club";
export const TOWN = "Arnold";
export const ADDRESS = "1000 Cypress Point Drive, Arnold, CA 95223";

export interface RawDayEvent {
  date: string; // YYYY-MM-DD
  summary: string;
  start: string;
  end: string;
  isAllDayEvent: boolean;
}

export interface MappedEvent {
  event: ExtractedEvent;
  visibility: "public" | "private";
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
export function parseClockTime(raw: string | undefined): string | null {
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

// The widget's `data-day-events` time strings are serialized in US EASTERN
// time, not the venue's Pacific — verified live 2026-07-12: the Groovy Judy
// patio party's blob says start "10pm" while the SAME blob's description says
// "*7-10pm Live Music" and the rendered widget shows 7pm (the widget's client
// JS converts for display; the raw attribute does not). Every timed entry on
// the page carries the same +3h skew. Eastern and Pacific observe DST in
// lockstep, so the correction is a constant -3 hours year-round.
export const SOURCE_TZ_OFFSET_HOURS = -3;

/**
 * Shifts a 24h "HH:MM" by offsetHours, wrapping across midnight.
 * dayDelta reports a date rollover (an Eastern 1am start is the prior
 * Pacific evening), so the caller can correct the event date too.
 */
export function shiftClock(
  hhmm: string,
  offsetHours: number
): { time: string; dayDelta: number } {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  const total = h + offsetHours;
  const wrapped = ((total % 24) + 24) % 24;
  return {
    time: `${String(wrapped).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
    dayDelta: Math.floor(total / 24),
  };
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

/**
 * Maps one decoded day-cell entry to an upsertable event (or null to skip).
 * The caller applies decodeEventFields (HTML-entity decode) on the result —
 * kept out of here so this module stays import-safe without an Anthropic key.
 */
export function mapRawEvent(raw: RawDayEvent): MappedEvent | null {
  const rawSummary = raw.summary.trim();
  if (!rawSummary || !raw.date) return null;

  // Third-party private rentals — don't record at all.
  if (PRIVATE_EVENT_TAG.test(rawSummary)) return null;

  const isMember = MEMBER_EVENT_TAG.test(rawSummary);
  const name = rawSummary.replace(MEMBER_EVENT_STRIP, "").replace(/\s+/g, " ").trim();
  if (!name) return null;

  // Convert the blob's Eastern-serialized times to Pacific. A start that
  // rolls back across midnight (Eastern 12–2:59am) moves the event to the
  // prior Pacific date; the end time is a bare clock, so its wrap is enough.
  const startEastern = raw.isAllDayEvent ? null : parseClockTime(raw.start);
  const endEastern = raw.isAllDayEvent ? null : parseClockTime(raw.end);
  const start = startEastern ? shiftClock(startEastern, SOURCE_TZ_OFFSET_HOURS) : null;
  const end = endEastern ? shiftClock(endEastern, SOURCE_TZ_OFFSET_HOURS) : null;
  const date = start && start.dayDelta !== 0 ? addDays(raw.date, start.dayDelta) : raw.date;

  const event: ExtractedEvent = {
    name,
    description: null,
    date,
    start_time: start?.time ?? null,
    end_time: end?.time ?? null,
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
    source_event_id: `sequoia-woods|${date}|${slugify(name)}`,
  };

  return { event, visibility: isMember ? "private" : "public" };
}

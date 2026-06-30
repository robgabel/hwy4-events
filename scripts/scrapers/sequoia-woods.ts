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
 * public dining/music/social nights. We classify each event and gate only the
 * members-only ones (visibility='private', surfaced behind the homepage Clubs
 * filter + the "Members & Guests" badge); the public social events stay
 * visibility='public' so visitors see the concerts, karaoke, and dinners.
 *
 * Source shape: the calendar (https://www.sequoiawoods.com/calendar) is a
 * Duda-built month-grid widget that 403s a plain fetch, so — like red-cross —
 * we render + JSON-extract it through Firecrawl (FIRECRAWL_API_KEY). The page
 * helpfully tags members-only entries with a literal "- Member Event" suffix,
 * which makes the public/private split deterministic; we ask Firecrawl for that
 * classification and back it with a keyword floor so an LLM whiff can never leak
 * a members-only golf event onto the public calendar.
 *
 * Coverage caveat: the widget shows ONE month at a time (the current month plus
 * a few spillover days), so each run picks up roughly the next ~4-5 weeks. There
 * is deliberately NO stale sweep — a sweep keyed on last_scraped_at would delete
 * the further-out rows that aren't in the visible window. Insert/upsert only,
 * mirroring the Blue Lake Springs member scraper.
 */

const SOURCE_NAME = "Sequoia Woods Country Club";
const ORG_SLUG = "sequoia-woods";
const PAGE_URL = "https://www.sequoiawoods.com/calendar";
const VENUE_NAME = "Sequoia Woods Country Club";
const TOWN = "Arnold";
const ADDRESS = "1000 Cypress Point Drive, Arnold, CA 95223";

// ─── Firecrawl JSON extraction ──────────────────────────────────────────

interface SwEvent {
  name?: string;
  date?: string; // YYYY-MM-DD
  start_time?: string; // 24h HH:MM (may be "")
  category?: string;
  members_only?: boolean;
  is_private_rental?: boolean;
}

const EVENT_SCHEMA = {
  type: "object",
  properties: {
    month_label: { type: "string" },
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          date: { type: "string" },
          start_time: { type: "string" },
          category: { type: "string" },
          members_only: { type: "boolean" },
          is_private_rental: { type: "boolean" },
        },
      },
    },
  },
};

const EXTRACT_PROMPT = `This is a month-grid events calendar for Sequoia Woods Country Club. The month and year are shown above the grid (e.g. "June 2026"). Extract EVERY event entry printed in any day cell, including days that spill into the next month.

For each event return:
- name: clean title. Strip any leading time like "9pm" and strip a trailing " - Member Event" suffix.
- date: YYYY-MM-DD, using the month/year header.
- start_time: 24-hour HH:MM, or "" if no time is shown (entries often prefix a time like "9pm", "10pm", "7:30am", "5pm").
- category: one of live_music, wine, games, kids, hike_walk, festival, civic, fine_arts, other.
- members_only: true if the entry text contains "Member Event" OR is a golf tournament / club competition (Men's Club, Women's club, Couple's Twilight, Jr. Golf Clinic, SWWGC, Partner Chapman, Home & Home, Par 3, Kick Off, "Tourney"). false for public dining/music/social events (Thursday Night Dinner, Karaoke, Live Music, Patio Party, Deli Special, Restaurant Open, Brunch).
- is_private_rental: true ONLY for third-party private bookings such as a wedding or corporate buyout.

Only return events actually printed on the calendar. Never invent an event.`;

async function fetchEvents(firecrawl: FirecrawlApp): Promise<SwEvent[]> {
  // schema is a plain JSON Schema — the SDK types want a Zod schema, but the API
  // accepts JSON Schema and scripts/ isn't type-checked. Same idiom as red-cross.
  const params = {
    formats: ["json"],
    jsonOptions: { prompt: EXTRACT_PROMPT, schema: EVENT_SCHEMA },
    waitFor: 8000,
    timeout: 60000,
    onlyMainContent: false,
  } as Parameters<typeof firecrawl.scrapeUrl>[1];

  try {
    const result = await firecrawl.scrapeUrl(PAGE_URL, params);
    if (!result.success) {
      console.warn(
        `  Firecrawl failed for ${PAGE_URL}:`,
        (result as { error?: string }).error ?? "unknown error"
      );
      return [];
    }
    const payload = (result.json ?? {}) as { events?: SwEvent[] };
    return Array.isArray(payload.events) ? payload.events : [];
  } catch (err) {
    console.warn(`  Error fetching ${PAGE_URL}:`, err);
    return [];
  }
}

// ─── Classification floors ──────────────────────────────────────────────

// Deterministic floor TOWARD members-only: clear golf/club-competition signals
// force visibility='private' even if the LLM marked the entry public. Only adds
// gating, never removes it — safe.
const MEMBER_SIGNAL =
  /member event|tourney|tournament|men'?s club|women'?s .*club|couple'?s twilight|jr\.? golf|junior golf|swwgc|partner chapman|home & home|par 3|kick.?off|scramble|shotgun|\b9 hole\b|\b18 hole\b/i;

// Deterministic floor TOWARD skipping: third-party private rentals are not
// community events and shouldn't be listed at all.
const PRIVATE_RENTAL_SIGNAL = /private event|wedding|corporate (event|buyout|party)/i;

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

function mapEvent(e: SwEvent): MappedEvent | null {
  const name = e.name?.trim();
  const date = e.date?.trim();
  if (!name || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  // Skip third-party private rentals (weddings, corporate buyouts).
  if (e.is_private_rental || PRIVATE_RENTAL_SIGNAL.test(name)) return null;

  const membersOnly = e.members_only === true || MEMBER_SIGNAL.test(name);
  const start = e.start_time?.trim();

  const event: ExtractedEvent = {
    name,
    description: null,
    date,
    start_time: start && /^\d{2}:\d{2}$/.test(start) ? start : null,
    end_time: null,
    venue_name: VENUE_NAME,
    town: TOWN,
    address: ADDRESS,
    // Deterministic category floor under the LLM hint (same pattern the other
    // scrapers use), so e.g. "Karaoke" / "Live Music …" land in live_music.
    category: classifyEventCategory(name),
    price: null,
    artists: null,
    event_url: null,
    image_url: null,
    // Stable id so a re-scrape updates the same row in place even if the title
    // changes slightly. Keyed on date + slug(name).
    source_event_id: `sequoia-woods|${date}|${slugify(name)}`,
  };

  return { event: decodeEventFields(event), visibility: membersOnly ? "private" : "public" };
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

  // 1. Pull + classify events from the visible calendar month(s).
  const raw = await fetchEvents(firecrawl);
  console.log(`  Firecrawl returned ${raw.length} calendar entr(ies)`);

  const mapped: MappedEvent[] = [];
  for (const e of raw) {
    const m = mapEvent(e);
    if (m) mapped.push(m);
  }

  // 2. Future only, then dedupe by stable source id.
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
    `\n${raw.length} extracted, ${mapped.length} mapped, ${future.length} future, ` +
      `${deduped.length} after dedup (${publicEvents.length} public, ${privateEvents.length} members-only)`
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

  // 3. Upsert through the shared path once per visibility. The matcher gives
  //    each row venue_key='sequoia-woods' + org_slug; the private batch carries
  //    visibility='private' for the Clubs-filter gating.
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

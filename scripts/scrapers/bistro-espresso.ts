import { supabaseAdmin } from "../lib/supabase-admin.js";
import {
  generateDedupKey,
  type UpsertResult,
} from "../lib/dedup.js";
import type { ExtractedEvent } from "../lib/extract.js";

const SITE_ORIGIN = "https://www.thebistroespresso.com";
const EVENTS_URL = `${SITE_ORIGIN}/events/`;
const SOURCE_NAME = "Bistro Espresso";
const ORG_SLUG = "bistro-espresso";
const VENUE_NAME = "Bistro Espresso";
const TOWN = "Arnold";
const ADDRESS = "1218 CA-4, Arnold, CA 95223";

interface RawBistroEvent {
  id: string;
  title: string;
  date: string; // e.g. "June 13, Saturday"
  time: string; // e.g. "6–9 PM"
  description?: string;
  image?: string;
}

/**
 * Bistro Espresso publishes its concert schedule as a hardcoded array
 * inside the React bundle. We fetch the page, locate the main JS bundle
 * URL, then extract the `Hu=[...]` events array from it.
 */
export async function scrapeBistroEspresso(): Promise<void> {
  console.log("=== Bistro Espresso Scraper ===");
  console.log(`Fetching: ${EVENTS_URL}`);

  const htmlRes = await fetch(EVENTS_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (hwy4events scraper)" },
  });
  if (!htmlRes.ok) {
    console.error(`Failed to fetch events page: ${htmlRes.status}`);
    return;
  }
  const html = await htmlRes.text();

  const bundleMatch = html.match(/\/static\/js\/main\.[A-Za-z0-9]+\.js/);
  if (!bundleMatch) {
    console.error("Could not locate main JS bundle URL in events page HTML");
    return;
  }
  const bundleUrl = `${SITE_ORIGIN}${bundleMatch[0]}`;
  console.log(`Fetching bundle: ${bundleUrl}`);

  const jsRes = await fetch(bundleUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (hwy4events scraper)" },
  });
  if (!jsRes.ok) {
    console.error(`Failed to fetch JS bundle: ${jsRes.status}`);
    return;
  }
  const js = await jsRes.text();

  const rawEvents = extractBistroEvents(js);
  console.log(`Parsed ${rawEvents.length} events from bundle`);

  const today = new Date().toISOString().slice(0, 10);
  const events = rawEvents
    .map(normalizeBistroEvent)
    .filter((e): e is ExtractedEvent => e !== null)
    .filter((e) => e.date >= today);

  console.log(`Future events: ${events.length}`);
  for (const e of events) {
    console.log(`  - ${e.name} | ${e.date} | ${e.start_time ?? "?"}`);
  }

  const result: UpsertResult = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skippedFuzzy: 0,
  };

  for (const event of events) {
    const outcome = await upsertBistroEvent(event);
    result[outcome]++;
  }

  console.log("\n=== Bistro Espresso Summary ===");
  console.log(`Events inserted: ${result.inserted}`);
  console.log(`Events updated:  ${result.updated}`);
  console.log(`Events merged (same date+venue): ${result.skippedFuzzy}`);
  console.log(`Events unchanged: ${result.unchanged}`);
}

/**
 * Extract the embedded `Hu=[{...}, ...]` events array from the JS bundle.
 *
 * The bundle uses minified JS object literal syntax (unquoted keys, single
 * quotes, escape sequences). We extract per-event field values with named
 * regexes rather than trying to JSON.parse the whole thing.
 */
function extractBistroEvents(js: string): RawBistroEvent[] {
  // Locate the events array. The variable name (`Hu` today) can change
  // across builds, so anchor on the first event's shape instead.
  const arrayMatch = js.match(
    /=\[(\{id:"\d{4}-\d{2}-\d{2}-[^"]+",[^\]]*?)\](?!\s*,\s*\{id:)/
  );
  if (!arrayMatch) {
    console.warn("Could not locate events array in JS bundle");
    return [];
  }
  const arrayBody = arrayMatch[1];

  const events: RawBistroEvent[] = [];
  // Each event is a top-level `{...}` object inside the array. Use a brace
  // counter to split since regexes don't handle nesting well — but since
  // these events have no nested braces, splitting on `},{` is safe.
  const objects = splitTopLevelObjects(arrayBody);
  for (const obj of objects) {
    const id = pickString(obj, "id");
    const title = pickString(obj, "title");
    const date = pickString(obj, "date");
    const time = pickString(obj, "time");
    const description = pickString(obj, "description");
    const image = pickImage(obj);
    if (!id || !title || !date) continue;
    events.push({ id, title, date, time: time ?? "", description, image });
  }
  return events;
}

function splitTopLevelObjects(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        out.push(body.slice(start + 1, i));
        start = -1;
      }
    }
  }
  return out;
}

function pickString(obj: string, key: string): string | undefined {
  const re = new RegExp(`(?:^|,)${key}:"((?:\\\\.|[^"\\\\])*)"`);
  const m = obj.match(re);
  if (!m) return undefined;
  return decodeJsString(m[1]);
}

/**
 * `image:n.p+"static/media/Foo_June13.hash.jpg"` — the publicPath prefix
 * `n.p` is `/` at runtime, so the absolute URL is the origin + relative.
 */
function pickImage(obj: string): string | undefined {
  const m = obj.match(/(?:^|,)image:[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\+"((?:\\.|[^"\\])*)"/);
  if (!m) return undefined;
  const relative = decodeJsString(m[1]);
  return `${SITE_ORIGIN}/${relative.replace(/^\//, "")}`;
}

function decodeJsString(s: string): string {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function normalizeBistroEvent(raw: RawBistroEvent): ExtractedEvent | null {
  // The id is `YYYY-MM-DD-slug`. That's our most reliable date source.
  const idDate = raw.id.match(/^(\d{4})-(\d{2})-(\d{2})-/);
  if (!idDate) return null;
  const date = `${idDate[1]}-${idDate[2]}-${idDate[3]}`;

  const { start, end } = parseTimeRange(raw.time);

  return {
    name: raw.title,
    description: raw.description ?? null,
    date,
    start_time: start,
    end_time: end,
    venue_name: VENUE_NAME,
    town: TOWN,
    address: ADDRESS,
    category: "live_music",
    price: null,
    artists: [raw.title], // Title is the performer
    event_url: EVENTS_URL,
    image_url: raw.image ?? null,
  };
}

/**
 * "6–9 PM" / "6-9 PM" / "5–8 PM" → { start: "18:00", end: "21:00" }.
 * Bistro uses concert-evening hours so we treat the single AM/PM as PM by default.
 */
function parseTimeRange(input: string): { start: string | null; end: string | null } {
  if (!input) return { start: null, end: null };
  const m = input.match(/(\d{1,2})(?::(\d{2}))?\s*[–—\-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return { start: null, end: null };
  let sH = parseInt(m[1], 10);
  const sM = m[2] ? parseInt(m[2], 10) : 0;
  let eH = parseInt(m[3], 10);
  const eM = m[4] ? parseInt(m[4], 10) : 0;
  const ampm = (m[5] ?? "PM").toUpperCase();

  // Assume both ends share the AM/PM marker (Bistro shows e.g. "6–9 PM").
  if (ampm === "PM") {
    if (sH < 12) sH += 12;
    if (eH < 12) eH += 12;
  } else if (ampm === "AM") {
    if (sH === 12) sH = 0;
    if (eH === 12) eH = 0;
  }
  const pad = (n: number) => n.toString().padStart(2, "0");
  return {
    start: `${pad(sH)}:${pad(sM)}`,
    end: `${pad(eH)}:${pad(eM)}`,
  };
}

type Outcome = "inserted" | "updated" | "unchanged" | "skippedFuzzy";

/**
 * Upsert with custom Bistro-specific merge:
 * 1. Strict dedup_key match → update.
 * 2. Same date + venue ILIKE 'bistro espresso%' + town=Arnold → claim & update
 *    (catches Facebook-discover events on the same night with different names).
 * 3. Otherwise insert.
 */
async function upsertBistroEvent(event: ExtractedEvent): Promise<Outcome> {
  const now = new Date().toISOString();
  const dedupKey = generateDedupKey(event.name, event.date, event.town);

  const { data: byKey } = await supabaseAdmin
    .from("hwy4_events")
    .select(
      "id, name, venue_name, description, start_time, end_time, price, event_url, address, town, image_url"
    )
    .eq("dedup_key", dedupKey)
    .maybeSingle();

  if (byKey) {
    const sameTime = (a: string | null, b: string | null) =>
      (a ?? "").slice(0, 5) === (b ?? "").slice(0, 5);
    const changed =
      byKey.name !== event.name ||
      byKey.venue_name !== event.venue_name ||
      byKey.description !== event.description ||
      !sameTime(byKey.start_time, event.start_time) ||
      !sameTime(byKey.end_time, event.end_time) ||
      byKey.price !== event.price ||
      byKey.address !== event.address ||
      byKey.town !== event.town ||
      byKey.image_url !== (event.image_url ?? null);
    if (changed) {
      await supabaseAdmin
        .from("hwy4_events")
        .update({
          name: event.name,
          venue_name: event.venue_name,
          description: event.description,
          start_time: event.start_time,
          end_time: event.end_time,
          address: event.address,
          town: event.town,
          image_url: event.image_url ?? null,
          last_scraped_at: now,
        })
        .eq("id", byKey.id);
      return "updated";
    }
    await supabaseAdmin
      .from("hwy4_events")
      .update({ last_scraped_at: now })
      .eq("id", byKey.id);
    return "unchanged";
  }

  // Same-night-same-venue merge: claim FB-discovered events on the same date.
  const { data: sameNight } = await supabaseAdmin
    .from("hwy4_events")
    .select(
      "id, name, venue_name, description, start_time, end_time, event_url, image_url, source_name"
    )
    .eq("date", event.date)
    .eq("town", event.town)
    .ilike("venue_name", "%bistro espresso%");

  if (sameNight && sameNight.length > 0) {
    const existing = sameNight[0];
    // Prefer the Facebook event URL if we have one — it links to the source
    // page that the user might already know — otherwise use our events page.
    const existingFbUrl =
      existing.event_url && existing.event_url.includes("facebook.com")
        ? existing.event_url
        : null;
    await supabaseAdmin
      .from("hwy4_events")
      .update({
        name: event.name,
        venue_name: event.venue_name,
        description: event.description ?? existing.description,
        start_time: event.start_time,
        end_time: event.end_time,
        address: event.address,
        town: event.town,
        category: event.category,
        artists: event.artists,
        image_url: event.image_url ?? existing.image_url ?? null,
        event_url: existingFbUrl ?? event.event_url,
        source_url: EVENTS_URL,
        source_name: SOURCE_NAME,
        org_slug: ORG_SLUG,
        dedup_key: dedupKey,
        last_scraped_at: now,
      })
      .eq("id", existing.id);
    console.log(
      `  Merged: "${event.name}" → claimed existing "${existing.name}" (${event.date})`
    );
    return "skippedFuzzy";
  }

  const { error } = await supabaseAdmin.from("hwy4_events").insert({
    name: event.name,
    description: event.description,
    date: event.date,
    start_time: event.start_time,
    end_time: event.end_time,
    venue_name: event.venue_name,
    town: event.town,
    address: event.address,
    category: event.category,
    artists: event.artists,
    status: "confirmed",
    is_past: false,
    price: event.price,
    event_url: event.event_url,
    image_url: event.image_url ?? null,
    source_url: EVENTS_URL,
    source_name: SOURCE_NAME,
    visibility: "public",
    org_slug: ORG_SLUG,
    dedup_key: dedupKey,
    last_scraped_at: now,
  });

  if (error) {
    console.error(`Failed to insert event "${event.name}":`, error.message);
    return "unchanged";
  }
  return "inserted";
}

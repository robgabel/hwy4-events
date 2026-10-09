import { decodeEventFields, type ExtractedEvent } from "../lib/extract.js";
import { beginOrganizerRun, emptyUpsertResult, addUpsertResult } from "../lib/organizer-source.js";
import { writeOrganizerBatch } from "../lib/organizer-source-exec.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";
import {
  buildExactMatchUpdate,
  countUpdateResult,
  generateDedupKey,
  rowChanged,
} from "../lib/dedup.js";
import {
  STEVENOT_API_URL,
  STEVENOT_ORG_SLUG,
  STEVENOT_PAGE_URL,
  STEVENOT_SOURCE_NAME,
  STEVENOT_TOWN,
  STEVENOT_UA,
  STEVENOT_VENUE_NAME,
  assignStevenotShows,
  categoryForStevenot,
  correctionSnapshot,
  mapStevenotEvent,
  type StevenotResident,
  type StevenotShow,
} from "../lib/stevenot.js";

/** Columns `buildExactMatchUpdate` reads. A missing lock or artists column
 *  looks unlocked or empty and would rewrite a field every run. */
type StevenotRow = StevenotResident & {
  venue_name: string;
  venue_key?: string | null;
  description: string | null;
  end_time: string | null;
  price: string | null;
  event_url: string | null;
  address: string | null;
  town: string;
  image_url: string | null;
  category?: string | null;
  price_locked?: boolean | null;
  description_locked?: boolean | null;
  poster_locked?: boolean | null;
  is_routine?: boolean | null;
  notability_locked?: boolean | null;
  times_locked?: boolean | null;
  family_friendly?: boolean | null;
  family_friendly_locked?: boolean | null;
};

/**
 * Stevenot Winery — the organizer's own Tribe calendar.
 *
 * Registered LAST in SPECIAL_SCRAPERS and deliberately not blocklisted.
 * GoCalaveras still lists the Sundays; this run writes after it and puts the
 * venue's act, clock, and price on the row GoCalaveras already inserted.
 * Parsing and the slug-preserving pairing live in scripts/lib/stevenot.ts.
 *
 * Fetch is this file. The shared Tribe transport uses a Mozilla UA that this
 * host answers with HTTP 403, then retries through a hosted render. A 403 or
 * a non-JSON body throws. There is no captcha workaround.
 *
 * Corrections update by id. They do not go through `upsertEvents`: the Tribe
 * id is not GoCalaveras's EventON id, and a corrected title does not share a
 * dedup_key, so the exact lookups miss. A fuzzy merge would union the wrong
 * act into `artists`. New shows (no resident that day) insert through the
 * organizer writer, with the Tribe id, after a runtime `hwy4_orgs` upsert.
 * No migration, and no stale sweep: a show that drops off this feed is not
 * proof GoCalaveras's row should be deleted, and merged rows keep
 * `org_slug = 'gocalaveras'`, which a stevenot sweep would not see.
 */

const PER_PAGE = 50;
const MAX_PAGES = 6;
const RESIDENT_SELECT =
  "id, name, date, venue_name, venue_key, description, start_time, end_time, price, event_url, address, town, image_url, category, artists, price_locked, description_locked, poster_locked, is_routine, notability_locked, times_locked, family_friendly, family_friendly_locked";

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": STEVENOT_UA, Accept: "application/json" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Stevenot fetch failed HTTP ${res.status} ${url}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Stevenot fetch returned non-JSON (HTTP ${res.status}) ${url}`);
  }
}

async function fetchStevenotEvents(startDate: string): Promise<unknown[]> {
  const events: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${STEVENOT_API_URL}?per_page=${PER_PAGE}&start_date=${startDate}&page=${page}`;
    console.log(`  fetching page ${page} …`);
    const body = await fetchJson(url);
    const list =
      body && typeof body === "object" && Array.isArray((body as { events?: unknown }).events)
        ? (body as { events: unknown[] }).events
        : null;
    if (!list) throw new Error(`Stevenot Tribe response has no events array (${url})`);
    events.push(...list);
    console.log(`    +${list.length} (running total ${events.length})`);
    if (list.length < PER_PAGE) break;
    const next = (body as { next_rest_url?: unknown }).next_rest_url;
    if (typeof next !== "string" || !next) break;
  }
  return events;
}

function toExtracted(show: StevenotShow, name: string, withSourceId: boolean): ExtractedEvent {
  return decodeEventFields({
    name,
    description: show.description,
    date: show.date,
    start_time: show.startTime,
    end_time: show.endTime,
    venue_name: STEVENOT_VENUE_NAME,
    town: STEVENOT_TOWN,
    address: null,
    category: categoryForStevenot(show),
    price: show.price,
    artists: show.act ? [show.act] : null,
    event_url: show.eventUrl,
    image_url: show.imageUrl,
    ...(withSourceId ? { source_event_id: show.sourceEventId } : {}),
    date_authoritative: true,
  });
}

async function ensureStevenotOrg(): Promise<void> {
  const { error } = await supabaseAdmin.from("hwy4_orgs").upsert(
    {
      slug: STEVENOT_ORG_SLUG,
      display_name: STEVENOT_VENUE_NAME,
      town: STEVENOT_TOWN,
      notes:
        "Organizer calendar at stevenotwinery.com (Tribe). Ensured by the Stevenot scraper so a new insert satisfies fk_hwy4_events_org. No canonical_url: the venue website stays the durable Visit link.",
    },
    { onConflict: "slug", ignoreDuplicates: true }
  );
  if (error) throw new Error(`Stevenot org upsert failed: ${error.message}`);
}

async function loadResidents(today: string): Promise<StevenotRow[]> {
  const { data, error } = await supabaseAdmin
    .from("hwy4_events")
    .select(RESIDENT_SELECT)
    .eq("venue_key", "stevenot")
    .gte("date", today)
    .neq("status", "cancelled");
  if (error) throw new Error(`Stevenot resident read failed: ${error.message}`);
  return (data ?? []) as unknown as StevenotRow[];
}

export async function scrapeStevenot(): Promise<void> {
  const run = beginOrganizerRun({
    title: "Stevenot Winery (Tribe REST API)",
    sourceName: STEVENOT_SOURCE_NAME,
    orgSlug: STEVENOT_ORG_SLUG,
    pageUrl: STEVENOT_PAGE_URL,
  });

  const raw = await fetchStevenotEvents(run.today);
  const shows: StevenotShow[] = [];
  for (const ev of raw) {
    const show = mapStevenotEvent(ev);
    if (show && show.date >= run.today) shows.push(show);
  }
  console.log(`Mapped ${shows.length} future show(s) from ${raw.length} Tribe event(s)`);
  if (shows.length === 0) {
    console.log("No future Stevenot shows to write.");
    return;
  }

  await ensureStevenotOrg();
  const residents = await loadResidents(run.today);
  const assignments = assignStevenotShows(shows, residents);
  const corrections = assignments.filter((a) => a.resident);
  const inserts = assignments.filter((a) => !a.resident);
  const now = new Date().toISOString();
  const corrected = emptyUpsertResult();

  for (const assignment of corrections) {
    const resident = assignment.resident!;
    const event = toExtracted(assignment.show, assignment.nameToWrite, false);
    const snapshot = correctionSnapshot(resident, assignment.replaceArtists);
    const label = `${assignment.nameToWrite} ${event.date}`;
    if (!rowChanged(snapshot, event)) {
      const { error } = await supabaseAdmin
        .from("hwy4_events")
        .update({ last_scraped_at: now })
        .eq("id", resident.id);
      countUpdateResult(corrected, "unchanged", error, label);
      continue;
    }
    const payload = buildExactMatchUpdate(
      snapshot,
      event,
      generateDedupKey(event.name, event.date, event.town),
      now
    );
    const { error } = await supabaseAdmin.from("hwy4_events").update(payload).eq("id", resident.id);
    if (countUpdateResult(corrected, "updated", error, label)) {
      console.log(
        `  corrected ${resident.name} -> ${assignment.nameToWrite} | ${event.date} ${event.start_time ?? "?"}-${event.end_time ?? "?"} | ${event.price ?? "no price"}`
      );
    }
  }

  const fresh = inserts.map((a) => toExtracted(a.show, a.nameToWrite, true));
  for (const e of fresh) {
    console.log(
      `  insert ${e.date} ${e.start_time ?? "?"}-${e.end_time ?? "?"} | ${e.name} | ${e.price ?? "no price"}`
    );
  }
  const { upsert, written } = await writeOrganizerBatch(run, { events: fresh });
  addUpsertResult(corrected, upsert);

  console.log("\n=== Stevenot Winery Summary ===");
  console.log(`Tribe events fetched: ${raw.length}`);
  console.log(`Future shows: ${shows.length}`);
  console.log(`Corrected in place: ${corrections.length}`);
  console.log(`New shows: ${written}`);
  console.log(`Inserted: ${corrected.inserted}`);
  console.log(`Updated: ${corrected.updated}`);
  console.log(`Unchanged: ${corrected.unchanged}`);
}

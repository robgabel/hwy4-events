// Write-time parity with reconcile (dedup v2 Phase 1.4, PRD-dedup-merge-v2.md).
//
// The write-time merge used to ask the shared matcher a narrower question than
// the nightly reconcile: the incoming row carried no feed and no registry key,
// the candidates carried no feed and no routine flag, and a hard town gate ran
// ahead of the rule that owns the town question. So a pair reconcile would
// merge at 15:30 could insert as a duplicate at the morning scrape.
//
// Two decisions are locked here beyond "the fields are passed":
//  - Ambiguity: an incoming row that matches two residents which are provably
//    different events merges into neither, the same refusal reconcile makes.
//  - Fill-only across a disagreement: when the match crosses a clock gap (the
//    cross-source rule) or a town label, the resident keeps its name, clock,
//    town and keys. Rewriting them with the incoming feed's would leave a row
//    whose `source_name` says one feed while its keys and clock are another's;
//    its own feed could no longer find it and would re-insert a row the matcher
//    reads as that feed's second session, a duplicate nothing can merge.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

type Row = Record<string, unknown>;
let db: Row[] = [];
let inserted: Row[] = [];
let updates: { id: unknown; payload: Row }[] = [];

function fakeQuery(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: "select" | "insert" | "update" = "select";
  let payload: unknown = null;
  let single = false;
  const run = () => {
    if (table !== "hwy4_events") return { data: [], error: null };
    if (op === "insert") {
      const rows = (Array.isArray(payload) ? payload : [payload]) as Row[];
      for (const r of rows) {
        db.push({ id: `new-${db.length}`, ...r });
        inserted.push(r);
      }
      return { data: rows.map((_, i) => ({ id: `ins-${i}` })), error: null };
    }
    const hits = db.filter((r) => filters.every((f) => f(r)));
    if (op === "update") {
      for (const h of hits) {
        updates.push({ id: h.id, payload: payload as Row });
        Object.assign(h, payload);
      }
      return { data: null, error: null };
    }
    return { data: single ? (hits[0] ?? null) : hits, error: null };
  };
  const q = {
    select: () => q,
    insert: (p: unknown) => ((op = "insert"), (payload = p), q),
    update: (p: unknown) => ((op = "update"), (payload = p), q),
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
    in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
    maybeSingle: () => ((single = true), q),
    then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
      Promise.resolve(run()).then(ok, fail),
  };
  return q;
}

async function upsert(
  batched: boolean,
  events: Row[],
  seed: Row[],
  sourceName: string,
  orgSlug: string
) {
  const { supabaseAdmin } = await import("../lib/supabase-admin.js");
  (supabaseAdmin as unknown as { from: typeof fakeQuery }).from = fakeQuery;
  const { upsertEvents } = await import("../lib/dedup.js");
  db = seed.map((r) => ({ ...r }));
  inserted = [];
  updates = [];
  const priorBatch = process.env.BATCH_DEDUP;
  if (batched) process.env.BATCH_DEDUP = "1";
  else delete process.env.BATCH_DEDUP;
  const { log, warn } = console;
  const lines: string[] = [];
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  console.warn = () => {};
  try {
    const result = await upsertEvents(
      events.map((e) => ({ ...e })) as never,
      sourceName,
      orgSlug,
      "https://example.com/events"
    );
    return { result, lines };
  } finally {
    console.log = log;
    console.warn = warn;
    if (priorBatch === undefined) delete process.env.BATCH_DEDUP;
    else process.env.BATCH_DEDUP = priorBatch;
  }
}

const todayUtc = new Date().toISOString().slice(0, 10);
const plusDays = (n: number): string => {
  const d = new Date(`${todayUtc}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const DAY = plusDays(19);

const incoming = (over: Row = {}): Row => ({
  description: null,
  date: DAY,
  end_time: null,
  address: null,
  category: "festival",
  price: null,
  artists: null,
  image_url: null,
  event_url: "https://example.com/events/incoming",
  source_event_id: "incoming-1",
  ...over,
});

const resident = (over: Row = {}): Row => ({
  id: "res",
  date: DAY,
  description: null,
  end_time: null,
  address: null,
  artists: null,
  price: null,
  image_url: null,
  event_url: "https://example.com/events/resident",
  source_event_id: "resident-1",
  dedup_key: "resident-key",
  series_umbrella: false,
  is_routine: false,
  category: "festival",
  status: "confirmed",
  visibility: "public",
  ...over,
});

for (const batched of [false, true]) {
  const path = batched ? "batched" : "serial";

  test(`[${path}] two feeds 1h apart on one event merge, fill-only: the resident keeps its identity`, async () => {
    const goCal = resident({
      name: "The Gathering on Murphys Main Street",
      town: "Murphys",
      venue_name: "Murphys Main Street",
      start_time: "11:00:00",
      end_time: "17:00:00",
      source_name: "GoCalaveras.com",
    });
    const { result } = await upsert(
      batched,
      [
        incoming({
          name: "Murphys Gathering – A Celebration of All Things Magical",
          town: "Murphys",
          venue_name: "Murphys Main Street",
          start_time: "12:00",
          end_time: "17:00",
          description: "A day of wizards, fairies and costume contests up and down Main Street.",
        }),
      ],
      [goCal],
      "Visit Murphys",
      "visit-murphys"
    );
    assert.equal(result.inserted, 0);
    assert.equal(result.skippedFuzzy, 1);
    const row = db.find((r) => r.id === "res")!;
    assert.equal(row.name, "The Gathering on Murphys Main Street");
    assert.equal(row.start_time, "11:00:00");
    assert.equal(row.dedup_key, "resident-key");
    assert.equal(row.source_event_id, "resident-1");
    assert.equal(row.event_url, "https://example.com/events/resident");
    assert.match(String(row.description), /wizards/, "blank fields still fill");
  });

  test(`[${path}] one feed at a different start is a second session: it inserts`, async () => {
    const { result } = await upsert(
      batched,
      [
        incoming({
          name: "Tapas on Tuesday Cooking Class",
          town: "Murphys",
          venue_name: "Marisolio Tasting Bar",
          start_time: "18:00",
          end_time: "20:00",
          category: "other",
        }),
      ],
      [
        resident({
          name: "Tapas on Tuesday Cooking Class",
          town: "Murphys",
          venue_name: "Marisolio Tasting Bar",
          start_time: "09:30:00",
          end_time: "11:30:00",
          source_name: "GoCalaveras.com",
          category: "other",
        }),
      ],
      "GoCalaveras.com",
      "gocalaveras"
    );
    assert.equal(result.inserted, 1);
  });

  test(`[${path}] a town label no longer gates the match; the resident keeps its town and key`, async () => {
    // Same room (same street number), same slot, same title, two town labels.
    const { result } = await upsert(
      batched,
      [
        incoming({
          name: "Harvest Supper at Hypothetical Hall",
          town: "Dorrington",
          venue_name: "Hypothetical Hall",
          address: "4545 Hypothetical Rd, Dorrington, CA 95223",
          start_time: "18:00",
          category: "other",
        }),
      ],
      [
        resident({
          name: "Harvest Supper at Hypothetical Hall",
          town: "Arnold",
          venue_name: "Hypothetical Hall",
          address: "4545 Hypothetical Rd",
          start_time: "18:00:00",
          source_name: "Visit Murphys",
          category: "other",
        }),
      ],
      "GoCalaveras.com",
      "gocalaveras"
    );
    assert.equal(result.inserted, 0);
    const row = db.find((r) => r.id === "res")!;
    assert.equal(row.town, "Arnold");
    assert.equal(row.dedup_key, "resident-key");
    assert.equal(row.source_event_id, "resident-1");
  });

  test(`[${path}] a placeholder matching two different acts merges into neither and inserts`, async () => {
    const hall = { town: "Arnold", venue_name: "Hypothetical Hall", start_time: "19:00:00", source_name: "Visit Murphys", category: "live_music" };
    const { result, lines } = await upsert(
      batched,
      [incoming({ name: "Live Music @ Hypothetical Hall", town: "Arnold", venue_name: "Hypothetical Hall", start_time: "19:00", category: "live_music" })],
      [
        resident({ ...hall, id: "a", name: "The Hollerin' Hounds", artists: ["The Hollerin' Hounds"], dedup_key: "a", source_event_id: "a" }),
        resident({ ...hall, id: "b", name: "Sipsy River Band", artists: ["Sipsy River Band"], dedup_key: "b", source_event_id: "b" }),
      ],
      "GoCalaveras.com",
      "gocalaveras"
    );
    assert.equal(result.inserted, 1);
    assert.equal(result.skippedFuzzy, 0);
    assert.ok(lines.some((l) => l.includes("AMBIGUOUS_MATCH")), "the refusal is logged");
  });

  test(`[${path}] a placeholder never merges into a routine operation`, async () => {
    const { result } = await upsert(
      batched,
      [
        incoming({
          name: "Live Music @ Sequoia Woods Country Club",
          town: "Arnold",
          venue_name: "Sequoia Woods Country Club",
          start_time: "19:00",
          category: "live_music",
        }),
      ],
      [
        resident({
          name: "Thursday Night Dinner",
          town: "Arnold",
          venue_name: "Sequoia Woods Country Club",
          venue_key: "sequoia-woods",
          start_time: "18:00:00",
          end_time: "21:00:00",
          source_name: "Sequoia Woods Country Club",
          is_routine: true,
          category: "other",
        }),
      ],
      "GoCalaveras.com",
      "gocalaveras"
    );
    assert.equal(result.inserted, 1);
    assert.equal(db.find((r) => r.id === "res")!.name, "Thursday Night Dinner");
  });
}

for (const batched of [false, true]) {
  const path = batched ? "batched" : "serial";
  test(`[${path}] a venue's own routine operation never merges into a live-music placeholder`, async () => {
    // Sequoia's scraper sends its dinner (the notability floor marks it
    // routine); GoCalaveras already listed the evening's music as a
    // placeholder. Merged, the concert row would take the dinner's name and
    // routine flag and vanish from the site.
    const { result } = await upsert(
      batched,
      [
        incoming({
          name: "Thursday Night Dinner",
          town: "Arnold",
          venue_name: "Sequoia Woods Country Club",
          start_time: "18:00",
          end_time: "21:00",
          category: "other",
        }),
      ],
      [
        resident({
          name: "Live Music @ Sequoia Woods Country Club",
          town: "Arnold",
          venue_name: "Sequoia Woods Country Club",
          venue_key: "sequoia-woods",
          start_time: "19:00:00",
          source_name: "GoCalaveras.com",
          category: "live_music",
        }),
      ],
      "Sequoia Woods Country Club",
      "sequoia-woods"
    );
    assert.equal(result.inserted, 1);
    const concert = db.find((r) => r.id === "res")!;
    assert.equal(concert.name, "Live Music @ Sequoia Woods Country Club");
    assert.notEqual(concert.is_routine, true);
  });
}

test("both write paths select the fields the matcher needs from every candidate", () => {
  const src = readFileSync(fileURLToPath(new URL("../lib/dedup.ts", import.meta.url)), "utf8");
  const select = src.match(/const CANDIDATE_SELECT =\s*"([^"]+)"/)?.[1] ?? "";
  for (const col of ["venue_key", "source_name", "is_routine", "town", "date", "address", "series_umbrella"]) {
    assert.ok(select.split(", ").includes(col), `CANDIDATE_SELECT lacks ${col}`);
  }
  assert.equal(
    [...src.matchAll(/\.select\(CANDIDATE_SELECT\)/g)].length,
    2,
    "the serial and batched fuzzy-match queries both use CANDIDATE_SELECT"
  );
  // The town is the shared rule's question now, never a pre-filter.
  assert.doesNotMatch(src, /normalizeTown\(c\.town\) === canonicalTown/);
});

test("fill-only never writes name, keys, clock, venue or town, and honors every lock", async () => {
  const { buildFillOnlyUpdate } = await import("../lib/dedup.js");
  const existing = {
    name: "The Gathering on Murphys Main Street",
    town: "Murphys",
    start_time: "11:00:00",
    end_time: null,
    venue_name: "Murphys Main Street",
    description: null,
    price: null,
    event_url: null,
    address: null,
    image_url: null,
    artists: null,
    category: "other",
    description_locked: true,
    price_locked: true,
    poster_locked: true,
    family_friendly_locked: false,
  };
  const event = {
    name: "Murphys Gathering",
    town: "Arnold",
    date: DAY,
    start_time: "12:00",
    end_time: "17:00",
    venue_name: "Main St",
    description: "Wizards on Main Street.",
    price: "$5",
    image_url: "https://example.com/p.jpg",
    event_url: "https://example.com/e",
    address: "1 Main St",
    artists: ["The Wizards"],
    category: "festival",
    source_event_id: "vm-1",
    is_routine: true,
  };
  const out = buildFillOnlyUpdate(existing as never, event as never, "2026-09-28T00:00:00Z")!;
  for (const k of ["name", "dedup_key", "source_event_id", "start_time", "end_time", "venue_name", "venue_key", "town", "is_routine"]) {
    assert.ok(!(k in out), `fill-only wrote ${k}`);
  }
  for (const k of ["description", "price", "image_url"]) assert.ok(!(k in out), `${k} is locked`);
  assert.equal(out.event_url, "https://example.com/e");
  assert.equal(out.address, "1 Main St");
  assert.deepEqual(out.artists, ["The Wizards"]);
  assert.equal(out.category, "festival");
  // Nothing blank to fill: no write at all.
  const full = { ...existing, event_url: "x", address: "y", artists: ["The Wizards"], category: "festival" };
  assert.equal(buildFillOnlyUpdate(full as never, event as never, "now"), null);
});

test("pickStrongMatch: an unreconciled duplicate pair is one event, and a same-slot match wins", async () => {
  const { pickStrongMatch } = await import("../lib/dedup.js");
  const base = { date: DAY, town: "Murphys", venue_name: "Murphys Main Street", end_time: "17:00", description: null, artists: null };
  const inc = { ...base, name: "Murphys Gathering", start_time: "12:00", source_name: "Visit Murphys" };
  const slot = { ...base, name: "The Murphys Gathering", start_time: "12:00", source_name: "Facebook Events Discover (Angels Camp)" };
  const early = { ...base, name: "The Gathering on Murphys Main Street", start_time: "11:00", source_name: "GoCalaveras.com" };
  const r = pickStrongMatch(inc, [early, slot]);
  assert.deepEqual(r.ambiguous, []);
  assert.equal(r.match?.row, slot);
  assert.equal(r.match?.kind, "standard");
  assert.equal(pickStrongMatch(inc, [early]).match?.kind, "cross_source");
});

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
    // The kept clock is not the last word: the organizer's 12:00 is staged for
    // a human at /admin/verification (review #5), never applied by the merge.
    assert.equal(row.verification_status, "needs_verification");
    assert.equal(row.verification_suggested_start, "12:00");
    assert.match(String(row.verification_reason), /Visit Murphys says 12:00 PM/);
  });

  test(`[${path}] a clock conflict never overrides locked times or an earlier verdict`, async () => {
    const base = {
      name: "The Gathering on Murphys Main Street",
      town: "Murphys",
      venue_name: "Murphys Main Street",
      start_time: "11:00:00",
      end_time: "17:00:00",
      source_name: "GoCalaveras.com",
      description: "Already described.",
    };
    const organizer = incoming({
      name: "Murphys Gathering – A Celebration of All Things Magical",
      town: "Murphys",
      venue_name: "Murphys Main Street",
      start_time: "12:00",
      end_time: "17:00",
    });
    for (const over of [{ times_locked: true }, { verification_status: "dismissed" }, { verification_status: "verified" }]) {
      const { result } = await upsert(batched, [organizer], [resident({ ...base, ...over })], "Visit Murphys", "visit-murphys");
      assert.equal(result.inserted, 0);
      const row = db.find((r) => r.id === "res")!;
      assert.notEqual(row.verification_status, "needs_verification", JSON.stringify(over));
      assert.equal(row.verification_suggested_start, undefined, JSON.stringify(over));
      assert.equal(row.start_time, "11:00:00");
    }
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

  test(`[${path}] a series placeholder's default clock never raises a clock flag`, async () => {
    // Brice Hilltop shape across two town labels (a fill-only match through
    // the shared street number): the placeholder's 19:00 is the aggregator's
    // series default, not a competing claim about the named act's 18:00.
    const { result } = await upsert(
      batched,
      [
        incoming({
          name: "Live Music @ Hypothetical Hall",
          town: "Dorrington",
          venue_name: "Hypothetical Hall",
          address: "4545 Hypothetical Rd, Dorrington, CA 95223",
          start_time: "19:00",
          category: "live_music",
        }),
      ],
      [
        resident({
          name: "The Hollerin' Hounds",
          artists: ["The Hollerin' Hounds"],
          town: "Arnold",
          venue_name: "Hypothetical Hall",
          address: "4545 Hypothetical Rd",
          start_time: "18:00:00",
          source_name: "Hypothetical Hall",
          category: "live_music",
        }),
      ],
      "GoCalaveras.com",
      "gocalaveras"
    );
    assert.equal(result.inserted, 0, "the placeholder merges");
    const row = db.find((r) => r.id === "res")!;
    assert.equal(row.start_time, "18:00:00");
    assert.notEqual(row.verification_status, "needs_verification");
  });

  test(`[${path}] a cancelled tombstone is not a second event: the third feed merges into the live row`, async () => {
    // Live 2026-10-10: the organizer's "BVTS Trail Work Day" plus the Phase 0
    // tombstone of GoCalaveras's "Bear Valley Trail Stewardship". Counted as a
    // second event, the tombstone made every third feed's listing ambiguous,
    // so it inserted each morning and reconcile merged it back each afternoon.
    const slot = { date: DAY, town: "Bear Valley", start_time: "08:30:00", end_time: "12:30:00", category: "civic" };
    const { result, lines } = await upsert(
      batched,
      [
        incoming({
          name: "Bear Valley Trail Stewardship",
          town: "Bear Valley",
          venue_name: "Bear Valley Adventure Company",
          start_time: "08:30",
          end_time: "12:30",
          category: "civic",
          description: "Trail work day with Bear Valley Trail Stewardship.",
        }),
      ],
      [
        resident({
          ...slot,
          id: "bvac",
          name: "BVTS Trail Work Day",
          venue_name: "Bear Valley Adventure Company",
          venue_key: "bear-valley-adventure-company",
          source_name: "Bear Valley Adventure Co.",
          description: "Bear Valley Trail Stewardship hosts a trail maintenance day starting at 8:30 AM.",
          dedup_key: "bvac",
          source_event_id: "bvac",
        }),
        resident({
          ...slot,
          id: "tomb",
          name: "Bear Valley Trail Stewardship",
          venue_name: "Unknown Venue",
          source_name: "GoCalaveras.com",
          status: "cancelled",
          dedup_key: "tomb",
          source_event_id: "tomb",
        }),
      ],
      "Facebook Events Discover (Bear Valley)",
      "fb-discover-bear-valley"
    );
    assert.equal(result.inserted, 0);
    assert.equal(result.skippedFuzzy, 1);
    assert.ok(!lines.some((l) => l.includes("AMBIGUOUS_MATCH")));
    assert.ok(updates.some((u) => u.id === "bvac"), "the live row takes the merge");
    assert.ok(!updates.some((u) => u.id === "tomb"), "the tombstone is left alone");
  });

  test(`[${path}] with no live match, a tombstone still absorbs its old listing`, async () => {
    const { result } = await upsert(
      batched,
      [incoming({ name: "Bear Valley Trail Stewardship!", town: "Bear Valley", venue_name: "Unknown Venue", start_time: "08:30", end_time: "12:30", category: "civic" })],
      [
        resident({
          id: "tomb",
          name: "Bear Valley Trail Stewardship",
          town: "Bear Valley",
          venue_name: "Unknown Venue",
          start_time: "08:30:00",
          end_time: "12:30:00",
          source_name: "Visit Murphys",
          status: "cancelled",
          category: "civic",
        }),
      ],
      "GoCalaveras.com",
      "gocalaveras"
    );
    assert.equal(result.inserted, 0);
    assert.equal(db.find((r) => r.id === "tomb")!.status, "cancelled");
  });

  test(`[${path}] a members-only row never makes a public listing ambiguous`, async () => {
    // Reconcile never clusters across visibility, so a private act at the same
    // slot is not a second candidate for a public placeholder.
    const hall = { town: "Arnold", venue_name: "Hypothetical Hall", start_time: "19:00:00", source_name: "Visit Murphys", category: "live_music" };
    const { result, lines } = await upsert(
      batched,
      [incoming({ name: "Live Music @ Hypothetical Hall", town: "Arnold", venue_name: "Hypothetical Hall", start_time: "19:00", category: "live_music" })],
      [
        resident({ ...hall, id: "a", name: "The Hollerin' Hounds", artists: ["The Hollerin' Hounds"], dedup_key: "a", source_event_id: "a" }),
        resident({ ...hall, id: "b", name: "Sipsy River Band", artists: ["Sipsy River Band"], dedup_key: "b", source_event_id: "b", visibility: "private" }),
      ],
      "GoCalaveras.com",
      "gocalaveras"
    );
    assert.equal(result.inserted, 0);
    assert.ok(!lines.some((l) => l.includes("AMBIGUOUS_MATCH")));
    assert.ok(updates.some((u) => u.id === "a"));
    assert.equal(db.find((r) => r.id === "a")!.name, "The Hollerin' Hounds", "a placeholder never renames an act");
  });

  test(`[${path}] a row an earlier event in the batch merged into still counts toward ambiguity`, async () => {
    // The pub's own karaoke and trivia rows. GoCalaveras sends its karaoke
    // listing (merges into the pub's) and a same-slot placeholder, which
    // matches both acts: ambiguous on both paths, never merged into trivia
    // just because the batch had already claimed karaoke.
    const pub = { town: "Murphys", venue_name: "Murphys Irish Pub", venue_key: "murphys-irish-pub", start_time: "19:00:00", source_name: "Murphys Irish Pub", category: "live_music" };
    const { result, lines } = await upsert(
      batched,
      [
        incoming({ name: "Karaoke with Kim @ Murphys Irish Pub", town: "Murphys", venue_name: "Murphys Irish Pub", start_time: "19:00", end_time: "22:00", category: "live_music", source_event_id: "g-kim", event_url: "https://example.com/g-kim" }),
        incoming({ name: "Live Music @ Murphys Irish Pub", town: "Murphys", venue_name: "Murphys Irish Pub", start_time: "19:00", category: "live_music", source_event_id: "g-lm", event_url: "https://example.com/g-lm" }),
      ],
      [
        resident({ ...pub, id: "kim", name: "Karaoke W/ Kim", dedup_key: "kim", source_event_id: "pub-kim" }),
        resident({ ...pub, id: "trivia", name: "Trivia Night", end_time: "21:00:00", dedup_key: "trivia", source_event_id: "pub-trivia" }),
      ],
      "GoCalaveras.com",
      "gocalaveras"
    );
    assert.equal(result.inserted, 1, "the placeholder inserts as its own row");
    assert.equal(result.skippedFuzzy, 1, "karaoke merges");
    assert.ok(lines.some((l) => l.includes("AMBIGUOUS_MATCH") && l.includes("Live Music @ Murphys Irish Pub")));
    assert.equal(db.find((r) => r.id === "trivia")!.name, "Trivia Night");
    assert.ok(!updates.some((u) => u.id === "trivia"));
  });

  test(`[${path}] a second listing of a row the batch already merged into never inserts`, async () => {
    const pub = { town: "Murphys", venue_name: "Murphys Irish Pub", venue_key: "murphys-irish-pub", start_time: "19:00:00", end_time: "22:00:00", source_name: "Murphys Irish Pub", category: "live_music" };
    const { result, lines } = await upsert(
      batched,
      [
        incoming({ name: "The Hit Men Live", town: "Murphys", venue_name: "Murphys Irish Pub", start_time: "19:00", end_time: "22:00", category: "live_music", source_event_id: "g-1", event_url: "https://example.com/g-1" }),
        incoming({ name: "Live Music @ Murphys Irish Pub", town: "Murphys", venue_name: "Murphys Irish Pub", start_time: "19:00", end_time: "22:00", category: "live_music", source_event_id: "g-2", event_url: "https://example.com/g-2" }),
      ],
      [resident({ ...pub, id: "hit", name: "The Hit Men", artists: ["The Hit Men"], dedup_key: "hit", source_event_id: "pub-hit" })],
      "GoCalaveras.com",
      "gocalaveras"
    );
    assert.equal(result.inserted, 0);
    assert.equal(result.skippedFuzzy, 2);
    if (batched) assert.ok(lines.some((l) => l.includes("DUPLICATE_IN_BATCH")));
    assert.equal(updates.filter((u) => u.id === "hit").length, batched ? 1 : 2);
  });
}

for (const batched of [false, true]) {
  const path = batched ? "batched" : "serial";

  test(`[${path}] applying a staged clock never lets the next scrapes duplicate the event`, async () => {
    // The second review's lifecycle: the flag's own "Use 12:00 PM (locks it)"
    // click made both clocks agree, the organizer feed's next scrape matched
    // in the same slot and rewrote the row's keys, and one scrape later
    // GoCalaveras could not find its row and re-inserted it at 11:00, a
    // duplicate no layer merges (one feed, two starts). A locked row now only
    // ever takes fill-only merges.
    const street = { town: "Murphys", venue_name: "Murphys Main Street", category: "festival" };
    const goCalEvent = incoming({
      ...street,
      name: "The Gathering on Murphys Main Street",
      start_time: "11:00",
      end_time: "17:00",
      source_event_id: "192826",
      event_url: "https://www.gocalaveras.com/events/the-gathering-on-murphys-main-street/",
    });
    const vmEvent = incoming({
      ...street,
      name: "Murphys Gathering – A Celebration of All Things Magical",
      start_time: "12:00",
      end_time: "17:00",
      source_event_id: "49075",
      event_url: "https://visitmurphys.com/event/murphys-gathering/",
    });
    const seed = [
      resident({
        ...street,
        name: "The Gathering on Murphys Main Street",
        start_time: "11:00:00",
        end_time: "17:00:00",
        source_name: "GoCalaveras.com",
        source_event_id: "192826",
        dedup_key: "gocal-gathering",
      }),
    ];
    await upsert(batched, [vmEvent], seed, "Visit Murphys", "visit-murphys");
    const flagged = db.find((r) => r.id === "res")!;
    assert.equal(flagged.verification_suggested_start, "12:00");
    // The human applies the staged time (applyOrganizerTime's payload).
    let state: Row[] = db.map((r) =>
      r.id === "res"
        ? { ...r, start_time: "12:00", end_time: "17:00", times_locked: true, verification_status: "verified" }
        : { ...r }
    );
    for (let day = 2; day <= 4; day++) {
      await upsert(batched, [goCalEvent], state, "GoCalaveras.com", "gocalaveras");
      state = db.map((r) => ({ ...r }));
      await upsert(batched, [vmEvent], state, "Visit Murphys", "visit-murphys");
      state = db.map((r) => ({ ...r }));
      assert.equal(state.length, 1, `day ${day}: still one row`);
      assert.equal(state[0].source_event_id, "192826", `day ${day}: GoCalaveras keeps its key`);
      assert.equal(state[0].start_time, "12:00", `day ${day}: the applied time stands`);
    }
  });

  test(`[${path}] a venue's second session is judged against the row its first session just rewrote`, async () => {
    // GoCalaveras lists the class as one 15:00-17:00 row; the studio's own
    // feed lists two sessions. Session 1 rewrites the row to 15:00-16:00, so
    // Session 2 no longer overlaps it and inserts, on both paths (the batched
    // path used to judge Session 2 against the pre-write 15:00-17:00 row and
    // drop it as a duplicate: second review, finding 4).
    const studio = { town: "Arnold", venue_name: "Lackler Ceramics", category: "other" };
    const { result } = await upsert(
      batched,
      [
        incoming({ ...studio, name: "Kids Clay - Session 1", start_time: "15:00", end_time: "16:00", source_event_id: "v1", event_url: "https://example.com/v1" }),
        incoming({ ...studio, name: "Kids Clay - Session 2", start_time: "16:00", end_time: "17:00", source_event_id: "v2", event_url: "https://example.com/v2" }),
      ],
      [resident({ ...studio, name: "Kids Clay Class", start_time: "15:00:00", end_time: "17:00:00", source_name: "GoCalaveras.com" })],
      "Lackler Ceramics",
      "lackler-ceramics"
    );
    assert.equal(result.skippedFuzzy, 1, "session 1 merges");
    assert.equal(result.inserted, 1, "session 2 is its own row");
    assert.ok(db.some((r) => r.name === "Kids Clay - Session 2"));
  });

  test(`[${path}] a tombstone absorbing a clock-shifted listing is never sent to verification`, async () => {
    const { result } = await upsert(
      batched,
      [incoming({ name: "The Gathering on Murphys Main Street", town: "Murphys", venue_name: "Murphys Main Street", start_time: "11:00", end_time: "17:00" })],
      [
        resident({
          name: "Murphys Gathering – A Celebration of All Things Magical",
          town: "Murphys",
          venue_name: "Murphys Main Street",
          start_time: "12:00:00",
          end_time: "17:00:00",
          source_name: "Visit Murphys",
          status: "cancelled",
        }),
      ],
      "GoCalaveras.com",
      "gocalaveras"
    );
    assert.equal(result.inserted, 0, "the tombstone absorbs it");
    assert.equal(db.find((r) => r.id === "res")!.verification_status, undefined);
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
  for (const col of ["venue_key", "source_name", "is_routine", "town", "date", "address", "series_umbrella", "status", "visibility", "verification_status", "community_sourced", "times_locked"]) {
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

test("pickStrongMatch: a row naming both of two differently titled residents joins them", async () => {
  const { pickStrongMatch } = await import("../lib/dedup.js");
  // No end times: two rows sharing a known start AND end at one venue already
  // match on the exact window, which would make the joiner moot.
  const slot = { date: DAY, town: "Arnold", venue_name: "Hypothetical Hall", start_time: "12:00", end_time: null, description: null, artists: null };
  const okt = { ...slot, name: "Oktoberfest", source_name: "Visit Murphys" };
  const brew = { ...slot, name: "Brewfest", source_name: "Facebook Events Discover (Arnold)" };
  const both = { ...slot, name: "Oktoberfest & Brewfest", source_name: "GoCalaveras.com" };
  const r = pickStrongMatch(both, [okt, brew]);
  assert.deepEqual(r.ambiguous, [], "the incoming title covers both residents");
  assert.ok(r.match);
  // Matching both residents is not enough: a row that reaches Brewfest only
  // through a shared act, and names only Oktoberfest, joins nothing.
  const band = ["The Polka Kings"];
  const r2 = pickStrongMatch(
    { ...slot, name: "Oktoberfest", artists: band, source_name: "GoCalaveras.com" },
    [okt, { ...brew, artists: band }]
  );
  assert.equal(r2.match, null);
  assert.equal(r2.ambiguous.length, 2);
});

test("pickStrongMatch: live same-visibility rows first; the rest only as a fallback; taken rows are judged but never targeted", async () => {
  const { pickStrongMatch } = await import("../lib/dedup.js");
  const slot = { date: DAY, town: "Arnold", venue_name: "Hypothetical Hall", start_time: "19:00", end_time: null, description: null, source_name: "Visit Murphys" };
  const inc = { ...slot, name: "Live Music @ Hypothetical Hall", source_name: "GoCalaveras.com" };
  const a = { ...slot, name: "The Hollerin' Hounds", artists: ["The Hollerin' Hounds"], status: "confirmed", visibility: "public" };
  const b = { ...slot, name: "Sipsy River Band", artists: ["Sipsy River Band"], status: "confirmed", visibility: "public" };
  const cancelledB = { ...b, status: "cancelled" };
  const privateB = { ...b, visibility: "private" };
  assert.equal(pickStrongMatch(inc, [a, b]).match, null, "two live acts: ambiguous");
  assert.equal(pickStrongMatch(inc, [a, cancelledB]).match?.row, a);
  assert.equal(pickStrongMatch(inc, [a, privateB]).match?.row, a);
  assert.equal(pickStrongMatch(inc, [a, privateB], { visibility: "private" }).match?.row, privateB);
  assert.equal(pickStrongMatch(inc, [cancelledB]).match?.row, cancelledB, "fallback to the tombstone");
  // Taken: judged (still ambiguous) and never the target.
  const judged = pickStrongMatch(inc, [a, b], { isTaken: (c) => c === a });
  assert.equal(judged.match, null);
  assert.equal(judged.ambiguous.length, 2);
  const onlyTaken = pickStrongMatch(inc, [a], { isTaken: (c) => c === a });
  assert.equal(onlyTaken.match, null);
  assert.equal(onlyTaken.taken, a);
  assert.deepEqual(onlyTaken.ambiguous, []);
  // The taken row named is the live one, not a tombstone listed ahead of it.
  const tomb = { ...a, name: "The Hollerin Hounds", status: "cancelled" };
  assert.equal(pickStrongMatch(inc, [tomb, a], { isTaken: (c) => c === a }).taken, a);
});

test("a resident with locked times only ever takes a fill-only merge", async () => {
  const { isFillOnlyMatch } = await import("../lib/dedup.js");
  const here = { town: "Murphys" };
  assert.equal(isFillOnlyMatch("standard", here, { town: "Murphys" }), false);
  assert.equal(isFillOnlyMatch("standard", here, { town: "Murphys", times_locked: true }), true);
  assert.equal(isFillOnlyMatch("cross_source", here, { town: "Murphys" }), true);
  assert.equal(isFillOnlyMatch("standard", here, { town: "Arnold" }), true);
});

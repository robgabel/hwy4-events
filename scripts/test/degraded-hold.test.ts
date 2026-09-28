// Regression lock for the degraded-insert hold (dedup v2 Phase 0.4,
// PRD-dedup-merge-v2.md, scripts/lib/degraded-hold.ts).
//
// The shape it exists for: on 2026-09-27 GoCalaveras's detail pages were
// rate-limited, and its "Bear Valley Trail Stewardship" listing for 2026-10-10
// (EventON 192106) arrived from the month feed alone: venue "Unknown Venue", no
// description. Its keys had been lost to an earlier merge into the BVAC row, so
// it could not exact-match, and with no venue and no prose the fuzzy matcher
// had nothing to work with. It inserted as a fresh duplicate, the fifth copy of
// that one event in 30 days.
//
// Two layers of lock. The pure rule (what counts as degraded, when a hold is
// allowed) is tested directly. The placement (only a NEW insert is held, after
// the exact-key and strong-match lookups, in both write paths) is tested by
// driving the real `upsertEvents` against a fake Supabase, because a
// source-text check could not see a hold moved ahead of the strong-match lookup
// (the Phase 0 review's F4). Both layers pin what must be HELD as hard as what
// must still INSERT: the hold is only safe if it can defer an event and never
// drop one.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEGRADED_HOLD_MIN_DAYS_OUT,
  degradedHoldLine,
  isDegradedListing,
  shouldHoldDegradedInsert,
} from "../lib/degraded-hold.js";
import { isEnrichFailure, type EnrichOutcome } from "../lib/enrich-report.js";

const RUN = "2026-09-27";

// The live row, as it arrived.
const bvts = {
  name: "Bear Valley Trail Stewardship",
  date: "2026-10-10",
  venue_name: "Unknown Venue",
  description: null as string | null,
  address: null as string | null,
  enrichment_failed: true,
};

test("the 2026-09-27 BVTS re-insert is held", () => {
  assert.equal(isDegradedListing(bvts), true);
  assert.equal(shouldHoldDegradedInsert(bvts, RUN), true);
});

test("a detail page that loaded and was bare is not a failure: the row inserts", () => {
  // `empty` means the page answered 200 with nothing extractable. Waiting a day
  // buys nothing, and holding would only delay the listing.
  assert.equal(shouldHoldDegradedInsert({ ...bvts, enrichment_failed: false }, RUN), false);
  assert.equal(shouldHoldDegradedInsert({ ...bvts, enrichment_failed: undefined }, RUN), false);
});

test("a named venue OR a description is enough signal to let the row through", () => {
  assert.equal(
    shouldHoldDegradedInsert({ ...bvts, venue_name: "Bear Valley Adventure Company" }, RUN),
    false,
    "the AJAX feed sometimes carries the venue; the matcher can use it"
  );
  assert.equal(
    shouldHoldDegradedInsert(
      { ...bvts, description: "Help maintain the trails around Bear Valley." },
      RUN
    ),
    false,
    "a description gives the matcher its text signals"
  );
});

test("a street number the matcher can anchor on lets the row through", () => {
  // EventON sometimes puts a street address in the venue field, which the
  // pre-pass moves into `address` and leaves the venue generic. The matcher's
  // same-street-number anchor can place that row, so it is not degraded.
  assert.equal(
    shouldHoldDegradedInsert({ ...bvts, address: "2182 Highway 4, Arnold, CA 95223" }, RUN),
    false
  );
  // The anchor needs two or more digits, and a town-only address has none.
  assert.equal(shouldHoldDegradedInsert({ ...bvts, address: "1 Main St, Arnold, CA" }, RUN), true);
  assert.equal(shouldHoldDegradedInsert({ ...bvts, address: "Bear Valley, CA" }, RUN), true);
});

test("every generic venue shape counts as no venue", () => {
  // A bare town name is the scraper's fallback, not a place.
  assert.equal(shouldHoldDegradedInsert({ ...bvts, venue_name: "Bear Valley" }, RUN), true);
  // Blank and whitespace venues.
  assert.equal(shouldHoldDegradedInsert({ ...bvts, venue_name: "" }, RUN), true);
  assert.equal(shouldHoldDegradedInsert({ ...bvts, venue_name: "   " }, RUN), true);
  // Subtitle text that leaked into venue_name is not a venue either.
  assert.equal(
    shouldHoldDegradedInsert({ ...bvts, venue_name: "Featuring The Star Dogs" }, RUN),
    true
  );
  // Whitespace-only prose is no prose.
  assert.equal(shouldHoldDegradedInsert({ ...bvts, description: " \n " }, RUN), true);
});

test("the hold defers, never drops: an event happening today always inserts", () => {
  assert.equal(DEGRADED_HOLD_MIN_DAYS_OUT, 1);
  assert.equal(
    shouldHoldDegradedInsert({ ...bvts, date: RUN }, RUN),
    false,
    "no later scrape can help an event that is already happening"
  );
  assert.equal(shouldHoldDegradedInsert({ ...bvts, date: "2026-09-28" }, RUN), true);
  // A past-dated row is not ours to judge here (the future floor owns it).
  assert.equal(shouldHoldDegradedInsert({ ...bvts, date: "2026-09-20" }, RUN), false);
});

test("the day count is calendar-exact across a DST change and a month edge", () => {
  // 2026-11-01 is the PDT -> PST change; the count must not drift by an hour
  // into a different day.
  assert.equal(shouldHoldDegradedInsert({ ...bvts, date: "2026-11-01" }, "2026-10-31"), true);
  assert.equal(shouldHoldDegradedInsert({ ...bvts, date: "2026-11-01" }, "2026-11-01"), false);
  assert.equal(shouldHoldDegradedInsert({ ...bvts, date: "2026-10-01" }, "2026-09-30"), true);
});

test("an unparseable date never holds: when in doubt, the old behavior wins", () => {
  assert.equal(shouldHoldDegradedInsert({ ...bvts, date: "TBD" }, RUN), false);
  assert.equal(shouldHoldDegradedInsert(bvts, "not-a-date"), false);
});

test("only a failure a later run can fix counts as failed enrichment", () => {
  const failed: EnrichOutcome[] = ["rate_limited", "network_error", "skipped"];
  for (const o of failed) assert.equal(isEnrichFailure(o), true, o);
  for (const o of ["enriched", "empty"] as EnrichOutcome[]) {
    assert.equal(isEnrichFailure(o), false, o);
  }
  // A wall or a server error can lift; a missing page will still be missing.
  for (const status of [403, 500, 503, undefined]) {
    assert.equal(isEnrichFailure("http_error", status), true, String(status));
  }
  for (const status of [404, 410]) {
    assert.equal(isEnrichFailure("http_error", status), false, String(status));
  }
});

test("the held-row log line is greppable and names the row", () => {
  const line = degradedHoldLine(bvts);
  assert.match(line, /DEGRADED_INSERT_HELD/);
  assert.match(line, /"Bear Valley Trail Stewardship" 2026-10-10/);
});

// A structural backstop for insert paths that do not exist yet: every
// hwy4_events INSERT site in dedup.ts must go through the hold. Scoped to that
// table, so an insert into event_merge_log (or any other table) is not counted.
// The behavioral tests below own the placement of the two paths that do exist.
test("every hwy4_events insert site in dedup.ts consults the hold", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../lib/dedup.ts", import.meta.url)),
    "utf8"
  );
  const insertSites = [
    ...src.matchAll(/\.from\(\s*["']hwy4_events["']\s*\)\s*\.(?:insert|upsert)\(/g),
  ].length;
  const holdCalls = [...src.matchAll(/(?<!function )holdDegradedInsert\(/g)].length;
  assert.ok(insertSites >= 2, "expected the serial and batched insert paths");
  assert.equal(
    holdCalls,
    insertSites,
    `${insertSites} hwy4_events insert site(s) but ${holdCalls} hold check(s). Route every ` +
      "new row through holdDegradedInsert before it is written (dedup v2 0.4)."
  );
});

// ---------------------------------------------------------------------------
// Behavior through the real upsertEvents, both write paths, against a fake
// Supabase. dedup.ts imports scripts/lib/supabase-admin, which throws at import
// time without the service-role env, so set dummy env, then patch the shared
// client's `from` before any query runs. The fake models only the query shapes
// dedup.ts uses (select / eq / in / maybeSingle / update / insert).
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

type Row = Record<string, unknown>;
let db: Row[] = [];
let insertedNames: string[] = [];

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
        insertedNames.push(String(r.name));
      }
      return { data: rows.map((_, i) => ({ id: `ins-${i}` })), error: null };
    }
    const hits = db.filter((r) => filters.every((f) => f(r)));
    if (op === "update") {
      for (const h of hits) Object.assign(h, payload);
      return { data: null, error: null };
    }
    return { data: single ? hits[0] ?? null : hits, error: null };
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

async function upsertWithFakeDb(batched: boolean, events: Row[], seed: Row[] = []) {
  const { supabaseAdmin } = await import("../lib/supabase-admin.js");
  (supabaseAdmin as unknown as { from: typeof fakeQuery }).from = fakeQuery;
  const { upsertEvents } = await import("../lib/dedup.js");
  db = seed.map((r) => ({ ...r }));
  insertedNames = [];
  const priorBatch = process.env.BATCH_DEDUP;
  if (batched) process.env.BATCH_DEDUP = "1";
  else delete process.env.BATCH_DEDUP;
  const { log, warn } = console;
  console.log = console.warn = () => {};
  try {
    return await upsertEvents(
      events.map((e) => ({ ...e })) as never,
      "GoCalaveras.com",
      "gocalaveras",
      "https://www.gocalaveras.com/events/"
    );
  } finally {
    console.log = log;
    console.warn = warn;
    if (priorBatch === undefined) delete process.env.BATCH_DEDUP;
    else process.env.BATCH_DEDUP = priorBatch;
  }
}

// upsertEvents reads its run date from the clock, so dates are relative to it.
const todayUtc = new Date().toISOString().slice(0, 10);
const plusDays = (n: number): string => {
  const d = new Date(`${todayUtc}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const degraded = (over: Row = {}): Row => ({
  name: "Bear Valley Trail Stewardship",
  description: null,
  date: plusDays(13),
  start_time: "08:30",
  end_time: "12:30",
  venue_name: "Unknown Venue",
  town: "Bear Valley",
  address: null,
  category: "hike",
  price: null,
  artists: null,
  event_url: "https://www.gocalaveras.com/events/bear-valley-trail-stewardship-5/",
  image_url: null,
  source_event_id: "192106",
  enrichment_failed: true,
  ...over,
});

for (const batched of [false, true]) {
  const path = batched ? "batched" : "serial";

  test(`[${path}] a degraded new row is held, not inserted`, async () => {
    const r = await upsertWithFakeDb(batched, [degraded()]);
    assert.equal(r.held, 1);
    assert.equal(r.inserted, 0);
    assert.deepEqual(insertedNames, []);
  });

  test(`[${path}] the row inserts when it is happening today, its page loaded, or it has a street number`, async () => {
    for (const over of [
      { date: todayUtc },
      { enrichment_failed: false },
      { address: "7777 Hypothetical Ridge Rd, Bear Valley, CA 95223" },
    ]) {
      const r = await upsertWithFakeDb(batched, [degraded(over)]);
      assert.equal(r.inserted, 1, JSON.stringify(over));
      assert.equal(r.held ?? 0, 0, JSON.stringify(over));
    }
  });

  test(`[${path}] an exact-key hit on a tombstone updates it and holds nothing`, async () => {
    const tombstone: Row = {
      id: "tomb",
      name: "Bear Valley Trail Stewardship",
      date: plusDays(13),
      town: "Bear Valley",
      venue_name: "Unknown Venue",
      description: null,
      start_time: "08:30:00",
      end_time: "12:30:00",
      source_name: "GoCalaveras.com",
      source_event_id: "192106",
      dedup_key: "tombstone-key",
      status: "cancelled",
      category: "other",
    };
    const r = await upsertWithFakeDb(batched, [degraded()], [tombstone]);
    assert.equal(r.held ?? 0, 0);
    assert.equal(r.inserted, 0);
    assert.equal(r.updated + r.unchanged, 1);
    assert.equal(db.find((x) => x.id === "tomb")?.status, "cancelled");
  });

  test(`[${path}] a degraded row the matcher CAN place still merges: the hold sits after strong-match`, async () => {
    // Same slot, a title the matcher reads as the same event (0.88 similar).
    const resident: Row = {
      id: "bvac",
      name: "Bear Valley Trail Stewardship Day",
      date: plusDays(13),
      town: "Bear Valley",
      venue_name: "Bear Valley Adventure Company",
      description: null,
      start_time: "08:30:00",
      end_time: "12:30:00",
      source_name: "Bear Valley Adventure Co.",
      source_event_id: "bvac-1",
      dedup_key: "bvac-key",
      status: "confirmed",
      category: "other",
    };
    const r = await upsertWithFakeDb(batched, [degraded()], [resident]);
    assert.equal(r.skippedFuzzy, 1);
    assert.equal(r.held ?? 0, 0);
    assert.equal(r.inserted, 0);
  });

  test(`[${path}] an enriched twin in the same batch inserts while its degraded copy is held`, async () => {
    const r = await upsertWithFakeDb(batched, [
      degraded(),
      degraded({ enrichment_failed: false, description: "Help maintain the trails." }),
    ]);
    assert.equal(r.held, 1);
    assert.equal(r.inserted, 1);
    assert.deepEqual(insertedNames, ["Bear Valley Trail Stewardship"]);
  });
}

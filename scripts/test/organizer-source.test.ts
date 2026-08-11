// Locks scripts/lib/organizer-source.ts — the spine four organizer scrapers
// share (HWY-23). Two of the rules asserted here decide whether a deletion
// happens: the future-only floor under every write, and "a run that wrote
// nothing may not sweep". Removing either is production risk, so read
// stale-sweep.test.ts alongside this file.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addUpsertResult,
  beginOrganizerRun,
  emptyUpsertResult,
  planUpserts,
  sweepIsAllowed,
} from "../lib/organizer-source.js";
import type { ExtractedEvent } from "../lib/extract.js";

function ev(date: string, name: string): ExtractedEvent {
  return {
    name,
    description: null,
    date,
    start_time: null,
    end_time: null,
    venue_name: "Test Venue",
    town: "Murphys",
    address: null,
    category: "other",
    price: null,
    artists: null,
    event_url: null,
    source_event_id: `test|${date}|${name}`,
  };
}

const TODAY = "2026-08-11";

test("planUpserts keeps today and drops only what is past", () => {
  const { groups, droppedPast } = planUpserts(
    { events: [ev("2026-08-10", "yesterday"), ev(TODAY, "today"), ev("2026-08-12", "tomorrow")] },
    TODAY
  );
  assert.equal(droppedPast, 1);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].events.map((e) => e.name),
    ["today", "tomorrow"]
  );
});

test("planUpserts floors the members-only group too", () => {
  const { groups, droppedPast } = planUpserts(
    {
      events: [ev("2026-08-12", "public future")],
      privateEvents: [ev("2026-07-01", "members past"), ev("2026-08-20", "members future")],
    },
    TODAY
  );
  assert.equal(droppedPast, 1);
  assert.deepEqual(
    groups.map((g) => [g.visibility, g.events.map((e) => e.name)]),
    [
      ["public", ["public future"]],
      ["private", ["members future"]],
    ]
  );
});

test("planUpserts writes public before members-only and skips an empty group", () => {
  // upsertEvents takes one visibility per call, so the split is two calls and
  // their order is the observable behavior. Public first; an empty group is
  // never called at all (an empty upsert would log a source result of zero).
  const onlyPrivate = planUpserts(
    { events: [], privateEvents: [ev("2026-08-12", "members night")] },
    TODAY
  );
  assert.deepEqual(
    onlyPrivate.groups.map((g) => g.visibility),
    ["private"]
  );

  const both = planUpserts(
    { events: [ev("2026-08-12", "patio party")], privateEvents: [ev("2026-08-13", "club scramble")] },
    TODAY
  );
  assert.deepEqual(
    both.groups.map((g) => g.visibility),
    ["public", "private"]
  );
});

test("planUpserts preserves source order within a group", () => {
  const names = ["third", "first", "second"];
  const { groups } = planUpserts(
    { events: names.map((n, i) => ev(`2026-08-1${i + 2}`, n)) },
    TODAY
  );
  assert.deepEqual(
    groups[0].events.map((e) => e.name),
    names
  );
});

test("an all-past batch plans no write at all", () => {
  const { groups, droppedPast } = planUpserts(
    { events: [ev("2026-01-01", "new year")], privateEvents: [ev("2026-02-01", "old club night")] },
    TODAY
  );
  assert.equal(droppedPast, 2);
  assert.deepEqual(groups, []);
});

test("a run that wrote nothing may not sweep", () => {
  // The load-bearing one. An empty batch is indistinguishable from a broken
  // fetch, and a sweep with an empty presence set selects every resident row
  // in its window — the abort cap stops the mass case and lets the small one
  // through. So the gate is on the write, not on the plan.
  assert.equal(sweepIsAllowed([]), false);
  assert.equal(
    sweepIsAllowed(planUpserts({ events: [ev("2026-01-01", "past only")] }, TODAY).groups),
    false
  );
  assert.equal(
    sweepIsAllowed(planUpserts({ events: [ev("2026-08-12", "live show")] }, TODAY).groups),
    true
  );
  // A members-only-only run still wrote rows, so it may still retract.
  assert.equal(
    sweepIsAllowed(
      planUpserts({ events: [], privateEvents: [ev("2026-08-12", "members night")] }, TODAY).groups
    ),
    true
  );
});

test("addUpsertResult sums every counter across a split write", () => {
  // A partial fold would under-report a two-visibility source's inserts to
  // scrape_runs and to the operator's summary line.
  const total = emptyUpsertResult();
  addUpsertResult(total, { inserted: 1, updated: 2, unchanged: 3, skippedFuzzy: 4, unpinned: 5 });
  addUpsertResult(total, { inserted: 10, updated: 20, unchanged: 30, skippedFuzzy: 40, unpinned: 50 });
  assert.deepEqual(total, {
    inserted: 11,
    updated: 22,
    unchanged: 33,
    skippedFuzzy: 44,
    unpinned: 55,
  });
});

test("emptyUpsertResult hands back a fresh object each call", () => {
  const a = emptyUpsertResult();
  addUpsertResult(a, { inserted: 7, updated: 0, unchanged: 0, skippedFuzzy: 0, unpinned: 0 });
  assert.equal(emptyUpsertResult().inserted, 0);
});

test("beginOrganizerRun banners the run and carries one dated declaration", () => {
  // The banner is how a source is found in a 20-minute scrape log, and today
  // feeds both the future floor and any sweep window — so it is read once, in
  // the same YYYY-MM-DD shape the window builders compare against.
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => void lines.push(args.join(" "));
  let run;
  try {
    run = beginOrganizerRun({
      title: "Test Source (fixture)",
      sourceName: "Test Source",
      orgSlug: "test-source",
      pageUrl: "https://example.com/events",
    });
  } finally {
    console.log = original;
  }
  assert.deepEqual(lines, ["=== Test Source (fixture) ==="]);
  assert.match(run.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(run.sourceName, "Test Source");
  assert.equal(run.orgSlug, "test-source");
  assert.equal(run.pageUrl, "https://example.com/events");
});

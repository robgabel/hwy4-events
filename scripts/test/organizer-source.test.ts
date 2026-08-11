// Locks scripts/lib/organizer-source.ts — the shared spine the four
// organizer-owned scrapers run on (HWY-20b, 2026-08-11).
//
// The point of the skeleton is that a guardrail lives in ONE place instead of
// four, so these assertions are the guardrails themselves: the ownership-aware
// blocklist (including the `.filter` footgun that silently inverts it), the
// future-filter boundary, and the run order — every upsert lands before the
// stale sweep asks what the source no longer asserts.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtractedEvent } from "../lib/extract.js";
import type { UpsertResult } from "../lib/dedup.js";
import {
  addUpsertResult,
  emptyUpsertResult,
  prepareBatches,
  runOrganizerSource,
  type OrganizerRunDeps,
  type SweepPlan,
} from "../lib/organizer-source.js";

const TODAY = "2026-08-11";

function event(partial: Partial<ExtractedEvent> = {}): ExtractedEvent {
  return {
    name: "Some Show",
    description: null,
    date: TODAY,
    start_time: "19:00",
    end_time: null,
    venue_name: "A Room Somewhere",
    town: "Murphys",
    address: null,
    category: "live_music",
    price: null,
    artists: null,
    event_url: "https://example.com/e/1",
    image_url: null,
    source_event_id: "sid-1",
    ...partial,
  };
}

function upsertResult(partial: Partial<UpsertResult> = {}): UpsertResult {
  return { inserted: 0, updated: 0, unchanged: 0, skippedFuzzy: 0, unpinned: 0, ...partial };
}

/** Swallow the skeleton's logging so the test output stays readable. */
function quiet<T>(fn: () => T): T {
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

// ---------- the ownership-aware blocklist ----------

test("blocklist: a source writes its OWN blocklisted venues and no others", () => {
  const owned = event({ name: "Guided Sunset Hike to Cougar Rock" }); // owner: arnold-rim-trail
  const someoneElses = event({
    name: "Junior Rangers",
    venue_name: "Calaveras Big Trees State Park", // no owner: seeded, nobody may write it
  });
  const ordinary = event({ name: "Wolf Jett" });

  const prepared = quiet(() =>
    prepareBatches([{ events: [owned, someoneElses, ordinary] }], {
      today: TODAY,
      orgSlug: "arnold-rim-trail",
    })
  );

  assert.deepEqual(
    prepared.writable.map((e) => e.name),
    ["Guided Sunset Hike to Cougar Rock", "Wolf Jett"]
  );
  assert.deepEqual(
    prepared.blocked.map((e) => e.name),
    ["Junior Rangers"]
  );
});

test("blocklist: an aggregator slug is blocked from the SAME row the owner may write", () => {
  const owned = () => event({ name: "Guided Sunset Hike to Cougar Rock" });

  const asOwner = quiet(() =>
    prepareBatches([{ events: [owned()] }], { today: TODAY, orgSlug: "arnold-rim-trail" })
  );
  const asAggregator = quiet(() =>
    prepareBatches([{ events: [owned()] }], { today: TODAY, orgSlug: "gocalaveras" })
  );

  assert.equal(asOwner.writable.length, 1, "the organizer writes its own rows");
  assert.equal(asOwner.blocked.length, 0);
  assert.equal(asAggregator.writable.length, 0, "an aggregator stays blocked");
  assert.equal(asAggregator.blocked.length, 1);
});

test("blocklist FOOTGUN: the verdict must not depend on a row's position in the batch", () => {
  // `.filter(isManuallyManagedEvent)` (bare reference) hands the ARRAY INDEX to
  // the predicate as `askingOrgSlug`, so an owner's slug is never seen and the
  // owner is blocked from its own rows — silently, and only on some indices.
  // Sweeping the owned row through every position proves the skeleton passes
  // the slug explicitly. CLAUDE.md documents the footgun; this is the lock.
  const filler = () => event({ name: "Wolf Jett" });
  for (let position = 0; position < 4; position++) {
    const events = [filler(), filler(), filler()];
    events.splice(position, 0, event({ name: "Volunteer Trail Workday" }));

    const prepared = quiet(() =>
      prepareBatches([{ events }], { today: TODAY, orgSlug: "arnold-rim-trail" })
    );
    assert.equal(
      prepared.blocked.length,
      0,
      `owned row at index ${position} must be writable by its owner`
    );
    assert.equal(prepared.writable.length, 4);
  }
});

// ---------- the future filter ----------

test("future filter: today is kept, yesterday is dropped, tomorrow is kept", () => {
  const prepared = quiet(() =>
    prepareBatches(
      [
        {
          events: [
            event({ name: "Yesterday", date: "2026-08-10" }),
            event({ name: "Today", date: TODAY }),
            event({ name: "Tomorrow", date: "2026-08-12" }),
            event({ name: "Next year", date: "2027-01-02" }),
          ],
        },
      ],
      { today: TODAY, orgSlug: "brice-station" }
    )
  );

  assert.deepEqual(
    prepared.writable.map((e) => e.name),
    ["Today", "Tomorrow", "Next year"]
  );
  assert.equal(prepared.past, 1);
});

test("refine runs between venue detection and the future filter", () => {
  const seen: string[] = [];
  const prepared = quiet(() =>
    prepareBatches(
      [
        {
          events: [
            event({ name: "Past out-of-scope", date: "2026-08-01", town: "Sonora" }),
            event({ name: "Future out-of-scope", town: "Sonora" }),
            event({ name: "Keeper", town: "Murphys" }),
          ],
        },
      ],
      {
        today: TODAY,
        orgSlug: "arnold-rim-trail",
        refine: (events) => {
          // Sees past rows too — proof it ran BEFORE the future filter.
          seen.push(...events.map((e) => e.name));
          return events.filter((e) => e.town === "Murphys");
        },
      }
    )
  );

  assert.deepEqual(seen, ["Past out-of-scope", "Future out-of-scope", "Keeper"]);
  assert.deepEqual(
    prepared.writable.map((e) => e.name),
    ["Keeper"]
  );
  // The rows refine removed are out of scope, not "past" — don't miscount them.
  assert.equal(prepared.past, 0);
});

// ---------- summary accounting ----------

test("addUpsertResult sums every field across batches", () => {
  const totals = emptyUpsertResult();
  addUpsertResult(totals, upsertResult({ inserted: 2, updated: 1, unpinned: 3 }));
  addUpsertResult(totals, upsertResult({ inserted: 1, unchanged: 4, skippedFuzzy: 2 }));
  assert.deepEqual(totals, {
    inserted: 3,
    updated: 1,
    unchanged: 4,
    skippedFuzzy: 2,
    unpinned: 3,
  });
});

/** A recording stub pair, so ordering and arguments are both assertable. */
function stubDeps(overrides: Partial<OrganizerRunDeps> = {}) {
  const calls: string[] = [];
  const upserts: {
    count: number;
    visibility?: string;
    unpinnedPolicy?: string;
    sourceName: string;
    orgSlug: string;
    sourceUrl: string;
  }[] = [];
  const sweeps: (SweepPlan & { orgSlug: string })[] = [];

  const deps: OrganizerRunDeps = {
    async upsert(events, sourceName, orgSlug, sourceUrl, visibility, unpinnedPolicy) {
      calls.push(`upsert:${visibility ?? "public"}`);
      upserts.push({
        count: events.length,
        visibility,
        unpinnedPolicy,
        sourceName,
        orgSlug,
        sourceUrl,
      });
      return upsertResult({ inserted: events.length, unpinned: 1 });
    },
    async sweep(opts) {
      calls.push("sweep");
      sweeps.push(opts);
      return 2;
    },
    ...overrides,
  };
  return { deps, calls, upserts, sweeps };
}

test("one upsert per non-empty batch, carrying that batch's visibility + the source policy", async () => {
  const { deps, calls, upserts } = stubDeps();

  await quiet(() =>
    runOrganizerSource(
      {
        sourceName: "Sequoia Woods Country Club",
        orgSlug: "sequoia-woods",
        pageUrl: "https://www.sequoiawoods.com/calendar",
        unpinnedPolicy: "warn",
        async harvest() {
          return {
            batches: [
              { visibility: "public" as const, events: [event({ name: "Patio Party" })] },
              { visibility: "private" as const, events: [event({ name: "Club Scramble" })] },
              { visibility: "private" as const, events: [] }, // empty: never written
            ],
            context: undefined,
          };
        },
      },
      deps
    )
  );

  assert.deepEqual(calls, ["upsert:public", "upsert:private"]);
  assert.deepEqual(
    upserts.map((u) => [u.visibility, u.count, u.unpinnedPolicy]),
    [
      ["public", 1, "warn"],
      ["private", 1, "warn"],
    ]
  );
  assert.equal(upserts[0].sourceName, "Sequoia Woods Country Club");
  assert.equal(upserts[0].orgSlug, "sequoia-woods");
  assert.equal(upserts[0].sourceUrl, "https://www.sequoiawoods.com/calendar");
});

test("the sweep runs AFTER every upsert, and sees exactly the rows that were written", async () => {
  const { deps, calls, sweeps } = stubDeps();

  await quiet(() =>
    runOrganizerSource<{ tag: string }>(
      {
        sourceName: "Murphys Irish Pub",
        orgSlug: "murphys-irish-pub",
        pageUrl: "https://www.murphysirishpubca.com/",
        async harvest() {
          return {
            batches: [
              { visibility: "public" as const, events: [event({ name: "Tonight" })] },
              {
                visibility: "private" as const,
                events: [
                  event({ name: "Members" }),
                  event({ name: "Stale", date: "2026-01-01" }), // past: never written
                ],
              },
            ],
            context: { tag: "ctx" },
          };
        },
        planSweep({ today, context, written }) {
          assert.equal(today, new Date().toISOString().slice(0, 10));
          assert.equal(context.tag, "ctx", "planSweep receives the harvest's context");
          assert.deepEqual(
            written.map((e) => e.name),
            ["Tonight", "Members"],
            "written excludes the past row"
          );
          return {
            reason: "test sweep",
            windows: [{ from: today, to: "2026-12-31" }],
            presentKeys: new Set(written.map((e) => e.source_event_id!)),
            keysOf: (r) => [r.source_event_id],
          };
        },
      },
      deps
    )
  );

  assert.deepEqual(calls, ["upsert:public", "upsert:private", "sweep"]);
  assert.equal(sweeps.length, 1);
  assert.equal(sweeps[0].orgSlug, "murphys-irish-pub", "the skeleton stamps the org slug");
  assert.equal(sweeps[0].reason, "test sweep");
});

test("planSweep returning null skips the sweep; the upserts still happen", async () => {
  const { deps, calls } = stubDeps();

  await quiet(() =>
    runOrganizerSource(
      {
        sourceName: "Murphys Irish Pub",
        orgSlug: "murphys-irish-pub",
        pageUrl: "https://www.murphysirishpubca.com/",
        async harvest() {
          return { batches: [{ events: [event()] }], context: undefined };
        },
        planSweep: () => null,
      },
      deps
    )
  );

  assert.deepEqual(calls, ["upsert:public"]);
});

test("a harvest that returns null writes nothing and sweeps nothing", async () => {
  const { deps, calls } = stubDeps();
  let planned = false;

  await quiet(() =>
    runOrganizerSource(
      {
        sourceName: "Murphys Irish Pub",
        orgSlug: "murphys-irish-pub",
        pageUrl: "https://www.murphysirishpubca.com/",
        // A failed list fetch must never read as "the calendar is empty".
        async harvest() {
          return null;
        },
        planSweep() {
          planned = true;
          return null;
        },
      },
      deps
    )
  );

  assert.deepEqual(calls, []);
  assert.equal(planned, false);
});

test("an all-past batch upserts nothing but still lets the source decide about sweeping", async () => {
  const { deps, calls } = stubDeps();
  let written: string[] | null = null;

  await quiet(() =>
    runOrganizerSource(
      {
        sourceName: "Sequoia Woods Country Club",
        orgSlug: "sequoia-woods",
        pageUrl: "https://www.sequoiawoods.com/calendar",
        async harvest() {
          return {
            batches: [{ events: [event({ name: "Last month", date: "2026-07-01" })] }],
            context: undefined,
          };
        },
        planSweep(run) {
          written = run.written.map((e) => e.name);
          return null;
        },
      },
      deps
    )
  );

  assert.deepEqual(calls, [], "nothing written");
  assert.deepEqual(written, [], "planSweep still ran, with an empty batch to reason about");
});

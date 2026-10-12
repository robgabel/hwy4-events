// Regression lock for the Big Trees seed's is_weekly flags
// (scripts/lib/bigtrees-schedule.ts).
//
// Daily / most-nights programs stay is_weekly so they collapse behind the
// homepage weekly toggle. Low-cadence programs (~1–2x/week) show inline.
// Live rows already match; a re-seed that wrote the old true flags would
// flip them back. Leftover from closed PR #81.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateDedupKey } from "../../lib/event-identity.js";
import { SAT, SUN, expandWeekly } from "../lib/recurrence.js";
import { buildOccurrences, omitCancelledOccurrences } from "../lib/bigtrees-schedule.js";

/** Daily / most-nights — stay collapsed. */
const WEEKLY = [
  "North Grove Guided Walk @ Big Trees State Park",
  "Junior Rangers @ Big Trees State Park",
  "South Grove Guided Hike @ Big Trees State Park",
  "Campfire: Songs and Silliness @ Big Trees State Park",
  "Campfire: Hug-A-Tree @ Big Trees State Park",
  "Campfire: Laugh then Learn @ Big Trees State Park",
] as const;

/** ~1–2x/week — show inline. */
const INLINE = [
  "Creek Critters @ Big Trees State Park",
  "Meadow Walk @ Big Trees State Park",
  "Bird Walk @ Big Trees State Park",
  "Introduction to North Grove @ Big Trees State Park",
] as const;

test("low-cadence Big Trees programs are is_weekly=false (show inline)", () => {
  const rows = buildOccurrences();
  assert.ok(rows.length > 0);

  const byName = new Map<string, boolean[]>();
  for (const e of rows) {
    const flags = byName.get(e.name) ?? [];
    flags.push(e.is_weekly);
    byName.set(e.name, flags);
  }

  for (const name of WEEKLY) {
    const flags = byName.get(name);
    assert.ok(flags && flags.length > 0, `missing weekly program: ${name}`);
    assert.ok(
      flags.every((f) => f === true),
      `${name} must stay is_weekly=true (daily / most-nights)`
    );
  }

  for (const name of INLINE) {
    const flags = byName.get(name);
    assert.ok(flags && flags.length > 0, `missing inline program: ${name}`);
    assert.ok(
      flags.every((f) => f === false),
      `${name} must be is_weekly=false so a re-seed cannot hide it again`
    );
  }

  // Astronomy nights and dated specials were already inline; a new unnamed
  // recurring program must be classified above rather than defaulting to weekly.
  for (const [name, flags] of byName) {
    if ((WEEKLY as readonly string[]).includes(name)) continue;
    assert.ok(
      flags.every((f) => f === false),
      `${name} is not on the weekly list and must stay is_weekly=false`
    );
  }
});

const SOUTH_GROVE = "South Grove Guided Hike @ Big Trees State Park";

test("South Grove is Saturdays and Sundays through September, with no October Sundays", () => {
  const dates = buildOccurrences()
    .filter((e) => e.name === SOUTH_GROVE)
    .map((e) => e.date);
  // Late-summer page: "Saturdays and Sundays through September."
  // May 23 is the Memorial Day weekend the rest of the season uses.
  assert.deepEqual(dates, expandWeekly([SAT, SUN], "2026-05-23", "2026-09-30"));
  assert.ok(dates.includes("2026-09-26"));
  assert.ok(dates.includes("2026-09-27"));
  assert.equal(dates.some((d) => d.startsWith("2026-10")), false);
  assert.equal(dates.includes("2026-10-18"), false);
  assert.equal(dates.includes("2026-10-25"), false);
  for (const date of dates) {
    const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    assert.ok(day === SAT || day === SUN, `${date} is not a weekend`);
  }
});

test("a cancelled South Grove date is left out of a re-seed, including October", () => {
  const rows = buildOccurrences();
  const october = {
    name: SOUTH_GROVE,
    date: "2026-10-18",
    town: "Arnold",
  };
  const octoberKey = generateDedupKey(october.name, october.date, october.town);
  const withGhost = [...rows, october];
  const kept = omitCancelledOccurrences(withGhost, new Set([octoberKey]));
  assert.equal(
    kept.some((e) => e.date === "2026-10-18"),
    false
  );
  // The rules no longer emit October, so the live batch is clean even
  // before the cancelled-key filter.
  assert.equal(
    rows.some((e) => e.name === SOUTH_GROVE && e.date.startsWith("2026-10")),
    false
  );

  const live = rows.find((e) => e.name === SOUTH_GROVE && e.date === "2026-09-27");
  assert.ok(live);
  const liveKey = generateDedupKey(live.name, live.date, live.town);
  const withoutLive = omitCancelledOccurrences(rows, new Set([liveKey]));
  assert.equal(withoutLive.length, rows.length - 1);
  assert.equal(
    withoutLive.some((e) => e.name === SOUTH_GROVE && e.date === "2026-09-27"),
    false
  );
  assert.equal(omitCancelledOccurrences(rows, new Set()).length, rows.length);
});

test("the seed omits cancelled dates before it upserts", () => {
  const seed = readFileSync(new URL("../seed-bigtrees-programs-2026.ts", import.meta.url), "utf8");
  const omitAt = seed.indexOf("omitCancelledOccurrences(");
  const upsertAt = seed.indexOf("upsertEvents(");
  assert.ok(omitAt > 0, "seed must call omitCancelledOccurrences");
  assert.ok(upsertAt > omitAt, "cancelled dates must be dropped before upsertEvents");
});

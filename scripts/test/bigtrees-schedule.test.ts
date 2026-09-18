// Regression lock for the Big Trees seed's is_weekly flags
// (scripts/lib/bigtrees-schedule.ts).
//
// Daily / most-nights programs stay is_weekly so they collapse behind the
// homepage weekly toggle. Low-cadence programs (~1–2x/week) show inline.
// Live rows already match; a re-seed that wrote the old true flags would
// flip them back. Leftover from closed PR #81.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOccurrences } from "../lib/bigtrees-schedule.js";

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

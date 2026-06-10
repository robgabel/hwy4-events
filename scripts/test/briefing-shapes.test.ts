// Locks the briefing shape rotation (WS-6): 7 consecutive days must show at
// least 3 distinct shapes with no two consecutive days the same.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BRIEFING_SHAPES,
  selectBriefingShape,
  dayOfYear,
  recentOpeners,
  openerKey,
} from "../../lib/briefing-shapes.js";

test("selectBriefingShape: 7 consecutive days -> >=3 distinct, none repeat day-to-day", () => {
  const base = 100;
  const week = Array.from({ length: 7 }, (_, i) => selectBriefingShape(base + i).id);
  assert.ok(new Set(week).size >= 3, `only ${new Set(week).size} distinct shapes: ${week}`);
  for (let i = 1; i < week.length; i++) {
    assert.notEqual(week[i], week[i - 1], `shape repeated on consecutive days: ${week}`);
  }
});

test("selectBriefingShape: deterministic and handles wrap/negatives", () => {
  assert.equal(selectBriefingShape(0).id, BRIEFING_SHAPES[0].id);
  assert.equal(selectBriefingShape(4).id, BRIEFING_SHAPES[0].id);
  assert.equal(selectBriefingShape(5).id, selectBriefingShape(1).id);
});

test("dayOfYear: Jan 1 is 1, Dec 31 is 365 (non-leap)", () => {
  assert.equal(dayOfYear(new Date(2026, 0, 1)), 1);
  assert.equal(dayOfYear(new Date(2026, 11, 31)), 365);
});

test("recentOpeners: takes the first words of each briefing's first line", () => {
  const openers = recentOpeners(
    ["Tuesday has a tidy little arc, starting with...", "Two things need a reservation this week; the rest..."],
    6,
  );
  assert.deepEqual(openers, [
    "Tuesday has a tidy little arc,",
    "Two things need a reservation this",
  ]);
});

test("openerKey: first 3 words, normalized, for repeat detection", () => {
  assert.equal(openerKey("Tuesday has a tidy little arc"), "tuesday has a");
  assert.equal(openerKey("Tuesday, has  a different rest"), "tuesday has a");
});

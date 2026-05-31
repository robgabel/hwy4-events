// Regression lock for the recurrence expander (lib/recurrence.ts).
//
// The canonical Big Trees schedule (scripts/lib/bigtrees-schedule.ts) is a set of
// prose rules turned into dated rows by these functions. If the date math drifts,
// every seeded program date drifts with it — so the arithmetic is pinned here.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  expandWeekly,
  mergeDates,
  excludeDates,
  TUE,
  SAT,
  THU,
  DAILY_EXCEPT_TUE,
} from "../lib/recurrence.js";

test("Creek Critters: Tue+Sat, June 13 - August 15, 2026 = 19 dates", () => {
  const dates = expandWeekly([TUE, SAT], "2026-06-13", "2026-08-15");
  assert.equal(dates.length, 19);
  assert.equal(dates[0], "2026-06-13"); // inclusive start (a Saturday)
  assert.equal(dates[dates.length - 1], "2026-08-15"); // inclusive end (a Saturday)
  // Every date really is a Tuesday or Saturday, and the list is sorted.
  for (const d of dates) {
    const dow = new Date(`${d}T00:00:00.000Z`).getUTCDay();
    assert.ok(dow === TUE || dow === SAT, `${d} is weekday ${dow}`);
  }
  assert.deepEqual([...dates].sort(), dates);
});

test("inclusive endpoints: a matching start and end day are both included", () => {
  // 2026-05-28 is a Thursday; 2026-06-04 is a Thursday.
  const dates = expandWeekly([THU], "2026-05-28", "2026-06-04");
  assert.deepEqual(dates, ["2026-05-28", "2026-06-04"]);
});

test("empty range (end before start) yields []", () => {
  assert.deepEqual(expandWeekly([TUE, SAT], "2026-08-15", "2026-06-13"), []);
});

test("empty day set yields []", () => {
  assert.deepEqual(expandWeekly([], "2026-06-13", "2026-08-15"), []);
});

test("DAILY_EXCEPT_TUE never includes a Tuesday", () => {
  const dates = expandWeekly(DAILY_EXCEPT_TUE, "2026-06-15", "2026-08-16");
  assert.ok(dates.length > 0);
  for (const d of dates) {
    assert.notEqual(new Date(`${d}T00:00:00.000Z`).getUTCDay(), TUE, `${d} is a Tuesday`);
  }
  // 6 of 7 weekdays, so ~6/7 of the span.
  assert.equal(dates.includes("2026-06-16"), false); // Tuesday, excluded
  assert.equal(dates.includes("2026-06-15"), true); // Monday, included
});

test("mergeDates unions, dedupes, and sorts compound sub-rules", () => {
  const a = ["2026-06-20", "2026-06-13"];
  const b = ["2026-06-13", "2026-06-27"];
  assert.deepEqual(mergeDates(a, b), ["2026-06-13", "2026-06-20", "2026-06-27"]);
});

test("excludeDates drops the listed dates (Night Skies Saturdays)", () => {
  const sats = ["2026-08-01", "2026-08-08", "2026-08-15"];
  assert.deepEqual(excludeDates(sats, ["2026-08-01", "2026-08-08"]), ["2026-08-15"]);
});

test("rejects malformed dates", () => {
  assert.throws(() => expandWeekly([TUE], "June 13", "2026-08-15"));
  assert.throws(() => expandWeekly([TUE], "2026-13-01", "2026-08-15")); // invalid month
});

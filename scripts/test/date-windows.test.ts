// Regression lock for Pacific-anchored homepage date-group labels
// (lib/date-windows.ts pacificDateGroupKind).
//
// The old browser-local isToday/isTomorrow were computed with the UTC clock
// during SSR, so a Pacific-evening event was labeled "Tomorrow" and hydration
// mismatched when the client re-ran them in local time (2026-07-02 review, P5).
// pacificDateGroupKind is pure + string-based, so server and client agree.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import { pacificDateGroupKind } from "../../lib/date-windows";

// Mirror pacificToday()'s formatter for a FIXED instant, so we can prove the
// anchor deterministically (pacificToday() itself reads the real clock).
function pacificParts(instant: string): { iso: string; dow: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(instant));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { iso: `${get("year")}-${get("month")}-${get("day")}`, dow: DOW[get("weekday")] };
}

test("Peter's case: 2026-07-03T02:00Z is Jul 2 7pm PT — today is 2026-07-02", () => {
  const { iso, dow } = pacificParts("2026-07-03T02:00:00Z");
  assert.equal(iso, "2026-07-02", "Pacific civil date, not the UTC Jul 3");
  // An event dated Jul 2 must read "today", not "tomorrow" (the old UTC bug).
  assert.equal(pacificDateGroupKind("2026-07-02", iso, dow), "today");
  assert.equal(pacificDateGroupKind("2026-07-03", iso, dow), "tomorrow");
});

test("today / tomorrow / this-week / future classification", () => {
  // 2026-07-02 is a Thursday (dow=4). Sat of this week = 2026-07-04.
  const todayIso = "2026-07-02";
  const dow = 4;
  assert.equal(pacificDateGroupKind("2026-07-02", todayIso, dow), "today");
  assert.equal(pacificDateGroupKind("2026-07-03", todayIso, dow), "tomorrow");
  assert.equal(pacificDateGroupKind("2026-07-04", todayIso, dow), "this-week"); // Saturday, inclusive
  assert.equal(pacificDateGroupKind("2026-07-05", todayIso, dow), "future"); // next Sunday
  assert.equal(pacificDateGroupKind("2026-08-01", todayIso, dow), "future");
});

test("on Saturday, only today remains in the Sun–Sat week (no this-week bucket)", () => {
  // 2026-07-04 is a Saturday (dow=6). saturdayIso === todayIso, so nothing is
  // strictly after tomorrow and <= Saturday.
  const todayIso = "2026-07-04";
  const dow = 6;
  assert.equal(pacificDateGroupKind("2026-07-04", todayIso, dow), "today");
  assert.equal(pacificDateGroupKind("2026-07-05", todayIso, dow), "tomorrow");
  assert.equal(pacificDateGroupKind("2026-07-06", todayIso, dow), "future");
});

// Locks the "Happening Now" vs "Up Next" boundary: a currently-live event must
// NOT also be eligible for "Up Next" (the two badges are mutually exclusive).
// Pure functions — the clock is passed in as absolute Pacific minutes, no DB,
// no real wall clock. Run: cd scripts && npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasEventStarted, hasEventEnded } from "../../lib/event-time.js";

const DAY = "2026-06-04";

// Reproduce the absolute-minutes scheme from event-time.ts so we can build a
// deterministic "now" without touching the real clock.
function at(dateStr: string, time24: string): number {
  const [h, m] = time24.split(":").map(Number);
  const [y, mo, d] = dateStr.split("-").map(Number);
  return y * 525960 + (mo - 1) * 43830 + d * 1440 + h * 60 + m;
}

// Mirrors the EventList "Up Next" predicate exactly.
function isUpNextEligible(
  date: string,
  start: string | null,
  end: string | null,
  now: number
): boolean {
  return !hasEventEnded(date, start, end, now) && !hasEventStarted(date, start, now);
}

test("hasEventStarted: true once the clock start has passed", () => {
  assert.equal(hasEventStarted(DAY, "09:30", at(DAY, "10:00")), true);
  assert.equal(hasEventStarted(DAY, "09:30", at(DAY, "09:30")), true); // exactly at start
});

test("hasEventStarted: false before the start", () => {
  assert.equal(hasEventStarted(DAY, "14:00", at(DAY, "10:00")), false);
});

test("hasEventStarted: timeless/all-day event never counts as started", () => {
  assert.equal(hasEventStarted(DAY, null, at(DAY, "23:00")), false);
});

test("hasEventStarted: unparseable start is treated as not-started", () => {
  assert.equal(hasEventStarted(DAY, "whenever", at(DAY, "10:00")), false);
});

test("live event is NOT Up Next eligible (the bug: no double badge)", () => {
  // Bird Walk 9:30–11:30, now 10:00 → Happening Now, must not also be Up Next.
  assert.equal(isUpNextEligible(DAY, "09:30", "11:30", at(DAY, "10:00")), false);
});

test("upcoming event IS Up Next eligible", () => {
  assert.equal(isUpNextEligible(DAY, "17:00", "20:00", at(DAY, "10:00")), true);
});

test("finished event is NOT Up Next eligible", () => {
  assert.equal(isUpNextEligible(DAY, "08:00", "09:00", at(DAY, "10:00")), false);
});

test("timeless event today stays Up Next eligible until day's end", () => {
  // No clock start → never shows Happening Now, so no badge conflict; it should
  // still be able to hold Up Next during the day.
  assert.equal(isUpNextEligible(DAY, null, null, at(DAY, "10:00")), true);
  // ...but not after the day is over.
  assert.equal(isUpNextEligible(DAY, null, null, at("2026-06-05", "00:01")), false);
});

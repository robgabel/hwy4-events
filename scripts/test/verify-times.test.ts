// Regression lock for the time-drift comparator (lib/verify-times.ts).
//
// The governing rule is never-guess: a page that does not state a time must
// flag NOTHING. A false flag costs a human a trip through /admin/verification
// and teaches them to ignore the queue, which is worse than missing one.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareEventTime,
  describeTimeMismatch,
  formatTimeForHuman,
  parseStatedTime,
} from "../../lib/verify-times.js";

test("parses the formats our DB and organizer pages actually emit", () => {
  // Our own column values.
  assert.equal(parseStatedTime("18:15:00"), "18:15");
  assert.equal(parseStatedTime("18:15"), "18:15");
  // Organizer prose / model output.
  assert.equal(parseStatedTime("6:15 PM"), "18:15");
  assert.equal(parseStatedTime("6:15pm"), "18:15");
  assert.equal(parseStatedTime("6 pm"), "18:00");
  assert.equal(parseStatedTime("6PM"), "18:00");
  assert.equal(parseStatedTime("10:30 a.m."), "10:30");
  assert.equal(parseStatedTime("Noon"), "12:00");
  // A range yields its START — the field we compare.
  assert.equal(parseStatedTime("11:00 am - 5:00 pm"), "11:00");
  assert.equal(parseStatedTime("6-8pm"), "18:00");
});

test("midnight and noon convert correctly (the classic 12 AM/PM trap)", () => {
  assert.equal(parseStatedTime("12:00 AM"), "00:00");
  assert.equal(parseStatedTime("12:30 AM"), "00:30");
  assert.equal(parseStatedTime("12:00 PM"), "12:00");
  assert.equal(parseStatedTime("12:30 PM"), "12:30");
});

test("refuses to guess an ambiguous or absent time", () => {
  // A bare hour with no meridiem could be 6 AM or 6 PM. Never guess.
  assert.equal(parseStatedTime("6"), null);
  assert.equal(parseStatedTime("7"), null);
  for (const v of [null, undefined, "", "  ", "(unknown)", "TBD-ish", "n/a", "none"]) {
    assert.equal(parseStatedTime(v), null, `should not parse: ${String(v)}`);
  }
  // Nonsense clock values.
  assert.equal(parseStatedTime("25:00"), null);
  assert.equal(parseStatedTime("10:75"), null);
  assert.equal(parseStatedTime("13:00 PM"), null);
});

test("silence never produces a flag", () => {
  // The whole never-guess policy in three assertions.
  assert.equal(compareEventTime("18:15", null), "unknown");
  assert.equal(compareEventTime(null, "6:15 PM"), "unknown");
  assert.equal(compareEventTime(null, null), "unknown");
  assert.equal(compareEventTime("18:15", "sometime in the evening"), "unknown");
});

test("agreeing times match across formats", () => {
  assert.equal(compareEventTime("18:15:00", "6:15 PM"), "match");
  assert.equal(compareEventTime("11:00", "11:00 am - 5:00 pm"), "match");
  // The real Boyle MacDonald case: our 18:00 vs the venue's "every Friday 6-8pm".
  assert.equal(compareEventTime("18:00:00", "6-8pm"), "match");
});

test("the Arnold Rim Trail case flags", () => {
  // Our stale aggregator row said 5:45 PM; ART's page said 6:15 PM.
  assert.equal(compareEventTime("17:45:00", "6:15 PM"), "mismatch");
  const reason = describeTimeMismatch("17:45:00", "6:15 PM");
  // The operator must see BOTH times without opening anything else.
  assert.match(reason, /5:45 PM/);
  assert.match(reason, /6:15 PM/);
});

test("formatTimeForHuman renders 12-hour clock and degrades honestly", () => {
  assert.equal(formatTimeForHuman("18:15"), "6:15 PM");
  assert.equal(formatTimeForHuman("09:00"), "9:00 AM");
  assert.equal(formatTimeForHuman("00:30"), "12:30 AM");
  assert.equal(formatTimeForHuman("12:00"), "12:00 PM");
  assert.equal(formatTimeForHuman(null), "unknown");
});

test("a range only inherits its end meridiem when the reading is unambiguous", () => {
  // "6-8pm" is plainly 6 PM.
  assert.equal(parseStatedTime("6-8pm"), "18:00");
  assert.equal(parseStatedTime("6:30-8pm"), "18:30");
  assert.equal(parseStatedTime("6 to 8 pm"), "18:00");
  // "11-1pm" means 11 AM, not 11 PM. Rather than encode a guess, refuse it —
  // an unknown never flags, whereas a wrong inheritance would flag every such
  // event forever.
  assert.equal(parseStatedTime("11-1pm"), null);
  assert.equal(parseStatedTime("11:30-1pm"), null);
  // When the start states its own meridiem there is nothing to infer.
  assert.equal(parseStatedTime("11:00 am - 1:00 pm"), "11:00");
});

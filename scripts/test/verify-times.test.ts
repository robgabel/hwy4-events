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
  clockConflictPatch,
  compareEventTime,
  describeTimeMismatch,
  formatTimeForHuman,
  isClockConflictReason,
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

// Clock conflicts between two merged listings (dedup v2 review #5). The merge
// keeps one clock; the other is staged here for a human, never applied.
const NOW = "2026-09-28T16:00:00.000Z";
const gathering = {
  start_time: "11:00:00",
  end_time: "17:00:00",
  source_name: "GoCalaveras.com",
  times_locked: false,
  verification_status: "unchecked",
  community_sourced: false,
};
const organizer = {
  start_time: "12:00",
  end_time: "17:00",
  source_name: "Visit Murphys",
  event_url: "https://visitmurphys.com/event/murphys-gathering/",
};

test("a clock conflict stages the other listing's time for a human", () => {
  const patch = clockConflictPatch(gathering, organizer, NOW)!;
  assert.equal(patch.verification_status, "needs_verification");
  assert.equal(patch.verification_suggested_start, "12:00");
  assert.equal(patch.verification_suggested_end, "17:00");
  assert.equal(patch.verification_checked_at, NOW);
  const reason = String(patch.verification_reason);
  assert.ok(isClockConflictReason(reason));
  assert.match(reason, /Visit Murphys says 12:00 PM; we show 11:00 AM from GoCalaveras\.com\./);
  assert.match(reason, /visitmurphys\.com/);
  // Staging only: the patch never writes the clock itself.
  assert.ok(!("start_time" in patch) && !("end_time" in patch) && !("times_locked" in patch));
});

test("a clock conflict flags nothing on silence, agreement, a lock, a verdict or a community row", () => {
  assert.equal(clockConflictPatch({ ...gathering, start_time: null }, organizer, NOW), null);
  assert.equal(clockConflictPatch(gathering, { ...organizer, start_time: null }, NOW), null);
  assert.equal(clockConflictPatch(gathering, { ...organizer, start_time: "11:00 AM" }, NOW), null);
  assert.equal(clockConflictPatch({ ...gathering, times_locked: true }, organizer, NOW), null);
  for (const status of ["verified", "dismissed", "needs_verification"]) {
    assert.equal(clockConflictPatch({ ...gathering, verification_status: status }, organizer, NOW), null, status);
  }
  // A community row's public "call ahead" note would vanish under a flag.
  assert.equal(clockConflictPatch({ ...gathering, community_sourced: true }, organizer, NOW), null);
  // An unset status is the column default, unchecked.
  assert.ok(clockConflictPatch({ ...gathering, verification_status: null }, organizer, NOW));
});

test("a clock conflict keeps a known end when the other listing states none", () => {
  const noEnd = { ...organizer, end_time: null };
  assert.equal(clockConflictPatch(gathering, noEnd, NOW)!.verification_suggested_end, "17:00");
  // Our end no longer follows their start: stage no end rather than a backwards window.
  const early = { ...gathering, start_time: "09:00:00", end_time: "10:00:00" };
  assert.equal(clockConflictPatch(early, noEnd, NOW)!.verification_suggested_end, null);
});

test("only a clock-conflict reason reads as one", () => {
  assert.equal(isClockConflictReason(describeTimeMismatch("17:45", "18:15")), false);
  assert.equal(isClockConflictReason(null), false);
  assert.equal(isClockConflictReason("Dismissed by admin."), false);
});

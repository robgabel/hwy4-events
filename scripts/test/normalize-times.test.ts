// Regression lock for the impossible-time guards in normalizeEventTimes
// (scripts/lib/dedup.ts), added after the 2026-07-16 persona QA passes:
//  - "1:00 AM – 1:00 AM" (Jazz Cellars): a zero-length window with a
//    small-hours start is garbage — drop both.
//  - "7:00 PM – 2:00 PM" (Bear Valley Music Festival): an end before start
//    that isn't a plausible overnight — drop the end, keep the start.
// Per the never-guess policy the guards DROP bad times, never invent them.
//
// dedup.ts imports scripts/lib/supabase-admin, which THROWS at import time if
// the service-role env is unset — dummy env + dynamic import, same pattern as
// title-copy-strip.test.ts.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

async function load() {
  return import("../lib/dedup.js");
}

const ev = (start: string | null, end: string | null) => ({
  name: "Test Event",
  date: "2026-08-08",
  venue_name: "Test Venue",
  town: "Murphys",
  description: null,
  start_time: start,
  end_time: end,
  address: null,
  category: "live_music",
});

test("zero-length small-hours window drops both times (the 1 AM Jazz Cellars shape)", async () => {
  const { normalizeEventTimes } = await load();
  const e = ev("01:00", "01:00");
  normalizeEventTimes(e as never);
  assert.equal(e.start_time, null);
  assert.equal(e.end_time, null);
});

test("zero-length window at a normal hour keeps the start, drops the end", async () => {
  const { normalizeEventTimes } = await load();
  const e = ev("19:00", "19:00");
  normalizeEventTimes(e as never);
  assert.equal(e.start_time, "19:00");
  assert.equal(e.end_time, null);
});

test("end-before-start past 3 AM drops the end (the BVMF 7 PM – 2 PM shape)", async () => {
  const { normalizeEventTimes } = await load();
  const e = ev("19:00", "14:00");
  normalizeEventTimes(e as never);
  assert.equal(e.start_time, "19:00");
  assert.equal(e.end_time, null);
});

test("a genuine overnight event (ends by ~3 AM) is untouched", async () => {
  const { normalizeEventTimes } = await load();
  const karaoke = ev("21:00", "00:00");
  normalizeEventTimes(karaoke as never);
  assert.equal(karaoke.end_time, "00:00");
  const lateSet = ev("22:00", "01:30");
  normalizeEventTimes(lateSet as never);
  assert.equal(lateSet.end_time, "01:30");
});

test("the dropped-PM recovery still runs first and wins", async () => {
  const { normalizeEventTimes } = await load();
  // 11 AM – 5 AM is the dropped-meridiem signature → corrected to 5 PM,
  // NOT nulled by the end-before-start guard.
  const e = ev("11:00", "05:00");
  normalizeEventTimes(e as never);
  assert.equal(e.end_time, "17:00");
});

test("normal windows pass through untouched", async () => {
  const { normalizeEventTimes } = await load();
  const e = ev("17:00", "19:00");
  normalizeEventTimes(e as never);
  assert.equal(e.start_time, "17:00");
  assert.equal(e.end_time, "19:00");
});

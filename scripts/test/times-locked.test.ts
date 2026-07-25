// Regression lock for `times_locked` (migration 20260725_add_times_locked.sql).
//
// Why it exists: the Arnold Rim Trail sunset hikes showed a start 30 minutes
// wrong on the day of the hike. The organizer moves the time as sunset shifts,
// our row came from an aggregator that snapshots a listing once, and EVERY
// scraper write path set start_time unconditionally — so a hand-corrected time
// would be reverted on the next nightly run. `times_locked` is the escape hatch,
// mirroring price_locked / description_locked / poster_locked / notability_locked.
//
// These assertions pin the two behaviors that make the lock worth anything:
//   1. a locked row's time diff is NOT a "change" (so it isn't even considered)
//   2. no update payload carries start_time/end_time for a locked row
// and that an UNlocked row still self-heals exactly as before.
//
// dedup.ts imports scripts/lib/supabase-admin, which THROWS at import time if the
// service-role env is unset. Set dummy env (createClient makes no network call at
// construction) then dynamic-import so the lock can run in CI without secrets.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

async function load() {
  return import("../lib/dedup.js");
}

// The real shape: our stored row carries the organizer-confirmed 6:15 PM start,
// the aggregator re-scrapes with its stale 5:45 PM snapshot.
const storedRow = {
  id: "e1",
  name: "Guided Sunset Hike to Cougar Rock",
  date: "2026-07-25",
  venue_name: "ART Trailhead – Valley View Dr.",
  description: "Watch the sunset from the top of Cougar Rock.",
  start_time: "18:15",
  end_time: "21:30",
  price: null,
  event_url: "https://arnoldrimtrail.org/event/x/",
  address: "Valley View Dr, Arnold, CA 95223",
  town: "Arnold",
  image_url: null,
  category: "hike_walk",
};

const staleScrape = {
  ...storedRow,
  start_time: "17:45",
  end_time: "20:15",
  artists: null,
  source_event_id: null,
};

test("a locked row's differing times do not count as a change", async () => {
  const { rowChanged } = await load();
  assert.equal(
    rowChanged({ ...storedRow, times_locked: true }, staleScrape as never),
    false,
    "a stale aggregator time must not mark a locked row as changed"
  );
});

test("an unlocked row still self-heals from a re-scrape", async () => {
  const { rowChanged } = await load();
  assert.equal(
    rowChanged({ ...storedRow, times_locked: false }, staleScrape as never),
    true,
    "without the lock, a differing time is still a real change"
  );
  // Absent/NULL column (pre-migration rows) must behave as unlocked, not locked —
  // otherwise the whole catalog would silently freeze its times.
  assert.equal(rowChanged({ ...storedRow }, staleScrape as never), true);
});

test("a locked row keeps a genuine non-time change detectable", async () => {
  const { rowChanged } = await load();
  // The lock covers times ONLY. A renamed or moved event must still update.
  assert.equal(
    rowChanged(
      { ...storedRow, times_locked: true },
      { ...staleScrape, name: "Sunset Hike to Cougar Rock (rescheduled)" } as never
    ),
    true
  );
  assert.equal(
    rowChanged({ ...storedRow, times_locked: true }, { ...staleScrape, date: "2026-07-26" } as never),
    true
  );
});

test("the merge payload omits times for a locked row and includes them otherwise", async () => {
  const { buildStrongMatchUpdate } = await load();
  const now = "2026-07-25T12:00:00.000Z";

  const locked = buildStrongMatchUpdate(
    { ...storedRow, artists: null, times_locked: true } as never,
    staleScrape as never,
    "key",
    now
  ) as Record<string, unknown>;
  assert.equal("start_time" in locked, false, "locked merge must not write start_time");
  assert.equal("end_time" in locked, false, "locked merge must not write end_time");
  // The rest of the merge still happens — the lock is surgical.
  assert.equal(locked.name, staleScrape.name);

  const unlocked = buildStrongMatchUpdate(
    { ...storedRow, artists: null, times_locked: false } as never,
    staleScrape as never,
    "key",
    now
  ) as Record<string, unknown>;
  assert.equal(unlocked.start_time, "17:45");
  assert.equal(unlocked.end_time, "20:15");
});

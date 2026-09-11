// Regression lock for `family_friendly_locked`
// (migration 20260911_add_family_friendly.sql, HWY-34).
//
// The Kids chip reads the stored `family_friendly` boolean. Scrapers recompute
// it from isFamilyFriendly whenever name/description refresh — unless a human
// pinned the flag. These assertions pin:
//   1. a locked row's flag flip is NOT a "change"
//   2. no update payload carries family_friendly for a locked row
//   3. an unlocked row still self-heals (promote + age-gate exclude)
//
// dedup.ts imports scripts/lib/supabase-admin, which throws at import time if
// the service-role env is unset. Set dummy env then dynamic-import.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

async function load() {
  return import("../lib/dedup.js");
}

const storedRow = {
  id: "e1",
  name: "Cameo Plaza Summer Concert: Flashback",
  date: "2026-07-25",
  venue_name: "Cameo Plaza",
  description: "Free outdoor concert. Dogs and kids welcome.",
  start_time: "18:00",
  end_time: "20:00",
  price: null,
  event_url: null,
  address: "Main St, Angels Camp, CA",
  town: "Angels Camp",
  image_url: null,
  category: "live_music",
  family_friendly: true,
  artists: null,
};

const sameScrape = {
  ...storedRow,
  source_event_id: null,
};

test("a locked row's differing family_friendly does not count as a change", async () => {
  const { rowChanged } = await load();
  assert.equal(
    rowChanged(
      { ...storedRow, family_friendly: false, family_friendly_locked: true },
      sameScrape as never
    ),
    false,
    "a human-pinned false must not be marked changed by a kids-welcome re-scrape"
  );
});

test("an unlocked row self-heals a stale false from kids-welcome copy", async () => {
  const { rowChanged } = await load();
  assert.equal(
    rowChanged(
      { ...storedRow, family_friendly: false, family_friendly_locked: false },
      sameScrape as never
    ),
    true,
    "without the lock, a kids-welcome description must flip the stored false"
  );
  assert.equal(
    rowChanged({ ...storedRow, family_friendly: false }, sameScrape as never),
    true,
    "absent/NULL lock column behaves as unlocked"
  );
});

test("an unlocked age-gated re-scrape flips a stored true to false", async () => {
  const { rowChanged } = await load();
  const gated = {
    ...sameScrape,
    description: "Kids welcome. This is a 21 and over event.",
  };
  assert.equal(
    rowChanged(
      { ...storedRow, family_friendly: true, family_friendly_locked: false },
      gated as never
    ),
    true
  );
});

test("a locked row keeps a genuine non-flag change detectable", async () => {
  const { rowChanged } = await load();
  assert.equal(
    rowChanged(
      { ...storedRow, family_friendly_locked: true },
      { ...sameScrape, name: "Cameo Plaza Summer Concert: Flashback (rescheduled)" } as never
    ),
    true
  );
});

test("the merge payload omits family_friendly for a locked row and writes it otherwise", async () => {
  const { buildStrongMatchUpdate } = await load();
  const now = "2026-07-25T12:00:00.000Z";

  const locked = buildStrongMatchUpdate(
    { ...storedRow, family_friendly_locked: true } as never,
    sameScrape as never,
    "key",
    now
  ) as Record<string, unknown>;
  assert.equal(
    "family_friendly" in locked,
    false,
    "locked merge must not write family_friendly"
  );
  assert.equal(locked.name, storedRow.name);

  const unlocked = buildStrongMatchUpdate(
    { ...storedRow, family_friendly: false, family_friendly_locked: false } as never,
    sameScrape as never,
    "key",
    now
  ) as Record<string, unknown>;
  assert.equal(unlocked.family_friendly, true);
});

test("the exact-match payload omits family_friendly when locked", async () => {
  const { buildExactMatchUpdate } = await load();
  const now = "2026-07-25T12:00:00.000Z";

  const locked = buildExactMatchUpdate(
    { ...storedRow, family_friendly_locked: true } as never,
    sameScrape as never,
    "key",
    now
  ) as Record<string, unknown>;
  assert.equal("family_friendly" in locked, false);

  const unlocked = buildExactMatchUpdate(
    { ...storedRow, family_friendly: false, family_friendly_locked: false } as never,
    sameScrape as never,
    "key",
    now
  ) as Record<string, unknown>;
  assert.equal(unlocked.family_friendly, true);

  const gated = buildExactMatchUpdate(
    { ...storedRow, family_friendly: true, family_friendly_locked: false } as never,
    {
      ...sameScrape,
      description: "Kids welcome. This is a 21 and over event.",
    } as never,
    "key",
    now
  ) as Record<string, unknown>;
  assert.equal(
    gated.family_friendly,
    false,
    "unlocked exact-match must write false on an age-gated re-scrape"
  );
});

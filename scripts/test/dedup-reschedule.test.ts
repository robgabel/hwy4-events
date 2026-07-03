// Regression lock for rescheduled-date propagation (scripts/lib/dedup.ts).
//
// The scraper matches an existing row by stable source_event_id (date-independent
// for GoCalaveras/visit-murphys per-occurrence ids). Before the 2026-07-02 fix
// (P4), the change-detection compared name/venue/times but NOT date, so a venue
// rescheduling an event (same id, new date) was seen as "unchanged" and the new
// date was silently dropped. This pins that a moved date counts as a change.
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

// tsx transforms this file to CJS (no top-level await), so import inside the
// tests. createClient makes no network call at construction, so dummy env is safe.
async function load() {
  return import("../lib/dedup.js");
}

// Minimal existing row + incoming event; only the date differs between them.
const base = {
  id: "e1",
  name: "Harvest Concert",
  date: "2026-08-01",
  venue_name: "Ironstone Vineyards",
  description: "Live music",
  start_time: "19:00:00",
  end_time: "22:00:00",
  price: null,
  event_url: "https://ironstonevineyards.com/e",
  address: "1894 Six Mile Rd",
  town: "Murphys",
  image_url: null,
  category: "live_music",
};

test("a rescheduled date is detected as a change", async () => {
  const { rowChanged } = await load();
  const moved = { ...base, date: "2026-08-08" };
  assert.equal(rowChanged(base, moved as never), true);
});

test("an identical row (same date) is not a change", async () => {
  const { rowChanged } = await load();
  assert.equal(rowChanged(base, { ...base } as never), false);
});

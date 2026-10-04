// Locks the exact-match artists fill in scripts/lib/dedup.ts (artist coverage,
// 2026-10-04). The exact-match payload never wrote `artists` before this, so a
// row inserted with an empty list stayed empty forever even once its title
// named the act. Fill-only: an empty stored list takes a scraped one; a stored
// list is never replaced; a fixture without the column (undefined) is unknown.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

async function load() {
  return import("../lib/dedup.js");
}

const base = {
  id: "e1",
  name: "Live Music - Carlos Castillo",
  date: "2026-10-10",
  venue_name: "Sequoia Woods Country Club",
  venue_key: "sequoia-woods",
  description: "Live music on the patio",
  start_time: "18:00:00",
  end_time: "21:00:00",
  price: null,
  event_url: "https://sequoiawoods.example/e",
  address: "1000 Cypress Point Dr",
  town: "Arnold",
  image_url: null,
  category: "live_music",
};
const NOW = "2026-10-04T00:00:00Z";

test("an empty stored artists list is filled and counts as a change", async () => {
  const { rowChanged, buildExactMatchUpdate } = await load();
  const existing = { ...base, artists: null };
  const event = { ...base, artists: ["Carlos Castillo"] };
  assert.equal(rowChanged(existing, event as never), true);
  const payload = buildExactMatchUpdate(existing, event as never, "k", NOW);
  assert.deepEqual(payload.artists, ["Carlos Castillo"]);
});

test("a stored artists list is never replaced", async () => {
  const { rowChanged, buildExactMatchUpdate } = await load();
  const existing = { ...base, artists: ["Carlos Castillo", "Guest"] };
  const event = { ...base, artists: ["Carlos Castillo"] };
  assert.equal(rowChanged(existing, event as never), false);
  assert.equal("artists" in buildExactMatchUpdate(existing, event as never, "k", NOW), false);
});

test("an unselected artists column is unknown: no fill, no change", async () => {
  const { rowChanged, buildExactMatchUpdate } = await load();
  const event = { ...base, artists: ["Carlos Castillo"] };
  assert.equal(rowChanged(base as never, event as never), false);
  assert.equal("artists" in buildExactMatchUpdate(base as never, event as never, "k", NOW), false);
});

test("an actless placeholder title never donates its scraped list (EventON leftovers)", async () => {
  const { rowChanged, buildExactMatchUpdate } = await load();
  const existing = { ...base, name: "Greg Sutton and Friends", artists: null };
  const event = {
    ...base,
    name: "Brice Station Vineyards – Hilltop Concert Series",
    artists: ["Earth Tones Trio & Band"],
  };
  assert.equal(rowChanged(existing, event as never), false);
  assert.equal("artists" in buildExactMatchUpdate(existing, event as never, "k", NOW), false);
});

test("a 'Live Music Upstairs'-style placeholder never donates its list (review finding 6)", async () => {
  const { buildExactMatchUpdate } = await load();
  const existing = { ...base, name: "Live Music Upstairs", venue_name: "Boyle MacDonald Wines", artists: null };
  const event = { ...existing, artists: ["Leftover Act"] };
  assert.equal("artists" in buildExactMatchUpdate(existing, event as never, "k", NOW), false);
});

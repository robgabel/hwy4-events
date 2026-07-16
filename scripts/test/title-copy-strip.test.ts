// Regression lock for the "(Copy)" title artifact strip (scripts/lib/dedup.ts,
// normalizeEventLocation). Squarespace/EventON page duplication leaks titles
// like "Murphys Wine Bar & Beer Garden Concert Series (Copy)" into aggregator
// feeds (found in a 2026-07-16 persona QA pass). The strip runs BEFORE
// dedup_key generation in both upsert paths, so the key is computed from the
// clean title and the cleaned row keeps matching on re-scrape.
//
// dedup.ts imports scripts/lib/supabase-admin, which THROWS at import time if
// the service-role env is unset — dummy env + dynamic import, same pattern as
// dedup-reschedule.test.ts.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

async function load() {
  return import("../lib/dedup.js");
}

const ev = (name: string) => ({
  name,
  date: "2026-08-08",
  venue_name: "Murphys Wine & Beer Garden",
  town: "Murphys",
  description: null,
  start_time: "13:00",
  end_time: "16:00",
  address: null,
  category: "live_music",
});

test("a trailing (Copy) is stripped from the event name", async () => {
  const { normalizeEventLocation } = await load();
  const e = ev("Murphys Wine Bar & Beer Garden Concert Series (Copy)");
  normalizeEventLocation(e as never);
  assert.equal(e.name, "Murphys Wine Bar & Beer Garden Concert Series");
});

test("numbered (Copy 2) variants are stripped too", async () => {
  const { normalizeEventLocation } = await load();
  const e = ev("Beer Garden Concert (Copy 2)");
  normalizeEventLocation(e as never);
  assert.equal(e.name, "Beer Garden Concert");
});

test("legitimate parentheticals are left alone", async () => {
  const { normalizeEventLocation } = await load();
  const e = ev("Live Music at the Beer Garden (Act TBA)");
  normalizeEventLocation(e as never);
  assert.equal(e.name, "Live Music at the Beer Garden (Act TBA)");
});

test("a name that IS just (Copy) survives unchanged rather than emptying", async () => {
  const { normalizeEventLocation } = await load();
  const e = ev("(Copy)");
  normalizeEventLocation(e as never);
  assert.equal(e.name, "(Copy)");
});

// Regression lock for the festival-guide registry (lib/event-guides.ts) — the
// inbound-link source that keeps a seasonal SEO landing page from being an
// orphan. Pin the event matcher and the hideAfter staleness gate so a past
// year's page stops being linked once its festival is over.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  festivalGuideForEvent,
  festivalGuidesForTown,
} from "../../lib/event-guides.js";

const BEFORE = "2026-07-05"; // during the festival window
const AFTER = "2026-09-01"; // past hideAfter (2026-08-02)

test("festivalGuideForEvent matches by venue_key and by name, while live", () => {
  assert.equal(festivalGuideForEvent({ venue_key: "big-white-tent", name: "x" }, BEFORE)?.path, "/bear-valley-music-festival-2026");
  assert.equal(festivalGuideForEvent({ venue_key: null, name: "Bear Valley Music Festival" }, BEFORE)?.path, "/bear-valley-music-festival-2026");
});

test("festivalGuideForEvent returns null for unrelated events", () => {
  assert.equal(festivalGuideForEvent({ venue_key: "ironstone", name: "Concert" }, BEFORE), null);
});

test("festivalGuideForEvent stops matching after hideAfter (no stale link next year)", () => {
  assert.equal(festivalGuideForEvent({ venue_key: "big-white-tent", name: "x" }, AFTER), null);
});

test("festivalGuidesForTown returns the guide for its town only, while live", () => {
  assert.equal(festivalGuidesForTown("bear-valley", BEFORE).length, 1);
  assert.equal(festivalGuidesForTown("murphys", BEFORE).length, 0);
  assert.equal(festivalGuidesForTown("bear-valley", AFTER).length, 0);
});

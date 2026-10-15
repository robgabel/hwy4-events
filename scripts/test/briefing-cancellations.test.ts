// Regression lock for lib/briefing-cancellations.ts (issue #405): the weekend
// briefing's CANCELLED EVENTS list must not carry dedup merge tombstones,
// which share status='cancelled' with real organizer cancellations.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  realCancellations,
  looksLikeSurvivor,
  type CancelledRow,
  type LiveRow,
} from "../../lib/briefing-cancellations.js";

// The live rows behind the 2026-10-14 persona-QA finding.
const gatheringTombstone: CancelledRow = {
  id: "2fd80754-25bf-4922-84c2-173600cbd000",
  name: "The Gathering on Murphys Main Street",
  date: "2026-10-17",
  venue_name: "Murphys Main Street",
  town: "Murphys",
};
const gatheringSurvivor: LiveRow = {
  name: "Murphys Gathering – A Celebration of All Things Magical",
  date: "2026-10-17",
  town: "Murphys",
};
const faireTombstone: CancelledRow = {
  id: "22d34f21-39b2-43f8-b5e2-5f6002d2568b",
  name: "Angels Camp, CALIFORNIA - All Hallows Faire (Oct 24-25)",
  date: "2026-10-24",
  venue_name: "Calaveras County Fairgrounds",
  town: "Angels Camp",
};
const faireSurvivor: LiveRow = {
  name: "18th Annual – All Hallow’s Faire",
  date: "2026-10-24",
  town: "Angels Camp",
};
const hikeCancelled: CancelledRow = {
  id: "7368edb1-2fdb-4b2b-883b-a86166cd9115",
  name: "South Grove Guided Hike @ Big Trees State Park",
  date: "2026-10-18",
  venue_name: "Calaveras Big Trees State Park",
  town: "Arnold",
};
const breakfast: LiveRow = { name: "Breakfast", date: "2026-10-18", town: "Arnold" };

test("a merge-logged tombstone is excluded, whatever its title", () => {
  const out = realCancellations([gatheringTombstone], [gatheringTombstone.id], []);
  assert.deepEqual(out, []);
});

test("a real cancellation with no log row and no twin is kept", () => {
  const out = realCancellations([hikeCancelled], [], [breakfast]);
  assert.deepEqual(out, [hikeCancelled]);
});

test("a tombstone without a log row is excluded when a confirmed twin is live", () => {
  // Same title the aggregator copied, no event_merge_log row (hand cancel).
  const handTombstone: CancelledRow = {
    id: "hand-1",
    name: "Red, White & Rosé Tasting Experience",
    date: "2026-09-05",
    venue_name: "Calaveras Winegrape Alliance Information Center",
    town: "Murphys",
  };
  const twin: LiveRow = {
    name: "Red, White and Rose Tasting Experience",
    date: "2026-09-05",
    town: "Murphys",
  };
  assert.deepEqual(realCancellations([handTombstone], [], [twin]), []);
  // The All Hallows Faire pair: zero string similarity after the ordinal
  // strip, two distinctive tokens in common ("hallows", "faire").
  assert.equal(looksLikeSurvivor(faireTombstone, faireSurvivor), true);
});

test("the mixed live set: tombstones out, the Big Trees hike in", () => {
  const out = realCancellations(
    [gatheringTombstone, hikeCancelled, faireTombstone],
    [gatheringTombstone.id, faireTombstone.id],
    [gatheringSurvivor, breakfast, faireSurvivor]
  );
  assert.deepEqual(out.map((c) => c.id), [hikeCancelled.id]);
});

test("the similar-name test needs the same date and town", () => {
  assert.equal(
    looksLikeSurvivor(hikeCancelled, { ...hikeCancelled, date: "2026-10-25" } as LiveRow),
    false
  );
  assert.equal(
    looksLikeSurvivor(hikeCancelled, { ...hikeCancelled, town: "Murphys" } as LiveRow),
    false
  );
  assert.equal(
    looksLikeSurvivor(hikeCancelled, { ...hikeCancelled } as LiveRow),
    true
  );
});

test("one shared token with the town stripped is not a twin", () => {
  // "Murphys" is the town, so only "gathering" is shared: not enough on its
  // own. The real Gathering tombstone is caught by its merge-log row.
  const other: LiveRow = {
    name: "Sip & Shop with Caravan Creations and Shuttercore Photography",
    date: "2026-10-17",
    town: "Murphys",
  };
  assert.equal(looksLikeSurvivor(gatheringTombstone, other), false);
  assert.equal(looksLikeSurvivor(gatheringTombstone, gatheringSurvivor), false);
});

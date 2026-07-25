// Regression lock for the recurring-series ingest horizon
// (scripts/lib/ingest-horizon.ts).
//
// Measured 2026-07-25: Visit Murphys' Tribe feed materializes each recurrence as
// a real post, so we had ingested 104 rows of "Live Music Upstairs" at Boyle
// MacDonald — every one asserting a 6:00 PM start — running to 2028-07-21, plus
// 82 upcoming rows past 12 months across 4 series. Nobody has confirmed a bar's
// trivia start time in July 2028, and PRD-search-indexing.md blames exactly this
// population for the site-wide "Discovered – currently not indexed".
//
// The cap must be narrow enough that it can only ever remove the low-information
// tail of a series. These cases pin that.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import { capSeriesHorizon, addDays } from "../lib/ingest-horizon.js";

const TODAY = "2026-07-25";

/** Build a weekly series of `n` instances starting `startOffset` days out. */
function weekly(name: string, venue: string, n: number, startOffset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    name,
    venue_name: venue,
    date: addDays(TODAY, startOffset + i * 7),
  }));
}

test("drops the far-future tail of a long recurring series", () => {
  // Two years of weekly rows — the real Boyle MacDonald shape.
  const events = weekly("Live Music Upstairs", "Boyle MacDonald Wines", 104, 6);
  const { kept, dropped } = capSeriesHorizon(events, { today: TODAY });

  assert.ok(dropped.length > 0, "should drop something");
  assert.ok(kept.length > 40, "should keep roughly the first year");
  // Nothing kept is past the horizon; nothing dropped is inside it.
  const cutoff = addDays(TODAY, 365);
  for (const e of kept) assert.ok(e.date <= cutoff, `kept past cutoff: ${e.date}`);
  for (const e of dropped) assert.ok(e.date > cutoff, `dropped inside cutoff: ${e.date}`);
  assert.equal(kept.length + dropped.length, events.length, "no event vanishes");
});

test("never drops a far-future ONE-OFF", () => {
  // The guard that matters: next year's festival, announced early, is not a
  // series and must survive however far out it is.
  const events = [
    { name: "Bear Valley Music Festival 2028", venue_name: "Big White Tent", date: "2028-07-14" },
    { name: "Murphys Irish Days 2028", venue_name: "Downtown Murphys", date: "2028-03-11" },
  ];
  const { kept, dropped } = capSeriesHorizon(events, { today: TODAY });
  assert.equal(dropped.length, 0);
  assert.equal(kept.length, 2);
});

test("a short run below the series threshold is never capped", () => {
  // A 5-night festival two years out: under MIN_SERIES_SIZE, so keep it all.
  const events = weekly("Some Small Series", "A Venue", 5, 800);
  const { kept, dropped } = capSeriesHorizon(events, { today: TODAY });
  assert.equal(dropped.length, 0);
  assert.equal(kept.length, 5);
});

test("a long series entirely inside the horizon is untouched", () => {
  // Weekly trivia for the next 6 months — every row is real, useful, and kept.
  const events = weekly("Thirsty Thursday Trivia", "The Watering Hole", 26, 3);
  const { kept, dropped } = capSeriesHorizon(events, { today: TODAY });
  assert.equal(dropped.length, 0);
  assert.equal(kept.length, 26);
});

test("series identity is name + venue, so same-named events at different venues don't pool", () => {
  // 4 "Live Music" at each of two venues = 8 rows, but neither group reaches the
  // threshold on its own, so nothing is dropped.
  const events = [
    ...weekly("Live Music", "Venue A", 4, 800),
    ...weekly("Live Music", "Venue B", 4, 800),
  ];
  const { dropped } = capSeriesHorizon(events, { today: TODAY });
  assert.equal(dropped.length, 0);
});

test("addDays does plain calendar math across a month and a leap day", () => {
  assert.equal(addDays("2026-07-25", 7), "2026-08-01");
  assert.equal(addDays("2026-07-25", 365), "2027-07-25");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
});

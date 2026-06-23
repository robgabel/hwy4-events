// Regression lock for the venue-gap worklist (lib/venue-gaps.ts), the input to the
// create_venue_row proposer. The pure aggregation is what decides which venues get
// proposed, so it's worth pinning: generic/poisoned names excluded, already-
// registered canonicals skipped, threshold honored.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateVenueGaps, isResolvableVenueName } from "../../lib/venue-gaps.js";

function ev(venue_name: string | null, town = "Arnold", name = "Some Event", status: string | null = null) {
  return { name, venue_name, town, status };
}

test("isResolvableVenueName rejects generic, poisoned, and empty names", () => {
  assert.equal(isResolvableVenueName("Murphys Volunteer Library"), true);
  assert.equal(isResolvableVenueName("Indian Rock Vineyards"), true);
  // generic fallbacks / bare towns
  assert.equal(isResolvableVenueName("Unknown Venue"), false);
  assert.equal(isResolvableVenueName("TBD"), false);
  assert.equal(isResolvableVenueName("Arnold"), false);
  assert.equal(isResolvableVenueName("downtown murphys"), false);
  // poisoned scraper artifacts
  assert.equal(isResolvableVenueName("Featuring James Michael Day"), false);
  assert.equal(isResolvableVenueName("Hosted by KJ Johnny"), false);
  // empty / null
  assert.equal(isResolvableVenueName(""), false);
  assert.equal(isResolvableVenueName("   "), false);
  assert.equal(isResolvableVenueName(null), false);
  assert.equal(isResolvableVenueName(undefined), false);
});

test("aggregateVenueGaps groups by venue and applies the threshold", () => {
  const rows = [
    ev("Murphys Volunteer Library"),
    ev("Murphys Volunteer Library"),
    ev("Murphys Volunteer Library"),
    ev("Gateway Hotel Pool", "Copperopolis"),
    ev("Gateway Hotel Pool", "Copperopolis"), // only 2 -> below default threshold 3
  ];
  const gaps = aggregateVenueGaps(rows, new Set());
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].venue, "Murphys Volunteer Library");
  assert.equal(gaps[0].count, 3);
  assert.equal(gaps[0].town, "Arnold");
});

test("aggregateVenueGaps sorts by count desc and respects a custom threshold", () => {
  const rows = [
    ev("Venue A"),
    ev("Venue A"),
    ev("Venue B"),
    ev("Venue B"),
    ev("Venue B"),
  ];
  const gaps = aggregateVenueGaps(rows, new Set(), 2);
  assert.deepEqual(
    gaps.map((g) => [g.venue, g.count]),
    [
      ["Venue B", 3],
      ["Venue A", 2],
    ]
  );
});

test("aggregateVenueGaps excludes generic names, cancelled rows, and registered canonicals", () => {
  const rows = [
    ev("Unknown Venue"),
    ev("Unknown Venue"),
    ev("Unknown Venue"), // generic -> excluded
    ev("Indian Rock Vineyards"),
    ev("Indian Rock Vineyards"),
    ev("Indian Rock Vineyards"), // registered -> excluded (case-insensitive)
    ev("New Winery"),
    ev("New Winery"),
    ev("New Winery", "Murphys", "x", "cancelled"), // cancelled doesn't count -> only 2
  ];
  const registered = new Set(["indian rock vineyards"]);
  const gaps = aggregateVenueGaps(rows, registered);
  assert.equal(gaps.length, 0);
});

test("aggregateVenueGaps backfills town from a later row when the first lacks one", () => {
  const rows = [
    ev("Lonely Venue", ""),
    ev("Lonely Venue", "Bear Valley"),
    ev("Lonely Venue", ""),
  ];
  const gaps = aggregateVenueGaps(rows, new Set());
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].town, "Bear Valley");
});

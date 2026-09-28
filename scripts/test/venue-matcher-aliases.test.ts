// Registry aliases that exist so two scrapes of the same room can agree
// on a venue_key. Coppertown Square is the Facebook Discover spelling of
// Copperopolis Town Square; without the alias the FB row lands unkeyed and
// the Saturday-night concert series never merges with GoCalaveras's listing.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { matchVenue, resolveVenueKey } from "../lib/venue-matcher.js";

test("Copperopolis Coppertown Square aliases to the town-square registry row", () => {
  const hit = matchVenue("", null, "Copperopolis Coppertown Square");
  assert.equal(hit?.venue_key, "copperopolis-town-square");
  assert.equal(hit?.venue_name, "Copperopolis Town Square");
});

test("bare Coppertown Square also aliases", () => {
  const hit = matchVenue("", null, "Coppertown Square");
  assert.equal(hit?.venue_key, "copperopolis-town-square");
});

// ---------------------------------------------------------------------------
// Secondary addresses (dedup v2 Phase 0.2). The fairgrounds has two street
// entrances, and sources list either one. With only 101 Frogtown Rd in the
// registry, a row at 2465 Gun Club Rd whose venue_name did not self-identify
// never resolved, so two listings of one event could not agree on a venue
// (the All Hallows Faire pair, 2026-10-24).
// ---------------------------------------------------------------------------

test("an organizer's name in the venue field resolves via the fairgrounds' Gun Club Rd entrance", () => {
  const hit = matchVenue(
    "All Hallows Faire 18th Annual",
    null,
    "All Hallows Fantasy Faire, Gary PooBar Britt and Lissa Britt",
    "2465 Gun Club Rd, Angels Camp, CA 95222-9248, United States"
  );
  assert.equal(hit?.venue_key, "fairgrounds");
  assert.equal(hit?.venue_name, "Calaveras County Fairgrounds");
  // The display/directions address stays the primary one.
  assert.equal(hit?.address, "101 Frogtown Rd, Angels Camp, CA 95222");
});

test("a bare Gun Club Rd address keys the fair organization's venue string to the fairgrounds", () => {
  assert.equal(
    resolveVenueKey({
      name: "1st Annual Live Like Lilly Dinner and Dance",
      description: null,
      venue_name: "Calaveras County Fair & Jumping Frog Jubilee",
      address: "2465 Gun Club Rd",
    }),
    "fairgrounds"
  );
});

test("the primary fairgrounds address still resolves", () => {
  assert.equal(
    resolveVenueKey({
      name: "Angels Camp, CALIFORNIA - All Hallows Faire (Oct 24-25)",
      description: null,
      venue_name: "Some Performer Page",
      address: "101 Frogtown Rd",
    }),
    "fairgrounds"
  );
});

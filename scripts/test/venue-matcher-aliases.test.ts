// Registry aliases that exist so two scrapes of the same room can agree
// on a venue_key. Coppertown Square is the Facebook Discover spelling of
// Copperopolis Town Square; without the alias the FB row lands unkeyed and
// the Saturday-night concert series never merges with GoCalaveras's listing.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { matchVenue } from "../lib/venue-matcher.js";

test("Copperopolis Coppertown Square aliases to the town-square registry row", () => {
  const hit = matchVenue("", null, "Copperopolis Coppertown Square");
  assert.equal(hit?.venue_key, "copperopolis-town-square");
  assert.equal(hit?.venue_name, "Copperopolis Town Square");
});

test("bare Coppertown Square also aliases", () => {
  const hit = matchVenue("", null, "Coppertown Square");
  assert.equal(hit?.venue_key, "copperopolis-town-square");
});

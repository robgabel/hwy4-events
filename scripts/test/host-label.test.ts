// The host label under an event title must name a real host, never one of
// our scrapers (#406).
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeHost } from "../../lib/poster.js";

const TITLE = "Welcome Homes Fall Makers Market";

test("Facebook discover source names are hidden", () => {
  assert.equal(humanizeHost("Facebook Events Discover (Copperopolis)", TITLE), null);
  assert.equal(humanizeHost("Facebook Events Discover (Angels Camp)", TITLE), null);
  assert.equal(humanizeHost("fb-discover-copperopolis", TITLE), null);
});

test("aggregators and community submissions stay hidden", () => {
  assert.equal(humanizeHost("GoCalaveras.com", TITLE), null);
  assert.equal(humanizeHost("Community Submission", TITLE), null);
});

test("slug-style feed names become the host, minus the feed word", () => {
  assert.equal(humanizeHost("moose-lodge-calendar", TITLE), "Moose Lodge");
  assert.equal(humanizeHost("Ebbetts Pass Moose Lodge Newsletter", TITLE), "Ebbetts Pass Moose Lodge");
  assert.equal(humanizeHost("cameo-plaza", TITLE), "Cameo Plaza");
});

test("real organizer names pass through", () => {
  assert.equal(humanizeHost("Stevenot Winery", TITLE), "Stevenot Winery");
  assert.equal(humanizeHost("Bear Valley Adventure Co.", TITLE), "Bear Valley Adventure Co.");
  assert.equal(humanizeHost("Visit Murphys", TITLE), "Visit Murphys");
});

test("a host that repeats the title is hidden", () => {
  assert.equal(humanizeHost("Arnold Rim Trail", "Arnold Rim Trail"), null);
});

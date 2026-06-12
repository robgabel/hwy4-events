// Locks the WS-8 confidence derivation (lib/confidence.ts): the disclosure note
// shows for community-submitted unverified events and nothing else.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { eventConfidence } from "../../lib/confidence.js";

test("community-sourced + unchecked -> disclosure (the Miss Debbie case)", () => {
  const c = eventConfidence({ community_sourced: true, verification_status: "unchecked" });
  assert.equal(c.level, "community_sourced_unverified");
  assert.equal(c.showDisclosure, true);
});

test("verified status wins -> no disclosure even if community-sourced", () => {
  const c = eventConfidence({ community_sourced: true, verification_status: "verified" });
  assert.equal(c.level, "verified");
  assert.equal(c.showDisclosure, false);
});

test("needs_verification -> stale_source, no note (existing 'Date unconfirmed' badge covers it)", () => {
  const c = eventConfidence({ verification_status: "needs_verification" });
  assert.equal(c.level, "stale_source");
  assert.equal(c.showDisclosure, false);
});

test("normal scraped row (not community, unchecked) -> no disclosure", () => {
  const c = eventConfidence({ community_sourced: false, verification_status: "unchecked" });
  assert.equal(c.level, "verified");
  assert.equal(c.showDisclosure, false);
});

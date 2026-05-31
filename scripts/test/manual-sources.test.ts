// Regression lock for the manual-venue blocklist (lib/manual-sources.ts).
//
// These venues are curated by hand and the auto-scrapers must skip them so they
// don't overwrite the hand-entered rows. Each case below is a real row shape we
// ship, so the protection can't silently regress.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import { isManuallyManagedEvent } from "../lib/manual-sources.js";

test("Lube Room is treated as manually managed (all real variants)", () => {
  // GoCalaveras's generic re-listing — the one that kept overwriting band titles.
  assert.equal(
    isManuallyManagedEvent({
      name: "Live Music @ The Lube Room",
      venue_name: "The Lube Room Saloon",
    }),
    true
  );
  // The seed's canonical title — "lube room" isn't in the name, matches via venue.
  assert.equal(
    isManuallyManagedEvent({
      name: "Live at The Lube: VC3 Band",
      venue_name: "The Lube Room Saloon",
    }),
    true
  );
  // Venue alone is enough, even with a missing name.
  assert.equal(
    isManuallyManagedEvent({ name: null, venue_name: "The Lube Room Saloon" }),
    true
  );
});

test("Cameo Plaza still matches (no regression)", () => {
  assert.equal(
    isManuallyManagedEvent({ name: "Cameo Plaza Merchants Holiday Market", venue_name: null }),
    true
  );
});

test("Calaveras Big Trees programs are treated as manually managed (all variants)", () => {
  // GoCalaveras's name format — matches via "big trees state park" in the name.
  assert.equal(
    isManuallyManagedEvent({
      name: "Creek Critters @ Big Trees State Park",
      venue_name: "Calaveras Big Trees State Park",
    }),
    true
  );
  // A program whose name doesn't contain "big trees" — matches via venue_name.
  assert.equal(
    isManuallyManagedEvent({
      name: "Junior Rangers",
      venue_name: "Calaveras Big Trees State Park",
    }),
    true
  );
  // Name alone is enough.
  assert.equal(
    isManuallyManagedEvent({
      name: "North Grove Guided Walk @ Big Trees State Park",
      venue_name: null,
    }),
    true
  );
});

test("unrelated corridor events are not blocklisted", () => {
  assert.equal(
    isManuallyManagedEvent({
      name: "Live Music @ Murphys Irish Pub",
      venue_name: "Murphys Irish Pub",
    }),
    false
  );
  // An Arnold event that isn't at the state park must still scrape normally.
  assert.equal(
    isManuallyManagedEvent({
      name: "Arnold Independence Day Parade",
      venue_name: "Cedar Center, Arnold",
    }),
    false
  );
});

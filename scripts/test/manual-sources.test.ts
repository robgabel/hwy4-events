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

test("Hot Copper Car Show is manually managed (both the source's doubled title and the hand-cleaned name)", () => {
  // GoCalaveras's actual (doubled) title — the row we want frozen so a re-scrape
  // can't restore "Show Show" or the 23:50 placeholder end time.
  assert.equal(
    isManuallyManagedEvent({
      name: "Hot Copper Car Show Show",
      venue_name: "Copperopolis Town Square",
    }),
    true
  );
  // The corrected name still matches.
  assert.equal(
    isManuallyManagedEvent({
      name: "Hot Copper Car Show",
      venue_name: "Copperopolis Town Square",
    }),
    true
  );
  // The OTHER event at the same square (July 4 Stars & Stripes) must still scrape
  // normally — the pattern is scoped to the car show's name, not the venue.
  assert.equal(
    isManuallyManagedEvent({
      name: "Stars & Stripes Copper Valley Town Square",
      venue_name: "Copperopolis Town Square",
    }),
    false
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

// --- Arnold Rim Trail: owner-aware blocking (2026-07-25) -------------------
//
// ART's guided hikes start at sunset, so their times shift monthly AND ART
// edits an occurrence days before it happens. We read the organizer's own
// calendar directly; the aggregators must not overwrite it with a stale
// snapshot. The twist vs every other entry here: the ART scraper itself has to
// stay allowed, or the source would skip its entire feed.

const ART_ROWS = [
  // The organizer's own rows, as our ART scraper produces them.
  { name: "Guided Sunset Hike to Cougar Rock", venue_name: "ART Trailhead – Valley View Dr." },
  { name: "Volunteer Trail Workday", venue_name: "US Forest Service Station in Hathaway Pines" },
  // GoCalaveras's copies, including the source's real "Aronld" typo.
  { name: "Guided Sunset Hike to Cougar Rock : Arnold Rim Trail", venue_name: "ART Trailhead – Valley View Dr." },
  { name: "Aronld Rim Trail : Tree Identifier Walks with Mary Anne Carlton", venue_name: "Sierra Nevada Logging Museum" },
  { name: "Arnold Rim Trail : Ultra Trail Run", venue_name: "White Pines Lake Park" },
];

test("aggregators are blocked from every Arnold Rim Trail event shape", () => {
  for (const row of ART_ROWS) {
    // No asking slug (gocalaveras, visit-murphys, hwy4-fb-discover all call it this way).
    assert.equal(isManuallyManagedEvent(row), true, `unblocked: ${row.name}`);
    // An unrelated source that does pass a slug is still blocked.
    assert.equal(isManuallyManagedEvent(row, "gocalaveras"), true, `unblocked: ${row.name}`);
  }
});

test("the Arnold Rim Trail scraper is NOT blocked from its own events", () => {
  for (const row of ART_ROWS) {
    assert.equal(
      isManuallyManagedEvent(row, "arnold-rim-trail"),
      false,
      `owner wrongly blocked from: ${row.name}`
    );
  }
});

test("owning one pattern does not unlock somebody else's curated rows", () => {
  // The ART scraper must still be blocked from hand-seeded venues it doesn't own.
  assert.equal(
    isManuallyManagedEvent(
      { name: "Live Music @ The Lube Room", venue_name: "The Lube Room Saloon" },
      "arnold-rim-trail"
    ),
    true
  );
});

test("unrelated Arnold events are untouched by the ART patterns", () => {
  // The patterns are ART-specific on purpose — a bare "arnold" or "trail" would
  // sweep up half the corridor (cf. the deliberate "lake alpine lodge" narrowing).
  for (const row of [
    { name: "Arnold Independence Day Parade", venue_name: "Arnold Cedar Center" },
    { name: "Trail Mix & Chill", venue_name: "Snowshoe Brewing Company" },
    { name: "Arnold Farmers Market", venue_name: "Arnold Rim Plaza" },
  ]) {
    assert.equal(isManuallyManagedEvent(row), false, `wrongly blocked: ${row.name}`);
  }
});

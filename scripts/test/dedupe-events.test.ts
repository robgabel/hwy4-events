// Read-time merge behavior for the umbrella-series + act case.
//
// `dedupeEvents` must collapse the GoCalaveras umbrella row ("Bistro Summer
// Concerts Series") and the venue feed's act ("Avalon Revival") into ONE card
// that keeps the band's name/photo but backfills the umbrella's blurb. Uses the
// repo's node:test + tsx harness (same as event-identity.test.ts).
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dedupeEvents,
  mergeCluster,
  pickSurvivor,
  type DedupableEvent,
} from "../../lib/dedupe-events.js";

const slot = {
  date: "2026-06-13",
  town: "Arnold",
  venue_name: "Bistro Espresso",
  start_time: "18:00",
  end_time: "21:00",
  visibility: "public" as const,
};

const umbrella: DedupableEvent = {
  ...slot,
  name: "Bistro Summer Concerts Series",
  description:
    "Summer concert season is back. Live music every Saturday 6-9 PM, smoky BBQ.",
  artists: null,
  image_url: "https://example.com/poster.jpg",
  source_event_id: "192236",
  event_url: "https://gocalaveras.com/event/192236",
};

const act: DedupableEvent = {
  ...slot,
  name: "Avalon Revival",
  description: null,
  artists: ["Avalon Revival"],
  image_url: "https://example.com/band.jpg",
};

test("collapses the umbrella + act pair to a single card (either order)", () => {
  assert.equal(dedupeEvents([umbrella, act]).length, 1);
  assert.equal(dedupeEvents([act, umbrella]).length, 1);
});

test("keeps the band name + its photo, backfills the umbrella blurb", () => {
  const [card] = dedupeEvents([umbrella, act]);
  assert.equal(card.name, "Avalon Revival");
  assert.equal(card.image_url, "https://example.com/band.jpg");
  assert.ok((card.description ?? "").includes("Summer concert season"));
  assert.deepEqual(card.artists, ["Avalon Revival"]);
});

test("does not mutate the input rows", () => {
  dedupeEvents([umbrella, act]);
  assert.equal(act.description, null);
  assert.equal(umbrella.name, "Bistro Summer Concerts Series");
});

test("mergeCluster returns the row unchanged for a singleton", () => {
  assert.equal(mergeCluster([act]), act);
});

test("pickSurvivor breaks a richness tie toward the older row (HWY-29)", () => {
  // Two identically-rich rows (same fields), differing only in age. The older
  // resident must win so a fresh aggregator re-insert can't displace it.
  const base: DedupableEvent = { ...slot, name: "Same Show", description: "x", artists: null };
  const older = { ...base, created_at: "2026-03-01T00:00:00Z" };
  const newer = { ...base, created_at: "2026-08-14T00:00:00Z" };
  assert.equal(pickSurvivor([newer, older]).created_at, older.created_at); // order-independent
  assert.equal(pickSurvivor([older, newer]).created_at, older.created_at);
});

test("pickSurvivor still lets a richer row win regardless of age", () => {
  // Age only breaks a tie; a genuinely richer (has artists) row still wins even
  // if it's newer.
  const poorOld: DedupableEvent = { ...slot, name: "Show", description: null, artists: null, created_at: "2026-01-01T00:00:00Z" };
  const richNew: DedupableEvent = { ...slot, name: "Show", description: "a much longer blurb here", artists: ["The Band"], created_at: "2026-08-01T00:00:00Z" };
  assert.equal(pickSurvivor([poorOld, richNew]).artists?.[0], "The Band");
});

test("leaves genuinely different shows alone (different venue)", () => {
  const elsewhere: DedupableEvent = {
    ...act,
    venue_name: "Cameo Plaza",
    name: "Snarky Cats",
    artists: ["Snarky Cats"],
  };
  assert.equal(dedupeEvents([act, elsewhere]).length, 2);
});

// ---------------------------------------------------------------------------
// HWY-10: read-time collapse of timeless duplicates.
// ---------------------------------------------------------------------------

const ironstoneSlot = {
  date: "2026-08-16",
  town: "Murphys",
  venue_name: "Ironstone Vineyards",
  visibility: "public" as const,
};

test("dedupeEvents collapses a timeless listing into its timed twin", () => {
  const timeless: DedupableEvent = {
    ...ironstoneSlot,
    name: "Kane Brown - Murphys",
    start_time: null,
    end_time: null,
    description:
      "An unforgettable night with Kane Brown at Ironstone Vineyards in Murphys.",
    artists: ["Kane Brown"],
    image_url: "https://example.com/kane.jpg",
  };
  const timed: DedupableEvent = {
    ...ironstoneSlot,
    name: "Kane Brown",
    start_time: "19:00",
    end_time: "22:00",
    description: "Kane Brown plays the amphitheatre.",
    artists: ["Kane Brown"],
  };
  const out = dedupeEvents([timeless, timed]);
  assert.equal(out.length, 1);
  // The surviving card states the hour it knows, and keeps the fuller blurb
  // and the poster from its timeless sibling.
  assert.equal(out[0].start_time, "19:00");
  assert.equal(out[0].end_time, "22:00");
  assert.equal(out[0].image_url, "https://example.com/kane.jpg");
});

test("a timeless survivor inherits the clock from a sibling", () => {
  // Here the timeless row wins on richness (much longer description); it must
  // still render a start time rather than a card with no hour.
  const rich: DedupableEvent = {
    ...ironstoneSlot,
    name: "Kane Brown - Murphys",
    start_time: null,
    end_time: null,
    description: "x".repeat(600),
    artists: ["Kane Brown"],
  };
  const sparse: DedupableEvent = {
    ...ironstoneSlot,
    name: "Kane Brown",
    start_time: "19:00",
    end_time: "22:00",
    description: null,
    artists: ["Kane Brown"],
  };
  const merged = mergeCluster([rich, sparse]);
  assert.equal(merged.start_time, "19:00");
  assert.equal(merged.end_time, "22:00");
});

test("dedupeEvents keeps a marked festival umbrella beside its opening night", () => {
  const umbrella: DedupableEvent = {
    date: "2026-07-17",
    town: "Bear Valley",
    venue_name: "Big White Tent",
    visibility: "public",
    name: "Bear Valley Music Festival 2026",
    start_time: null,
    end_time: null,
    description: "July 17 through August 2, 2026. Three weeks under the tent.",
    artists: null,
    series_umbrella: true,
    robs_pick: true,
  };
  const openingNight: DedupableEvent = {
    date: "2026-07-17",
    town: "Bear Valley",
    venue_name: "Big White Tent",
    visibility: "public",
    name: "Bear Valley Music Festival",
    start_time: "19:00",
    end_time: null,
    description: "Opening night under the Big White Tent.",
    artists: ["Bear Valley Festival Orchestra"],
  };
  const out = dedupeEvents([umbrella, openingNight]);
  assert.equal(out.length, 2, "the umbrella card is duplicative by design");
});

test("collapses a cross-town duplicate of the same program (bucket no longer keys on town)", () => {
  // The 2026-07-28 Doc Nancy dupe as it reached the homepage. Both cards showed
  // under "This Saturday" because the bucket key put them in separate buckets on
  // the town label alone, so they were never even compared.
  const parkListing: DedupableEvent = {
    date: "2026-08-01",
    town: "Arnold",
    venue_name: "Calaveras Big Trees State Park",
    address: "1170 East Highway 4, Arnold, CA 95223",
    visibility: "public",
    name: "Night Skies with Doc Nancy @ Big Trees State Park",
    start_time: "20:00",
    end_time: null,
    description:
      "Doc Nancy shares the science, constellations, and stories of the night sky. Meet at the Scenic Overlook.",
    artists: null,
  };
  const communityRow: DedupableEvent = {
    date: "2026-08-01",
    town: "Camp Connell",
    venue_name: "Big tree State Park overlook",
    visibility: "public",
    name: "Night skies with Doc Nancy",
    start_time: "20:00",
    end_time: "22:30",
    description: "Bring a chair and a blanket",
    artists: null,
  };

  const out = dedupeEvents([parkListing, communityRow]);
  assert.equal(out.length, 1, "one program, one card");
  // The park's own listing is the richer row, so it keeps the display slot.
  assert.equal(out[0].name, "Night Skies with Doc Nancy @ Big Trees State Park");
});

test("does NOT collapse two towns' same-titled events at different venues", () => {
  // Dropping town from the bucket key must not let the predicate's venue veto be
  // bypassed: these are two real, separate trivia nights.
  const murphys: DedupableEvent = {
    date: "2026-07-10",
    town: "Murphys",
    venue_name: "Murphys Irish Pub",
    visibility: "public",
    name: "Trivia Night",
    start_time: "19:00",
    end_time: null,
    description: null,
    artists: null,
  };
  const arnold: DedupableEvent = {
    date: "2026-07-10",
    town: "Arnold",
    venue_name: "Bistro Espresso",
    visibility: "public",
    name: "Trivia Night",
    start_time: "19:00",
    end_time: null,
    description: null,
    artists: null,
  };
  assert.equal(dedupeEvents([murphys, arnold]).length, 2);
});

// The read-time assertion (HWY-16's loud successor to the collapse) and its
// tests were removed with the assertion itself (2026-08-23, dedup Move 3
// complete). findDuplicateClusters — the same clustering — stays locked via
// the audit-checks and reconcile suites.

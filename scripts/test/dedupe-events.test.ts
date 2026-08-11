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
  assertNoResidentDuplicates,
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

// ---------------------------------------------------------------------------
// HWY-16: read-time dedupe becomes a loud assertion, not a collapse.
//
// `assertNoResidentDuplicates` reuses the exact same clustering
// `dedupeEvents` does (so it can never disagree about what's a duplicate) but
// must NEVER merge — a resident duplicate is now a bug for the write-time
// merge / nightly reconcile to fix, not something the render path hides.
// ---------------------------------------------------------------------------

/** Runs `fn` with `console.error` swapped for a recorder, always restoring the
 *  real one afterward (even on assertion failure). Returns the recorded calls. */
function captureConsoleError(fn: () => void): unknown[][] {
  const original = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    fn();
  } finally {
    console.error = original;
  }
  return calls;
}

test("assertNoResidentDuplicates returns a clean set unchanged and silent", () => {
  const arnold: DedupableEvent = {
    date: "2026-09-01",
    town: "Arnold",
    venue_name: "Bistro Espresso",
    visibility: "public",
    name: "Open Mic",
    start_time: "19:00",
    end_time: null,
    description: null,
    artists: null,
  };
  const murphys: DedupableEvent = {
    date: "2026-09-01",
    town: "Murphys",
    venue_name: "Murphys Creek Theatre",
    visibility: "public",
    name: "Fall Play Opening Night",
    start_time: "19:00",
    end_time: null,
    description: null,
    artists: null,
  };
  const input = [arnold, murphys];

  let out!: DedupableEvent[];
  const calls = captureConsoleError(() => {
    out = assertNoResidentDuplicates(input);
  });

  assert.equal(out, input, "returns the SAME array reference — never collapses");
  assert.deepEqual(out, [arnold, murphys]);
  assert.equal(calls.length, 0, "a clean set never logs");
});

test("assertNoResidentDuplicates leaves a real duplicate cluster fully intact, but screams", () => {
  // umbrella + act is the exact pair the earlier test in this file confirms
  // `dedupeEvents` collapses to ONE card. The assertion must do the opposite:
  // keep both rows, and log instead of merge.
  const input = [umbrella, act];

  let out!: DedupableEvent[];
  const calls = captureConsoleError(() => {
    out = assertNoResidentDuplicates(input);
  });

  assert.equal(out, input, "returns the SAME array reference — never collapses");
  assert.equal(out.length, 2, "both rows survive; nothing is merged away");
  assert.deepEqual(out, [umbrella, act]);

  assert.equal(calls.length, 1, "one greppable line per cluster found");
  const line = String(calls[0][0]);
  assert.ok(
    line.startsWith("READTIME_DEDUPE_ASSERT"),
    `line must start with the greppable prefix, got: ${line}`
  );
  assert.ok(line.includes(slot.date), "names the date");
  assert.ok(line.includes(slot.venue_name), "names the venue");
  assert.ok(
    line.includes(umbrella.name) && line.includes(act.name),
    "names every member of the cluster"
  );
});

test("assertNoResidentDuplicates does not mutate the input rows", () => {
  captureConsoleError(() => {
    assertNoResidentDuplicates([umbrella, act]);
  });
  assert.equal(act.description, null);
  assert.equal(umbrella.name, "Bistro Summer Concerts Series");
});

test("assertNoResidentDuplicates logs one line per cluster, not per duplicate row", () => {
  // Three-way cluster (umbrella + two near-identical acts) must still yield
  // exactly one READTIME_DEDUPE_ASSERT line, not one per pair.
  const secondAct: DedupableEvent = {
    ...slot,
    name: "Avalon Revival (Acoustic Set)",
    description: null,
    artists: ["Avalon Revival"],
  };
  const input = [umbrella, act, secondAct];

  let out!: DedupableEvent[];
  const calls = captureConsoleError(() => {
    out = assertNoResidentDuplicates(input);
  });

  assert.equal(out, input);
  assert.equal(out.length, 3, "no row is ever dropped");
  assert.equal(calls.length, 1, "one line for the one 3-member cluster");
});

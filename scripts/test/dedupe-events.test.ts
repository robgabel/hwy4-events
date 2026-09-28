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
  clusterEvents,
  clusterEventsDetailed,
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

test("collapses Brice Hilltop series @ 19:00 into Greg Sutton @ 18:00", () => {
  const hilltop: DedupableEvent = {
    date: "2026-09-19",
    town: "Murphys",
    venue_name: "Brice Station Vineyards",
    venue_key: "brice-station",
    start_time: "19:00:00",
    end_time: "22:00:00",
    visibility: "public",
    name: "Brice Station Vineyards – Hilltop Concert Series",
    artists: ["Earth Tones Trio & Band"],
    description: "The Earth Tones Trio & Band brings soulful vocals.",
  };
  const greg: DedupableEvent = {
    date: "2026-09-19",
    town: "Murphys",
    venue_name: "Brice Station Vineyards",
    venue_key: "brice-station",
    start_time: "18:00:00",
    end_time: null,
    visibility: "public",
    name: "Greg Sutton and Friends",
    artists: ["Greg Sutton and Friends"],
    description:
      "Greg Sutton is a Northern California singer-songwriter. This concert begins at 6:00 PM.",
    event_url: "https://bricestation.com/products/greg-sutton-and-friends-september-19-2026-6pm",
  };
  const [card] = dedupeEvents([hilltop, greg]);
  assert.equal(dedupeEvents([hilltop, greg]).length, 1);
  assert.equal(card.name, "Greg Sutton and Friends");
  assert.equal(card.start_time, "18:00:00");
  // Named-act bio wins; the series leftover blurb must not replace it.
  assert.ok((card.description ?? "").includes("Greg Sutton is a Northern California"));
  assert.ok(!(card.description ?? "").includes("Earth Tones"));
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
// complete). Coverage after the removal, stated precisely: the predicate is
// heavily locked by event-identity.test.ts, and clusterEvents/pickSurvivor
// are exercised transitively by the dedupeEvents tests above; nothing locks
// findDuplicateClusters by name (it is clusterEvents(...).filter(len>1)).

test("a named 'Live Music - <Act>' row keeps the card over a richer true placeholder (dedup v2 0.3)", () => {
  // The aggregator's "Live Music @ Sequoia Woods" row is the richer one here
  // (long blurb, image, source id). It used to win because the named row was
  // ALSO penalized as a placeholder, so the merged card lost the band name.
  const sequoia = {
    date: "2027-07-10",
    town: "Arnold",
    venue_name: "Sequoia Woods Country Club",
    visibility: "public" as const,
  };
  const placeholder: DedupableEvent = {
    ...sequoia,
    name: "Live Music @ Sequoia Woods",
    start_time: "19:00",
    end_time: "22:00",
    description: "x".repeat(300),
    source_event_id: "192001",
    image_url: "https://example.com/a.jpg",
    event_url: "https://www.gocalaveras.com/events/live-music-sequoia-woods/",
    artists: null,
  };
  const named: DedupableEvent = {
    ...sequoia,
    name: "Live Music - Jill Warren",
    start_time: "19:00",
    end_time: "22:00",
    description: "Jill Warren on the deck.",
    source_event_id: "sw-2027-07-10-jill",
    artists: null,
  };
  assert.equal(pickSurvivor([placeholder, named]).name, "Live Music - Jill Warren");
  assert.equal(pickSurvivor([named, placeholder]).name, "Live Music - Jill Warren");
  // ...and the pair is one event, so dedupe collapses it to that card.
  const out = dedupeEvents([placeholder, named]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Live Music - Jill Warren");
});

test("a TBD slot cannot chain a different act into its re-listing's cluster (dedup v2 Phase 0 review)", () => {
  // The real 2026-08-08 Sequoia evening: the TBD patio slot, the named re-list
  // of that slot (The Hit Men), and Jamie Byous 30 minutes earlier. Only the
  // slot and its re-list are one event; Byous must never join them, or
  // reconcile deletes a distinct act.
  const night = {
    date: "2026-08-08",
    town: "Arnold",
    venue_name: "Sequoia Woods Country Club",
    visibility: "public" as const,
    description: null,
    artists: null,
  };
  const tbd: DedupableEvent = { ...night, name: "Patio Party #4 featuring live music (TBD)", start_time: "19:00", end_time: "22:00" };
  const byous: DedupableEvent = { ...night, name: "Live Music - Jamie Byous", start_time: "18:30", end_time: "21:30" };
  const hitMen: DedupableEvent = { ...night, name: "Patio Party #4 featuring live music - The Hit Men", start_time: "19:00", end_time: "22:00" };
  const clusters = clusterEvents([tbd, byous, hitMen]).map((c) => c.map((e) => e.name).sort());
  assert.deepEqual(
    clusters.sort((x, y) => y.length - x.length),
    [
      ["Patio Party #4 featuring live music (TBD)", "Patio Party #4 featuring live music - The Hit Men"],
      ["Live Music - Jamie Byous"],
    ]
  );
});

// ---------------------------------------------------------------------------
// Dedup v2 Phase 1.5: union-find with a cannot-link. A row that resembles two
// events that must stay apart joins neither; a vague row that merely fails to
// match does not block a merge. Real multi-row dates live in
// dedup-golden.test.ts; these pin the rule's shapes.
// ---------------------------------------------------------------------------

const park = {
  date: "2026-07-12",
  town: "Arnold",
  venue_name: "Calaveras Big Trees State Park",
  venue_key: "big-trees-state-park",
  visibility: "public" as const,
  description: null,
  artists: null,
};
const names = (cs: DedupableEvent[][]) => cs.map((c) => c.map((e) => e.name).sort()).sort();

test("a placeholder that matches two different programs joins neither, and is reported", () => {
  const placeholder: DedupableEvent = { ...park, name: "Calaveras Big Trees State Park", start_time: "10:00", source_name: "GoCalaveras.com" };
  const rangers: DedupableEvent = { ...park, name: "Junior Rangers", start_time: "10:00", source_name: "Calaveras Big Trees State Park" };
  const walk: DedupableEvent = { ...park, name: "Meadow Walk", start_time: "10:00", source_name: "Calaveras Big Trees State Park" };
  for (const order of [[placeholder, rangers, walk], [rangers, walk, placeholder], [rangers, placeholder, walk]]) {
    const r = clusterEventsDetailed(order);
    assert.deepEqual(names(r.clusters), [["Calaveras Big Trees State Park"], ["Junior Rangers"], ["Meadow Walk"]]);
    // Reported once, under the placeholder, with both programs it matched.
    assert.deepEqual(
      r.refused.map((x) => [x.row.name, x.matches.map((m) => m.name).sort()]),
      [["Calaveras Big Trees State Park", ["Junior Rangers", "Meadow Walk"]]]
    );
  }
  // With one program in the slot the placeholder is that program's listing.
  assert.deepEqual(names(clusterEvents([placeholder, rangers])), [["Calaveras Big Trees State Park", "Junior Rangers"]]);
});

test("two copies of an ambiguous placeholder still merge with each other, never with either side", () => {
  const p1: DedupableEvent = { ...park, name: "Calaveras Big Trees State Park", start_time: "10:00", source_name: "GoCalaveras.com" };
  const p2: DedupableEvent = { ...p1, source_name: "Visit Murphys" };
  const rangers: DedupableEvent = { ...park, name: "Junior Rangers", start_time: "10:00", source_name: "Calaveras Big Trees State Park" };
  const walk: DedupableEvent = { ...park, name: "Meadow Walk", start_time: "10:00", source_name: "Calaveras Big Trees State Park" };
  assert.deepEqual(names(clusterEvents([p1, rangers, p2, walk])), [
    ["Calaveras Big Trees State Park", "Calaveras Big Trees State Park"],
    ["Junior Rangers"],
    ["Meadow Walk"],
  ]);
});

test("an all-day listing that overlaps a feed's two sessions joins neither session", () => {
  // The PRD's cannot-link: one feed's 10:00 and 12:00 sessions are two events,
  // and an aggregator's 10:00-14:00 listing must not glue them together.
  const venue = { ...park, venue_name: "Lackler Ceramics", venue_key: null, town: "Arnold" };
  const morning: DedupableEvent = { ...venue, name: "Kids Clay", start_time: "10:00", end_time: "11:30", source_name: "GoCalaveras.com" };
  const midday: DedupableEvent = { ...venue, name: "Kids Clay", start_time: "12:00", end_time: "13:30", source_name: "GoCalaveras.com" };
  const allDay: DedupableEvent = { ...venue, name: "Kids Clay Day", start_time: "10:00", end_time: "14:00", source_name: "Visit Murphys" };
  const r = clusterEventsDetailed([morning, midday, allDay]);
  assert.deepEqual(names(r.clusters), [["Kids Clay"], ["Kids Clay"], ["Kids Clay Day"]]);
  assert.ok(r.refused.some((x) => x.row === allDay));
});

test("a venue-less listing never glues two venues' same-titled events together", () => {
  const night = { date: "2026-06-12", town: "Murphys", visibility: "public" as const, description: null, artists: null, start_time: "19:00" };
  const pub: DedupableEvent = { ...night, name: "Karaoke Night", venue_name: "Murphys Irish Pub", source_name: "Murphys Irish Pub" };
  const bar: DedupableEvent = { ...night, name: "Karaoke Night", venue_name: "The Watering Hole", source_name: "GoCalaveras.com" };
  const unknown: DedupableEvent = { ...night, name: "Karaoke Night", venue_name: "Unknown Venue", source_name: "Community Submission" };
  assert.deepEqual(names(clusterEvents([pub, unknown, bar])), [["Karaoke Night"], ["Karaoke Night"], ["Karaoke Night"]]);
});

test("a routine row never survives a cluster that holds a real event, even a Rob's Pick (dedup v2 1.7)", () => {
  const lodge = { date: "2026-07-27", town: "Arnold", venue_name: "Ebbetts Pass Moose Lodge", visibility: "private" as const, artists: null };
  const routine: DedupableEvent = {
    ...lodge,
    name: "Queen of Hearts and Burger Night",
    start_time: "17:30",
    description: "Burger night and the Queen of Hearts drawing, members and guests welcome all evening.",
    image_url: "https://example.com/p.jpg",
    robs_pick: true,
    is_routine: true,
  };
  const event: DedupableEvent = { ...lodge, name: "Queen of Hearts", start_time: "17:30", description: null, is_routine: false };
  assert.equal(pickSurvivor([routine, event]).name, "Queen of Hearts");
  assert.equal(pickSurvivor([event, routine]).name, "Queen of Hearts");
});

test("two named acts under one series title never merge through an all-evening listing", () => {
  const venue = {
    date: "2026-08-22",
    town: "Murphys",
    venue_name: "Murphys Irish Pub",
    visibility: "public" as const,
    description: null,
  };
  // Two feeds list two different acts' sets under the same series title.
  const early: DedupableEvent = { ...venue, name: "Blues Night", start_time: "18:00", end_time: "20:00", artists: ["The Hollerin' Hounds"], source_name: "Murphys Irish Pub" };
  const late: DedupableEvent = { ...venue, name: "Blues Night", start_time: "21:00", end_time: "23:00", artists: ["Sipsy River Band"], source_name: "Visit Murphys" };
  // A third feed lists the whole evening with no act.
  const evening: DedupableEvent = { ...venue, name: "Blues Night", start_time: "18:00", end_time: "23:00", artists: null, source_name: "GoCalaveras.com" };
  const r = clusterEventsDetailed([early, evening, late]);
  assert.ok(
    r.clusters.every((c) => !(c.includes(early) && c.includes(late))),
    "the two acts share no cluster"
  );
});

test("a chain of clock-tolerant matches never joins one feed's two sessions, in any input order", () => {
  // Four feeds list one class with drifting clocks. Each neighbour pair
  // overlaps, but no single row matches both of the studio's own sessions
  // (10:00 and 14:00), so only the union-time cannot-link keeps them apart.
  const studio = { date: "2026-10-01", town: "Arnold", venue_name: "Lackler Ceramics", visibility: "public" as const, description: null, artists: null, name: "Kids Clay" };
  const morning: DedupableEvent = { ...studio, start_time: "10:00", end_time: "12:00", source_name: "Lackler Ceramics", created_at: "2026-09-01T00:00:00Z" };
  const aggA: DedupableEvent = { ...studio, start_time: "11:00", end_time: "13:00", source_name: "GoCalaveras.com", created_at: "2026-09-02T00:00:00Z" };
  const aggB: DedupableEvent = { ...studio, start_time: "12:30", end_time: "14:30", source_name: "Visit Murphys", created_at: "2026-09-03T00:00:00Z" };
  const afternoon: DedupableEvent = { ...studio, start_time: "14:00", end_time: "16:00", source_name: "Lackler Ceramics", created_at: "2026-09-04T00:00:00Z" };
  const sets = (evs: DedupableEvent[]) =>
    clusterEvents(evs).map((c) => c.map((e) => e.start_time).sort().join("+")).sort();
  const want = sets([morning, aggA, aggB, afternoon]);
  assert.ok(want.every((s) => !(s.includes("10:00") && s.includes("14:00"))), JSON.stringify(want));
  for (const order of [
    [afternoon, aggB, aggA, morning],
    [aggB, morning, afternoon, aggA],
    [aggA, afternoon, morning, aggB],
  ]) {
    assert.deepEqual(sets(order), want, "oldest-first processing makes the result order-free");
  }
});

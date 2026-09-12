// Regression lock for the evergreen persona SEO hubs
// (lib/persona-hubs.ts, roadmap ticket HWY-39).
//
// Why they exist: GSC already sends clicks to dated instance URLs for
// "arnold car show 2026", "hermitfest 2026", and "brice station concerts
// 2026". Those slugs expire. These year-less pages are the durable landing
// spots, same move as HWY-38 / Meet Me in Murphys.
//
// Load-bearing here:
//   * the year-less paths (the entire point)
//   * title/H1 matching the GSC queries
//   * the event matchers (no cross-town / cross-category bleed)
//   * honesty: no invented next-year date, price, or lineup
//   * the voice rules on fixed copy (no em dashes, Q&A resolves the question)
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PERSONA_HUBS,
  isArnoldCarShowEvent,
  isHermitfestEvent,
  isBriceConcertEvent,
  isPersonaHubEvent,
  personaHubForEvent,
  personaHubForVenueKey,
  personaHubsForTown,
  personaHubByKey,
} from "../../lib/persona-hubs.js";
import { generateEventSlug } from "../../lib/slugs.js";

function allStrings(g: (typeof PERSONA_HUBS)[number]): string[] {
  return [
    g.h1,
    g.lead,
    g.metaTitle,
    g.metaDescription,
    g.heading,
    g.blurb,
    g.upcomingHeading,
    g.emptyUpcoming,
    g.newsletterHeading,
    ...g.facts.map((f) => `${f.label} ${f.value}`),
    ...g.editorial,
    ...g.qa.flatMap((item) => [item.q, item.a]),
  ];
}

test("hubs are coherent: year-less paths, wired towns, enough copy", () => {
  assert.equal(PERSONA_HUBS.length, 3);
  const paths = new Set<string>();
  for (const g of PERSONA_HUBS) {
    assert.ok(g.path.startsWith("/"), `${g.key} path`);
    assert.ok(!/20\d\d/.test(g.path), `${g.key} path must not embed a year`);
    assert.ok(!paths.has(g.path), `${g.key} duplicate path`);
    paths.add(g.path);
    assert.ok(g.town.length > 0 && g.townSlug.length > 0, `${g.key} town`);
    assert.ok(g.editorial.length >= 2, `${g.key} editorial`);
    assert.ok(g.qa.length >= 4, `${g.key} qa`);
    assert.ok(g.facts.length >= 2, `${g.key} facts`);
    assert.ok(g.venueKeys.length >= 1, `${g.key} venueKeys`);
  }
  assert.deepEqual(
    PERSONA_HUBS.map((g) => g.path).sort(),
    ["/arnold-car-show", "/brice-station-concerts", "/hermitfest"]
  );
});

test("title and H1 match the GSC queries searchers actually type", () => {
  const arnold = personaHubByKey("arnold-car-show");
  assert.match(arnold.h1, /Arnold Car Show/);
  assert.match(arnold.metaTitle, /Arnold Car Show/);
  assert.match(arnold.metaTitle, /2026/);
  assert.match(arnold.lead, /September 19/);
  assert.match(arnold.lead, /1965 Blagen/);
  assert.match(arnold.lead, /\bCA\b/);

  const hermit = personaHubByKey("hermitfest");
  assert.match(hermit.h1, /Hermitfest/);
  assert.match(hermit.metaTitle, /Hermitfest/);
  assert.match(hermit.metaTitle, /2026/);
  assert.match(hermit.lead, /Bear Valley/);
  assert.match(hermit.lead, /September 12 and 13/);
  assert.match(hermit.lead, /vary/i);

  const brice = personaHubByKey("brice-station-concerts");
  assert.match(brice.h1, /Brice Station Concerts/);
  assert.match(brice.metaTitle, /Brice Station Concerts/);
  assert.match(brice.metaTitle, /2026/);
  assert.match(brice.lead, /3353 East Highway 4/);
  assert.match(brice.lead, /Murphys/);

  for (const g of PERSONA_HUBS) {
    assert.ok(g.metaTitle.length <= 70, `${g.key} metaTitle too long (${g.metaTitle.length})`);
    assert.ok(
      g.metaDescription.length >= 70 && g.metaDescription.length <= 175,
      `${g.key} metaDescription length ${g.metaDescription.length}`
    );
  }
});

test("the Q&A covers when, where, and the honest unknowns", () => {
  const arnold = personaHubByKey("arnold-car-show");
  const arnoldQs = arnold.qa.map((i) => i.q.toLowerCase()).join(" | ");
  assert.match(arnoldQs, /when/);
  assert.match(arnoldQs, /where/);
  assert.match(arnoldQs, /cost|admission|price/);

  const hermit = personaHubByKey("hermitfest");
  const hermitQs = hermit.qa.map((i) => i.q.toLowerCase()).join(" | ");
  assert.match(hermitQs, /when is hermitfest 2026/);
  assert.match(hermitQs, /where/);
  assert.match(hermitQs, /time/);

  const brice = personaHubByKey("brice-station-concerts");
  const briceQs = brice.qa.map((i) => i.q.toLowerCase()).join(" | ");
  assert.match(briceQs, /where/);
  assert.match(briceQs, /ticket/);
});

test("every Q&A answer leads with the answer, not a restatement", () => {
  for (const g of PERSONA_HUBS) {
    for (const { q, a } of g.qa) {
      assert.ok(a.length > 20, `${g.key} answer too thin: ${q}`);
      const first = a.split(/(?<=\.)\s/)[0].trim();
      assert.ok(first.length > 0, `${g.key} empty first sentence: ${q}`);
      assert.ok(
        !/^(well|so|great question|that depends|it depends|generally speaking)\b/i.test(first),
        `${g.key} answer warms up instead of answering: ${q}`
      );
      const qCore = q.replace(/[?]/g, "").toLowerCase();
      assert.ok(
        first.toLowerCase() !== qCore,
        `${g.key} answer restates the question: ${q}`
      );
    }
  }
});

test("fixed copy does not invent a next-year date, a price, or a future lineup", () => {
  for (const g of PERSONA_HUBS) {
    const blob = allStrings(g).join("\n");
    assert.ok(!/2027/.test(blob), `${g.key} must not invent a 2027 date`);
    assert.ok(!/\$\d/.test(blob), `${g.key} must not invent a ticket price`);
    assert.ok(
      !/\b(will feature|will play|is playing|lineup is)\b/i.test(blob),
      `${g.key} must not assert a future lineup`
    );
  }
  const arnold = personaHubByKey("arnold-car-show");
  assert.match(allStrings(arnold).join("\n"), /Unknown/);
  const hermit = personaHubByKey("hermitfest");
  assert.match(hermit.lead, /vary/i);
});

test("fixed copy obeys the voice rules", () => {
  for (const g of PERSONA_HUBS) {
    for (const s of allStrings(g)) {
      assert.ok(!s.includes("—"), `em dash in ${g.key}: ${s.slice(0, 60)}`);
      assert.ok(
        !/\b(knowledge base|our data|the database|my notes|our sources)\b/i.test(s),
        `internal-tooling reference in ${g.key}: ${s.slice(0, 60)}`
      );
    }
  }
});

test("isArnoldCarShowEvent matches Arnold car shows and no other", () => {
  assert.equal(
    isArnoldCarShowEvent({ name: "21st Arnold Classic Car Show", town: "Arnold" }),
    true
  );
  assert.equal(
    isArnoldCarShowEvent({ name: "Car Show & Chili Cookoff", town: "Arnold" }),
    true
  );
  assert.equal(
    isArnoldCarShowEvent({ name: "Car Show Setup", town: "Arnold" }),
    false
  );
  assert.equal(
    isArnoldCarShowEvent({ name: "Hot Copper Car Show", town: "Copperopolis" }),
    false
  );
  assert.equal(
    isArnoldCarShowEvent({ name: "Arnold 4th of July Parade", town: "Arnold" }),
    false
  );
});

test("isHermitfestEvent matches Bear Valley Hermitfest spellings and no other", () => {
  assert.equal(
    isHermitfestEvent({ name: "Hermitfest West – Music Festival", town: "Bear Valley" }),
    true
  );
  assert.equal(
    isHermitfestEvent({ name: "Hermit Fest 2026", town: "Bear Valley" }),
    true
  );
  assert.equal(
    isHermitfestEvent({ name: "Hermitfest West Lodge Special", town: "Bear Valley" }),
    true
  );
  assert.equal(
    isHermitfestEvent({ name: "Hermitfest West", town: "Arnold" }),
    false
  );
  assert.equal(
    isHermitfestEvent({ name: "Bear Valley Music Festival", town: "Bear Valley" }),
    false
  );
});

test("isBriceConcertEvent is live-music at Brice, not every Brice listing", () => {
  assert.equal(
    isBriceConcertEvent({
      name: "Hilltop Concert Series",
      town: "Murphys",
      venue_key: "brice-station",
      category: "live_music",
    }),
    true
  );
  assert.equal(
    isBriceConcertEvent({
      name: "Arnold Angels Music Festival",
      town: "Murphys",
      venue_key: "brice-station",
      category: "live_music",
    }),
    true
  );
  assert.equal(
    isBriceConcertEvent({
      name: "Sierra Circus Camp",
      town: "Murphys",
      venue_key: "brice-station",
      category: "kids",
    }),
    false
  );
  assert.equal(
    isBriceConcertEvent({
      name: "Hula Hoop Workshop @ Brice Station",
      town: "Murphys",
      venue_key: "brice-station",
      category: "other",
    }),
    false
  );
  assert.equal(
    isBriceConcertEvent({
      name: "Poor Man's Whiskey",
      town: "Murphys",
      venue_key: "ironstone-vineyards",
      category: "live_music",
    }),
    false
  );
  // Unkeyed but named Brice Station concert still belongs here.
  assert.equal(
    isBriceConcertEvent({
      name: "Live Music at Brice Station",
      town: "Murphys",
      venue_key: null,
      category: "live_music",
    }),
    true
  );
});

test("lookups resolve by town, event, and venue, and stay empty otherwise", () => {
  assert.equal(
    personaHubsForTown("arnold").map((g) => g.key).join(","),
    "arnold-car-show"
  );
  assert.equal(
    personaHubsForTown("bear-valley").map((g) => g.key).join(","),
    "hermitfest"
  );
  assert.equal(
    personaHubsForTown("murphys").map((g) => g.key).join(","),
    "brice-station-concerts"
  );
  assert.deepEqual(personaHubsForTown("copperopolis"), []);

  assert.equal(
    personaHubForEvent({
      name: "21st Arnold Classic Car Show",
      town: "Arnold",
      venue_key: "white-pines-lake-park",
      category: "live_music",
    })?.key,
    "arnold-car-show"
  );
  assert.equal(
    personaHubForEvent({
      name: "Bear Valley Music Festival",
      town: "Bear Valley",
      venue_key: "big-white-tent",
      category: "festival",
    }),
    null
  );

  assert.equal(personaHubForVenueKey("brice-station")?.key, "brice-station-concerts");
  assert.equal(personaHubForVenueKey("white-pines-lake-park")?.key, "arnold-car-show");
  assert.equal(personaHubForVenueKey("bear-valley-meadow")?.key, "hermitfest");
  assert.equal(personaHubForVenueKey("ironstone-vineyards"), null);
});

test("isPersonaHubEvent dispatches to the hub's own matcher", () => {
  const arnold = personaHubByKey("arnold-car-show");
  assert.equal(
    isPersonaHubEvent(arnold, {
      name: "21st Arnold Classic Car Show",
      town: "Arnold",
      venue_key: "white-pines-lake-park",
      category: "civic",
    }),
    true
  );
  assert.equal(
    isPersonaHubEvent(arnold, {
      name: "Hermitfest West",
      town: "Bear Valley",
      venue_key: "bear-valley-meadow",
      category: "festival",
    }),
    false
  );
});

test("matching is case and whitespace tolerant", () => {
  assert.equal(
    isArnoldCarShowEvent({ name: "21ST ARNOLD CLASSIC CAR SHOW", town: " arnold " }),
    true
  );
  assert.equal(
    isHermitfestEvent({ name: "HERMIT  FEST WEST", town: " bear valley " }),
    true
  );
});

test("the 2026 listing slugs are stable for a later seasonal-redirect append", () => {
  assert.equal(
    generateEventSlug("21st Arnold Classic Car Show", "2026-09-19", "Arnold"),
    "21st-arnold-classic-car-show-2026-09-19-arnold"
  );
  assert.equal(
    generateEventSlug("Hermitfest West Music Festival", "2026-09-13", "Bear Valley"),
    "hermitfest-west-music-festival-2026-09-13-bear-valley"
  );
});

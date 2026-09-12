// Regression lock for the evergreen Meet Me in Murphys guide
// (lib/meet-me-pages.ts, roadmap ticket HWY-38).
//
// Why it exists: "meet me in murphys" and "meet me in murphys 2026" sit
// in striking distance (positions ~5.9 / ~4.3) with almost no clicks, and
// the dated 2026 event URL cancelled. This year-less page is the durable
// landing spot. Facts come from the one hwy4_events row; blank beats wrong.
//
// Load-bearing here:
//   * the year-less path (the entire point)
//   * title/H1 matching the GSC queries
//   * the event matcher (name + town, no cross-town bleed)
//   * honesty: no invented next date, price, or future lineup
//   * the voice rules on fixed copy (no em dashes, Q&A resolves the question)
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MEET_ME_GUIDES,
  isMeetMeEvent,
  meetMeGuideForEvent,
  meetMeGuideForTown,
} from "../../lib/meet-me-pages.js";
import { generateEventSlug } from "../../lib/slugs.js";

function allStrings(g: (typeof MEET_ME_GUIDES)[number]): string[] {
  return [
    g.h1,
    g.lead,
    g.metaTitle,
    g.metaDescription,
    g.heading,
    g.blurb,
    g.listedAddress,
    g.listedDate,
    g.listedTime,
    ...g.editorial,
    ...g.qa.flatMap((item) => [item.q, item.a]),
  ];
}

test("guide is coherent: year-less path, wired town, enough copy", () => {
  assert.equal(MEET_ME_GUIDES.length, 1);
  const g = MEET_ME_GUIDES[0];
  assert.equal(g.path, "/meet-me-in-murphys");
  assert.ok(!/20\d\d/.test(g.path), "path must not embed a year");
  assert.equal(g.town, "Murphys");
  assert.equal(g.townSlug, "murphys");
  assert.ok(g.editorial.length >= 2);
  assert.ok(g.qa.length >= 4);
  assert.equal(g.listedStatus, "cancelled");
});

test("title and H1 match the GSC queries searchers actually type", () => {
  const g = MEET_ME_GUIDES[0];
  assert.match(g.h1, /Meet Me in Murphys/);
  assert.match(g.metaTitle, /Meet Me in Murphys/);
  assert.match(g.metaTitle, /2026/);
  assert.ok(g.metaTitle.length <= 70, `metaTitle too long (${g.metaTitle.length})`);
  assert.ok(
    g.metaDescription.length >= 70 && g.metaDescription.length <= 175,
    `metaDescription length ${g.metaDescription.length}`
  );
  // The lead is the search answer: what, when, where, status.
  assert.match(g.lead, /Meet Me in Murphys/);
  assert.match(g.lead, /September 5/);
  assert.match(g.lead, /236 Crestview/);
  assert.match(g.lead, /cancelled/i);
  assert.match(g.lead, /\bCA\b/);
});

test("the Q&A covers what, when, where, and the 2026 cancellation", () => {
  const g = MEET_ME_GUIDES[0];
  const qs = g.qa.map((i) => i.q.toLowerCase()).join(" | ");
  assert.match(qs, /what is meet me in murphys/);
  assert.match(qs, /when is meet me in murphys 2026/);
  assert.match(qs, /where/);
  assert.match(qs, /cancelled/);
});

test("every Q&A answer leads with the answer, not a restatement", () => {
  const g = MEET_ME_GUIDES[0];
  for (const { q, a } of g.qa) {
    assert.ok(a.length > 20, `answer too thin: ${q}`);
    const first = a.split(/(?<=\.)\s/)[0].trim();
    assert.ok(first.length > 0, `empty first sentence: ${q}`);
    assert.ok(
      !/^(well|so|great question|that depends|it depends|generally speaking)\b/i.test(first),
      `answer warms up instead of answering: ${q}`
    );
    const qCore = q.replace(/[?]/g, "").toLowerCase();
    assert.ok(first.toLowerCase() !== qCore, `answer restates the question: ${q}`);
  }
});

test("fixed copy does not invent a next date, a price, or a future lineup", () => {
  const g = MEET_ME_GUIDES[0];
  const blob = allStrings(g).join("\n");
  assert.ok(!/2027/.test(blob), "must not invent a 2027 date");
  assert.ok(!/\$\d/.test(blob), "must not invent a ticket price");
  // A future lineup claim would name an act without the cancelled-listing hedge.
  assert.ok(
    !/\b(will feature|will play|is playing|lineup is)\b/i.test(blob),
    "must not assert a future lineup"
  );
  assert.match(blob, /Unknown/);
  assert.match(blob, /cancelled/i);
});

test("fixed copy obeys the voice rules", () => {
  for (const g of MEET_ME_GUIDES) {
    for (const s of allStrings(g)) {
      assert.ok(!s.includes("—"), `em dash: ${s.slice(0, 60)}`);
      assert.ok(
        !/\b(knowledge base|our data|the database|my notes|our sources)\b/i.test(s),
        `internal-tooling reference: ${s.slice(0, 60)}`
      );
    }
  }
});

test("isMeetMeEvent matches its own listings and no other", () => {
  const g = MEET_ME_GUIDES[0];

  assert.equal(
    isMeetMeEvent(g, { name: "Meet Me in Murphys Summer Concert", town: "Murphys" }),
    true
  );
  // A later year under the same name still belongs on this page.
  assert.equal(
    isMeetMeEvent(g, { name: "Meet Me in Murphys", town: "Murphys" }),
    true
  );
  // Wrong town never matches.
  assert.equal(
    isMeetMeEvent(g, { name: "Meet Me in Murphys Summer Concert", town: "Arnold" }),
    false
  );
  // A different Murphys concert never matches.
  assert.equal(
    isMeetMeEvent(g, { name: "Music on the Rooftop", town: "Murphys" }),
    false
  );
});

test("lookups resolve by town slug and by event, and stay null otherwise", () => {
  assert.equal(meetMeGuideForTown("murphys")?.key, "meet-me-in-murphys");
  assert.equal(meetMeGuideForTown("arnold"), null);

  assert.equal(
    meetMeGuideForEvent({
      name: "Meet Me in Murphys Summer Concert",
      town: "Murphys",
    })?.key,
    "meet-me-in-murphys"
  );
  assert.equal(
    meetMeGuideForEvent({ name: "Bear Valley Music Festival", town: "Bear Valley" }),
    null
  );
});

test("the cancelled 2026 listing's computed slug is the seasonal-redirect source", () => {
  assert.equal(
    generateEventSlug("Meet Me in Murphys Summer Concert", "2026-09-05", "Murphys"),
    "meet-me-in-murphys-summer-concert-2026-09-05-murphys"
  );
});

test("matching is case and whitespace tolerant", () => {
  const g = MEET_ME_GUIDES[0];
  assert.equal(
    isMeetMeEvent(g, { name: "MEET ME IN MURPHYS SUMMER CONCERT", town: " murphys " }),
    true
  );
});

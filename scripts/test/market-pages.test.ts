// Regression lock for the evergreen farmers-market guide pages
// (lib/market-pages.ts, roadmap ticket HWY-31).
//
// Why they exist: "murphys farmers market" was the site's biggest un-captured
// audience (148 impressions, position 8.6), and what ranked for it was a DATED
// event-instance URL whose equity was split across seven live instances of the
// same weekly market and which expires every Sunday. These year-less pages are
// the durable landing spot, the same move the July 4th guides (HWY-6) and the
// venue hubs (HWY-9) made.
//
// Load-bearing here:
//   * the year-less path (the entire point)
//   * the event matcher, which must not cross the two markets (both are named
//     "... Farmers Market" and only the town separates them)
//   * the stated facts, because the lead sentence IS the search answer
//   * the voice rules on fixed copy (no em dashes, Q&A resolves the question)
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MARKET_GUIDES,
  isMarketEvent,
  marketGuideForEvent,
  marketGuideForTown,
} from "../../lib/market-pages.js";

function allStrings(g: (typeof MARKET_GUIDES)[number]): string[] {
  return [
    g.h1,
    g.lead,
    g.metaTitle,
    g.metaDescription,
    g.heading,
    g.blurb,
    ...g.editorial,
    ...g.qa.flatMap((item) => [item.q, item.a]),
  ];
}

test("guides are coherent: year-less paths, wired towns, enough copy", () => {
  assert.ok(MARKET_GUIDES.length >= 2);
  const paths = new Set<string>();
  for (const g of MARKET_GUIDES) {
    assert.ok(g.path.startsWith("/"), `${g.key} path`);
    // A dated path cannot inherit next season's searches. That is the bug.
    assert.ok(!/20\d\d/.test(g.path), `${g.key} path must not embed a year`);
    assert.ok(!paths.has(g.path), `${g.key} duplicate path`);
    paths.add(g.path);
    assert.ok(g.town.length > 0 && g.townSlug.length > 0, `${g.key} town`);
    assert.ok(g.editorial.length >= 2, `${g.key} editorial`);
    assert.ok(g.qa.length >= 4, `${g.key} qa`);
    assert.ok(g.venue.length > 0 && g.address.length > 0, `${g.key} venue/address`);
  }
});

test("the lead sentence states day, hours, venue and street address", () => {
  // The lead is what a search snippet or an answer engine lifts. If it stops
  // resolving the question, the page stops being worth ranking.
  for (const g of MARKET_GUIDES) {
    assert.ok(g.lead.includes(g.day), `${g.key} lead must name the day`);
    assert.ok(g.lead.includes(g.venue), `${g.key} lead must name the venue`);
    // Street number from the address, e.g. "505" / "1075".
    const streetNumber = g.address.match(/^\d+/)?.[0];
    assert.ok(streetNumber, `${g.key} address should start with a street number`);
    assert.ok(
      g.lead.includes(streetNumber!),
      `${g.key} lead must carry the street address`
    );
    assert.ok(/\bCA\b/.test(g.lead), `${g.key} lead must say CA`);
  }
});

test("meta titles and H1s carry the market name searchers actually type", () => {
  for (const g of MARKET_GUIDES) {
    assert.match(g.metaTitle, /Farmers Market/i, `${g.key} metaTitle`);
    assert.match(g.h1, /Farmers Market/i, `${g.key} h1`);
    assert.ok(g.metaTitle.includes(g.town), `${g.key} metaTitle must name the town`);
    assert.ok(g.h1.includes(g.town), `${g.key} h1 must name the town`);
    // Long titles get truncated in the SERP, which wastes the whole point.
    assert.ok(g.metaTitle.length <= 70, `${g.key} metaTitle too long (${g.metaTitle.length})`);
    assert.ok(
      g.metaDescription.length >= 70 && g.metaDescription.length <= 175,
      `${g.key} metaDescription length ${g.metaDescription.length}`
    );
  }
});

test("the Q&A covers when, where and admission", () => {
  // These are the three things every "<town> farmers market" search wants, and
  // the block is rendered visibly (not schema-only) so a reader gets them too.
  for (const g of MARKET_GUIDES) {
    const qs = g.qa.map((i) => i.q.toLowerCase()).join(" | ");
    assert.match(qs, /what day|what time|when/, `${g.key} needs a "when" question`);
    assert.match(qs, /where/, `${g.key} needs a "where" question`);
    assert.match(qs, /cost|admission|free|price/, `${g.key} needs an admission question`);
  }
});

test("every Q&A answer leads with the answer, not a restatement", () => {
  // The rule is that the FIRST sentence resolves the question, so a one-word
  // "Sunday." or "No." is the ideal shape, not a failure. What must not happen
  // is an answer that warms up, echoes the question back, or hedges before it
  // says anything (that is what stops an answer engine lifting it).
  for (const g of MARKET_GUIDES) {
    for (const { q, a } of g.qa) {
      assert.ok(a.length > 20, `${g.key} answer too thin: ${q}`);
      const first = a.split(/(?<=\.)\s/)[0].trim();
      assert.ok(first.length > 0, `${g.key} empty first sentence: ${q}`);
      assert.ok(
        !/^(well|so|great question|that depends|it depends|generally speaking)\b/i.test(first),
        `${g.key} answer warms up instead of answering: ${q}`
      );
      // An answer that opens by repeating the question resolves nothing.
      const qCore = q.replace(/[?]/g, "").toLowerCase();
      assert.ok(
        first.toLowerCase() !== qCore,
        `${g.key} answer restates the question: ${q}`
      );
      // Somewhere in the answer there has to be a concrete fact: a time, a day,
      // a street number, or a plain yes/no.
      assert.ok(
        /\b(AM|PM|Sunday|Friday|No\b|Yes\b|\d)/i.test(a),
        `${g.key} answer states nothing concrete: ${q}`
      );
    }
  }
});

test("fixed copy obeys the voice rules", () => {
  for (const g of MARKET_GUIDES) {
    for (const s of allStrings(g)) {
      assert.ok(!s.includes("—"), `em dash in ${g.key}: ${s.slice(0, 60)}`);
      // Never reference internal plumbing in public copy.
      assert.ok(
        !/\b(knowledge base|our data|the database|my notes|our sources)\b/i.test(s),
        `internal-tooling reference in ${g.key}: ${s.slice(0, 60)}`
      );
    }
  }
});

// The matcher. Both markets are named "... Farmers Market", so only the town
// separates them; crossing them would list Angels Camp dates on the Murphys page.
test("isMarketEvent matches its own market and no other", () => {
  const murphys = MARKET_GUIDES.find((g) => g.key === "murphys-farmers-market")!;
  const angels = MARKET_GUIDES.find((g) => g.key === "angels-camp-farmers-market")!;

  const murphysRow = { name: "Murphys Park Farmers Market", town: "Murphys" };
  const angelsRow = { name: "Angels Camp Farmers Market", town: "Angels Camp" };

  assert.equal(isMarketEvent(murphys, murphysRow), true);
  assert.equal(isMarketEvent(murphys, angelsRow), false, "must not cross towns");
  assert.equal(isMarketEvent(angels, angelsRow), true);
  assert.equal(isMarketEvent(angels, murphysRow), false);

  // The one-off "Murphys Certified Farmers Market (Opening Day)" listing is the
  // same market under another name, and should land on the same page.
  assert.equal(
    isMarketEvent(murphys, {
      name: "Murphys Certified Farmers Market (Opening Day)",
      town: "Murphys",
    }),
    true
  );

  // A non-market event in the same town never matches.
  assert.equal(
    isMarketEvent(murphys, { name: "Music on the Rooftop", town: "Murphys" }),
    false
  );
  // Nor does a craft/flea market, which is a different thing entirely.
  assert.equal(
    isMarketEvent(murphys, { name: "Memorial Day Weekend Flea Market", town: "Murphys" }),
    false
  );
});

test("lookups resolve by town slug and by event, and stay null otherwise", () => {
  assert.equal(marketGuideForTown("murphys")?.key, "murphys-farmers-market");
  assert.equal(marketGuideForTown("angels-camp")?.key, "angels-camp-farmers-market");
  assert.equal(marketGuideForTown("arnold"), null);

  assert.equal(
    marketGuideForEvent({ name: "Angels Camp Farmers Market", town: "Angels Camp" })?.key,
    "angels-camp-farmers-market"
  );
  assert.equal(
    marketGuideForEvent({ name: "Bear Valley Music Festival", town: "Bear Valley" }),
    null
  );
});

test("matching is case and whitespace tolerant", () => {
  const murphys = MARKET_GUIDES.find((g) => g.key === "murphys-farmers-market")!;
  assert.equal(isMarketEvent(murphys, { name: "MURPHYS PARK FARMERS MARKET", town: " murphys " }), true);
});

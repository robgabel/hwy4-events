// HWY-56: a weekday named next to "farmers market" has to match MARKET_GUIDES.
//
// The Murphys market is Sunday, 9 AM to 1 PM, at Murphys Community Park. A
// Saturday claim survived in the knowledge base (and the Murphys town page)
// after the guide was corrected, and the published venue blurb had the same
// miss. This locks the prose we ship in the repo. It does not scrape the
// database: the live blurb and local_facts row were already corrected.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MARKET_GUIDES,
  marketWeekdayMismatches,
} from "../../lib/market-pages.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

function assertNoMismatches(text: string, label: string, context?: { venue?: string; town?: string }) {
  const mismatches = marketWeekdayMismatches(text, context);
  assert.deepEqual(
    mismatches,
    [],
    `${label}: ${mismatches.map((m) => `${m.guideKey} says ${m.expected}, text says ${m.weekday} ("${m.excerpt}")`).join("; ")}`
  );
}

test("Murphys park blurb: Sunday matches, Saturday does not", () => {
  const context = { venue: "Murphys Community Park" };
  assertNoMismatches(
    "Shaded lawn along Murphys Creek. The farmers market sets up Sunday mornings, 9 AM to 1 PM.",
    "sunday blurb",
    context
  );
  // The venue string the town page and the KB actually use.
  assertNoMismatches(
    "The farmers market sets up Sunday mornings, 9 AM to 1 PM.",
    "sunday blurb, park alias",
    { venue: "Murphys Park" }
  );

  const wrong = marketWeekdayMismatches(
    "The farmers market sets up Saturday mornings, 9 AM to 1 PM.",
    context
  );
  assert.equal(wrong.length, 1);
  assert.equal(wrong[0].weekday, "Saturday");
  assert.equal(wrong[0].expected, "Sunday");
  assert.equal(wrong[0].guideKey, "murphys-farmers-market");
});

test("Angels Camp market is Friday, and a Saturday concert nearby is not the market", () => {
  assertNoMismatches(
    "The farmers market runs Friday evenings, 4:30 to 7:30 PM.",
    "angels blurb",
    { venue: "Utica Park" }
  );
  const wrong = marketWeekdayMismatches(
    "The Angels Camp Farmers Market runs Saturdays at Utica Park.",
  );
  assert.equal(wrong.length, 1);
  assert.equal(wrong[0].expected, "Friday");

  // Same sentence, two clocks. Only the weekday next to "farmers market" counts.
  assertNoMismatches(
    "The farmers market is Sunday mornings, and the concert series plays Saturday night.",
    "sunday market plus saturday concert",
    { venue: "Murphys Community Park" }
  );
});

test("a farmers-market weekday with no town or venue is not guessed", () => {
  assert.deepEqual(
    marketWeekdayMismatches("Come by the farmers market on Saturday."),
    []
  );
  assert.deepEqual(
    marketWeekdayMismatches("Murphys Community Park hosts a grape stomp the first Saturday in October."),
    []
  );
});

test("the guide copy agrees with its own day", () => {
  for (const g of MARKET_GUIDES) {
    const text = [
      g.lead,
      g.blurb,
      g.metaDescription,
      ...g.editorial,
      ...g.qa.flatMap((item) => [item.q, item.a]),
    ].join("\n");
    assertNoMismatches(text, g.key, { venue: g.venue, town: g.town });
  }
});

test("repo copy that states the Murphys market day matches the guide", () => {
  // These are the surfaces that kept saying Saturday after the guide moved
  // to Sunday. A published venue blurb lives in the database, not here.
  const files = [
    "docs/LOCAL-KNOWLEDGE-BASE.md",
    "docs/PERSONAS.md",
    "app/towns/town-content.ts",
  ];
  for (const rel of files) {
    assertNoMismatches(read(rel), rel);
  }
});

test("the knowledge base no longer teaches Saturday for the Murphys market", () => {
  const kb = read("docs/LOCAL-KNOWLEDGE-BASE.md");
  assert.doesNotMatch(kb, /NOT Sundays/);
  assert.match(kb, /Murphys (Park )?Farmers Market \(Sundays 9am/);
  assert.match(kb, /\*\*Sundays\*\*/);
  assert.match(kb, /Sunday farmers market in Murphys\b/);
});

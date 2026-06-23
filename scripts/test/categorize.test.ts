// Regression + precedence lock for the event categorizer (lib/categorize.ts).
//
// Two jobs:
//  1. classifyEventCategory output must not drift — the keyword token set + order
//     is the contract every scraper, the feed ingester, and /admin/submissions
//     depend on.
//  2. reconcileCategory must enforce the precedence the GoCalaveras + Facebook
//     scrapers rely on: an AUTHORITATIVE keyword beats the LLM; a SOFT keyword
//     may be upgraded by the LLM but never downgraded to "other".
//
// Run: `cd scripts && npm test`  (tsx --test, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyEventCategory,
  classifyEventCategoryDetailed,
  reconcileCategory,
} from "../../lib/categorize.js";

test("classify: representative cases (output contract is stable)", () => {
  assert.equal(classifyEventCategory("Live Music @ Stevenot Winery"), "live_music");
  assert.equal(classifyEventCategory("Acoustic trio on the patio"), "live_music");
  assert.equal(classifyEventCategory("Wine Wednesday tasting"), "wine");
  assert.equal(classifyEventCategory("Guided nature walk along the trail"), "hike_walk");
  assert.equal(classifyEventCategory("Hamlet at the Murphys Playhouse"), "fine_arts");
  assert.equal(classifyEventCategory("Storytime with Miss Debbie"), "kids");
  assert.equal(classifyEventCategory("Bingo Night at the Pourhouse"), "games");
  assert.equal(classifyEventCategory("Wheel throwing pottery class"), "fine_arts");
  assert.equal(classifyEventCategory("Spring Festival in the park"), "festival");
  assert.equal(classifyEventCategory("Town Council meeting"), "civic");
  assert.equal(classifyEventCategory("Blood drive at the Senior Center"), "civic");
  assert.equal(classifyEventCategory("Sunrise yoga session"), "other");
});

test("detailed: high-precision keywords are authoritative", () => {
  assert.equal(classifyEventCategoryDetailed("Bingo Night").authoritative, true);
  assert.equal(classifyEventCategoryDetailed("Opera gala").authoritative, true);
  assert.equal(classifyEventCategoryDetailed("Wine tasting").authoritative, true);
  assert.equal(classifyEventCategoryDetailed("Karaoke at the bar").authoritative, true);
  // soft signals are NOT authoritative — the LLM may still refine them
  assert.equal(classifyEventCategoryDetailed("Acoustic trio").authoritative, false);
  assert.equal(classifyEventCategoryDetailed("Community gathering").authoritative, false); // → other
});

test("reconcile: authoritative keyword beats a confident-wrong LLM", () => {
  // The exact bug this fixes: the LLM guessed a specific (wrong) category and
  // used to win, because the keyword floor only rescued "other".
  assert.equal(reconcileCategory(classifyEventCategoryDetailed("Bingo Night"), "civic"), "games");
  assert.equal(
    reconcileCategory(classifyEventCategoryDetailed("Opera in the Park"), "live_music"),
    "fine_arts",
  );
});

test("reconcile: soft keyword can be upgraded but never downgraded to other", () => {
  // Upgrade: keyword fell to "other", the LLM has a specific guess → take it.
  assert.equal(
    reconcileCategory(classifyEventCategoryDetailed("Annual Gathering"), "festival"),
    "festival",
  );
  // No downgrade: a specific (soft) keyword result survives an LLM "other".
  assert.equal(reconcileCategory(classifyEventCategoryDetailed("Acoustic trio set"), "other"), "live_music");
  // Junk / invalid LLM value is ignored; the keyword stands.
  assert.equal(reconcileCategory(classifyEventCategoryDetailed("Acoustic trio set"), "garbage"), "live_music");
  // No LLM at all → keyword stands.
  assert.equal(reconcileCategory(classifyEventCategoryDetailed("Bingo"), null), "games");
});

test("classify: venue boilerplate doesn't poison the category", () => {
  // "concert venue" is venue self-description, not an event signal — a comedy
  // night there is fine_arts, not live_music. (The Eugene Hult Center failure.)
  assert.equal(
    classifyEventCategory("Comedy Night at the foothills' most beautiful concert venue"),
    "fine_arts",
  );
  // A real concert is untouched (no venue-noun follows "concert").
  assert.equal(classifyEventCategory("Summer Concert in the Park"), "live_music");
});

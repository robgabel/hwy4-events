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
  assert.equal(classifyEventCategory("Angels Camp Candidates Night"), "civic");
  assert.equal(classifyEventCategory("Sunrise yoga session"), "other");
});

test("a candidates forum is civic even when held in a theatre", () => {
  // The live shape: /admin/submissions classifies on name + description, and
  // this event's venue IS a theatre while its ballot text is full of "board"
  // and "council". Before the civic_forum rule led the list, "theatre" (a
  // fine_arts token) claimed the whole event, because fine_arts sits above
  // civic and the soft civic rule never got a turn.
  const text =
    "Angels Camp Candidates Night. The Angels Camp Business Association hosts " +
    "Candidates Night at the Bret Harte Theatre, also known as the Elliott " +
    "Smart Theatre. City Council candidates and the high school district " +
    "governing board candidates answer predetermined questions.";
  assert.equal(classifyEventCategory(text), "civic");
  assert.equal(classifyEventCategoryDetailed(text).rule, "civic_forum");
  // Authoritative, so an LLM guessing "fine_arts" off the venue cannot win.
  assert.equal(reconcileCategory(classifyEventCategoryDetailed(text), "fine_arts"), "civic");
});

test("candidate-forum spelling variants all land on civic", () => {
  for (const name of [
    "Candidates Night",
    "Candidate's Night",
    "Candidates' Night",
    "Candidate Forum",
    "Candidates Forum",
    "Meet the Candidates",
  ]) {
    assert.equal(classifyEventCategory(name), "civic", name);
  }
});

test("civic_forum does not steal genuine theatre or music events", () => {
  // The rule leads the list, so it must be narrow enough that an ordinary
  // play or concert is untouched.
  assert.equal(classifyEventCategory("Hamlet at the Murphys Playhouse"), "fine_arts");
  assert.equal(classifyEventCategory("A Night at the Theatre"), "fine_arts");
  assert.equal(classifyEventCategory("Live music at the theatre"), "live_music");
  // A bare "Night" must not reach the rule; this was "other" before and after.
  assert.equal(classifyEventCategory("Opening Night gala"), "other");
  assert.equal(classifyEventCategory("Candidate information session"), "other");
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

test("classify: 'family' as a band-name suffix is not a kids signal", () => {
  // "Willie Nelson & Family" was classified kids off the band name
  // (2026-07-16 persona QA). The act-shaped usages are stripped…
  assert.equal(classifyEventCategory("Willie Nelson & Family – Murphys concert"), "live_music");
  assert.equal(classifyEventCategory("The Cowboy Family Band plays the saloon"), "live_music");
  assert.equal(
    classifyEventCategory("An evening of country, his Family lineup adding heart, live under the stars concert"),
    "live_music",
  );
  // …while genuine family/kids phrasing still routes to kids.
  assert.equal(classifyEventCategory("A Fun-Filled Family Day at the park"), "kids");
  assert.equal(classifyEventCategory("Fun for the whole family"), "kids");
});

test("classify: '& Family' strips even with no live-music token in the text", () => {
  // The real 2026-07-19 row: title + description carry no "concert"/"live"
  // token, so the broken "\b&" strip left "family" and kids fired. The fix
  // must land it anywhere but kids ("other" is fine; the scraper never writes
  // "other" over a specific stored category).
  const got = classifyEventCategory(
    "Willie Nelson & Family – Murphys",
    "Willie Nelson & Family play the Ironstone Amphitheatre in Murphys, an open-air evening of country and folk classics under the stars."
  );
  assert.notEqual(got, "kids");
});

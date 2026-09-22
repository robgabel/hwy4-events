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

// ─── HWY-47: amenity "live music" in a blurb must not steal the category ───

test("HWY-47: farmers market stays civic despite live-music amenity in description", () => {
  // Production: Murphys Park Farmers Market (6 upcoming rows). Title alone is
  // civic_strong; the creek-side blurb used to win via live_music_strong.
  assert.equal(classifyEventCategory("Murphys Park Farmers Market"), "civic");
  assert.equal(
    classifyEventCategory(
      "Murphys Park Farmers Market",
      "Come enjoy shopping your favorite local vendors while listening to live music by the creek.",
    ),
    "civic",
  );
  const detailed = classifyEventCategoryDetailed(
    "Murphys Park Farmers Market",
    "Come enjoy shopping your favorite local vendors while listening to live music by the creek.",
  );
  assert.equal(detailed.category, "civic");
  assert.equal(detailed.rule, "civic_strong");
});

test("HWY-47: car show stays civic despite live-music amenity in description", () => {
  // Production: 21st Arnold Classic Car Show — Jen's homepage badge bug.
  assert.equal(classifyEventCategory("21st Arnold Classic Car Show"), "civic");
  assert.equal(
    classifyEventCategory(
      "21st Arnold Classic Car Show",
      "Food vendors and live music have been staples of past events.",
    ),
    "civic",
  );
});

test("HWY-47: Oktoberfest is festival, not live_music (or kids via family-friendly)", () => {
  // Production: Oktoberfest @ Murphys Creek Park. `\bfest\b` cannot see inside
  // "Oktoberfest"; festival_strong covers the compound. family-friendly in the
  // blurb must not steal into kids once live_music is demoted.
  assert.equal(
    classifyEventCategory(
      "Oktoberfest @ Murphys Creek Park",
      "Join us for local craft beer, bratwurst, live music, and family-friendly activities.",
    ),
    "festival",
  );
  const detailed = classifyEventCategoryDetailed(
    "Oktoberfest @ Murphys Creek Park",
    "Join us for local craft beer, bratwurst, live music, and family-friendly activities.",
  );
  assert.equal(detailed.rule, "festival_strong");
  assert.equal(detailed.authoritative, true);
});

test("HWY-47: title-carried live music / open mic / karaoke stay live_music", () => {
  // Genuine music listings — the signal is in the title, so amenity demotion
  // must not touch them. Assert keep-matching as hard as the stop-matching above.
  assert.equal(classifyEventCategory("Live Music @ Prospect 772"), "live_music");
  assert.equal(
    classifyEventCategoryDetailed("Live Music @ Prospect 772").rule,
    "live_music_strong",
  );
  assert.equal(
    classifyEventCategoryDetailed("Live Music @ Prospect 772").authoritative,
    true,
  );
  assert.equal(
    classifyEventCategory("Open Mic @ Val du Vino Music Barn"),
    "live_music",
  );
  assert.equal(
    classifyEventCategory("Karaoke at The Murphys Irish Pub"),
    "live_music",
  );
  // Title signal beats a civic-looking description.
  assert.equal(
    classifyEventCategory(
      "Live Music @ Prospect 772",
      "Bring the whole family for a night on the patio.",
    ),
    "live_music",
  );
  // Soft title signal (concert / band) still classifies live_music.
  assert.equal(classifyEventCategory("Summer Concert in the Park"), "live_music");
  // "Live at The Lube: Hit Replay" has no strong/soft keyword today (other);
  // scrapers/LLM may upgrade. Locked so HWY-47 does not invent a new title rule.
  assert.equal(
    classifyEventCategory("Live at The Lube: Hit Replay", "Classic rock covers."),
    "other",
  );
});

test("HWY-47: description-only non-amenity live music is soft, not authoritative", () => {
  // A bare "live music" claim in prose (not amenity phrasing) defers so a
  // later rule can win; with no later rule it still lands live_music, soft.
  const deferred = classifyEventCategoryDetailed(
    "Evening on the Patio",
    "There will be live music tonight under the oaks.",
  );
  assert.equal(deferred.category, "live_music");
  assert.equal(deferred.rule, "live_music_strong");
  assert.equal(deferred.authoritative, false);
  // Soft → LLM may retype; authoritative title claim may not.
  assert.equal(reconcileCategory(deferred, "civic"), "civic");
  assert.equal(
    reconcileCategory(classifyEventCategoryDetailed("Live Music Night"), "civic"),
    "live_music",
  );
});

test("HWY-47: amenity live music alone does not classify the event as live_music", () => {
  // Amenity phrasing is stripped from the description score — with no other
  // signal the row stays other (never live_music from a host-music blurb).
  assert.equal(
    classifyEventCategory(
      "Community Picnic at Utica Park",
      "Bring a blanket. Food trucks and live music by the bandstand.",
    ),
    "other",
  );
  assert.equal(
    classifyEventCategory(
      "Annual Chili Cookoff",
      "Vendors, games, and live music, plus awards at 3pm.",
    ),
    "other",
  );
});

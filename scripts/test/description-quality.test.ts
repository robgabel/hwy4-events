// Regression lock for the description quality gate (lib/description-quality.ts).
//
// Fixtures are the real failures from the June 9 2026 AI-detection audit:
// calendar-widget junk (Native Sons / Coffee & Cars), a colon-terminated stub
// (Bingo), an LLM title-restatement (archery), and a legit long-ish description
// that must PASS (Forest School). Plus the meta-truncation "for purc" tell.
//
// Run: `cd scripts && npm test`  (tsx --test, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeDescription,
  sanitizeDescriptionDetailed,
  assessDescription,
  displayDescription,
  truncateMeta,
} from "../../lib/description-quality.js";

// --- Real calendar-widget junk (EventON) -----------------------------------
const NATIVE_SONS = `@



Please join us on the 3rd Sunday of the month for a fantastic all you can eat pancake breakfast. Breakfast includes pancakes, scrambled eggs, sausage, biscuits with sausage gravy, OJ, coffee, or hot chocolate.

$12 Cash Only Adults, $5 Kids under 12. Breakfast open From 7:30 - 11:30 AM.

389 Main Street, Murphys


 Add to calendar

 Google Calendar
 iCalendar
 Outlook 365
 Outlook Live

 Details

 Date:

 Time:`;

test("sanitize: strips calendar-widget chrome but keeps the real prose", () => {
  const out = sanitizeDescription(NATIVE_SONS);
  // Real content survives.
  assert.match(out, /pancake breakfast/);
  assert.match(out, /\$12 Cash Only Adults/);
  // Widget chrome is gone.
  for (const junk of [
    "Add to calendar",
    "Google Calendar",
    "iCalendar",
    "Outlook 365",
    "Outlook Live",
    "Date:",
    "Time:",
  ]) {
    assert.ok(!out.includes(junk), `should strip "${junk}"`);
  }
  // Leading orphan "@" line is gone; no 3+ blank-line runs remain.
  assert.ok(!out.startsWith("@"));
  assert.ok(!/\n{3,}/.test(out));
});

test("sanitize: heavily-stripped junk row still renders (content is good)", () => {
  const { strippedRatio } = sanitizeDescriptionDetailed(NATIVE_SONS);
  assert.ok(strippedRatio > 0.3, "widget rows trip the >30% stripped signal");
  // But the cleaned remainder is good, so we show it, not suppress it.
  assert.notEqual(
    displayDescription({
      description: NATIVE_SONS,
      name: "Native Sons 3rd Sunday Pancake Breakfast",
      venue_name: "Native Sons Hall",
      town: "Murphys",
    }),
    null,
  );
});

test("sanitize: empty/undefined is safe", () => {
  assert.equal(sanitizeDescription(null), "");
  assert.equal(sanitizeDescription(undefined), "");
  assert.equal(sanitizeDescription("   \n  \n"), "");
});

// --- Suppress cases ---------------------------------------------------------
test("suppress: colon-terminated boilerplate (Bingo)", () => {
  const text =
    "Bingo Night is back at the Murphys Pourhouse and we have a packed calendar coming together for everyone. Consider this your early heads-up on some of our 2026 events:";
  const a = assessDescription(text, "Bingo Night at Murphys Pourhouse", "Murphys Pourhouse");
  assert.equal(a.verdict, "suppress");
  assert.ok(a.reasons.includes("ends_with_colon"));
});

test("suppress: LLM title-restatement that only adds a date (archery)", () => {
  const text =
    "An archery shooting event held at Bear Valley Mountain Resort. The event runs June 13-14, 2026.";
  const a = assessDescription(text, "High Sierra Archery", "Bear Valley Mountain Resort", {
    town: "Bear Valley",
  });
  assert.equal(a.verdict, "suppress");
  assert.ok(a.reasons.includes("title_restatement"));
  assert.equal(
    displayDescription({
      description: text,
      name: "High Sierra Archery",
      venue_name: "Bear Valley Mountain Resort",
      town: "Bear Valley",
    }),
    null,
  );
});

test("suppress: under 15 words", () => {
  const a = assessDescription("Bingo. Doors open 5:30pm", "Bingo", "Ebbetts Pass Moose Lodge");
  assert.equal(a.verdict, "suppress");
  assert.ok(a.reasons.some((r) => r.startsWith("too_short")));
});

test("suppress: pure exclamatory hype, nothing concrete", () => {
  const text =
    "You really have to come out and join us for the best time ever, it is going to be amazing and so much fun for everyone who shows up!";
  const a = assessDescription(text, "Summer Bash", "The Lot");
  assert.equal(a.verdict, "suppress");
  assert.ok(a.reasons.includes("generic_hype"));
});

test("suppress: no terminal punctuation (looks truncated)", () => {
  const a = assessDescription(
    "Join us downtown this weekend for a full slate of music and food and family activities all day long",
    "Street Fair",
    "Main Street",
  );
  assert.equal(a.verdict, "suppress");
  assert.ok(a.reasons.includes("no_terminal_punctuation"));
});

// --- Pass cases -------------------------------------------------------------
const FOREST_SCHOOL =
  "It's that time of year again! Forest School Adventure Camp is running at White Pines this summer under a new brand name, Sugar Pine! As always, children are invited to do more than just crafts or typical summer camp activities. They're invited to wonder, explore, experiment, create, and connect with the natural world in meaningful ways. Our STEAM-powered arts and crafts classes and nature-based camps blend science, art, engineering, storytelling, and outdoor exploration into hands-on experiences designed to spark curiosity and creativity. Whether campers are examining dragonflies at the lake, watercoloring wildflowers, building flight challenges inspired by birds, or exploring forest trails, children are encouraged to slow down, ask questions, and learn through discovery and play.";

test("pass: legit organizer description (Forest School) renders", () => {
  const a = assessDescription(FOREST_SCHOOL, "Forest School Adventure Camp", "White Pines Community Park");
  assert.equal(a.verdict, "pass");
  assert.equal(
    displayDescription({
      description: FOREST_SCHOOL,
      name: "Forest School Adventure Camp",
      venue_name: "White Pines Community Park",
      town: "Arnold",
    }),
    FOREST_SCHOOL,
  );
});

test("pass: short-but-specific description with logistics", () => {
  const text =
    "Newsome Harlow pours its new releases on the patio Saturday afternoon with the Gilpin Trio playing bluegrass from 2pm. Bring a picnic; kids and dogs welcome.";
  assert.equal(assessDescription(text, "Patio Pour", "Newsome Harlow").verdict, "pass");
});

test("rewrite: over-long but usable still renders (not suppressed)", () => {
  const text =
    "The Calaveras County Fair returns to Frogtown with four days of rodeo, carnival rides, livestock shows, and live music on three stages. ".repeat(
      10,
    );
  const a = assessDescription(text.trim(), "Calaveras County Fair", "Frogtown");
  assert.equal(a.verdict, "rewrite");
  assert.ok(a.reasons.some((r) => r.startsWith("too_long")));
  assert.notEqual(
    displayDescription({ description: text, name: "Calaveras County Fair", venue_name: "Frogtown" }),
    null,
  );
});

// --- Meta truncation --------------------------------------------------------
test("truncateMeta: short text is returned unchanged", () => {
  assert.equal(truncateMeta("Live music on the patio tonight."), "Live music on the patio tonight.");
});

test("truncateMeta: prefers a full sentence boundary", () => {
  const input =
    "Tickets for the summer concert series go on sale this Friday at noon sharp. Each show includes two opening acts and a headliner plus food trucks in the lot.";
  const out = truncateMeta(input);
  assert.ok(out.length <= 155);
  assert.ok(out.endsWith("."));
  assert.equal(out, "Tickets for the summer concert series go on sale this Friday at noon sharp.");
});

test("truncateMeta: never ends mid-word (kills the 'for purc' tell)", () => {
  const input =
    "Tickets are available now for purchase at the door or online through our website and we strongly recommend buying yours early because this popular community event sells out fast.";
  const out = truncateMeta(input);
  assert.ok(out.length <= 156);
  assert.ok(out.endsWith("…"));
  const stem = out.slice(0, -1);
  assert.ok(input.startsWith(stem), "truncation is an exact prefix of the source");
  // The character right after the kept stem is a space => we cut on a word boundary.
  assert.equal(input[stem.length], " ");
  assert.ok(!out.includes("purc "), "did not cut mid-word into 'purc'");
});

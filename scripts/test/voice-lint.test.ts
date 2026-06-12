// Fixture tests for the voice lint (lib/voice-lint.ts) + a guard that the real
// shipped content (town pages, FAQ, About) carries zero hard-fail violations.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lintPage,
  lintDuplicatePhrases,
  lintAll,
  HARD_FAIL_RULES,
} from "../../lib/voice-lint.js";
import { collectSources } from "../voice-lint.js";

const rulesOf = (text: string) => lintPage("p", text).map((v) => v.rule);

test("BANNED_PHRASE: catches banned marketing phrases", () => {
  assert.ok(rulesOf("This spot punches above its weight.").includes("BANNED_PHRASE"));
  assert.ok(rulesOf("A nestled hidden gem.").includes("BANNED_PHRASE"));
  assert.ok(rulesOf("the most complete listing").includes("BANNED_PHRASE"));
});

test("BANNED_PHRASE: 'elevation' does NOT false-trip the 'elevate' rule", () => {
  assert.ok(!rulesOf("Bear Valley sits at 7,000 feet of elevation.").includes("BANNED_PHRASE"));
});

test("HUMANITY_CLAIM: catches claims/denials of being human", () => {
  assert.ok(rulesOf("Written to sound like a neighbor, not a robot.").includes("HUMANITY_CLAIM"));
  assert.ok(rulesOf("This is a real human writing, not a machine.").includes("HUMANITY_CLAIM"));
});

test("LEAK: catches editorial asides and TODOs", () => {
  assert.ok(rulesOf("Green fairways. (Rob: pull this if it gets busy.)").includes("LEAK"));
  assert.ok(rulesOf("Great patio. TODO: confirm hours.").includes("LEAK"));
});

test("CONTRAST_OVERUSE: warns above 1 per page", () => {
  const r = rulesOf("Open Friday, not Monday. Beer, not wine. Locals, not tourists.");
  assert.ok(r.includes("CONTRAST_OVERUSE"));
  // exactly one is fine
  assert.ok(!rulesOf("We pour beer, not wine, on the patio.").includes("CONTRAST_OVERUSE"));
});

test("SPACKLE_OVERUSE: warns above 2 sincerity words", () => {
  assert.ok(rulesOf("It is actually genuinely truly worth it.").includes("SPACKLE_OVERUSE"));
  assert.ok(!rulesOf("It is actually genuinely good.").includes("SPACKLE_OVERUSE"));
});

test("YES_YES: warns above 1 rhetorical 'And yes' move", () => {
  assert.ok(rulesOf("And yes, dogs welcome. And yes, kids too.").includes("YES_YES"));
  assert.ok(!rulesOf("And yes, dogs are welcome here.").includes("YES_YES"));
});

test("EXCLAIM + EMDASH: warn on our-copy punctuation", () => {
  assert.ok(rulesOf("Come on out!").includes("EXCLAIM"));
  assert.ok(rulesOf("Great patio — quiet too.").includes("EMDASH"));
});

test("rules filter: error-only pass skips warn rules (About mode)", () => {
  const errorOnly = new Set(["BANNED_PHRASE", "HUMANITY_CLAIM", "LEAK"]);
  const vs = lintPage("about", "Come on out! Beer, not wine, not soda. (Rob: fix)", errorOnly);
  assert.deepEqual(
    vs.map((v) => v.rule).sort(),
    ["LEAK"],
    "only the error rule fires when warn rules are filtered out",
  );
});

test("DUP_PHRASE_SITEWIDE: flags a 4-gram on >=3 pages, not on 2", () => {
  const onThree = lintDuplicatePhrases([
    { page: "a", text: "near big trees state park today" },
    { page: "b", text: "visit big trees state park soon" },
    { page: "c", text: "the big trees state park trail" },
  ]);
  assert.ok(onThree.some((v) => v.rule === "DUP_PHRASE_SITEWIDE"));

  const onTwo = lintDuplicatePhrases([
    { page: "a", text: "near big trees state park today" },
    { page: "b", text: "visit big trees state park soon" },
  ]);
  assert.equal(onTwo.length, 0);
});

test("clean voice-compliant text produces no violations", () => {
  assert.deepEqual(
    lintPage("p", "Newsome Harlow pours new releases on the patio Saturday from 2pm. Bring a picnic; dogs welcome."),
    [],
  );
});

test("shipped site content (towns + FAQ + About) has zero hard-fail violations", () => {
  const errors = lintAll(collectSources()).filter((v) => HARD_FAIL_RULES.has(v.rule));
  assert.equal(
    errors.length,
    0,
    "hard-fail voice violations in shipped content:\n" +
      errors.map((e) => `  [${e.rule}] ${e.page}: ${e.excerpt}`).join("\n"),
  );
});

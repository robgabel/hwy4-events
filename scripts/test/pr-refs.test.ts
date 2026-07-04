// Regression lock for parseBuiltRefs (lib/tasks.ts) — the parser the auto-Done
// webhook (/api/tasks/pr-merged) uses to find which Roadmap tickets a merged PR
// closes. The whole git-linking loop rides on this, so pin its behavior.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBuiltRefs } from "../../lib/tasks.js";

test("parseBuiltRefs pulls a single 'Builds HWY-N' ref", () => {
  assert.deepEqual(parseBuiltRefs("Adds the widget.\n\nBuilds HWY-42\n"), ["HWY-42"]);
});

test("parseBuiltRefs is case-insensitive on the keyword and upper-cases the ref", () => {
  assert.deepEqual(parseBuiltRefs("builds hwy-7"), ["HWY-7"]);
  assert.deepEqual(parseBuiltRefs("BUILD HWY-3"), ["HWY-3"]);
});

test("parseBuiltRefs collects multiple distinct refs and dedupes", () => {
  assert.deepEqual(parseBuiltRefs("Builds HWY-1 and also Builds HWY-2. Builds HWY-1 again."), ["HWY-1", "HWY-2"]);
});

test("parseBuiltRefs ignores a bare ref not preceded by build/builds", () => {
  assert.deepEqual(parseBuiltRefs("Related to HWY-99 but does not close it."), []);
  assert.deepEqual(parseBuiltRefs("See HWY-5 for context."), []);
});

test("parseBuiltRefs returns [] on empty / null / no ref", () => {
  assert.deepEqual(parseBuiltRefs(""), []);
  assert.deepEqual(parseBuiltRefs(null), []);
  assert.deepEqual(parseBuiltRefs(undefined), []);
  assert.deepEqual(parseBuiltRefs("Just a normal PR with no ticket."), []);
});

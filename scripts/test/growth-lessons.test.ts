// Regression lock for the growth agent's lesson distillation (lib/agent/growth-lessons.ts,
// Roadmap ticket HWY-5). experimentToLesson turns a concluded experiment into the
// one-line memory the weekly memo reads back, so pin its verdict wording and its
// "not lesson-worthy yet" cases (running / abandoned / no result).
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { experimentToLesson } from "../../lib/agent/growth-lessons.js";

const base = { id: "e1", name: "Newsletter box on event pages", metric: "net adds/wk", result: "net went 1 to 7" };

test("a won experiment becomes a 'Worked' lesson with the metric", () => {
  assert.equal(
    experimentToLesson({ ...base, status: "won" }),
    "Worked: Newsletter box on event pages. net went 1 to 7 (metric: net adds/wk)"
  );
});

test("a lost experiment with no metric becomes a 'Did not work' lesson", () => {
  assert.equal(
    experimentToLesson({ id: "e2", name: "Poster QR cards", metric: null, status: "lost", result: "no scans in 30d" }),
    "Did not work: Poster QR cards. no scans in 30d"
  );
});

test("an inconclusive experiment becomes an 'Unclear' lesson", () => {
  assert.equal(experimentToLesson({ ...base, status: "inconclusive" })?.startsWith("Unclear:"), true);
});

test("not lesson-worthy: abandoned, still running, or no result written yet -> null", () => {
  assert.equal(experimentToLesson({ ...base, status: "abandoned" }), null);
  assert.equal(experimentToLesson({ ...base, status: "running" }), null);
  assert.equal(experimentToLesson({ ...base, status: "won", result: null }), null);
  assert.equal(experimentToLesson({ ...base, status: "won", result: "   " }), null);
});

test("name/result whitespace is trimmed", () => {
  assert.equal(
    experimentToLesson({ id: "e3", name: "  Trimmed  ", metric: null, status: "won", result: "  did a thing  " }),
    "Worked: Trimmed. did a thing"
  );
});

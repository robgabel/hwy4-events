// Regression lock for the pure core of the Roadmap-board task proposer
// (lib/agent/propose-tasks.ts, PRD-roadmap-board.md Phase 2). The LLM extraction
// and DB dedup are integration concerns, but the JSON coercion (defaults, caps,
// dropping title-less rows) and the title-collision test (which stops a daily
// reasoner refiling the same idea) are pure and worth pinning.
//
// Run: `cd scripts && npm test`  (tsx --test, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseExtractedTasks, titlesCollide } from "../../lib/agent/propose-tasks.js";

test("parseExtractedTasks parses a fenced JSON array and keeps valid enums", () => {
  const text = "```json\n" +
    JSON.stringify([
      { title: "Add a /free filter to town pages", body: "spec", type: "feature", priority: "p1", rationale: "why" },
    ]) +
    "\n```";
  const out = parseExtractedTasks(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Add a /free filter to town pages");
  assert.equal(out[0].type, "feature");
  assert.equal(out[0].priority, "p1");
});

test("parseExtractedTasks defaults invalid type/priority (chore/p3) and drops title-less rows", () => {
  const out = parseExtractedTasks(
    JSON.stringify([
      { title: "Fix stale price on Ironstone Sundays", type: "nonsense", priority: "urgent" },
      { body: "no title here", type: "bug", priority: "p0" },
    ])
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "chore");
  assert.equal(out[0].priority, "p3");
  assert.equal(out[0].body, ""); // missing body coerces to empty string
});

test("parseExtractedTasks returns [] on non-array / junk / empty", () => {
  assert.deepEqual(parseExtractedTasks("not json at all"), []);
  assert.deepEqual(parseExtractedTasks('{"title":"an object not an array"}'), []);
  assert.deepEqual(parseExtractedTasks("[]"), []);
  assert.deepEqual(parseExtractedTasks(""), []);
});

test("parseExtractedTasks caps at the max (precision over volume)", () => {
  const many = JSON.stringify(
    Array.from({ length: 5 }, (_, i) => ({ title: `Task number ${i}`, type: "chore", priority: "p2" }))
  );
  assert.equal(parseExtractedTasks(many).length, 2); // default MAX_PER_RUN
  assert.equal(parseExtractedTasks(many, 4).length, 4);
});

test("titlesCollide catches re-wordings of the same idea, not distinct tickets", () => {
  // Same idea, reworded → collide (so a daily reasoner won't refile it).
  assert.equal(titlesCollide("Add a /free filter to town pages", "Add free filter on town pages"), true);
  assert.equal(titlesCollide("Fix stale Ironstone price", "Fix the stale Ironstone price bug"), true);
  // Genuinely different work → do not collide.
  assert.equal(titlesCollide("Add a /free filter to town pages", "Build a QA audit cron for broken links"), false);
  // Degenerate inputs never collide.
  assert.equal(titlesCollide("", "anything"), false);
});

// Regression lock for the pure core of the KB capture loop (lib/local-facts.ts).
// computeWasEdited decides whether a human Save was a verbatim accept or a real
// correction — the signal the whole loop exists to capture — so its null/false/
// true distinction is worth pinning, especially the whitespace-insensitivity.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWasEdited, selectBlurbBackfill } from "../../lib/local-facts.js";

test("computeWasEdited returns null when there was no AI draft to compare", () => {
  // A from-scratch human blurb: "edited" is meaningless, so null (not false).
  assert.equal(computeWasEdited(null, "A human-written blurb."), null);
});

test("computeWasEdited is false when the human kept the AI draft verbatim", () => {
  assert.equal(computeWasEdited("Same text.", "Same text."), false);
  // Whitespace-only differences (trailing newline, leading spaces) are not edits.
  assert.equal(computeWasEdited("Same text.", "  Same text.\n"), false);
  assert.equal(computeWasEdited("  Padded.  ", "Padded."), false);
});

test("computeWasEdited is true when the human changed the AI draft", () => {
  assert.equal(computeWasEdited("AI draft.", "Human-corrected draft."), true);
  // A real content change, not just whitespace.
  assert.equal(computeWasEdited("Open daily.", "Open most days."), true);
});

test("selectBlurbBackfill picks only published-blurb venues with no active fact", () => {
  const venues = [
    { venue_key: "captured", blurb: "Already recorded." },
    { venue_key: "uncaptured", blurb: "  Published, never captured.  " },
    { venue_key: "no-blurb", blurb: null },
    { venue_key: "blank-blurb", blurb: "   " },
  ];
  const out = selectBlurbBackfill(venues, new Set(["captured"]));
  // Only the uncaptured published blurb survives, trimmed for insertion.
  assert.deepEqual(out, [
    { venue_key: "uncaptured", blurb: "Published, never captured." },
  ]);
});

test("selectBlurbBackfill is a no-op when every blurb is already captured", () => {
  const venues = [{ venue_key: "a", blurb: "Done." }];
  assert.deepEqual(selectBlurbBackfill(venues, new Set(["a"])), []);
});

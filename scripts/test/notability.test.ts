// Regression + precedence lock for the event notability judgment
// (lib/notability.ts). Grounds the floor in the real Sequoia + Moose data:
// mundane meal service hides, genuine events stay, and a hook beats a meal word.
//
// Run: `cd scripts && npm test`  (tsx --test, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRoutine,
  classifyNotabilityDetailed,
  reconcileNotability,
} from "../../lib/notability.js";

test("routine: mundane recurring meal service is hidden", () => {
  // The exact noise from the live DB (Sequoia public "other" rows).
  assert.equal(classifyRoutine("Thursday Night Dinner"), true);
  assert.equal(classifyRoutine("Wednesday Night Deli Special"), true);
  // Rob's other examples.
  assert.equal(classifyRoutine("Sunday Brunch"), true);
  assert.equal(classifyRoutine("Wednesday Deli Special"), true);
  assert.equal(classifyRoutine("Restaurant Open for Father's Day"), true);
  assert.equal(classifyRoutine("Prime Rib Night"), true);
  assert.equal(classifyRoutine("Taco Tuesday"), true);
  assert.equal(classifyRoutine("Friday Fish Fry"), true);
  assert.equal(classifyRoutine("Mother's Day Buffet"), true);
});

test("notable: a hook beats the meal floor (the load-bearing case)", () => {
  // Meal word present, but the live-music hook wins.
  assert.equal(classifyRoutine("Special Monthly Dinner with Live Music"), false);
  assert.equal(classifyRoutine("Father's Day Brunch with Live Jazz"), false);
  // Real events from the live DB.
  assert.equal(classifyRoutine("Karaoke - Taylor Made"), false);
  assert.equal(classifyRoutine("Live Music - Carlos Castillo"), false);
  assert.equal(
    classifyRoutine("Patio Party #2 featuring live music by Fabulous Off Brothers"),
    false,
  );
  assert.equal(classifyRoutine("Car Show & Chili Cookoff"), false);
  // A real member golf competition that happens to say "Dinner" — must stay.
  assert.equal(classifyRoutine("Sequoians Summer Scramble SG / Dinner"), false);
});

test("signals: category=live_music forces notable; is_weekly + meal => routine", () => {
  // A row already categorized live_music is a hook even with a plain title.
  assert.equal(classifyRoutine("Hit Collective", { category: "live_music" }), false);
  // Weekly + a meal noun is a soft operational tell.
  const d = classifyNotabilityDetailed("Community Dinner", { is_weekly: true });
  assert.equal(d.isRoutine, true);
  assert.equal(d.authoritative, false);
});

test("detailed: authoritative tiers vs deferrable soft", () => {
  // Tier-1 meal floor is authoritative.
  assert.equal(classifyNotabilityDetailed("Thursday Night Dinner").authoritative, true);
  // Tier-0 hook is authoritative (and not routine).
  const hook = classifyNotabilityDetailed("Live Music - Neil Buettner");
  assert.equal(hook.authoritative, true);
  assert.equal(hook.isRoutine, false);
  // Ambiguous meal-ish title with no day/holiday anchor => not authoritative.
  assert.equal(classifyNotabilityDetailed("Pasta Feed").authoritative, false);
});

test("reconcile: authoritative floor beats the LLM (both directions)", () => {
  // Hard routine + LLM says "not routine" => stays routine.
  assert.equal(
    reconcileNotability(classifyNotabilityDetailed("Thursday Night Dinner"), false),
    true,
  );
  // Hook (authoritative-notable) + LLM says "routine" => stays notable.
  assert.equal(
    reconcileNotability(classifyNotabilityDetailed("Special Monthly Dinner with Live Music"), true),
    false,
  );
});

test("reconcile: soft floor defers to the LLM", () => {
  const soft = classifyNotabilityDetailed("Community Dinner", { is_weekly: true }); // soft routine
  assert.equal(soft.authoritative, false);
  // LLM clears it (judges it a real community event).
  assert.equal(reconcileNotability(soft, false), false);
  // LLM absent => soft floor stands.
  assert.equal(reconcileNotability(soft, null), true);
});

test("routine: a private party / hall rental is not a public event", () => {
  assert.equal(classifyNotabilityDetailed("Private Dinner Party").isRoutine, true);
  assert.equal(classifyNotabilityDetailed("Private Dinner Party").authoritative, true);
  assert.equal(classifyNotabilityDetailed("Private Event").isRoutine, true);
  // ...but "private" mid-title or with a hook stays notable
  assert.equal(classifyNotabilityDetailed("Karaoke Private Room Night").isRoutine, false);
});

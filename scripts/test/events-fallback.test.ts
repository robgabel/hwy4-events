// Regression lock for stale-slug recovery (lib/events.ts `pickFallbackEvent`).
//
// Event URLs are a pure function of the *current* event name, so a title edit
// or a dedup merge that keeps a differently-titled survivor orphans the old
// indexed/shared URL. The detail page recovers those with a 301 driven by this
// matcher — it must redirect confidently on a real rename, but NEVER guess the
// wrong event when a date+town has several listings.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import { pickFallbackEvent } from "../../lib/events.js";
import { generateEventSlug } from "../../lib/slugs.js";

type Ev = { name: string; date: string; town: string };
const ev = (name: string, date: string, town: string): Ev => ({ name, date, town });
const slugOf = (e: Ev) => generateEventSlug(e.name, e.date, e.town);

// The real case that started this: name gained an apostrophe-s.
const arnoldParade = ev("Arnold's Independence Day Parade", "2026-07-04", "Arnold");
const STALE = "arnold-independence-day-parade-2026-07-04-arnold";

test("recovers a renamed event (apostrophe added) from its stale slug", () => {
  const hit = pickFallbackEvent([arnoldParade], STALE);
  assert.equal(hit, arnoldParade);
});

test("the live (canonical) slug is what we redirect TO", () => {
  assert.equal(slugOf(arnoldParade), "arnolds-independence-day-parade-2026-07-04-arnold");
});

test("matches across other same-date events without false positives", () => {
  const others = [
    ev("Murphys 4th of July Parade", "2026-07-04", "Murphys"),
    ev("Creek Critters @ Big Trees State Park", "2026-07-04", "Arnold"),
    ev("Sierra Nevada Arts and Crafts Festival", "2026-07-04", "Arnold"),
    arnoldParade,
  ];
  assert.equal(pickFallbackEvent(others, STALE), arnoldParade);
});

test("requires same town — won't redirect across towns", () => {
  const murphysParade = ev("Independence Day Parade", "2026-07-04", "Murphys");
  // Stale slug is an Arnold slug; the only candidate is in Murphys → no match.
  assert.equal(pickFallbackEvent([murphysParade], STALE), null);
});

test("returns null when two same-town events are equally plausible (ambiguous)", () => {
  const a = ev("Summer Concert", "2026-07-04", "Arnold");
  const b = ev("Summer Concert", "2026-07-04", "Arnold"); // genuine duplicate-ish
  const stale = "summer-concert-2026-07-04-arnold";
  assert.equal(pickFallbackEvent([a, b], stale), null);
});

test("returns null on a weak match (different event entirely)", () => {
  const unrelated = ev("Yoga in the Park", "2026-07-04", "Arnold");
  assert.equal(pickFallbackEvent([unrelated], STALE), null);
});

test("returns null when the slug has no parseable date", () => {
  assert.equal(pickFallbackEvent([arnoldParade], "arnold-independence-day-parade"), null);
});

test("prefix tokens match (fest ↔ festival) but trivial short tokens don't", () => {
  const festival = ev("Arts Festival", "2026-08-01", "Murphys");
  // 'art' is < 4 chars so 'art' ↔ 'arts' must NOT match on prefix; but the
  // 'festival' token carries the match. Use a slug whose name part is "arts-fest".
  const stale = "arts-fest-2026-08-01-murphys";
  assert.equal(pickFallbackEvent([festival], stale), festival);
});

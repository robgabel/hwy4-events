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
import { pickFallbackEvent, matchMergedSlug } from "../../lib/events.js";
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

// --- Dominance second chance (substantial partial match, no rivals) --------

test("real case: recovers the renamed shrimp-feed survivor (dominant partial match)", () => {
  // The 2026-08-11 hand merge kept "Annual Shrimp & Pasta Feed Fundraiser",
  // orphaning the old "Rotary's Annual Shrimp Feed & Auction" slug at a 0.6
  // name score — under MIN_SCORE, but with every other same-day event at 0.
  const survivor = ev("Annual Shrimp & Pasta Feed Fundraiser", "2026-08-15", "Murphys");
  const others = [
    ev("Live Music @ Murphys Irish Pub", "2026-08-15", "Murphys"),
    ev("Murphys Creek Theatre presents", "2026-08-15", "Murphys"),
    survivor,
  ];
  const stale = "rotarys-annual-shrimp-feed-auction-2026-08-15-murphys";
  assert.equal(pickFallbackEvent(others, stale), survivor);
});

test("dominance needs silence behind it — a mid-score rival blocks the redirect", () => {
  const a = ev("Annual Shrimp & Pasta Feed Fundraiser", "2026-08-15", "Murphys");
  const b = ev("Annual Shrimp Boil & Auction", "2026-08-15", "Murphys");
  const stale = "rotarys-annual-shrimp-feed-auction-2026-08-15-murphys";
  assert.equal(pickFallbackEvent([a, b], stale), null);
});

test("dominance needs ≥3 matched tokens — two shared words are not identity", () => {
  const only = ev("Wine Tasting Night", "2026-08-15", "Murphys");
  // "wine" + "tasting" match, but 2 tokens on a 4-token slug is a guess.
  assert.equal(
    pickFallbackEvent([only], "wine-tasting-summer-social-2026-08-15-murphys"),
    null
  );
});

// --- Containment second chance (artist/venue-shaped stale slugs) -----------
// LLM-written surfaces (briefings, newsletters) mint slugs from their prose
// rename of an event — the act or the venue — which share zero tokens with the
// row's actual name. Both cases below shipped as live 404s on 2026-08-15.

test("real case: an artist-first minted slug recovers via artists (Kane Brown)", () => {
  const concert = {
    ...ev("Ironstone Summer Concert Series", "2026-08-16", "Murphys"),
    artists: ["Kane Brown"],
    venue_name: "Ironstone Vineyards",
  };
  const mimosa = {
    ...ev("Mimosa Sundays at Ironstone Vineyards", "2026-08-16", "Murphys"),
    artists: null,
    venue_name: "Ironstone Vineyards",
  };
  const minted = "kane-brown-murphys-2026-08-16-murphys";
  assert.equal(pickFallbackEvent([concert, mimosa], minted), concert);
});

test("real case: a venue-shaped minted slug recovers via the venue core (Brice)", () => {
  const show = {
    ...ev("Deep Thicket Dwellers", "2026-08-15", "Murphys"),
    artists: ["Deep Thicket Dwellers"],
    venue_name: "Brice Station Vineyards",
  };
  const pub = {
    ...ev("Live Music @ Murphys Irish Pub", "2026-08-15", "Murphys"),
    artists: null,
    venue_name: "Murphys Irish Pub",
  };
  const minted = "live-music-brice-station-vineyards-2026-08-15-murphys";
  assert.equal(pickFallbackEvent([show, pub], minted), show);
});

test("containment never fires when two same-venue events both qualify", () => {
  const base = {
    artists: null as string[] | null,
    venue_name: "Calaveras Big Trees State Park",
  };
  const a = { ...ev("Junior Rangers @ Big Trees State Park", "2026-08-15", "Arnold"), ...base };
  const b = { ...ev("Meadow Walk @ Big Trees State Park", "2026-08-15", "Arnold"), ...base };
  // Venue-only slug: the park's distinctive core matches both programs.
  const minted = "calaveras-big-trees-2026-08-15-arnold";
  assert.equal(pickFallbackEvent([a, b], minted), null);
});

test("a single-token act can't containment-match (too weak a signal)", () => {
  const show = {
    ...ev("Summer Concert Series", "2026-08-15", "Murphys"),
    artists: ["Waterloo"],
    venue_name: "Ironstone Vineyards",
  };
  // "waterloo" appears in the slug, but one token is not identity.
  assert.equal(
    pickFallbackEvent([show], "waterloo-night-2026-08-15-murphys"),
    null
  );
});

test("containment still requires the same town", () => {
  const concert = {
    ...ev("Ironstone Summer Concert Series", "2026-08-16", "Murphys"),
    artists: ["Kane Brown"],
    venue_name: "Ironstone Vineyards",
  };
  assert.equal(
    pickFallbackEvent([concert], "kane-brown-2026-08-16-arnold"),
    null
  );
});

// --- matchMergedSlug (merge-loser recovery) --------------------------------
// The reconcile engine deletes merged losers, and precisely those rows carry
// titles too different for the fuzzy matcher above (that's why they were
// dupes). This pins the exact snapshot-slug → survivor mapping.

const mergeRow = (name: string, date: string, town: string, survivor: string) => ({
  survivor_id: survivor,
  merged_snapshot: { name, date, town },
});

test("recovers a merged loser's slug to its survivor id (different titles)", () => {
  // The real GoCalaveras case: umbrella listing merged into the specific act.
  const rows = [
    mergeRow("Live Music @ The Lube Room", "2026-07-11", "Arnold", "surv-1"),
    mergeRow("Bistro Summer Concert Series", "2026-07-11", "Murphys", "surv-2"),
  ];
  const loserSlug = "live-music-the-lube-room-2026-07-11-arnold";
  assert.equal(matchMergedSlug(rows, loserSlug), "surv-1");
});

test("no snapshot-slug match returns null (never guesses)", () => {
  const rows = [mergeRow("Trivia Night", "2026-07-11", "Arnold", "surv-1")];
  assert.equal(matchMergedSlug(rows, "karaoke-night-2026-07-11-arnold"), null);
});

test("tolerates malformed snapshots (missing fields, null snapshot)", () => {
  const rows = [
    { survivor_id: "surv-x", merged_snapshot: null },
    { survivor_id: "surv-y", merged_snapshot: { name: "X", date: null, town: "Arnold" } },
    mergeRow("Karaoke Night", "2026-07-11", "Arnold", "surv-z"),
  ];
  assert.equal(matchMergedSlug(rows, "karaoke-night-2026-07-11-arnold"), "surv-z");
});

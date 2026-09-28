// The dedup golden set (PRD-dedup-merge-v2.md, Appendix A plus the multi-row
// dates the Phase 1 replay surfaced).
//
// Real hwy4_events rows as stored on 2026-09-28 (rows since merged away come
// from their event_merge_log snapshots), trimmed to the columns the matcher
// reads: fixtures/dedup-golden.json. Every label was judged by a person reading
// both listings, not by a matcher.
//
// Two layers, both deliberate:
//  - Pairwise: each labeled pair matches or does not. The four duplicates
//    Phase 1 is not meant to catch are asserted as misses, each with its
//    reason, so a change that starts catching one is a conscious label flip.
//  - Clustering: the dates where reconcile sees several rows at once, with the
//    clusters it must form and the rows it must refuse.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isSameEvent, sameEventMatch, type EventIdentity } from "../../lib/event-identity.js";
import {
  clusterEventsDetailed,
  pickSurvivor,
  type DedupableEvent,
} from "../../lib/dedupe-events.js";

type Row = DedupableEvent & EventIdentity & { id: string; date: string; town: string };

const rows: Row[] = JSON.parse(
  readFileSync(new URL("./fixtures/dedup-golden.json", import.meta.url), "utf8")
);
const byId = new Map(rows.map((r) => [r.id, r]));
const row = (id: string): Row => {
  const r = byId.get(id);
  assert.ok(r, `fixture row ${id} missing`);
  return r;
};

// [a, b, how they must match (null = must not), why]
const PAIRS: [string, string, "standard" | "cross_source" | null, string][] = [
  // Duplicates Phase 1 catches.
  ["2fd80754", "7357b581", "cross_source", "Murphys Gathering: 11:00 on GoCalaveras, 12:00 on Visit Murphys"],
  ["0274b193", "204ae1b8", "cross_source", "Live Like Lilly: 18:00 on Facebook, 17:00 on GoCalaveras"],
  ["2171ef14", "22d34f21", "standard", "All Hallows 10-24: junk venue string, registry key agrees"],
  ["533bfca0", "2c2a58ed", "cross_source", "All Hallows 10-25: 11:00 vs 12:00, Facebook title decoration"],
  ["159f0c7e", "94b96428", "standard", "Karaoke @ vs at The Murphys Irish Pub"],
  ["76ad870f", "86028654", "standard", "Patriotic Car Cruise, paraphrased"],
  ["fb74d5d5", "d2db6635", "standard", "Karaoke W/ Kim vs Karaoke with Kim @"],
  ["f7707fc1", "d2db6635", "standard", "Karaoke: community submission vs GoCalaveras"],
  ["f7707fc1", "fb74d5d5", "standard", "Karaoke: community submission vs the pub"],
  ["758422c9", "7d5788e4", "cross_source", "Hermitfest West: the 12:00 set inside the 9-2 festival"],
  // Duplicates Phase 1 is not meant to catch.
  ["94b2a310", "98110902", null, "BVTS: venue-less degraded re-insert, the Phase 0.4 hold's job"],
  ["5f4d4748", "551f2b7b", null, "4th of July at the Murphys Hotel: 4h apart, no overlap; review queue"],
  ["3782281d", "91e6347e", null, "Constitution matinee: venue-only title 2h after the play; review queue"],
  ["2296c258", "be0865d0", null, "Hit Collective: +3h timezone bug in an early scrape, fixed upstream"],
  // Must never merge.
  ["436a6aa8", "4575e863", null, "An Act of God 19:30 vs 14:00: two performances"],
  ["017279df", "4a6d29e1", null, "Tapas morning vs evening class: one feed, two sessions"],
  ["3f25c6c3", "6a662b75", null, "Bike clinic vs BVTS work day: overlapping, different events"],
  ["1fda1aa3", "6a662b75", null, "Pickleball lessons vs BVTS work day"],
  ["6cd0fdad", "3bf13282", null, "Irish Pub: Eva Grace 19:00 vs afternoon live music"],
  ["fe43e6e8", "d09d006a", null, "Irish Pub: afternoon vs midday sets"],
  ["e0812376", "211ddc72", null, "Ironstone concert vs Mimosa Sundays"],
  ["b75743e8", "edb35ad0", null, "Lackler Ceramics: Kids Clay vs Making Smalls"],
  ["43eb38ea", "159f0c7e", null, "Karaoke at Sequoia Woods vs the Irish Pub"],
];

for (const [a, b, want, why] of PAIRS) {
  test(`golden pair: ${why}`, () => {
    assert.equal(sameEventMatch(row(a), row(b)), want);
    assert.equal(sameEventMatch(row(b), row(a)), want, "the rule is symmetric");
  });
}

test("golden set: the Phase 1 acceptance bar (>= 10/14 duplicates, 0 false merges)", () => {
  const dups = PAIRS.slice(0, 14);
  const distinct = PAIRS.slice(14);
  const caught = dups.filter(([a, b]) => isSameEvent(row(a), row(b))).length;
  const falseMerges = distinct.filter(([a, b]) => isSameEvent(row(a), row(b))).length;
  assert.ok(caught >= 10, `caught ${caught}/14`);
  assert.equal(falseMerges, 0);
});

test("golden set: no unlabeled pair among the single-pair corpus rows merges", () => {
  // Includes the five Calaveras Big Trees programs of 2026-07-12: one park,
  // overlapping windows, five different programs.
  const clusterDates = new Set(["2026-03-14", "2026-04-16", "2026-07-19", "2026-07-27"]);
  const labeled = new Set(PAIRS.map(([a, b]) => [a, b].sort().join("|")));
  const corpus = rows.filter((r) => !clusterDates.has(r.date));
  const unexpected: string[] = [];
  for (let i = 0; i < corpus.length; i++) {
    for (let j = i + 1; j < corpus.length; j++) {
      const a = corpus[i];
      const b = corpus[j];
      if (a.date !== b.date || labeled.has([a.id, b.id].sort().join("|"))) continue;
      if (isSameEvent(a, b)) unexpected.push(`"${a.name}" ~ "${b.name}"`);
    }
  }
  assert.deepEqual(unexpected, []);
});

const clusterIds = (date: string) => {
  const r = clusterEventsDetailed(rows.filter((x) => x.date === date));
  return {
    clusters: r.clusters.map((c) => c.map((x) => x.id).sort()).sort(),
    refused: r.refused.map((x) => x.row.id).sort(),
    raw: r,
  };
};

test("cluster 2026-03-14 Bear Valley: a placeholder that matches two events joins neither", () => {
  // "Live Music on the Sundeck" matches both undated resort listings; they are
  // different events. Single-link clustering chained all three, and reconcile
  // would have deleted one of the two real events.
  const { clusters, refused } = clusterIds("2026-03-14");
  assert.ok(clusters.every((c) => c.length === 1), JSON.stringify(clusters));
  assert.deepEqual(refused, ["171a8815"], "the placeholder, reported once for review");
});

test("cluster 2026-04-16 Moose Lodge: partial titles of one dinner are joined by the full one", () => {
  // "Dinner - Tacos" and "Moose Legion Dinner" name different parts of the
  // same dinner; "Dinner - Moose Legion Tacos" names both.
  const { clusters, refused } = clusterIds("2026-04-16");
  assert.deepEqual(clusters, [
    ["084e8969", "406c23a1", "4fae63ae", "ba9f58a4"],
    ["47e0e39e"],
  ]);
  assert.deepEqual(refused, []);
});

test("cluster 2026-07-27 Moose Lodge: a vague 'Dinner' does not block, and routine never survives", () => {
  const { clusters, raw } = clusterIds("2026-07-27");
  assert.deepEqual(clusters, [["19faeac7", "61ba1a96", "64f7eaf2", "8b746c8b", "cb4c95c4"]]);
  // Four of the five are flagged routine (hidden); the one that is not must be
  // the survivor, or the listing vanishes with the merge (dedup v2 1.7).
  const survivor = pickSurvivor(raw.clusters[0]);
  assert.equal(survivor.id, "64f7eaf2");
  assert.equal(survivor.is_routine, false);
});

test("cluster 2026-07-19 Moose Lodge: a row bridging two titles that name different things is refused", () => {
  // The one human merge Phase 1 does not reproduce: "District 8 and Hesperian
  // Moose Legion Meetings" and "District 8 Meetings and Backyard BBQ" each name
  // something the other does not, and only the Picnic row matches both. Left
  // for review rather than guessed.
  const { clusters, refused } = clusterIds("2026-07-19");
  assert.ok(clusters.every((c) => c.length === 1), JSON.stringify(clusters));
  assert.deepEqual(refused, ["5ad932a5"]);
});

test("clustering is independent of the order the database returns rows in", () => {
  for (const date of ["2026-03-14", "2026-04-16", "2026-07-19", "2026-07-27", "2026-07-12"]) {
    const day = rows.filter((x) => x.date === date);
    const want = clusterIds(date).clusters;
    for (const perm of [[...day].reverse(), [...day.slice(1), day[0]]]) {
      const got = clusterEventsDetailed(perm).clusters.map((c) => c.map((x) => x.id).sort()).sort();
      assert.deepEqual(got, want, date);
    }
  }
});

// Regression lock for the pure Search Console analytics (lib/seo-insights.ts).
//
// These functions drive the /admin/analytics Search panel and the Growth Agent's
// weekly memo, so their shape must not drift: striking-distance must exclude
// already-winning and hopeless ranks, and month-over-month must split windows by
// count (not assume contiguous GSC dates).
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectStrikingDistance,
  monthOverMonth,
  summarizePeriod,
  snapshotTotals,
} from "../../lib/seo-insights.js";

const q = (
  query: string,
  clicks: number,
  impressions: number,
  position: number
) => ({ query, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });

test("striking distance excludes top-3 and deep ranks, keeps the page-1/2 fringe", () => {
  const rows = [
    q("already winning", 90, 100, 2.0), // pos < 4 → excluded
    q("striking A", 2, 300, 8.0), // fringe, big impressions
    q("striking B", 1, 120, 12.0),
    q("too deep", 0, 500, 40.0), // pos > 20 → excluded
    q("too niche", 0, 5, 9.0), // impressions < 20 → excluded
  ];
  const out = selectStrikingDistance(rows);
  const queries = out.map((r) => r.query);
  assert.deepEqual(queries, ["striking A", "striking B"]);
  assert.ok(!queries.includes("already winning"));
  assert.ok(!queries.includes("too deep"));
  assert.ok(!queries.includes("too niche"));
});

test("striking distance ranks by un-captured impressions (potential), not raw impressions", () => {
  const rows = [
    q("high ctr big impr", 250, 300, 6.0), // most impressions but converting well
    q("low ctr mid impr", 2, 200, 9.0), // fewer impressions, mostly wasted
  ];
  const out = selectStrikingDistance(rows);
  assert.equal(out[0].query, "low ctr mid impr");
  assert.equal(out[0].potential, 198);
});

test("striking distance respects custom bounds + limit", () => {
  const rows = [
    q("a", 1, 100, 5),
    q("b", 1, 100, 6),
    q("c", 1, 100, 7),
  ];
  const out = selectStrikingDistance(rows, { limit: 2, maxPosition: 6 });
  assert.equal(out.length, 2);
  assert.ok(out.every((r) => r.position <= 6));
});

const day = (date: string, clicks: number, impressions: number, position: number) => ({
  date,
  clicks,
  impressions,
  position,
});

test("summarizePeriod is impression-weighted for position and derives ctr", () => {
  const t = summarizePeriod([day("2026-06-01", 10, 100, 5), day("2026-06-02", 0, 100, 15)]);
  assert.equal(t.clicks, 10);
  assert.equal(t.impressions, 200);
  assert.equal(t.avgPosition, 10); // (5*100 + 15*100)/200
  assert.equal(t.ctr, 0.05);
  assert.equal(t.days, 2);
});

test("monthOverMonth splits by count from the tail and computes deltas", () => {
  // 4 days, periodDays=2 → current = last 2, prior = the 2 before.
  const points = [
    day("2026-06-01", 10, 100, 10),
    day("2026-06-02", 10, 100, 10),
    day("2026-06-03", 20, 100, 8),
    day("2026-06-04", 20, 100, 8),
  ];
  const mom = monthOverMonth(points, 2);
  assert.equal(mom.current.clicks, 40);
  assert.equal(mom.prior.clicks, 20);
  assert.equal(mom.clicksDeltaPct, 100); // doubled
  assert.equal(mom.impressionsDeltaPct, 0);
  assert.equal(mom.positionDelta, -2); // 8 - 10, improved
});

test("monthOverMonth returns null deltas when there is no prior baseline", () => {
  const mom = monthOverMonth([day("2026-06-03", 5, 50, 9), day("2026-06-04", 5, 50, 9)], 2);
  assert.equal(mom.prior.impressions, 0);
  assert.equal(mom.clicksDeltaPct, null);
  assert.equal(mom.positionDelta, null);
});

test("snapshotTotals aggregates a query snapshot", () => {
  const t = snapshotTotals([q("a", 10, 100, 4), q("b", 5, 100, 6)]);
  assert.equal(t.clicks, 15);
  assert.equal(t.impressions, 200);
  assert.equal(t.avgPosition, 5);
});

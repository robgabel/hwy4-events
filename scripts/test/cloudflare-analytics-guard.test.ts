// Regression lock for the Cloudflare RUM spike guard.
//
// Adaptive groups can return a capped day (~10,000 pageviews and ~10,000
// visits). On 2026-09-01 that number was stored as real traffic and the Friday
// growth memo summed the newest 14 analytics_daily rows into a fake Labor Day
// spike. These tests pin: ingest reject (ceiling + referrer mismatch), a normal
// day still accepted, calendar-window sums that skip rejected days, and
// excluded_dates on the traffic block. Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADAPTIVE_GROUPS_CEILING,
  REFERRER_MISMATCH_RATIO,
  buildAnalyticsDailyRow,
  isUnusableAnalyticsDay,
  judgeRumSnapshot,
  sumCfTrafficWindows,
  utcAddDays,
  type AnalyticsSnapshot,
  type CountRow,
} from "../../lib/cloudflare-analytics.ts";

const referrers = (visits: number): CountRow[] => [
  { key: "google.com", pageviews: visits, visits },
];

test("utcAddDays stays on the UTC calendar (no local TZ drift)", () => {
  assert.equal(utcAddDays("2026-09-01", -1), "2026-08-31");
  assert.equal(utcAddDays("2026-09-10", -7), "2026-09-03");
  assert.equal(utcAddDays("2026-01-01", -1), "2025-12-31");
});

test("promote-to-reject: a 10k pageviews day is the adaptive-groups ceiling", () => {
  const v = judgeRumSnapshot({
    pageviews: ADAPTIVE_GROUPS_CEILING,
    visits: ADAPTIVE_GROUPS_CEILING,
    referrers: referrers(40),
  });
  assert.deepEqual(v, { reject: true, reason: "adaptive_groups_ceiling" });
});

test("promote-to-reject: 10k visits alone is enough (pageviews under the cap)", () => {
  const v = judgeRumSnapshot({
    pageviews: 200,
    visits: ADAPTIVE_GROUPS_CEILING,
    referrers: referrers(40),
  });
  assert.deepEqual(v, { reject: true, reason: "adaptive_groups_ceiling" });
});

test("promote-to-reject: totals wildly above the same snapshot's referrer-row visit sum", () => {
  const refVisits = 40;
  const claimed = refVisits * REFERRER_MISMATCH_RATIO;
  const v = judgeRumSnapshot({
    pageviews: claimed,
    visits: claimed,
    referrers: referrers(refVisits),
  });
  assert.deepEqual(v, { reject: true, reason: "referrer_mismatch" });
});

test("a normal day still sums: tens/hundreds of visits with matching referrers are accepted", () => {
  const v = judgeRumSnapshot({
    pageviews: 120,
    visits: 80,
    referrers: [
      { key: "google.com", pageviews: 50, visits: 40 },
      { key: "", pageviews: 70, visits: 40 },
    ],
  });
  assert.deepEqual(v, { reject: false });
});

test("a quiet day with empty referrers is not a mismatch (dimension fetch may be empty)", () => {
  const v = judgeRumSnapshot({ pageviews: 12, visits: 8, referrers: [] });
  assert.deepEqual(v, { reject: false });
});

test("a 10k day whose referrers also sum to 10k is still the ceiling, never trusted", () => {
  const v = judgeRumSnapshot({
    pageviews: 10_000,
    visits: 10_000,
    referrers: [{ key: "google.com", pageviews: 10_000, visits: 10_000 }],
  });
  assert.deepEqual(v, { reject: true, reason: "adaptive_groups_ceiling" });
});

const emptySnapshot = (over: Partial<AnalyticsSnapshot> & { totals: AnalyticsSnapshot["totals"] }): AnalyticsSnapshot => ({
  range: { since: "2026-09-01T00:00:00Z", until: "2026-09-01T23:59:59Z" },
  topPages: [],
  referrers: [],
  countries: [],
  devices: [],
  browsers: [],
  aiReferrals: {},
  ...over,
});

test("buildAnalyticsDailyRow: a 10k day writes null totals + rejected, never the cap", () => {
  const row = buildAnalyticsDailyRow(
    "2026-09-01",
    emptySnapshot({
      totals: { pageviews: 10_000, visits: 10_000 },
      referrers: referrers(47),
    })
  );
  assert.equal(row.rejected, true);
  assert.equal(row.reject_reason, "adaptive_groups_ceiling");
  assert.equal(row.pageviews, null);
  assert.equal(row.visits, null);
  assert.equal(row.date, "2026-09-01");
  // Referrer breakdown is evidence, not a guessed replacement total.
  assert.equal(row.referrers[0]?.visits, 47);
});

test("buildAnalyticsDailyRow: a normal day stores the real totals", () => {
  const row = buildAnalyticsDailyRow(
    "2026-09-02",
    emptySnapshot({
      totals: { pageviews: 90, visits: 60 },
      referrers: referrers(60),
    })
  );
  assert.equal(row.rejected, false);
  assert.equal(row.reject_reason, null);
  assert.equal(row.pageviews, 90);
  assert.equal(row.visits, 60);
});

test("isUnusableAnalyticsDay: rejected flag, null totals, or a still-stored 10k cap", () => {
  assert.equal(isUnusableAnalyticsDay({ date: "2026-09-01", rejected: true, pageviews: null, visits: null }), true);
  assert.equal(isUnusableAnalyticsDay({ date: "2026-09-01", pageviews: null, visits: 12 }), true);
  assert.equal(isUnusableAnalyticsDay({ date: "2026-09-01", pageviews: 10_000, visits: 10_000 }), true);
  assert.equal(isUnusableAnalyticsDay({ date: "2026-09-02", pageviews: 90, visits: 60 }), false);
  assert.equal(isUnusableAnalyticsDay({ date: "2026-09-02", pageviews: 0, visits: 0 }), false);
});

const day = (date: string, pageviews: number, extra: { rejected?: boolean; visits?: number | null } = {}) => ({
  date,
  pageviews: extra.rejected ? null : pageviews,
  visits: extra.rejected ? null : (extra.visits ?? pageviews),
  rejected: extra.rejected ?? false,
});

test("sumCfTrafficWindows: a normal 14-day series sums calendar 7d vs prior 7d, not newest-N", () => {
  // today = 2026-09-10 → current window Sep 3–9, prev Aug 27–Sep 2.
  const rows = [];
  for (let i = 0; i < 14; i++) {
    const d = utcAddDays("2026-09-09", -i);
    rows.push(day(d, 10));
  }
  // A 999-pageview day sitting as the newest row but OUTSIDE the 7d calendar
  // window (today itself) must not enter pageviews_7d — the old newest-7-rows
  // path would have counted it.
  rows.unshift(day("2026-09-10", 999));
  const w = sumCfTrafficWindows(rows, "2026-09-10");
  assert.equal(w.window_start, "2026-09-03");
  assert.equal(w.window_end, "2026-09-09");
  assert.equal(w.pageviews_7d, 70);
  assert.equal(w.pageviews_prev_7d, 70);
  assert.equal(w.days_included, 7);
  assert.equal(w.days_included_prev, 7);
  assert.deepEqual(w.excluded_dates, []);
});

test("sumCfTrafficWindows: a 10k day in the current window is excluded, not summed", () => {
  // today = 2026-09-04 → current Aug 28–Sep 3, which includes Labor Day Sep 1.
  const rows = [];
  for (let i = 0; i < 14; i++) {
    const d = utcAddDays("2026-09-03", -i);
    rows.push(d === "2026-09-01" ? day(d, 10_000) : day(d, 100));
  }
  const w = sumCfTrafficWindows(rows, "2026-09-04");
  assert.equal(w.pageviews_7d, 600, "6 usable days × 100, the 10k day is skipped");
  assert.equal(w.days_included, 6);
  assert.deepEqual(w.excluded_dates, ["2026-09-01"]);
  assert.ok(w.pageviews_7d < 1000, "must never look like an 11k Labor Day spike");
});

test("sumCfTrafficWindows: a rejected-flag / null-totals day surfaces on excluded_dates", () => {
  const rows = [
    day("2026-09-09", 80),
    day("2026-09-08", 80),
    { date: "2026-09-07", pageviews: null, visits: null, rejected: true },
    day("2026-09-06", 80),
    day("2026-09-05", 80),
    day("2026-09-04", 80),
    day("2026-09-03", 80),
  ];
  const w = sumCfTrafficWindows(rows, "2026-09-10");
  assert.equal(w.pageviews_7d, 480);
  assert.equal(w.days_included, 6);
  assert.deepEqual(w.excluded_dates, ["2026-09-07"]);
});

test("sumCfTrafficWindows: a 10k day outside both calendar windows is not counted (newest-14 would have)", () => {
  // today = 2026-09-18 → current Sep 11–17, prev Sep 4–10. Sep 1 is 17 days
  // back: the old newest-14-rows path would still pick it up as row 14.
  const rows = [day("2026-09-01", 10_000)];
  for (let i = 0; i < 14; i++) {
    rows.push(day(utcAddDays("2026-09-17", -i), 50));
  }
  const w = sumCfTrafficWindows(rows, "2026-09-18");
  assert.equal(w.window_start, "2026-09-11");
  assert.equal(w.window_end, "2026-09-17");
  assert.equal(w.prev_window_start, "2026-09-04");
  assert.equal(w.prev_window_end, "2026-09-10");
  assert.equal(w.pageviews_7d, 350);
  assert.equal(w.pageviews_prev_7d, 350);
  assert.deepEqual(w.excluded_dates, []);
  assert.ok(w.pageviews_7d < 10_000);
});

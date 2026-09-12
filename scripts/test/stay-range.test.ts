// Regression lock for the Karen stay-range overlay (lib/stay-range.ts, HWY-40).
//
// The page may only show a custom window when both dates are real ISO days
// and the span fits a typical guest stay. Everything else falls back to
// this weekend, including a silent refusal of Feb 30 and 3-week ranges.
//
// Run: cd scripts && npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STAY_MAX_DAYS,
  formatStayShort,
  inclusiveDayCount,
  parseIsoDate,
  parseStayRange,
  stayHref,
  stayMaxEnd,
  stayMeta,
  stayOgPath,
} from "../../lib/stay-range.js";

test("parseIsoDate accepts a real day and rejects junk", () => {
  assert.equal(parseIsoDate("2026-03-14"), "2026-03-14");
  assert.equal(parseIsoDate(" 2026-03-14 "), "2026-03-14");
  assert.equal(parseIsoDate("2026-02-30"), null);
  assert.equal(parseIsoDate("2026-13-01"), null);
  assert.equal(parseIsoDate("03-14-2026"), null);
  assert.equal(parseIsoDate("2026-3-14"), null);
  assert.equal(parseIsoDate("not-a-date"), null);
  assert.equal(parseIsoDate(""), null);
  assert.equal(parseIsoDate(undefined), null);
  assert.equal(parseIsoDate("1999-01-01"), null);
  assert.equal(parseIsoDate("2101-01-01"), null);
});

test("parseStayRange requires both ends, in order, within the cap", () => {
  assert.deepEqual(parseStayRange({ from: "2026-03-14", to: "2026-03-16" }), {
    start: "2026-03-14",
    end: "2026-03-16",
    dayCount: 3,
  });
  assert.deepEqual(parseStayRange({ from: "2026-03-14", to: "2026-03-14" }), {
    start: "2026-03-14",
    end: "2026-03-14",
    dayCount: 1,
  });
  // one missing
  assert.equal(parseStayRange({ from: "2026-03-14" }), null);
  assert.equal(parseStayRange({ to: "2026-03-16" }), null);
  assert.equal(parseStayRange({}), null);
  // reversed
  assert.equal(parseStayRange({ from: "2026-03-16", to: "2026-03-14" }), null);
  // overlong: 17 inclusive days
  assert.equal(parseStayRange({ from: "2026-03-01", to: "2026-03-17" }), null);
  // exactly the cap
  const max = parseStayRange({ from: "2026-03-01", to: stayMaxEnd("2026-03-01") });
  assert.ok(max);
  assert.equal(max.dayCount, STAY_MAX_DAYS);
  // calendar-impossible end
  assert.equal(parseStayRange({ from: "2026-03-14", to: "2026-02-30" }), null);
});

test("inclusiveDayCount is calendar days, not nights", () => {
  assert.equal(inclusiveDayCount("2026-03-14", "2026-03-16"), 3);
  assert.equal(inclusiveDayCount("2026-03-14", "2026-03-14"), 1);
  assert.equal(STAY_MAX_DAYS, 16);
});

test("stayHref is a clean this-weekend query (no src)", () => {
  const range = parseStayRange({ from: "2026-03-14", to: "2026-03-16" })!;
  assert.equal(stayHref(range), "/this-weekend?from=2026-03-14&to=2026-03-16");
  assert.equal(stayOgPath(range), "/og/weekend?from=2026-03-14&to=2026-03-16");
  assert.equal(stayOgPath(null), "/og/weekend");
});

test("formatStayShort and stayMeta stay em-dash-free", () => {
  const same = parseStayRange({ from: "2026-03-14", to: "2026-03-14" })!;
  assert.equal(formatStayShort(same), "Mar 14");
  const mid = parseStayRange({ from: "2026-03-14", to: "2026-03-16" })!;
  assert.equal(formatStayShort(mid), "Mar 14 to 16");
  const cross = parseStayRange({ from: "2026-03-28", to: "2026-04-02" })!;
  assert.equal(formatStayShort(cross), "Mar 28 to Apr 2");
  const meta = stayMeta(mid);
  assert.equal(meta.title, "What's on Hwy 4, Mar 14 to 16");
  assert.ok(!meta.title.includes("—") && !meta.description.includes("—"));
  assert.ok(!meta.title.includes("–") && !meta.description.includes("–"));
  assert.ok(
    meta.description.startsWith(
      "Live events along the Highway 4 corridor Mar 14 to 16"
    )
  );
  assert.ok(!/public listings only/i.test(meta.description));
});

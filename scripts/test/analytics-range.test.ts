import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RANGE_OPTIONS,
  bucketLabel,
  bucketSeries,
  bucketSizeFor,
  parseRange,
} from "../../lib/analytics-range.ts";

const days = (n: number, from = "2026-06-01") => {
  const out: { date: string; v: number }[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push({ date: d.toISOString().split("T")[0], v: i });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
};

test("parseRange: known keys resolve, anything else falls back to the default", () => {
  assert.equal(parseRange("90d").days, 90);
  assert.equal(parseRange(["7d"]).key, "7d");
  assert.equal(parseRange(undefined).key, "30d");
  assert.equal(parseRange("nonsense").key, "30d");
  assert.equal(parseRange("").key, "30d");
});

test("every range option is unique and ascending", () => {
  const keys = RANGE_OPTIONS.map((o) => o.key);
  assert.equal(new Set(keys).size, keys.length);
  for (let i = 1; i < RANGE_OPTIONS.length; i++) {
    assert.ok(RANGE_OPTIONS[i].days > RANGE_OPTIONS[i - 1].days);
  }
});

test("bucketSizeFor: per-day while it fits, whole weeks once it doesn't", () => {
  assert.equal(bucketSizeFor(7), 1);
  assert.equal(bucketSizeFor(30), 1);
  assert.equal(bucketSizeFor(90), 7); // ~13 bars
  assert.equal(bucketSizeFor(182), 7); // 26 bars
  assert.equal(bucketSizeFor(365), 14); // 26 bars
  // Never an arbitrary non-week lump above 1.
  for (const d of [31, 45, 60, 120, 200, 400]) {
    const s = bucketSizeFor(d);
    assert.ok(s === 1 || s % 7 === 0, `${d} -> ${s}`);
  }
});

test("bucketSizeFor honors the bar cap", () => {
  for (const d of [7, 30, 90, 182, 365]) {
    const s = bucketSizeFor(d);
    assert.ok(Math.ceil(d / s) <= 30, `${d} days at size ${s}`);
  }
});

test("bucketSeries: size 1 is a passthrough", () => {
  const rows = days(5);
  const b = bucketSeries(rows, 1);
  assert.equal(b.length, 5);
  assert.deepEqual(b[0], { start: rows[0].date, end: rows[0].date, count: 1, rows: [rows[0]] });
});

test("bucketSeries: partial bucket lands at the OLD end, newest is always whole", () => {
  const rows = days(10); // 10 days, weekly buckets -> 3 + 7
  const b = bucketSeries(rows, 7);
  assert.equal(b.length, 2);
  assert.equal(b[0].count, 3, "the short bucket is the oldest");
  assert.equal(b[1].count, 7, "the newest bucket is a full week");
  assert.equal(b[1].end, rows[9].date, "series ends on the newest day");
  assert.equal(b[0].start, rows[0].date, "series starts on the oldest day");
});

test("bucketSeries: every row is kept exactly once, in order", () => {
  const rows = days(90);
  const b = bucketSeries(rows, 7);
  const flat = b.flatMap((x) => x.rows);
  assert.deepEqual(flat, rows);
});

test("bucketSeries: empty input yields no buckets", () => {
  assert.deepEqual(bucketSeries([], 7), []);
  assert.deepEqual(bucketSeries([], 1), []);
});

test("bucketLabel: single day vs span", () => {
  const short = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${Number(m)}/${Number(d)}`;
  };
  const one = bucketSeries(days(1), 1)[0];
  assert.equal(bucketLabel(one, short), "6/1");
  const week = bucketSeries(days(7), 7)[0];
  assert.equal(bucketLabel(week, short), "6/1–6/7");
});

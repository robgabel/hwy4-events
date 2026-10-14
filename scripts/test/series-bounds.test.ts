// Weekly series bounds (#384). Big Trees was the first caller; every generator
// that expands a weekday rule now goes through scripts/lib/series-bounds.ts.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { generateDedupKey } from "../../lib/event-identity.js";
import { WED } from "../lib/recurrence.js";
import {
  boundWeeklySeries,
  expandWeeklyThrough,
  omitCancelledOccurrences,
} from "../lib/series-bounds.js";

const scriptsRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...tsFiles(path));
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** Calls of expandWeekly(, skipping the function declaration and expandWeeklyThrough. */
function directExpandWeeklyCalls(src: string): number {
  const re = /(?<![\w])expandWeekly\s*\(/g;
  let count = 0;
  for (const match of src.matchAll(re)) {
    const index = match.index ?? 0;
    const before = src.slice(Math.max(0, index - 24), index);
    if (/function\s+$/.test(before)) continue;
    count++;
  }
  return count;
}

test("expandWeeklyThrough requires a season end and stops on that date", () => {
  const dates = expandWeeklyThrough([WED], "2026-06-03", "2026-12-30");
  assert.equal(dates[0], "2026-06-03");
  assert.equal(dates[dates.length - 1] <= "2026-12-30", true);
  assert.equal(dates.includes("2026-12-30"), true);
  assert.equal(dates.includes("2027-01-06"), false);
  for (const date of dates) {
    assert.equal(new Date(`${date}T00:00:00.000Z`).getUTCDay(), WED);
  }
  assert.throws(() => expandWeeklyThrough([WED], "2026-06-03", ""), /season end/);
  assert.throws(() => expandWeeklyThrough([WED], "2026-06-03", "December 30"), /season end/);
});

test("boundWeeklySeries drops dates past the season and cancelled dedup keys", () => {
  const events = [
    { name: "Storytime with Miss Debbie", date: "2026-12-23", town: "Arnold" },
    { name: "Storytime with Miss Debbie", date: "2026-12-30", town: "Arnold" },
    { name: "Storytime with Miss Debbie", date: "2027-01-06", town: "Arnold" },
    { name: "Storytime with Miss Debbie", date: "not-a-date", town: "Arnold" },
  ];
  const cancelled = generateDedupKey(events[0].name, events[0].date, events[0].town);
  const kept = boundWeeklySeries(events, {
    seasonEnd: "2026-12-30",
    cancelledDedupKeys: new Set([cancelled]),
  });
  assert.deepEqual(
    kept.map((e) => e.date),
    ["2026-12-30"]
  );
  assert.throws(() => boundWeeklySeries(events, { seasonEnd: " " }), /season end/);
});

test("omitCancelledOccurrences keeps every other date and is a no-op on an empty set", () => {
  const events = [
    { name: "Creek Critters", date: "2026-08-15", town: "Arnold", note: "keep" },
    { name: "Creek Critters", date: "2026-08-11", town: "Arnold", note: "drop" },
  ];
  const key = generateDedupKey(events[1].name, events[1].date, events[1].town);
  const kept = omitCancelledOccurrences(events, new Set([key]));
  assert.deepEqual(
    kept.map((e) => e.date),
    ["2026-08-15"]
  );
  assert.equal(kept[0].note, "keep");
  assert.equal(omitCancelledOccurrences(events, new Set()).length, events.length);
});

test("production scripts expand weekly series only through expandWeeklyThrough", () => {
  const offenders: string[] = [];
  for (const path of tsFiles(scriptsRoot)) {
    const rel = relative(scriptsRoot, path);
    if (rel.startsWith("test/")) continue;
    if (rel === "lib/recurrence.ts" || rel === "lib/series-bounds.ts") continue;
    const src = readFileSync(path, "utf8");
    if (directExpandWeeklyCalls(src) > 0) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

test("a generator that expands and writes drops cancelled dates first", () => {
  for (const path of tsFiles(scriptsRoot)) {
    const rel = relative(scriptsRoot, path);
    if (rel.startsWith("test/")) continue;
    const src = readFileSync(path, "utf8");
    if (!src.includes("expandWeeklyThrough(")) continue;
    const writes = /upsertEvents\s*\(|\.insert\s*\(/.test(src);
    if (!writes) continue;
    const filterAt = Math.max(
      src.indexOf("omitCancelledOccurrences("),
      src.indexOf("boundWeeklySeries(")
    );
    const writeAt = (() => {
      const upsert = src.indexOf("upsertEvents(");
      const insert = src.indexOf(".insert(");
      const hits = [upsert, insert].filter((n) => n >= 0);
      return hits.length ? Math.min(...hits) : -1;
    })();
    assert.ok(filterAt >= 0, `${rel} expands a weekly series and writes rows without skipping cancelled dates`);
    assert.ok(writeAt > filterAt, `${rel} must drop cancelled dates before the write`);
  }
});

// Regression lock for the pure scraper-health shaping (lib/scraper-health.ts).
// Drives the /admin/scrapers operational-health tab and the weekly
// scraper-health memo.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rollupBySource,
  runStatus,
  formatDuration,
  currentlyErroring,
  type ScrapeRunRow,
} from "../../lib/scraper-health.js";

function run(
  startedAt: string,
  sourceResults: ScrapeRunRow["source_results"],
  sourcesErrored: number
): ScrapeRunRow {
  return {
    id: startedAt,
    started_at: startedAt,
    completed_at: startedAt,
    duration_ms: 60000,
    sources_attempted: Object.keys(sourceResults).length,
    sources_errored: sourcesErrored,
    total_inserted: 0,
    total_updated: 0,
    source_results: sourceResults,
  };
}

const ok = (inserted = 0, updated = 0) => ({ inserted, updated, unchanged: 0, skippedFuzzy: 0, error: null });
const failed = (msg: string) => ({ inserted: 0, updated: 0, unchanged: 0, skippedFuzzy: 0, error: msg });

test("runStatus: no sources attempted reads as no-data, not clean", () => {
  assert.equal(runStatus(run("2026-07-08", {}, 0)), "no-data");
});

test("runStatus: any errored source flips the whole run to errors", () => {
  const r = run("2026-07-08", { "visit-murphys": failed("403") }, 1);
  assert.equal(runStatus(r), "errors");
});

test("runStatus: clean when every source succeeded", () => {
  const r = run("2026-07-08", { "fb-discover-arnold": ok(2, 1) }, 0);
  assert.equal(runStatus(r), "clean");
});

test("rollupBySource: sums inserted/updated across runs and tracks first error/ok seen", () => {
  const runs = [
    run("2026-07-08", { "visit-murphys": failed("403 on page 1") }, 1),
    run("2026-07-07", { "visit-murphys": ok(1, 0) }, 0),
    run("2026-07-06", { "visit-murphys": failed("bad json") }, 1),
  ];
  const [rollup] = rollupBySource(runs);
  assert.equal(rollup.key, "visit-murphys");
  assert.equal(rollup.runsSeen, 3);
  assert.equal(rollup.errorRuns, 2);
  assert.equal(rollup.totalInserted, 1);
  // "last" here means first-in-input, i.e. most recent when callers pass
  // newest-first (as the admin page and memo context both do).
  assert.equal(rollup.lastErrorAt, "2026-07-08");
  assert.equal(rollup.lastOkAt, "2026-07-07");
});

test("currentlyErroring: excludes a source whose most recent run succeeded", () => {
  const runs = [
    run("2026-07-08", { "visit-murphys": ok(1, 0) }, 0),
    run("2026-07-07", { "visit-murphys": failed("403") }, 1),
  ];
  const rollups = rollupBySource(runs);
  assert.deepEqual(currentlyErroring(rollups), []);
});

test("currentlyErroring: includes a source that has never once succeeded", () => {
  const runs = [run("2026-07-08", { "new-source": failed("timeout") }, 1)];
  const rollups = rollupBySource(runs);
  assert.equal(currentlyErroring(rollups).length, 1);
  assert.equal(currentlyErroring(rollups)[0].key, "new-source");
});

test("formatDuration formats minutes+seconds and bare seconds", () => {
  assert.equal(formatDuration(538000), "8m 58s");
  assert.equal(formatDuration(45000), "45s");
});

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
  findInsertRateAnomalies,
  INSERT_RATE_ANOMALY_MEDIAN_THRESHOLD,
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

test("findInsertRateAnomalies: a sustained high-insert source flags (the pub case)", () => {
  const runs = [
    run("2026-08-09", { "murphys-irish-pub": ok(11) }, 0),
    run("2026-08-08", { "murphys-irish-pub": ok(9) }, 0),
    run("2026-08-07", { "murphys-irish-pub": ok(10) }, 0),
    run("2026-08-06", { "murphys-irish-pub": ok(8) }, 0),
  ];
  const anomalies = findInsertRateAnomalies(runs);
  assert.equal(anomalies.length, 1);
  assert.deepEqual(anomalies[0], { source: "murphys-irish-pub", runCount: 4, medianInserted: 9.5 });
});

test("findInsertRateAnomalies: a normal steady-state source (median 0-3/run) does not flag", () => {
  const runs = [
    run("2026-08-09", { "arnold-rim-trail": ok(1) }, 0),
    run("2026-08-08", { "arnold-rim-trail": ok(0) }, 0),
    run("2026-08-07", { "arnold-rim-trail": ok(2) }, 0),
    run("2026-08-06", { "arnold-rim-trail": ok(3) }, 0),
  ];
  assert.deepEqual(findInsertRateAnomalies(runs), []);
});

test("findInsertRateAnomalies: a one-off spike does not flag (the median stays low)", () => {
  const runs = [
    run("2026-08-09", { "gocalaveras": ok(0) }, 0),
    run("2026-08-08", { "gocalaveras": ok(1) }, 0),
    run("2026-08-07", { "gocalaveras": ok(20) }, 0), // one big legitimate batch, not sustained
    run("2026-08-06", { "gocalaveras": ok(0) }, 0),
    run("2026-08-05", { "gocalaveras": ok(1) }, 0),
  ];
  assert.deepEqual(findInsertRateAnomalies(runs), []);
});

test("findInsertRateAnomalies: fewer than MIN_RUNS never flags, even at a high median", () => {
  const runs = [
    run("2026-08-09", { "brand-new-source": ok(10) }, 0),
    run("2026-08-08", { "brand-new-source": ok(12) }, 0),
  ];
  assert.deepEqual(findInsertRateAnomalies(runs), []);
});

test("findInsertRateAnomalies: median exactly at the threshold flags (>=, not >)", () => {
  const runs = [
    run("2026-08-09", { "boundary-source": ok(INSERT_RATE_ANOMALY_MEDIAN_THRESHOLD) }, 0),
    run("2026-08-08", { "boundary-source": ok(INSERT_RATE_ANOMALY_MEDIAN_THRESHOLD) }, 0),
    run("2026-08-07", { "boundary-source": ok(INSERT_RATE_ANOMALY_MEDIAN_THRESHOLD) }, 0),
  ];
  const anomalies = findInsertRateAnomalies(runs);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].medianInserted, INSERT_RATE_ANOMALY_MEDIAN_THRESHOLD);
});

test("findInsertRateAnomalies: sorts worst-median-first and only flags the anomalous source", () => {
  const runs = [
    run(
      "2026-08-09",
      { "murphys-irish-pub": ok(20), "boundary-source": ok(5), "arnold-rim-trail": ok(1) },
      0
    ),
    run(
      "2026-08-08",
      { "murphys-irish-pub": ok(18), "boundary-source": ok(5), "arnold-rim-trail": ok(2) },
      0
    ),
    run(
      "2026-08-07",
      { "murphys-irish-pub": ok(19), "boundary-source": ok(5), "arnold-rim-trail": ok(0) },
      0
    ),
  ];
  const anomalies = findInsertRateAnomalies(runs);
  assert.deepEqual(
    anomalies.map((a) => a.source),
    ["murphys-irish-pub", "boundary-source"]
  );
});

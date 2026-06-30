// Regression lock for the scrape-health state machine (lib/scrape-health.ts),
// the rule that decides when a source counts as fail / lapse / never-ran and
// therefore alarms. The whole point of the feature is that this verdict is
// correct, so it's pinned here — especially the two adversarial cases:
//   - the Facebook scrapers swallow their Apify 401 and return "ok", so telemetry
//     must NOT mask a real outage (liveness has to win for upsert sources);
//   - Blue Lake Springs is insert-only, so its liveness clock ages even on a
//     healthy week, and a recent good run must rescue it from a false alarm.
//
// Run: `cd scripts && npm test`  (node --test + tsx, zero extra deps)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveSourceState,
  isDegradedState,
  GRACE_DAYS,
  EXPECTED_SOURCES,
  MANUAL_SOURCES,
} from "../../lib/scrape-health.js";

// Default to a quiet liveness source with no signal; override per case.
const state = (o: Partial<Parameters<typeof deriveSourceState>[0]>) =>
  deriveSourceState({
    cadence: "daily",
    freshness: "liveness",
    daysSinceSuccess: null,
    daysSinceGoodRun: null,
    lastRunStatus: null,
    ...o,
  });

test("a hard run error is failing, regardless of liveness", () => {
  assert.equal(state({ daysSinceSuccess: 0, lastRunStatus: "failed" }), "failing");
  assert.equal(state({ cadence: "weekly", lastRunStatus: "failed" }), "failing");
  assert.equal(isDegradedState("failing"), true);
});

test("liveness drives ok vs stale against the cadence grace", () => {
  assert.equal(state({ daysSinceSuccess: 0.1, lastRunStatus: "ok" }), "ok");
  assert.equal(state({ daysSinceSuccess: 2, lastRunStatus: "ok" }), "ok");
  assert.equal(state({ daysSinceSuccess: 4.2 }), "stale");
  assert.equal(state({ cadence: "weekly", daysSinceSuccess: 4 }), "ok");
  assert.equal(state({ cadence: "weekly", daysSinceSuccess: 21.1 }), "stale");
  assert.equal(isDegradedState("stale"), true);
  assert.equal(isDegradedState("ok"), false);
});

test("Facebook error-swallow: a fresh 'ok' run must NOT mask a stale liveness clock", () => {
  // fb-discover runs daily without throwing (it returns [] on an Apify 401), so
  // its last good run is today — but it has produced nothing for 40 days. Liveness
  // must win, or the exact 40-day outage we built this for goes undetected.
  assert.equal(
    state({ daysSinceSuccess: 40, daysSinceGoodRun: 0, lastRunStatus: "ok" }),
    "stale"
  );
});

test("insert-only source (run freshness): a recent good run rescues an aged liveness clock", () => {
  // BLS only inserts new flyers, so last_scraped_at ages even on a healthy week.
  // A good run today keeps it OK despite 21-day-old liveness.
  assert.equal(
    state({ cadence: "weekly", freshness: "run", daysSinceSuccess: 21, daysSinceGoodRun: 0.1, lastRunStatus: "ok" }),
    "ok"
  );
  // ...but with no run telemetry yet, it falls back to liveness and reads stale
  // (honest: we can't confirm the cron is running).
  assert.equal(
    state({ cadence: "weekly", freshness: "run", daysSinceSuccess: 21, daysSinceGoodRun: null }),
    "stale"
  );
  // A run source whose cron actually stopped (no good run, stale liveness) alarms.
  assert.equal(
    state({ cadence: "weekly", freshness: "run", daysSinceSuccess: 30, daysSinceGoodRun: 30, lastRunStatus: "empty" }),
    "stale"
  );
});

test("a source that has never produced is informational, not an alarm", () => {
  assert.equal(state({ daysSinceSuccess: null, lastRunStatus: null }), "never_ran");
  assert.equal(isDegradedState("never_ran"), false);
  assert.equal(state({ daysSinceSuccess: null, lastRunStatus: "ok" }), "empty");
  assert.equal(state({ daysSinceSuccess: null, lastRunStatus: "empty" }), "empty");
  assert.equal(isDegradedState("empty"), false);
});

test("the three real dark sources resolve to degraded; the live ones do not", () => {
  // fb-discover-arnold (40d daily liveness), visit-murphys (throws 403),
  // blue-lake-springs (21d, run-freshness, no telemetry yet)
  assert.equal(state({ daysSinceSuccess: 40 }), "stale");
  assert.equal(state({ daysSinceSuccess: 30.2, lastRunStatus: "failed" }), "failing");
  assert.equal(state({ cadence: "weekly", freshness: "run", daysSinceSuccess: 21.1 }), "stale");
  // gocalaveras / moose-lodge ran and produced today
  assert.equal(state({ daysSinceSuccess: 0.1, lastRunStatus: "ok" }), "ok");
  assert.equal(state({ cadence: "weekly", daysSinceSuccess: 0, lastRunStatus: "ok" }), "ok");
});

test("grace windows are sane (daily tighter than weekly)", () => {
  assert.ok(GRACE_DAYS.daily < GRACE_DAYS.weekly);
  assert.equal(GRACE_DAYS.daily, 2);
  assert.equal(GRACE_DAYS.weekly, 9);
});

test("registries do not overlap: a manual source is never health-checked", () => {
  const expected = new Set(EXPECTED_SOURCES.map((s) => s.org_slug));
  for (const slug of Object.keys(MANUAL_SOURCES)) {
    assert.equal(expected.has(slug), false, `${slug} is in both EXPECTED_SOURCES and MANUAL_SOURCES`);
  }
  assert.equal(expected.size, EXPECTED_SOURCES.length, "duplicate org_slug in EXPECTED_SOURCES");
  for (const s of EXPECTED_SOURCES) {
    assert.ok(s.cadence in GRACE_DAYS, `${s.org_slug} has an unknown cadence`);
  }
});

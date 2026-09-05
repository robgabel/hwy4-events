// Locks the GoCalaveras enrichment accounting (roadmap ticket HWY-32).
//
// The bug: on 2026-09-04 every detail-page fetch returned HTTP 429 and the run
// still logged "Enriched 130/130 events from detail pages", because the summary
// counted attempts rather than successes. A total enrichment outage rendered as
// a perfect score, while new rows landed with no description, poster, venue name
// or address (the shape that fed the Arnold Angels location red runs).
//
// So the assertions that matter are the ones about a run that FAILED: the count
// must fall, the reason must be named, and the operator must get a warning.
//
// Pure module, no network. Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CIRCUIT_BREAK_CONSECUTIVE_429,
  RATE_LIMIT_WARN_RATIO,
  attempted,
  classifyStatus,
  emptyTally,
  retryDelayMs,
  shouldTripCircuit,
  summarizeEnrichment,
  tallyOutcome,
  type EnrichOutcome,
} from "../lib/enrich-report.js";

const tallyOf = (outcomes: EnrichOutcome[]) => {
  const t = emptyTally();
  for (const o of outcomes) tallyOutcome(t, o);
  return t;
};

test("a fully rate-limited run reports ZERO enriched, not the attempt count", () => {
  // The exact Sep 4 shape, scaled down.
  const t = tallyOf(Array(10).fill("rate_limited" as const));
  const { line, warning } = summarizeEnrichment(t, 10);

  assert.match(line, /Enriched 0\/10/, "the old code printed 130/130 here");
  assert.doesNotMatch(line, /Enriched 10\/10/);
  assert.match(line, /10 rate-limited \(429\)/);
  assert.ok(warning, "a total 429 wall must warn");
  assert.match(warning!, /rate-limited/i);
});

test("a clean run reads clean, with no warning and no noise", () => {
  const t = tallyOf(Array(10).fill("enriched" as const));
  const { line, warning } = summarizeEnrichment(t, 10);
  assert.equal(line.trim(), "Enriched 10/10 events from detail pages");
  assert.equal(warning, null);
});

test("a 200 that yields no fields counts as empty, not enriched", () => {
  // Otherwise a detail-page markup change reads as a perfect run forever.
  const t = tallyOf(["empty", "empty", "enriched"]);
  const { line } = summarizeEnrichment(t, 3);
  assert.match(line, /Enriched 1\/3/);
  assert.match(line, /2 no detail fields/);
});

test("zero enriched across a whole run warns even when nothing was throttled", () => {
  const t = tallyOf(["empty", "empty", "empty"]);
  const { warning } = summarizeEnrichment(t, 3);
  assert.ok(warning);
  assert.match(warning!, /produced NOTHING/);
});

test("the warning threshold fires at the documented ratio, not before", () => {
  // 1 in 10 throttled: under the bar, no warning.
  const under = tallyOf([...Array(9).fill("enriched" as const), "rate_limited"]);
  assert.equal(summarizeEnrichment(under, 10).warning, null);
  assert.ok(1 / 10 < RATE_LIMIT_WARN_RATIO);

  // 2 in 10: at the bar, warn.
  const at = tallyOf([...Array(8).fill("enriched" as const), "rate_limited", "rate_limited"]);
  const w = summarizeEnrichment(at, 10).warning;
  assert.ok(w, "20% throttled must warn");
  assert.match(w!, /20%/);
});

test("a tripped circuit breaker is reported as skipped work, not success", () => {
  const t = tallyOf([
    ...Array(CIRCUIT_BREAK_CONSECUTIVE_429).fill("rate_limited" as const),
    ...Array(50).fill("skipped" as const),
  ]);
  const { line, warning } = summarizeEnrichment(t, 62);
  assert.match(line, /Enriched 0\/62/);
  assert.match(line, /50 skipped after circuit break/);
  assert.ok(warning);
  assert.match(warning!, /CIRCUIT BROKE/);
  // Skipped requests were never attempted, so they must not dilute the ratio.
  assert.equal(attempted(t), CIRCUIT_BREAK_CONSECUTIVE_429);
});

test("only 429 is rate limiting; other failures are their own bucket", () => {
  assert.equal(classifyStatus(429), "rate_limited");
  assert.equal(classifyStatus(403), "http_error");
  assert.equal(classifyStatus(500), "http_error");
  const t = tallyOf(["http_error", "network_error"]);
  const { line } = summarizeEnrichment(t, 2);
  assert.match(line, /1 http error/);
  assert.match(line, /1 network error/);
});

test("the breaker trips only on CONSECUTIVE throttling", () => {
  assert.equal(shouldTripCircuit(CIRCUIT_BREAK_CONSECUTIVE_429 - 1), false);
  assert.equal(shouldTripCircuit(CIRCUIT_BREAK_CONSECUTIVE_429), true);
  // A run that recovers between 429s never trips it (the counter resets in
  // enrichEvents), so an intermittent limiter still gets full coverage.
  assert.equal(shouldTripCircuit(0), false);
});

test("Retry-After is honored, and a hostile one cannot park the scrape", () => {
  assert.equal(retryDelayMs("2", 1500, 5000), 2000, "delta-seconds honored");
  assert.equal(retryDelayMs(null, 1500, 5000), 1500, "missing header falls back");
  assert.equal(retryDelayMs("", 1500, 5000), 1500);
  assert.equal(retryDelayMs("600", 1500, 5000), 5000, "10 minutes must be capped");
  // An HTTP-date Retry-After is legal but not delta-seconds; fall back rather
  // than parse a date into NaN and sleep forever.
  assert.equal(retryDelayMs("Wed, 21 Oct 2026 07:28:00 GMT", 1500, 5000), 1500);
  assert.equal(retryDelayMs("-5", 1500, 5000), 1500, "negative is not a delay");
});

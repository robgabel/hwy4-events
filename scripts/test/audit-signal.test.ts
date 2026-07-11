// Regression lock for the data-quality audit signal (lib/agent/audit-signal.ts).
//
// The bug this closes (2026-07-10): /api/check-events posted "11 unresolved
// venues / 15 missing addresses" to Slack at 18:00 UTC, and an hour later the
// chief-of-staff headlined "all quiet" in the same channel, because the audit
// persisted nothing and the digest read nothing. The audit now stashes its
// summary in site_config; these tests lock the parse + the deterministic
// digest items so the mention never depends on the model.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_MAX_AGE_HOURS,
  auditAlarmItem,
  auditBacklogItem,
  ensureAuditItems,
  parseAuditSignal,
  type AuditSignal,
} from "../../lib/agent/audit-signal.js";
import { emptyDigest } from "../../lib/agent/types.js";

const NOW = Date.parse("2026-07-10T19:00:00Z");

/** A persisted summary shaped like the 2026-07-10 audit that exposed the gap. */
function rawSummary(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    audited_at: "2026-07-10T18:00:05Z",
    total_future_events: 973,
    issues: {
      duplicates: 0,
      same_event_duplicates: 0,
      hidden: 0,
      missing_venue: 0,
      unresolved_venue: 11,
      unresolved_address: 15,
      invalid_category: 0,
      missing_image_bls: 0,
      stale_scrapes: 0,
    },
    actionable_link_gaps: 0,
    analytics_stale: false,
    analytics_stale_reason: null,
    samples: {
      unresolved_venue: ['"Bocce fun!" (2026-09-10, venue="Downtown Murphys")'],
      unresolved_address: ['"Karaoke at The Murphys Irish Pub" @ Murphys Irish Pub (2026-07-10)'],
    },
    ...overrides,
  });
}

test("parseAuditSignal reads the persisted summary", () => {
  const signal = parseAuditSignal(rawSummary(), NOW);
  assert.ok(signal);
  assert.equal(signal.open_issues, 26);
  assert.equal(signal.issues.unresolved_venue, 11);
  assert.equal(signal.issues.unresolved_address, 15);
  // zero-count classes are dropped, not carried as noise
  assert.equal("duplicates" in signal.issues, false);
  assert.equal(signal.hours_old, 0);
  assert.equal(signal.stale, false);
  assert.equal(signal.analytics_stale, false);
  assert.equal(signal.samples.unresolved_venue.length, 1);
});

test("parseAuditSignal returns null on missing/garbage input", () => {
  assert.equal(parseAuditSignal(null, NOW), null);
  assert.equal(parseAuditSignal(undefined, NOW), null);
  assert.equal(parseAuditSignal("", NOW), null);
  assert.equal(parseAuditSignal("not json", NOW), null);
  assert.equal(parseAuditSignal("[1,2,3]", NOW), null);
  assert.equal(parseAuditSignal(JSON.stringify({ issues: {} }), NOW), null); // no audited_at
  assert.equal(
    parseAuditSignal(JSON.stringify({ audited_at: "not a date" }), NOW),
    null
  );
});

test("an audit older than the max age is stale", () => {
  const old = parseAuditSignal(
    rawSummary({ audited_at: "2026-07-08T18:00:00Z" }),
    NOW
  );
  assert.ok(old);
  assert.ok(old.hours_old > AUDIT_MAX_AGE_HOURS);
  assert.equal(old.stale, true);
});

test("backlog item carries the total and the biggest classes", () => {
  const signal = parseAuditSignal(rawSummary(), NOW) as AuditSignal;
  const item = auditBacklogItem(signal);
  assert.ok(item);
  assert.match(item.title, /26 open item/);
  assert.match(item.detail, /15 event\(s\) with no precise address/);
  assert.match(item.detail, /11 event\(s\) with an unresolved venue/);
  assert.match(item.detail, /Bocce fun!/); // names a concrete example
});

test("a clean audit earns no backlog item", () => {
  const signal = parseAuditSignal(
    rawSummary({ issues: {}, samples: {} }),
    NOW
  ) as AuditSignal;
  assert.equal(signal.open_issues, 0);
  assert.equal(auditBacklogItem(signal), null);
});

test("link gaps count toward the backlog even with zero issues", () => {
  const signal = parseAuditSignal(
    rawSummary({ issues: {}, actionable_link_gaps: 2, samples: {} }),
    NOW
  ) as AuditSignal;
  const item = auditBacklogItem(signal);
  assert.ok(item);
  assert.match(item.title, /2 open item/);
  assert.match(item.detail, /2 venue\(s\) worth a durable link/);
});

test("analytics staleness earns a needs_you alarm", () => {
  const signal = parseAuditSignal(
    rawSummary({
      analytics_stale: true,
      analytics_stale_reason: "latest snapshot is 2026-07-07 (3 days behind)",
    }),
    NOW
  ) as AuditSignal;
  const alarm = auditAlarmItem(signal);
  assert.ok(alarm);
  assert.match(alarm.detail, /3 days behind/);
  assert.ok(alarm.why);
});

test("a stale audit earns the dead-watchdog alarm over the analytics one", () => {
  const signal = parseAuditSignal(
    rawSummary({ audited_at: "2026-07-07T18:00:00Z", analytics_stale: true }),
    NOW
  ) as AuditSignal;
  const alarm = auditAlarmItem(signal);
  assert.ok(alarm);
  assert.match(alarm.title, /audit has stopped running/);
});

test("ensureAuditItems appends backlog to watching when nothing mentions it", () => {
  const digest = emptyDigest("Quiet day.");
  const signal = parseAuditSignal(rawSummary(), NOW) as AuditSignal;
  ensureAuditItems(digest, signal);
  assert.equal(digest.needs_you.length, 0);
  assert.equal(digest.watching.length, 1);
  assert.match(digest.watching[0].title, /backlog/i);
});

test("ensureAuditItems does not duplicate a model mention", () => {
  const digest = emptyDigest("Quiet, 26 data-quality items on the standing backlog.");
  digest.watching.push({
    title: "Data-quality backlog holding at 26",
    detail: "11 unresolved venues and 15 missing addresses, unchanged.",
  });
  const signal = parseAuditSignal(rawSummary(), NOW) as AuditSignal;
  ensureAuditItems(digest, signal);
  assert.equal(digest.watching.length, 1);
});

test("ensureAuditItems escalates an alarm to needs_you", () => {
  const digest = emptyDigest("Quiet day.");
  const signal = parseAuditSignal(
    rawSummary({ analytics_stale: true, analytics_stale_reason: "0 pageviews captured" }),
    NOW
  ) as AuditSignal;
  ensureAuditItems(digest, signal);
  assert.equal(digest.needs_you.length, 1);
  assert.match(digest.needs_you[0].title, /analytics/i);
});

test("ensureAuditItems is a no-op without a signal", () => {
  const digest = emptyDigest("Quiet day.");
  ensureAuditItems(digest, null);
  assert.equal(digest.needs_you.length, 0);
  assert.equal(digest.fyi.length, 0);
  assert.equal(digest.watching.length, 0);
});

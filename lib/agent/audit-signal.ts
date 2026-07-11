// Data-quality audit signal for the chief-of-staff digest.
//
// /api/check-events (18:00 UTC) computes the daily data-quality audit and
// Slack-posts it, but until 2026-07-11 it persisted nothing, so the
// chief-of-staff (19:00 UTC) was structurally blind to it and could headline
// "all quiet" an hour after the audit listed 26 open items in the same Slack
// channel. The audit now stashes a compact summary in site_config
// (AUDIT_SIGNAL_KEY); this module parses it defensively and provides the
// deterministic digest items, so the mention never depends on the model
// choosing to bring it up (same contract as picks-runway.ts).
//
// Pure and relative-imported so scripts/test/audit-signal.test.ts can lock it.

import type { Digest, DigestItem } from "./types";

/** site_config key the audit route upserts its summary under. */
export const AUDIT_SIGNAL_KEY = "latest_audit_summary";

/**
 * An audit older than this is treated as stale: the audit runs daily at 18:00
 * UTC and the digest at 19:00 UTC, so anything past ~a day and a half means
 * the audit cron itself has stopped.
 */
export const AUDIT_MAX_AGE_HOURS = 36;

export type AuditSignal = {
  audited_at: string;
  /** Age of the audit at digest time, whole hours. */
  hours_old: number;
  /** True when the audit is older than AUDIT_MAX_AGE_HOURS. */
  stale: boolean;
  total_future_events: number | null;
  /** Per-class open counts (duplicates, unresolved_venue, unresolved_address, …). */
  issues: Record<string, number>;
  /** Sum of the issue counts: the standing data-quality backlog. */
  open_issues: number;
  /** Single-operator venues worth an hwy4_orgs row (the link-gap worklist). */
  actionable_link_gaps: number;
  analytics_stale: boolean;
  analytics_stale_reason: string | null;
  /** A few concrete examples per class so the digest can name names. */
  samples: Record<string, string[]>;
};

/**
 * Parse the persisted audit summary. Never throws; returns null on a missing
 * row, unparseable JSON, or a shape without audited_at (the digest then simply
 * says nothing about the audit, as it did before this signal existed).
 */
export function parseAuditSignal(raw: string | null | undefined, nowMs: number): AuditSignal | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.audited_at !== "string") return null;
  const auditedMs = Date.parse(o.audited_at);
  if (Number.isNaN(auditedMs)) return null;

  const issues: Record<string, number> = {};
  if (o.issues && typeof o.issues === "object") {
    for (const [k, v] of Object.entries(o.issues as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) issues[k] = n;
    }
  }

  const samples: Record<string, string[]> = {};
  if (o.samples && typeof o.samples === "object") {
    for (const [k, v] of Object.entries(o.samples as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        const list = v.filter((s): s is string => typeof s === "string").slice(0, 5);
        if (list.length > 0) samples[k] = list;
      }
    }
  }

  const hoursOld = Math.max(0, Math.floor((nowMs - auditedMs) / 3_600_000));
  return {
    audited_at: o.audited_at,
    hours_old: hoursOld,
    stale: hoursOld > AUDIT_MAX_AGE_HOURS,
    total_future_events:
      Number.isFinite(Number(o.total_future_events)) && o.total_future_events != null
        ? Number(o.total_future_events)
        : null,
    issues,
    open_issues: Object.values(issues).reduce((a, b) => a + b, 0),
    actionable_link_gaps: Number.isFinite(Number(o.actionable_link_gaps))
      ? Math.max(0, Number(o.actionable_link_gaps))
      : 0,
    analytics_stale: o.analytics_stale === true,
    analytics_stale_reason:
      typeof o.analytics_stale_reason === "string" ? o.analytics_stale_reason : null,
    samples,
  };
}

const ISSUE_LABELS: Record<string, string> = {
  duplicates: "duplicate group(s)",
  same_event_duplicates: "same-event duplicate(s)",
  hidden: "hidden future event(s)",
  missing_venue: "event(s) missing a venue",
  unresolved_venue: "event(s) with an unresolved venue",
  unresolved_address: "event(s) with no precise address",
  invalid_category: "event(s) with a bad category",
  missing_image_bls: "BLS event(s) missing a flyer",
  stale_scrapes: "stale scrape(s)",
};

function describeIssues(signal: AuditSignal): string {
  const parts = Object.entries(signal.issues)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${ISSUE_LABELS[k] ?? k.replace(/_/g, " ")}`);
  if (signal.actionable_link_gaps > 0) {
    parts.push(`${signal.actionable_link_gaps} venue(s) worth a durable link`);
  }
  return parts.join(", ");
}

/**
 * The standing-backlog item the audit earns, or null when clean. Backlog goes
 * in `watching`, not `needs_you`: these are slow-burn registry chores
 * (add a venue to scripts/lib/venues.ts, add an hwy4_orgs row), not decisions
 * with a today deadline. It still must be SAID, so "all quiet" stays honest.
 */
export function auditBacklogItem(signal: AuditSignal): DigestItem | null {
  const total = signal.open_issues + signal.actionable_link_gaps;
  if (total === 0) return null;
  const sample = Object.values(signal.samples)[0]?.[0];
  return {
    title: `Data-quality backlog: ${total} open item(s)`,
    detail:
      `Yesterday's audit found ${describeIssues(signal)}.` +
      (sample ? ` Example: ${sample}.` : "") +
      " Standing registry work, not urgent, but it does not clear itself.",
  };
}

/**
 * The needs_you item an analytics-staleness alarm or a dead audit cron earns,
 * or null. These ARE today problems: un-snapshotted analytics days are lost
 * for good past Cloudflare's short retention, and a silent audit means the
 * whole data-quality watchdog is off.
 */
export function auditAlarmItem(signal: AuditSignal): DigestItem | null {
  if (signal.stale) {
    return {
      title: "The daily data-quality audit has stopped running",
      detail: `The latest /api/check-events summary is ${signal.hours_old} hours old (it should run daily at 18:00 UTC). Until it runs, duplicates and data drift go unwatched.`,
      why: "The audit is the watchdog for every scraper write path. A dead watchdog fails silent.",
    };
  }
  if (signal.analytics_stale) {
    return {
      title: "Analytics snapshot is stale",
      detail:
        signal.analytics_stale_reason ??
        "The daily analytics snapshot has fallen behind.",
      why: "Cloudflare's RUM API only serves ~3 weeks back, so days that go un-snapshotted are lost for good.",
    };
  }
  return null;
}

/**
 * Deterministic backstop: make sure the digest carries the audit signal when
 * one is warranted. Skips buckets that already mention it (the reasoner sees
 * the same signal and may have covered it). Mutates in place, same pattern as
 * ensurePicksRunwayItem.
 */
export function ensureAuditItems(digest: Digest, signal: AuditSignal | null): void {
  if (!signal) return;
  const allBuckets = [digest.needs_you, digest.fyi, digest.watching];
  const mentioned = (re: RegExp) =>
    allBuckets.some((bucket) => bucket.some((i) => re.test(`${i.title} ${i.detail}`)));

  const alarm = auditAlarmItem(signal);
  if (alarm && !mentioned(/analytics|audit/i)) digest.needs_you.push(alarm);

  const backlog = auditBacklogItem(signal);
  if (backlog && !mentioned(/backlog|data.quality|unresolved|audit/i)) {
    digest.watching.push(backlog);
  }
}

// Notices when a scrape source throws, the GitHub job dies, or the schedule
// never fires. Issue #345. Rob reads the inbox, not Slack, so these are
// proposed agent_actions rows.
//
// The type is the existing `schedule_watch_alert` (the Big Trees watcher).
// `agent_actions.type` is unconstrained text, so this needs no migration and
// no new policy row. `reversible: false` keeps canAutoExecute false even if a
// policy row is later flipped on. Reject dismisses the row. Approving it does
// not change events (there is no executor handler).
//
// payload.alert = "scrape" keeps these out of the Big Trees duplicate check,
// which matches on kind + fingerprint and never sets `alert`.

import { canAutoExecute } from "./agent/policy";
import { scrapeRunAgeMs, scrapeRunIsOverdue } from "./audit-checks";
import { SCHEDULE_WATCH_ACTION_TYPE } from "./bigtrees-watch";

export const SCRAPE_ALERT_TYPE = SCHEDULE_WATCH_ACTION_TYPE;
export const SCRAPE_ERROR_SNIPPET_CHARS = 200;

export type ScrapeAlertKind =
  | "source_errors"
  | "nulled_links"
  | "spared_hosts"
  | "validation"
  | "job_failed"
  | "missed_run";

export type ScrapeSourceError = { source: string; message: string };

export type ScrapeAlertPayload = {
  alert: "scrape";
  kind: ScrapeAlertKind;
  /** Stable identity for "an open row already covers this incident". */
  fingerprint: string;
  run_url: string | null;
  sources?: ScrapeSourceError[];
  nulled?: number;
  spared_hosts?: string[];
  validation_error?: string | null;
  job_result?: string;
  failed_step?: string;
  scrape_outcome?: string | null;
  sanity_outcome?: string | null;
  started_at?: string | null;
  age_hours?: number | null;
};

export type ScrapeAlertRow = {
  type: typeof SCRAPE_ALERT_TYPE;
  title: string;
  rationale: string;
  payload: ScrapeAlertPayload;
  blast_radius: "low";
  reversible: false;
  outward_facing: false;
  status: "proposed";
};

const DISMISS =
  "Reject this row once it has been handled. Approving it does not change events.";

/** First ~200 characters of an error, one line, so a notice stays scannable. */
export function errorSnippet(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  const text = flat || "(no message)";
  return text.length <= SCRAPE_ERROR_SNIPPET_CHARS
    ? text
    : text.slice(0, SCRAPE_ERROR_SNIPPET_CHARS);
}

/** `process.env`, or a test double. Index signature so a partial env still typechecks. */
export type ScrapeAlertEnv = { [key: string]: string | undefined };

export function scrapeRunUrlFromEnv(env: ScrapeAlertEnv): string | null {
  const server = env.GITHUB_SERVER_URL?.replace(/\/$/, "") ?? "";
  const repo = env.GITHUB_REPOSITORY ?? "";
  const id = env.GITHUB_RUN_ID ?? "";
  if (!/^https:\/\/[A-Za-z0-9.-]+$/.test(server)) return null;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
  if (!/^\d+$/.test(id)) return null;
  return `${server}/${repo}/actions/runs/${id}`;
}

function notice(title: string, rationale: string, payload: ScrapeAlertPayload): ScrapeAlertRow {
  return {
    type: SCRAPE_ALERT_TYPE,
    title,
    rationale,
    payload,
    blast_radius: "low",
    reversible: false,
    outward_facing: false,
    status: "proposed",
  };
}

function sortedSources(errors: readonly ScrapeSourceError[]): ScrapeSourceError[] {
  return [...errors]
    .map((e) => ({ source: e.source.trim(), message: errorSnippet(e.message) }))
    .filter((e) => e.source.length > 0)
    .sort((a, b) => a.source.localeCompare(b.source) || a.message.localeCompare(b.message));
}

/**
 * Stable class for a thrown error. The fingerprint uses this, not the message,
 * so a request id, a URL, or a count does not file a new inbox row.
 */
export function scrapeErrorKind(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim().toLowerCase();
  if (!flat) return "unknown";
  if (/non-json|invalid json|did not return valid json|unexpected token/.test(flat)) return "invalid-json";
  if (/missing\b.*\b(?:api_key|environment variable)|api key is unset|environment variable/.test(flat)) {
    return "missing-env";
  }
  if (/\bnonce\b|shortcode|page config/.test(flat)) return "page-config";
  const http = httpKind(flat);
  if (http) return http;
  if (/timeout|timed out|econnreset|enotfound|eai_again|fetch failed|network|socket hang up|aborted/.test(flat)) {
    return "network";
  }
  const stem = flat
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b(?:req|request|trace)[_ :=-]*[a-z0-9-]{6,}\b/g, " ")
    .replace(/\b[0-9a-f]{8,}\b/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 6)
    .join("-");
  return stem || "unknown";
}

function httpKind(flat: string): string | null {
  if (/rate.?limit/.test(flat)) return "http-429";
  const match = /\b(?:http|status)\s*(\d{3})\b|\bfailed:?\s*(\d{3})\b/.exec(flat);
  const code = match?.[1] ?? match?.[2];
  if (!code) return null;
  if (code === "429") return "http-429";
  if (code === "401" || code === "403") return `http-${code}`;
  if (code === "404" || code === "410") return "http-404";
  if (code.startsWith("5")) return "http-5xx";
  return `http-${code}`;
}

/** A quiet link check nulls a dead page or two. 139 in one day is an outage. */
export const NULLED_LINK_ALERT_MIN = 10;
/**
 * Also alert when today's count clears the recent median by this many, even
 * under the absolute minimum. A 1-link wobble does not.
 */
export const NULLED_LINK_JUMP = 8;
/** site_config key. scrape_runs is already written before the link check. */
export const NULLED_LINK_HISTORY_KEY = "scrape_nulled_link_counts";
export const NULLED_LINK_HISTORY_KEEP = 14;

export function parseNulledLinkHistory(raw: string | null | undefined): number[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const counts: number[] = [];
  for (const value of parsed) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    counts.push(Math.max(0, Math.floor(value)));
  }
  return counts.slice(-NULLED_LINK_HISTORY_KEEP);
}

export function nextNulledLinkHistory(recent: readonly number[], nulled: number): number[] {
  const n = Math.max(0, Math.floor(nulled) || 0);
  return [...recent, n].slice(-NULLED_LINK_HISTORY_KEEP);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** True when a nulled-link count is worth an inbox row. */
export function nulledLinkAlertWarranted(nulled: number, recent: readonly number[]): boolean {
  const n = Math.max(0, Math.floor(nulled) || 0);
  if (n <= 0) return false;
  if (n >= NULLED_LINK_ALERT_MIN) return true;
  const prior = recent.filter((value) => Number.isFinite(value)).map((value) => Math.max(0, Math.floor(value)));
  if (prior.length === 0) return false;
  return n >= median(prior) + NULLED_LINK_JUMP;
}

function withRun(lines: string[], runUrl: string | null): string {
  if (runUrl) lines.push(`Run: ${runUrl}`);
  lines.push(DISMISS);
  return lines.join("\n");
}

/**
 * Notices for a scrape process that exited on its own. Empty when every
 * source returned, the link check was quiet, and no host was spared.
 * Each notice has its own fingerprint, so a new source, a new error kind,
 * or a spared host does not refile the others. A thrown source does not
 * fail the GitHub job; these rows are the alert.
 */
export function buildScrapeRunAlerts(args: {
  sourceErrors: readonly ScrapeSourceError[];
  nulled: number;
  /** Nulled counts from earlier runs, oldest first. Empty means no baseline. */
  recentNulled?: readonly number[];
  sparedHosts: readonly string[];
  validationError: string | null;
  runUrl: string | null;
}): ScrapeAlertRow[] {
  const sources = sortedSources(args.sourceErrors);
  const spared = [...new Set(args.sparedHosts.map((h) => h.trim()).filter(Boolean))].sort();
  const nulled = Math.max(0, Math.floor(args.nulled) || 0);
  const recent = args.recentNulled ?? [];
  const validation = args.validationError ? errorSnippet(args.validationError) : null;
  const rows: ScrapeAlertRow[] = [];

  for (const source of sources) {
    const kind = scrapeErrorKind(source.message);
    rows.push(
      notice(`Scrape source failed: ${source.source}`, withRun([`${source.source} threw: ${source.message}`], args.runUrl), {
        alert: "scrape",
        kind: "source_errors",
        fingerprint: `source:${source.source}:${kind}`,
        run_url: args.runUrl,
        sources: [source],
      })
    );
  }

  if (nulledLinkAlertWarranted(nulled, recent)) {
    const prior = recent.filter((value) => Number.isFinite(value));
    const why =
      nulled >= NULLED_LINK_ALERT_MIN
        ? `That is at least ${NULLED_LINK_ALERT_MIN} links, above a quiet link check.`
        : `That jumps past recent runs (${prior.join(", ")}).`;
    rows.push(
      notice(
        `Scrape link check nulled ${nulled} link${nulled === 1 ? "" : "s"}`,
        withRun([`The link check nulled ${nulled} link${nulled === 1 ? "" : "s"}.`, why], args.runUrl),
        {
          alert: "scrape",
          kind: "nulled_links",
          fingerprint: "nulled",
          run_url: args.runUrl,
          nulled,
        }
      )
    );
  }

  if (spared.length > 0) {
    rows.push(
      notice(
        `Scrape link check spared ${spared.length} host${spared.length === 1 ? "" : "s"}`,
        withRun(
          [`The link check spared ${spared.join(", ")} (treated as a host problem, not dead pages).`],
          args.runUrl
        ),
        {
          alert: "scrape",
          kind: "spared_hosts",
          fingerprint: `spared:${spared.join(",")}`,
          run_url: args.runUrl,
          spared_hosts: spared,
        }
      )
    );
  }

  if (validation) {
    const kind = scrapeErrorKind(validation);
    rows.push(
      notice("Scrape URL validation failed", withRun([`URL validation threw: ${validation}`], args.runUrl), {
        alert: "scrape",
        kind: "validation",
        fingerprint: `validation:${kind}`,
        run_url: args.runUrl,
        validation_error: validation,
      })
    );
  }

  return rows;
}

export function describeScrapeJobFailure(args: {
  jobResult: string;
  sanityOutcome?: string | null;
}): { title: string; failedStep: string } {
  if (args.sanityOutcome === "failure") {
    return { title: "Location sanity check failed", failedStep: "Location sanity check" };
  }
  if (args.jobResult === "cancelled") {
    return {
      title: "Daily scrape did not finish",
      failedStep: "Scrape (timed out or cancelled)",
    };
  }
  if (args.jobResult === "skipped") {
    return { title: "Daily scrape did not run", failedStep: "Scrape (skipped)" };
  }
  return { title: "Scrape failed", failedStep: "Scrape" };
}

/**
 * Notice for the workflow alert job. Null when the scrape job succeeded (or
 * the result is missing), so a mis-fired alert step cannot file a row.
 * Fingerprint is the GitHub run id: one row per failed run, and a re-run of
 * the alert job does not insert a second.
 */
export function buildJobFailureAlert(args: {
  jobResult: string;
  scrapeOutcome?: string | null;
  sanityOutcome?: string | null;
  runUrl: string | null;
  runId: string | null;
}): ScrapeAlertRow | null {
  const jobResult = args.jobResult.trim();
  if (!jobResult || jobResult === "success") return null;
  const described = describeScrapeJobFailure({
    jobResult,
    sanityOutcome: args.sanityOutcome,
  });
  const runId = args.runId && /^\d+$/.test(args.runId) ? args.runId : null;
  const fingerprint = runId ? `job:${runId}` : `job:${jobResult}:${described.failedStep}`;
  const lines = [
    `${described.failedStep}. Job result: ${jobResult}.`,
    `Scrape step: ${args.scrapeOutcome || "unknown"}. Sanity check: ${args.sanityOutcome || "unknown"}.`,
  ];
  if (jobResult === "cancelled") {
    lines.push(
      "A timeout-minutes kill is reported as cancelled, so a step conditioned on failure() does not run. This job runs whenever the scrape job is not success."
    );
  }
  if (args.runUrl) lines.push(`Run: ${args.runUrl}`);
  lines.push(DISMISS);
  return notice(described.title, lines.join("\n"), {
    alert: "scrape",
    kind: "job_failed",
    fingerprint,
    run_url: args.runUrl,
    job_result: jobResult,
    failed_step: described.failedStep,
    scrape_outcome: args.scrapeOutcome ?? null,
    sanity_outcome: args.sanityOutcome ?? null,
  });
}

/**
 * Notice for /api/check-events. Null when the newest start is still inside
 * the 30-hour window. Fingerprint includes that start, so the same outage
 * does not file again on the next audit, and a later outage (a newer start
 * that then goes stale) does.
 */
export function buildMissedRunAlert(args: {
  startedAt: string | null;
  nowMs: number;
}): ScrapeAlertRow | null {
  if (!scrapeRunIsOverdue(args.startedAt, args.nowMs)) return null;
  const ageMs = scrapeRunAgeMs(args.startedAt, args.nowMs);
  const ageHours = ageMs === null || ageMs < 0 ? null : Math.floor(ageMs / 3_600_000);
  const startedAt = args.startedAt;
  const lines = startedAt
    ? [
        `The newest scrape_runs row started at ${startedAt} (${ageHours ?? "unknown"} hours before this audit).`,
        "The daily scrape is scheduled for 08:00 UTC. A start older than 30 hours means a day was skipped or the job never started. A run that never starts writes nothing, so the workflow cannot report it.",
        DISMISS,
      ]
    : [
        "scrape_runs has no usable start time. The daily scrape has not recorded a run.",
        "A run that never starts writes nothing, so the workflow cannot report it.",
        DISMISS,
      ];
  return notice("Daily scrape has not run", lines.join("\n"), {
    alert: "scrape",
    kind: "missed_run",
    fingerprint: `missed:${startedAt ?? "none"}`,
    run_url: null,
    started_at: startedAt,
    age_hours: ageHours,
  });
}

function fingerprintOf(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { alert?: unknown; fingerprint?: unknown };
  if (p.alert !== "scrape" || typeof p.fingerprint !== "string") return null;
  return p.fingerprint;
}

/** An open proposed scrape notice with the same fingerprint is enough. */
export function isDuplicateScrapeAlert(
  existing: ReadonlyArray<{ payload?: unknown }>,
  alert: ScrapeAlertRow
): boolean {
  return existing.some((row) => fingerprintOf(row.payload) === alert.payload.fingerprint);
}

/** A notice. A policy row must not be able to execute it. */
export function scrapeAlertCanAutoExecute(alert: ScrapeAlertRow): boolean {
  return canAutoExecute(alert, { auto_execute: true });
}

export type FileScrapeAlertResult =
  | { status: "inserted" }
  | { status: "duplicate" }
  | { status: "error"; message: string };

type AlertQuery = {
  data: Array<{ payload: unknown }> | null;
  error: { message: string } | null;
};

/**
 * The slice of the service-role client this writer uses. Both the Next route
 * and the scripts package pass their own Supabase client.
 */
export type ScrapeAlertClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          order(column: string, options: { ascending: boolean }): {
            limit(count: number): PromiseLike<AlertQuery>;
          };
        };
      };
    };
    insert(row: ScrapeAlertRow): PromiseLike<{ error: { message: string } | null }>;
  };
};

/** Insert the notice unless an open proposed row already has this fingerprint. */
export async function fileScrapeAlert(
  supabase: ScrapeAlertClient,
  alert: ScrapeAlertRow
): Promise<FileScrapeAlertResult> {
  try {
    const { data, error } = await supabase
      .from("agent_actions")
      .select("payload")
      .eq("type", alert.type)
      .eq("status", "proposed")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return { status: "error", message: error.message };
    if (isDuplicateScrapeAlert(data ?? [], alert)) return { status: "duplicate" };
    const inserted = await supabase.from("agent_actions").insert(alert);
    if (inserted.error) return { status: "error", message: inserted.error.message };
    return { status: "inserted" };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Decision for scripts/file-scrape-job-alert.ts. Code 0 when there is nothing
 * to file or the row was written (or already existed). Code 1 when the write
 * failed, so the alert job itself goes red.
 */
export async function fileJobAlertFromEnv(
  env: ScrapeAlertEnv,
  supabase: ScrapeAlertClient
): Promise<{ code: number; status: string; detail: string }> {
  const alert = buildJobFailureAlert({
    jobResult: env.SCRAPE_JOB_RESULT ?? "",
    scrapeOutcome: env.SCRAPE_STEP_OUTCOME ?? null,
    sanityOutcome: env.SANITY_STEP_OUTCOME ?? null,
    runUrl: scrapeRunUrlFromEnv(env),
    runId: env.GITHUB_RUN_ID ?? null,
  });
  if (!alert) {
    return { code: 0, status: "skipped", detail: "Scrape job succeeded; no alert." };
  }
  const filed = await fileScrapeAlert(supabase, alert);
  if (filed.status === "error") {
    return { code: 1, status: "error", detail: filed.message };
  }
  return { code: 0, status: filed.status, detail: `${filed.status} ${alert.title}` };
}

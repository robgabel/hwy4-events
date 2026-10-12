// Locks lib/scrape-alerts.ts (issue #345). A thrown source, a failed or
// cancelled scrape job, and a scrape that never started each become one
// proposed agent_actions row. No Slack, no new action type.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEDULE_WATCH_ACTION_TYPE } from "../../lib/bigtrees-watch.js";
import {
  SCRAPE_ALERT_TYPE,
  SCRAPE_ERROR_SNIPPET_CHARS,
  buildJobFailureAlert,
  buildMissedRunAlert,
  buildScrapeRunAlert,
  fileJobAlertFromEnv,
  fileScrapeAlert,
  scrapeAlertCanAutoExecute,
  scrapeRunUrlFromEnv,
  type ScrapeAlertClient,
  type ScrapeAlertRow,
} from "../../lib/scrape-alerts.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const AUDIT_AT = Date.parse("2026-10-04T18:00:00Z");

function memory(seed: unknown[] = [], insertError: string | null = null) {
  const rows = seed.map((payload) => ({ payload }));
  const inserts: ScrapeAlertRow[] = [];
  const client: ScrapeAlertClient = {
    from(table: string) {
      assert.equal(table, "agent_actions");
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    order() {
                      return {
                        limit: async () => ({ data: rows, error: null }),
                      };
                    },
                  };
                },
              };
            },
          };
        },
        insert: async (row: ScrapeAlertRow) => {
          if (insertError) return { error: { message: insertError } };
          inserts.push(row);
          rows.unshift({ payload: row.payload });
          return { error: null };
        },
      };
    },
  };
  return { client, inserts };
}

function assertNoEmDash(text: string) {
  assert.equal(text.includes("\u2014"), false, text);
}

test("one thrown source is one notice naming that source", () => {
  const alert = buildScrapeRunAlert({
    sourceErrors: [
      { source: "visit-murphys", message: "Firecrawl fallback did not return valid JSON" },
    ],
    nulled: 0,
    sparedHosts: [],
    validationError: null,
    runUrl: "https://github.com/robgabel/hwy4-events/actions/runs/9",
  });
  assert.ok(alert);
  assert.equal(alert.type, SCHEDULE_WATCH_ACTION_TYPE);
  assert.equal(SCRAPE_ALERT_TYPE, "schedule_watch_alert");
  assert.equal(alert.title, "Scrape source failed: visit-murphys");
  assert.match(alert.rationale, /visit-murphys threw: Firecrawl fallback did not return valid JSON/);
  assert.match(alert.rationale, /Reject this row once it has been handled/);
  assert.equal(alert.reversible, false);
  assert.equal(alert.payload.alert, "scrape");
  assert.equal(alert.payload.kind, "source_errors");
  assert.equal(scrapeAlertCanAutoExecute(alert), false);
  assertNoEmDash(alert.title);
  assertNoEmDash(alert.rationale);
});

test("two thrown sources share one notice, names sorted, snippets capped", () => {
  const alert = buildScrapeRunAlert({
    sourceErrors: [
      { source: "stevenot", message: "y".repeat(400) },
      { source: "brice-station", message: "calendar empty" },
    ],
    nulled: 0,
    sparedHosts: [],
    validationError: null,
    runUrl: null,
  });
  assert.ok(alert);
  assert.equal(alert.title, "Scrape sources failed: brice-station, stevenot");
  assert.equal(alert.payload.sources?.length, 2);
  assert.equal(
    alert.payload.sources?.find((s) => s.source === "stevenot")?.message.length,
    SCRAPE_ERROR_SNIPPET_CHARS
  );
  assert.equal(SCRAPE_ERROR_SNIPPET_CHARS, 200);
});

test("a clean run files nothing", () => {
  assert.equal(
    buildScrapeRunAlert({
      sourceErrors: [],
      nulled: 0,
      sparedHosts: [],
      validationError: null,
      runUrl: "https://github.com/robgabel/hwy4-events/actions/runs/1",
    }),
    null
  );
});

test("nulled links and a spared host share the run notice", () => {
  const alert = buildScrapeRunAlert({
    sourceErrors: [],
    nulled: 139,
    sparedHosts: ["visitmurphys.com"],
    validationError: null,
    runUrl: null,
  });
  assert.ok(alert);
  assert.equal(alert.title, "Scrape link check nulled 139 links");
  assert.match(alert.rationale, /nulled 139 links/);
  assert.match(alert.rationale, /spared visitmurphys.com/);
  assertNoEmDash(alert.rationale);
});

test("a URL validation throw is its own notice when nothing else failed", () => {
  const alert = buildScrapeRunAlert({
    sourceErrors: [],
    nulled: 0,
    sparedHosts: [],
    validationError: "socket hang up",
    runUrl: null,
  });
  assert.ok(alert);
  assert.equal(alert.title, "Scrape URL validation failed");
  assert.match(alert.rationale, /URL validation threw: socket hang up/);
});

test("an open row with the same fingerprint is not inserted again; a new error is", async () => {
  const first = buildScrapeRunAlert({
    sourceErrors: [{ source: "gocalaveras", message: "429" }],
    nulled: 0,
    sparedHosts: [],
    validationError: null,
    runUrl: null,
  });
  const changed = buildScrapeRunAlert({
    sourceErrors: [{ source: "gocalaveras", message: "nonce missing" }],
    nulled: 0,
    sparedHosts: [],
    validationError: null,
    runUrl: null,
  });
  assert.ok(first && changed);
  const db = memory();
  assert.equal((await fileScrapeAlert(db.client, first)).status, "inserted");
  assert.equal((await fileScrapeAlert(db.client, first)).status, "duplicate");
  assert.equal((await fileScrapeAlert(db.client, changed)).status, "inserted");
  assert.equal(db.inserts.length, 2);
});

test("a select failure does not insert", async () => {
  const alert = buildScrapeRunAlert({
    sourceErrors: [{ source: "gocalaveras", message: "429" }],
    nulled: 0,
    sparedHosts: [],
    validationError: null,
    runUrl: null,
  });
  assert.ok(alert);
  let inserted = false;
  const client: ScrapeAlertClient = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    order() {
                      return { limit: async () => ({ data: null, error: { message: "down" } }) };
                    },
                  };
                },
              };
            },
          };
        },
        insert: async () => {
          inserted = true;
          return { error: null };
        },
      };
    },
  };
  const filed = await fileScrapeAlert(client, alert);
  assert.equal(filed.status, "error");
  assert.equal(inserted, false);
});

test("a Big Trees row with the same fingerprint string is not this notice", async () => {
  const alert = buildJobFailureAlert({
    jobResult: "failure",
    runUrl: null,
    runId: "7",
  });
  assert.ok(alert);
  const db = memory([{ kind: "missing", fingerprint: alert.payload.fingerprint }]);
  assert.equal((await fileScrapeAlert(db.client, alert)).status, "inserted");
});

test("a successful job inserts nothing", async () => {
  const db = memory();
  const r = await fileJobAlertFromEnv({ SCRAPE_JOB_RESULT: "success" }, db.client);
  assert.equal(r.code, 0);
  assert.equal(r.status, "skipped");
  assert.equal(db.inserts.length, 0);
  assert.equal(buildJobFailureAlert({ jobResult: "", runUrl: null, runId: null }), null);
});

test("a cancelled job inserts one row, and the same run id does not insert again", async () => {
  const db = memory();
  const env = {
    SCRAPE_JOB_RESULT: "cancelled",
    SCRAPE_STEP_OUTCOME: "cancelled",
    SANITY_STEP_OUTCOME: "skipped",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: "robgabel/hwy4-events",
    GITHUB_RUN_ID: "42",
  };
  const first = await fileJobAlertFromEnv(env, db.client);
  const second = await fileJobAlertFromEnv(env, db.client);
  assert.equal(first.code, 0);
  assert.equal(first.status, "inserted");
  assert.equal(second.status, "duplicate");
  assert.equal(db.inserts.length, 1);
  assert.equal(db.inserts[0].title, "Daily scrape did not finish");
  assert.equal(db.inserts[0].payload.fingerprint, "job:42");
  assert.match(db.inserts[0].rationale, /actions\/runs\/42/);
  assertNoEmDash(db.inserts[0].rationale);
});

test("a failed sanity step is named in the title", () => {
  const alert = buildJobFailureAlert({
    jobResult: "failure",
    scrapeOutcome: "success",
    sanityOutcome: "failure",
    runUrl: null,
    runId: "3",
  });
  assert.ok(alert);
  assert.equal(alert.title, "Location sanity check failed");
});

test("a missed run is quiet inside 30 hours and one row once it is older", async () => {
  assert.equal(buildMissedRunAlert({ startedAt: "2026-10-04T16:20:00Z", nowMs: AUDIT_AT }), null);
  const alert = buildMissedRunAlert({ startedAt: "2026-10-03T08:00:00Z", nowMs: AUDIT_AT });
  assert.ok(alert);
  assert.equal(alert.title, "Daily scrape has not run");
  assert.equal(alert.payload.fingerprint, "missed:2026-10-03T08:00:00Z");
  assert.equal(alert.payload.age_hours, 34);
  assertNoEmDash(alert.rationale);
  const db = memory();
  assert.equal((await fileScrapeAlert(db.client, alert)).status, "inserted");
  assert.equal((await fileScrapeAlert(db.client, alert)).status, "duplicate");
  assert.equal(db.inserts.length, 1);
});

test("a write failure exits 1 so the alert job goes red", async () => {
  const db = memory([], "insert rejected");
  const r = await fileJobAlertFromEnv(
    { SCRAPE_JOB_RESULT: "failure", GITHUB_RUN_ID: "8" },
    db.client
  );
  assert.equal(r.code, 1);
  assert.equal(r.status, "error");
  assert.equal(db.inserts.length, 0);
});

test("run urls are only built from an https host, an owner/repo, and a numeric id", () => {
  assert.equal(
    scrapeRunUrlFromEnv({
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "robgabel/hwy4-events",
      GITHUB_RUN_ID: "15",
    }),
    "https://github.com/robgabel/hwy4-events/actions/runs/15"
  );
  assert.equal(
    scrapeRunUrlFromEnv({
      GITHUB_SERVER_URL: "http://github.com",
      GITHUB_REPOSITORY: "robgabel/hwy4-events",
      GITHUB_RUN_ID: "15",
    }),
    null
  );
  assert.equal(
    scrapeRunUrlFromEnv({
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "robgabel/hwy4-events",
      GITHUB_RUN_ID: "abc",
    }),
    null
  );
});

test("scrape.ts files the run notice and does not grow a new Slack post", () => {
  const src = readFileSync(join(root, "scripts/scrape.ts"), "utf8");
  assert.match(src, /buildScrapeRunAlert/);
  assert.match(src, /fileScrapeAlert/);
  assert.doesNotMatch(src, /postSlack/);
  assert.doesNotMatch(src, /SLACK_WEBHOOK/);
});

test("check-events files the missed-run notice", () => {
  const src = readFileSync(join(root, "app/api/check-events/route.ts"), "utf8");
  assert.match(src, /buildMissedRunAlert/);
  assert.match(src, /fileScrapeAlert/);
  assert.match(src, /scrapeRunIsOverdue/);
});

test("the alert job script exits with the writer's code", () => {
  const src = readFileSync(join(root, "scripts/file-scrape-job-alert.ts"), "utf8");
  assert.match(src, /fileJobAlertFromEnv/);
  assert.match(src, /process\.exit\(r\.code\)/);
  assert.doesNotMatch(src, /SLACK_WEBHOOK/);
});

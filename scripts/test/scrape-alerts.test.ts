// Locks lib/scrape-alerts.ts (issue #345). A thrown source, a failed or
// cancelled scrape job, and a scrape that never started each become a
// proposed agent_actions row. A source fingerprint is the name plus the
// error kind. Nulled links file only above a threshold or a jump, and
// spared hosts are their own row. No Slack, no new action type.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEDULE_WATCH_ACTION_TYPE } from "../../lib/bigtrees-watch.js";
import {
  NULLED_LINK_HISTORY_KEEP,
  SCRAPE_ALERT_TYPE,
  SCRAPE_ERROR_SNIPPET_CHARS,
  buildJobFailureAlert,
  buildMissedRunAlert,
  buildScrapeRunAlerts,
  fileJobAlertFromEnv,
  fileScrapeAlert,
  nextNulledLinkHistory,
  nulledLinkAlertWarranted,
  parseNulledLinkHistory,
  scrapeAlertCanAutoExecute,
  scrapeErrorKind,
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

function runAlerts(partial: {
  sourceErrors?: { source: string; message: string }[];
  nulled?: number;
  recentNulled?: number[];
  sparedHosts?: string[];
  validationError?: string | null;
  runUrl?: string | null;
}) {
  return buildScrapeRunAlerts({
    sourceErrors: partial.sourceErrors ?? [],
    nulled: partial.nulled ?? 0,
    recentNulled: partial.recentNulled,
    sparedHosts: partial.sparedHosts ?? [],
    validationError: partial.validationError ?? null,
    runUrl: partial.runUrl ?? null,
  });
}

test("one thrown source is one notice naming that source", () => {
  const [alert] = runAlerts({
    sourceErrors: [
      { source: "visit-murphys", message: "Firecrawl fallback did not return valid JSON" },
    ],
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
  assert.equal(alert.payload.fingerprint, "source:visit-murphys:invalid-json");
  assert.equal(scrapeAlertCanAutoExecute(alert), false);
  assertNoEmDash(alert.title);
  assertNoEmDash(alert.rationale);
});

test("two thrown sources are two notices, snippets capped", () => {
  const alerts = runAlerts({
    sourceErrors: [
      { source: "stevenot", message: "y".repeat(400) },
      { source: "brice-station", message: "calendar empty" },
    ],
  });
  assert.deepEqual(
    alerts.map((a) => a.title),
    ["Scrape source failed: brice-station", "Scrape source failed: stevenot"]
  );
  assert.equal(alerts[1].payload.sources?.[0].message.length, SCRAPE_ERROR_SNIPPET_CHARS);
  assert.equal(SCRAPE_ERROR_SNIPPET_CHARS, 200);
});

test("a source fingerprint is the name and the error kind", () => {
  const usual = "Firecrawl fallback did not return valid JSON (request abcdef1234567890)";
  const reworded =
    "Tribe API request failed on page 3 (direct: HTTP 500 https://visitmurphys.com/x): Firecrawl fallback did not return valid JSON trace-deadbeefcafe";
  assert.equal(scrapeErrorKind(usual), "invalid-json");
  assert.equal(scrapeErrorKind(reworded), "invalid-json");
  assert.equal(scrapeErrorKind("AJAX request RATE-LIMITED (429) for October req-abc123def"), "http-429");
  assert.equal(scrapeErrorKind("AJAX request failed: 429 https://gocalaveras.com/x"), "http-429");
  assert.equal(scrapeErrorKind("returned 500 events"), "returned-events");
  assert.equal(scrapeErrorKind("returned 12 events"), "returned-events");
  assert.equal(scrapeErrorKind("GoCalaveras events page gave no nonce (HTTP 200, the page loaded)"), "page-config");

  const alone = runAlerts({ sourceErrors: [{ source: "visit-murphys", message: usual }] });
  const beside = runAlerts({
    sourceErrors: [
      { source: "visit-murphys", message: reworded },
      { source: "stevenot", message: "Stevenot fetch failed HTTP 503 https://www.stevenotwinery.com/x" },
    ],
  });
  assert.equal(alone[0].payload.fingerprint, "source:visit-murphys:invalid-json");
  assert.equal(
    beside.find((row) => row.payload.sources?.[0].source === "visit-murphys")?.payload.fingerprint,
    alone[0].payload.fingerprint
  );
  assert.equal(
    beside.find((row) => row.payload.sources?.[0].source === "stevenot")?.payload.fingerprint,
    "source:stevenot:http-5xx"
  );
  const rateLimited = runAlerts({
    sourceErrors: [{ source: "gocalaveras", message: "AJAX request failed: 429" }],
  });
  const nonce = runAlerts({
    sourceErrors: [
      { source: "gocalaveras", message: "GoCalaveras events page gave no nonce (HTTP 200)" },
    ],
  });
  assert.equal(rateLimited[0].payload.fingerprint, "source:gocalaveras:http-429");
  assert.equal(nonce[0].payload.fingerprint, "source:gocalaveras:page-config");
  assert.notEqual(rateLimited[0].payload.fingerprint, nonce[0].payload.fingerprint);
});

test("the same source kind stays one open row when the message or a second source changes", async () => {
  const usual = runAlerts({
    sourceErrors: [
      {
        source: "visit-murphys",
        message: "Firecrawl fallback did not return valid JSON request abcdef123456",
      },
    ],
  })[0];
  const next = runAlerts({
    sourceErrors: [
      {
        source: "visit-murphys",
        message: "Firecrawl fallback did not return valid JSON trace-deadbeefcafe",
      },
      { source: "stevenot", message: "Stevenot fetch failed HTTP 503" },
    ],
  });
  const db = memory();
  assert.equal((await fileScrapeAlert(db.client, usual)).status, "inserted");
  assert.equal((await fileScrapeAlert(db.client, usual)).status, "duplicate");
  for (const row of next) {
    const filed = await fileScrapeAlert(db.client, row);
    const source = row.payload.sources?.[0].source;
    assert.equal(filed.status, source === "visit-murphys" ? "duplicate" : "inserted");
  }
  assert.equal(db.inserts.length, 2);
});

test("a clean run files nothing", () => {
  assert.deepEqual(runAlerts({ runUrl: "https://github.com/robgabel/hwy4-events/actions/runs/1" }), []);
});

test("a quiet nulled count files nothing; a 139-link day and a later 150 share one fingerprint", () => {
  assert.equal(nulledLinkAlertWarranted(2, [0, 1, 1]), false);
  assert.equal(nulledLinkAlertWarranted(3, [0, 1, 0, 1]), false);
  assert.equal(nulledLinkAlertWarranted(9, []), false);
  assert.equal(nulledLinkAlertWarranted(4, [139]), false);
  assert.deepEqual(runAlerts({ nulled: 2, recentNulled: [0, 1, 1] }), []);
  assert.deepEqual(runAlerts({ nulled: 9 }), []);

  const outage = runAlerts({ nulled: 139, recentNulled: [0, 1, 1] });
  const still = runAlerts({ nulled: 150, recentNulled: [0, 1, 139] });
  assert.equal(outage.length, 1);
  assert.equal(outage[0].title, "Scrape link check nulled 139 links");
  assert.equal(outage[0].payload.kind, "nulled_links");
  assert.equal(outage[0].payload.fingerprint, "nulled");
  assert.equal(outage[0].payload.nulled, 139);
  assert.equal(still[0].payload.fingerprint, "nulled");
  assert.match(outage[0].rationale, /at least 10 links/);
  assertNoEmDash(outage[0].rationale);
});

test("a jump under the minimum files, and the fingerprint stays nulled", () => {
  assert.equal(nulledLinkAlertWarranted(9, [0, 1, 0, 1]), true);
  const rows = runAlerts({ nulled: 9, recentNulled: [0, 1, 0, 1] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.fingerprint, "nulled");
  assert.match(rows[0].rationale, /jumps past recent runs \(0, 1, 0, 1\)/);
  assertNoEmDash(rows[0].rationale);
});

test("139 then 150 nulled links do not insert a second row", async () => {
  const day1 = runAlerts({ nulled: 139 })[0];
  const day2 = runAlerts({ nulled: 150, recentNulled: [139] })[0];
  const db = memory();
  assert.equal((await fileScrapeAlert(db.client, day1)).status, "inserted");
  assert.equal((await fileScrapeAlert(db.client, day2)).status, "duplicate");
  assert.equal(db.inserts.length, 1);
});

test("spared hosts are a separate notice, and host order does not change the fingerprint", () => {
  const quiet = runAlerts({
    nulled: 2,
    recentNulled: [0, 1],
    sparedHosts: ["visitmurphys.com", "example.com", "visitmurphys.com"],
  });
  assert.equal(quiet.length, 1);
  assert.equal(quiet[0].payload.kind, "spared_hosts");
  assert.equal(quiet[0].payload.fingerprint, "spared:example.com,visitmurphys.com");
  assert.equal(quiet[0].title, "Scrape link check spared 2 hosts");
  assert.match(quiet[0].rationale, /spared example.com, visitmurphys.com/);
  assertNoEmDash(quiet[0].rationale);

  const loud = runAlerts({
    nulled: 139,
    sparedHosts: ["example.com", "visitmurphys.com"],
  });
  const spared = loud.find((row) => row.payload.kind === "spared_hosts");
  const nulled = loud.find((row) => row.payload.kind === "nulled_links");
  assert.equal(spared?.payload.fingerprint, quiet[0].payload.fingerprint);
  assert.equal(nulled?.payload.fingerprint, "nulled");
  assert.equal(runAlerts({ sparedHosts: ["other.example"] })[0].payload.fingerprint, "spared:other.example");
});

test("a URL validation throw keeps its kind when the request id changes", () => {
  const first = runAlerts({ validationError: "socket hang up request abcdef123456" })[0];
  const second = runAlerts({
    validationError: "socket hang up trace-deadbeefcafe https://visitmurphys.com/x",
  })[0];
  assert.equal(first.title, "Scrape URL validation failed");
  assert.match(first.rationale, /URL validation threw: socket hang up/);
  assert.equal(first.payload.kind, "validation");
  assert.equal(first.payload.fingerprint, "validation:network");
  assert.equal(second.payload.fingerprint, first.payload.fingerprint);
});

test("nulled-link history keeps the last 14 finite counts", () => {
  assert.deepEqual(parseNulledLinkHistory(null), []);
  assert.deepEqual(parseNulledLinkHistory("nope"), []);
  assert.deepEqual(parseNulledLinkHistory(JSON.stringify({ nulled: 4 })), []);
  assert.deepEqual(parseNulledLinkHistory(JSON.stringify([1, "x", 2.9, -3])), [1, 2, 0]);
  const long = Array.from({ length: 20 }, (_, i) => i);
  assert.equal(NULLED_LINK_HISTORY_KEEP, 14);
  assert.deepEqual(parseNulledLinkHistory(JSON.stringify(long)), long.slice(-14));
  assert.deepEqual(nextNulledLinkHistory([0, 1], 2), [0, 1, 2]);
  assert.deepEqual(nextNulledLinkHistory(long, 3).length, 14);
  assert.equal(nextNulledLinkHistory(long, 3).at(-1), 3);
});

test("a different error kind is inserted again", async () => {
  const first = runAlerts({
    sourceErrors: [{ source: "gocalaveras", message: "AJAX request failed: 429" }],
  })[0];
  const changed = runAlerts({
    sourceErrors: [
      { source: "gocalaveras", message: "GoCalaveras events page gave no nonce (HTTP 200)" },
    ],
  })[0];
  const db = memory();
  assert.equal((await fileScrapeAlert(db.client, first)).status, "inserted");
  assert.equal((await fileScrapeAlert(db.client, first)).status, "duplicate");
  assert.equal((await fileScrapeAlert(db.client, changed)).status, "inserted");
  assert.equal(db.inserts.length, 2);
});

test("a select failure does not insert", async () => {
  const alert = runAlerts({
    sourceErrors: [{ source: "gocalaveras", message: "AJAX request failed: 429" }],
  })[0];
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

test("scrape.ts files each run notice and does not grow a new Slack post", () => {
  const src = readFileSync(join(root, "scripts/scrape.ts"), "utf8");
  assert.match(src, /buildScrapeRunAlerts/);
  assert.doesNotMatch(src, /buildScrapeRunAlert[^s]/);
  assert.match(src, /fileScrapeAlert/);
  assert.match(src, /nextNulledLinkHistory/);
  assert.match(src, /NULLED_LINK_HISTORY_KEY/);
  assert.match(src, /recordNulled && recentNulled/);
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

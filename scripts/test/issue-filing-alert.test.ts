// Regression lock for the issue-filing alert (lib/agent/issue-filing-alert.ts,
// issue #325). When the QA audit or the growth memo can't get its findings into
// GitHub, the Inbox must say so (agent_actions), not Slack alone.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIssueFilingAlert, fileIssueFilingAlert, ISSUE_FILING_ALERT_TYPE } from "../../lib/agent/issue-filing-alert.js";

test("a filing failure becomes one proposed, non-reversible agent_actions row", () => {
  const row = buildIssueFilingAlert({ source: "qa_audit", error: "list_failed", unfiled: ["QA: The /free page returns an error"] });
  assert.ok(row);
  assert.equal(row.type, ISSUE_FILING_ALERT_TYPE);
  assert.equal(row.status, "proposed");
  assert.equal(row.reversible, false);
  assert.match(String(row.title), /Weekly QA audit could not file GitHub issues \(list_failed\)/);
  assert.match(String(row.rationale), /re-mint/);
  assert.match(String(row.rationale), /The \/free page returns an error/);
  assert.deepEqual((row.payload as { source: string }).source, "qa_audit");
});

test("no error, or an error that isn't about filing, files nothing", () => {
  assert.equal(buildIssueFilingAlert({ source: "growth_memo", error: null, unfiled: [] }), null);
  assert.equal(buildIssueFilingAlert({ source: "growth_memo", error: "extraction_failed", unfiled: [] }), null);
});

test("every filing error has fix text", () => {
  for (const error of ["GITHUB_ISSUES_TOKEN_MISSING", "list_failed", "create_failed", "labels_dropped"]) {
    const row = buildIssueFilingAlert({ source: "growth_memo", error, unfiled: [] });
    assert.ok(row && String(row.rationale).length > 20, error);
  }
});

test("an issue that lost its proposed label is named, even when a create also failed", () => {
  const both = buildIssueFilingAlert({
    source: "growth_memo",
    error: "create_failed",
    unfiled: ["Fix the grape stomp page title"],
    ungated: ["https://github.com/robgabel/hwy4-events/issues/999"],
  });
  assert.ok(both);
  assert.match(String(both.rationale), /Not filed: Fix the grape stomp page title/);
  assert.match(String(both.rationale), /issues\/999/);
  // labels dropped with no other error still files the alert
  const onlyDropped = buildIssueFilingAlert({ source: "qa_audit", error: null, unfiled: [], ungated: ["u1"] });
  assert.equal((onlyDropped?.payload as { error: string }).error, "labels_dropped");
});

test("a long outage keeps the newest items, not the first week's", () => {
  const many = Array.from({ length: 25 }, (_, i) => `title ${i}`);
  const row = buildIssueFilingAlert({ source: "growth_memo", error: "list_failed", unfiled: many });
  const kept = (row?.payload as { unfiled: string[] }).unfiled;
  assert.equal(kept.length, 20);
  assert.equal(kept[kept.length - 1], "title 24");
  assert.ok(!kept.includes("title 0"));
});

// A minimal chainable stand-in for the two Supabase calls fileIssueFilingAlert makes.
function fakeSupabase(open: { id: string; payload: unknown }[]) {
  const writes: { op: string; row: Record<string, unknown> }[] = [];
  const chain = {
    select: () => chain,
    eq: () => chain,
    limit: async () => ({ data: open, error: null }),
    insert: async (row: Record<string, unknown>) => {
      writes.push({ op: "insert", row });
      return { error: null };
    },
    update: (row: Record<string, unknown>) => ({
      eq: async () => {
        writes.push({ op: "update", row });
        return { error: null };
      },
    }),
  };
  return { client: { from: () => chain } as unknown as Parameters<typeof fileIssueFilingAlert>[0], writes };
}

test("fileIssueFilingAlert inserts the first row, then merges later runs into it", async () => {
  const first = fakeSupabase([]);
  assert.equal(
    await fileIssueFilingAlert(first.client, { source: "growth_memo", error: "privacy_hold", unfiled: ["a (held: quotes a figure; spec: x)"] }),
    "inserted"
  );
  assert.equal(first.writes[0].op, "insert");

  const second = fakeSupabase([
    { id: "row1", payload: { error: "privacy_hold", errors: ["privacy_hold"], unfiled: ["a (held: quotes a figure; spec: x)"], ungated: [] } },
  ]);
  assert.equal(
    await fileIssueFilingAlert(second.client, { source: "growth_memo", error: "list_failed", unfiled: ["b"] }),
    "duplicate"
  );
  assert.equal(second.writes[0].op, "update");
  const payload = second.writes[0].row.payload as { unfiled: string[]; error: string };
  assert.deepEqual(payload.unfiled, ["a (held: quotes a figure; spec: x)", "b"]);
  // the earlier run's reason and its fix text survive the merge
  assert.deepEqual((second.writes[0].row.payload as { errors: string[] }).errors, ["privacy_hold", "list_failed"]);
  assert.match(String(second.writes[0].row.rationale), /repo is public/);
  assert.match(String(second.writes[0].row.title), /privacy_hold, list_failed/);
});

test("fileIssueFilingAlert skips when there is nothing to report", async () => {
  const s = fakeSupabase([]);
  assert.equal(await fileIssueFilingAlert(s.client, { source: "qa_audit", error: null, unfiled: [] }), "skipped");
  assert.equal(s.writes.length, 0);
});

// Regression lock for the issue-filing alert (lib/agent/issue-filing-alert.ts,
// issue #325). When the QA audit or the growth memo can't get its findings into
// GitHub, the Inbox must say so (agent_actions), not Slack alone.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIssueFilingAlert, ISSUE_FILING_ALERT_TYPE } from "../../lib/agent/issue-filing-alert.js";

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

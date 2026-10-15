// Drives the file_github_issue executor (lib/agent/file-github-issue.ts, reached
// through executeAction in lib/agent/actions-executor.ts) with a fake GitHub
// client. The growth memo is propose-first: it stages a private agent_actions
// row and only Rob's Approve files the public issue. These pin that one approval
// files exactly one issue, that a second approval of the same row never files a
// second, that the title dedup still runs at approval, and that a GitHub failure
// files nothing and leaves the row retryable.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { executeAction } from "../../lib/agent/actions-executor.js";
import { actionCheckKey, FILE_GITHUB_ISSUE_TYPE, fileIssueForAction, issueForAction, mergeIssueEdits } from "../../lib/agent/file-github-issue.js";
import { approvable, APPROVAL_IN_FLIGHT_MS, recordExecution, type ApprovalDb } from "../../lib/agent/approval-record.js";
import { canAutoExecute, type AgentActionRow } from "../../lib/agent/policy.js";
import { isAutoReady } from "../../lib/agent/auto-runner.js";
import { parseExtractedTasks, proposalRow } from "../../lib/agent/propose-tasks.js";
import { bodyCheckKey, type IssueLite, type IssuesClient, type NewIssue } from "../../lib/github-issues.js";

// A fake repo: create() adds the issue to what listRecent() returns, like GitHub.
function fakeRepo(opts: { existing?: IssueLite[]; listFails?: boolean; createFails?: boolean; dropLabels?: boolean } = {}) {
  const issues: IssueLite[] = [...(opts.existing ?? [])];
  const created: NewIssue[] = [];
  let n = 400;
  const client: IssuesClient = {
    repo: "x/y",
    async listRecent() {
      if (opts.listFails) throw new Error("GitHub list issues 401");
      return [...issues];
    },
    async create(issue) {
      if (opts.createFails) throw new Error("GitHub create issue 502");
      created.push(issue);
      n++;
      issues.push({ number: n, title: issue.title, body: issue.body, state: "open", state_reason: null, closed_at: null, html_url: `https://github.com/x/y/issues/${n}` });
      return { number: n, html_url: `https://github.com/x/y/issues/${n}`, title: issue.title, gated: !opts.dropLabels };
    },
  };
  return { client, created };
}

const [task] = parseExtractedTasks(
  JSON.stringify([{ title: "Add a /free filter to town pages", body: "Spec text.", type: "feature", priority: "p2", rationale: "why" }])
);

function row(over: Partial<AgentActionRow> = {}): AgentActionRow {
  const r = proposalRow(task, { runId: "run-1", date: "2026-10-16" });
  return {
    id: "11111111-2222-3333-4444-555555555555",
    created_at: "2026-10-16T16:00:00Z",
    run_id: "run-1",
    type: r.type as string,
    title: r.title as string,
    rationale: r.rationale as string,
    payload: r.payload as Record<string, unknown>,
    blast_radius: r.blast_radius as AgentActionRow["blast_radius"],
    reversible: r.reversible as boolean,
    outward_facing: r.outward_facing as boolean,
    status: "approved",
    before_snapshot: null,
    target_table: null,
    target_id: null,
    decided_note: null,
    error: null,
    decided_at: null,
    executed_at: null,
    reverted_at: null,
    ...over,
  };
}

// The executor never touches the database for this type.
const noDb = null as unknown as Parameters<typeof executeAction>[0];

test("approve files exactly one issue, with the row's check_key and the proposed label", async () => {
  const { client, created } = fakeRepo();
  const r = await executeAction(noDb, row(), { issues: client });
  assert.equal(r.ok, true);
  assert.equal(r.targetTable, "github_issues");
  assert.equal(r.targetId, "401");
  assert.equal(created.length, 1);
  assert.equal(created[0].title, "Add a /free filter to town pages");
  assert.deepEqual(created[0].labels, ["feature", "proposed", "lens:growth-memo"]);
  assert.equal(bodyCheckKey(created[0].body), actionCheckKey(row().id));
  assert.match(created[0].body, /## Proposed change\nSpec text\./);
});

test("approving the same row twice files one issue; the second finds it by check_key", async () => {
  const { client, created } = fakeRepo();
  const first = await executeAction(noDb, row(), { issues: client });
  const second = await executeAction(noDb, row(), { issues: client });
  assert.equal(created.length, 1);
  assert.equal(second.ok, true);
  assert.equal(second.targetId, first.targetId);
  assert.match(second.note ?? "", /Already filed as #401/);
});

test("a different row with a colliding title is not filed: the dedup still runs at approval", async () => {
  const { client, created } = fakeRepo({
    existing: [{ number: 77, title: "Add free filter on town pages", body: null, state: "open", state_reason: null, closed_at: null, html_url: "u77" }],
  });
  const r = await executeAction(noDb, row(), { issues: client });
  assert.equal(r.ok, false);
  assert.equal(r.retryable, undefined);
  assert.match(r.error ?? "", /#77 \(open\) already covers this/);
  assert.equal(created.length, 0);

  // A recently declined issue blocks too; one closed as completed does not.
  const now = new Date("2026-10-16T16:00:00Z");
  const declined = fakeRepo({
    existing: [{ number: 78, title: "Add a free filter to the town pages", body: null, state: "closed", state_reason: "not_planned", closed_at: "2026-10-10T00:00:00Z", html_url: "u78" }],
  });
  assert.equal((await fileIssueForAction(declined.client, row(), now)).ok, false);
  const done = fakeRepo({
    existing: [{ number: 79, title: "Add a free filter to the town pages", body: null, state: "closed", state_reason: "completed", closed_at: "2026-10-10T00:00:00Z", html_url: "u79" }],
  });
  assert.equal((await fileIssueForAction(done.client, row(), now)).ok, true);
  assert.equal(done.created.length, 1);
});

test("no token, a failed list, or a failed create files nothing and stays retryable", async () => {
  const none = await executeAction(noDb, row(), { issues: null });
  assert.equal(none.ok, false);
  assert.equal(none.retryable, true);
  assert.match(none.error ?? "", /GITHUB_ISSUES_TOKEN/);

  const list = fakeRepo({ listFails: true });
  const listed = await executeAction(noDb, row(), { issues: list.client });
  assert.equal(listed.retryable, true);
  assert.equal(list.created.length, 0);

  const create = fakeRepo({ createFails: true });
  const made = await executeAction(noDb, row(), { issues: create.client });
  assert.equal(made.ok, false);
  assert.equal(made.retryable, true);
});

test("a dropped proposed label is filed but named in the flash", async () => {
  const { client } = fakeRepo({ dropLabels: true });
  const r = await executeAction(noDb, row(), { issues: client });
  assert.equal(r.ok, true);
  assert.match(r.note ?? "", /dropped the labels/);
});

test("Rob's edits are what get filed, and a pasted check_key line can't hijack the row's", () => {
  const issue = issueForAction("abc", {
    title: "  Sharper title  ",
    body: "Edited body.\ncheck_key: growth-memo/something-else",
    labels: ["bug", "proposed"],
  });
  assert.ok(!("error" in issue));
  if ("error" in issue) return;
  assert.equal(issue.title, "Sharper title");
  assert.equal(bodyCheckKey(issue.body), "agent-action/abc");
  assert.doesNotMatch(issue.body, /something-else/);
  assert.deepEqual(issueForAction("abc", { title: " " }), { error: "Missing issue title." });
});

test("a file_github_issue row can never auto-run", () => {
  const r = row({ status: "proposed" });
  assert.equal(r.type, FILE_GITHUB_ISSUE_TYPE);
  assert.equal(canAutoExecute(r, { auto_execute: true }), false);
  assert.equal(isAutoReady(r), false);
});

test("clearing the body files a title-only issue, never the stored text (QA F1)", async () => {
  const leaky = row({ payload: { ...row().payload, body: "Confirm rate fell to 40%." } });
  const cleared = mergeIssueEdits(leaky.payload, { title: "Resend the confirm link", body: "" });
  const { client, created } = fakeRepo();
  const r = await executeAction(noDb, { ...leaky, payload: cleared }, { issues: client });
  assert.equal(r.ok, true);
  assert.doesNotMatch(created[0].body, /40%/);
  assert.equal(created[0].body, `Resend the confirm link\n\ncheck_key: ${actionCheckKey(leaky.id)}`);
  // A field that wasn't submitted keeps the stored value.
  assert.equal(mergeIssueEdits(leaky.payload, { title: null, body: null }).body, "Confirm rate fell to 40%.");
  // A cleared title is refused, not filed under the old one.
  const noTitle = await executeAction(noDb, { ...leaky, payload: mergeIssueEdits(leaky.payload, { title: "", body: null }) }, { issues: client });
  assert.equal(noTitle.ok, false);
  assert.equal(created.length, 1);
});

// A fake agent_actions table holding one row's status.
function fakeDb(status: string, opts: { writeFails?: boolean } = {}): ApprovalDb & { row: Record<string, unknown> } {
  const row: Record<string, unknown> = { status };
  return {
    row,
    async updateIfApproved(_id, fields) {
      if (opts.writeFails) throw new Error("db down");
      if (row.status !== "approved") return 0;
      Object.assign(row, fields);
      return 1;
    },
  };
}

test("recordExecution: success marks executed; a retryable failure re-queues; a final one fails", async () => {
  const done = fakeDb("approved");
  const ok = await recordExecution(done, "id", { ok: true, targetTable: "github_issues", targetId: "401", note: "Filed #401." });
  assert.deepEqual(ok, { ok: true, message: "Approved. Filed #401." });
  assert.equal(done.row.status, "executed");
  assert.equal(done.row.target_id, "401");

  const retry = fakeDb("approved");
  await recordExecution(retry, "id", { ok: false, retryable: true, error: "502" });
  assert.equal(retry.row.status, "proposed");
  assert.equal(retry.row.error, "502");

  const final = fakeDb("approved");
  await recordExecution(final, "id", { ok: false, error: "covered by #77" });
  assert.equal(final.row.status, "failed");
});

test("recordExecution: a Reject clicked meanwhile wins over the approval's writes (QA F2)", async () => {
  const filed = fakeDb("rejected");
  const r1 = await recordExecution(filed, "id", { ok: true, targetId: "401", note: "Filed #401." });
  assert.equal(r1.ok, false);
  assert.equal(filed.row.status, "rejected");
  assert.match(r1.message, /Filed #401\. The row was rejected while this ran/);

  const failed = fakeDb("rejected");
  await recordExecution(failed, "id", { ok: false, retryable: true, error: "502" });
  assert.equal(failed.row.status, "rejected"); // not pulled back into the queue
});

test("recordExecution: a failed row save after a filed issue is reported, not a clean success (QA F3)", async () => {
  const r = await recordExecution(fakeDb("approved", { writeFails: true }), "id", { ok: true, targetId: "401", note: "Filed #401." });
  assert.equal(r.ok, false);
  assert.match(r.message, /Filed #401\. But saving the row failed \(db down\).*Approve it again/);
});

test("approvable: an approved row only after the function limit, so two executors can't race", () => {
  const now = Date.parse("2026-10-16T16:10:00Z");
  assert.equal(approvable({ status: "proposed", decided_at: null }, now), true);
  assert.equal(approvable({ status: "approved", decided_at: new Date(now - 30_000).toISOString() }, now), false);
  assert.equal(approvable({ status: "approved", decided_at: new Date(now - APPROVAL_IN_FLIGHT_MS - 1).toISOString() }, now), true);
  for (const status of ["executed", "rejected", "failed", "reverted"]) {
    assert.equal(approvable({ status, decided_at: null }, now), false);
  }
});

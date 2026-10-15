// Drives the two agent issue writers (lib/agent/qa-audit.ts fileQaFindings,
// lib/agent/propose-tasks.ts fileTaskIssues) through every filing path with a
// fake GitHub client: no token, list failed, create failed, labels dropped, and
// dedup. These paths decide whether the Inbox alert fires (issue #325), so a
// quiet regression here is a sensor failing silently.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileQaFindings, checkKey, type QaAgg } from "../../lib/agent/qa-audit.js";
import { fileTaskIssues, parseExtractedTasks, privateSignal } from "../../lib/agent/propose-tasks.js";
import { checkKeyLine, type IssueLite, type IssuesClient, type NewIssue } from "../../lib/github-issues.js";

function fakeClient(opts: {
  existing?: IssueLite[];
  listFails?: boolean;
  createFails?: (i: NewIssue) => boolean;
  dropLabels?: boolean;
}): IssuesClient & { created: NewIssue[] } {
  const created: NewIssue[] = [];
  let n = 100;
  return {
    repo: "x/y",
    created,
    async listRecent() {
      if (opts.listFails) throw new Error("401");
      return opts.existing ?? [];
    },
    async create(issue) {
      if (opts.createFails?.(issue)) throw new Error("500");
      created.push(issue);
      n++;
      return { number: n, html_url: `u${n}`, title: issue.title, gated: !opts.dropLabels };
    },
  };
}

const open = (over: Partial<IssueLite>): IssueLite => ({
  number: 1,
  title: "t",
  body: null,
  state: "open",
  state_reason: null,
  closed_at: null,
  html_url: "u",
  ...over,
});

const agg = (scope: string): QaAgg => ({
  key: checkKey("status", scope),
  check: "status",
  severity: "p1",
  title: `QA: ${scope} returns an error`,
  examples: [scope],
  detail: "HTTP 500",
});

test("fileQaFindings: no findings is a clean no-op", async () => {
  const r = await fileQaFindings(fakeClient({}), []);
  assert.deepEqual(r, { filed: 0, skipped: 0, filed_issues: [], filing_error: null, unfiled_titles: [] });
});

test("fileQaFindings: no token and a failed list each report every finding as unfiled", async () => {
  const aggs = [agg("/free"), agg("/about")];
  const noToken = await fileQaFindings(null, aggs);
  assert.equal(noToken.filing_error, "GITHUB_ISSUES_TOKEN_MISSING");
  assert.deepEqual(noToken.unfiled_titles, aggs.map((a) => a.title));
  const client = fakeClient({ listFails: true });
  const listFailed = await fileQaFindings(client, aggs);
  assert.equal(listFailed.filing_error, "list_failed");
  assert.equal(listFailed.unfiled_titles.length, 2);
  assert.equal(client.created.length, 0);
});

test("fileQaFindings: skips a covered check_key, files the rest, reports a create failure", async () => {
  const client = fakeClient({
    existing: [open({ body: checkKeyLine(checkKey("status", "/free")) })],
    createFails: (i) => i.title.includes("/hosts"),
  });
  const r = await fileQaFindings(client, [agg("/free"), agg("/about"), agg("/hosts")]);
  assert.equal(r.filed, 1);
  assert.deepEqual(client.created.map((i) => i.title), ["QA: /about returns an error"]);
  assert.equal(r.skipped, 2);
  assert.equal(r.filing_error, "create_failed");
  assert.deepEqual(r.unfiled_titles, ["QA: /hosts returns an error"]);
});

test("fileQaFindings: a dropped proposed label is filed but flagged", async () => {
  const r = await fileQaFindings(fakeClient({ dropLabels: true }), [agg("/free")]);
  assert.equal(r.filed, 1);
  assert.equal(r.filing_error, "labels_dropped");
  assert.deepEqual(r.unfiled_titles, []);
});

const tasks = parseExtractedTasks(
  JSON.stringify([
    { title: "Add a free events filter to town pages", body: "spec", type: "feature", priority: "p2" },
    { title: "Fix the grape stomp page title", body: "spec", type: "bug", priority: "p2" },
  ])
);
const OPTS = { runId: "r1", date: "2026-10-16" };

test("fileTaskIssues: dedups by title against open issues and files the rest", async () => {
  const client = fakeClient({ existing: [open({ title: "Add free events filter to the town pages" })] });
  const r = await fileTaskIssues(client, tasks, OPTS);
  assert.equal(r.proposed, 1);
  assert.equal(r.skipped, 1);
  assert.equal(r.error, null);
  assert.deepEqual(client.created.map((i) => i.title), ["Fix the grape stomp page title"]);
});

test("fileTaskIssues: list failure, create failure and dropped labels all surface", async () => {
  const listFailed = await fileTaskIssues(fakeClient({ listFails: true }), tasks, OPTS);
  assert.equal(listFailed.error, "list_failed");
  assert.equal(listFailed.unfiled.length, 2);

  const createFailed = await fileTaskIssues(fakeClient({ createFails: (i) => i.title.startsWith("Fix") }), tasks, OPTS);
  assert.equal(createFailed.error, "create_failed");
  assert.deepEqual(createFailed.unfiled, ["Fix the grape stomp page title"]);
  assert.equal(createFailed.proposed, 1);

  const dropped = await fileTaskIssues(fakeClient({ dropLabels: true }), tasks, OPTS);
  assert.equal(dropped.error, "labels_dropped");
  assert.equal(dropped.proposed, 2);
});

test("privateSignal holds back figures that must not reach a public repo", () => {
  const t = (body: string) => ({ title: "Fix the newsletter confirm email", body, rationale: "" });
  assert.equal(privateSignal(t("Confirm rate fell to 40% this week")), "a percentage");
  assert.equal(privateSignal(t("12 of 30 signups never confirmed")), "an N of M count");
  assert.equal(privateSignal(t("We have 212 subscribers now")), "a private metric");
  assert.equal(privateSignal(t("subscribers dropped to 180")), "a private metric");
  assert.equal(privateSignal(t("Ask owner@brice.example about the feed")), "an email address");
  assert.equal(privateSignal(t("Sponsorship worth $500")), "a dollar amount");
  // describing the kind of signal, without figures, is fine
  assert.equal(privateSignal(t("Newsletter confirmations are leaking; resend the confirm link after a day")), null);
  assert.equal(privateSignal(t("Add a /free filter to the 9 town pages")), null);
});

test("fileTaskIssues: a proposal quoting private figures is held, not filed", async () => {
  const leaky = parseExtractedTasks(
    JSON.stringify([{ title: "Resend the confirm link", body: "confirm rate is 40%", type: "growth", priority: "p2" }])
  );
  const client = fakeClient({});
  const r = await fileTaskIssues(client, leaky, OPTS);
  assert.equal(client.created.length, 0);
  assert.equal(r.error, "privacy_hold");
  assert.match(r.unfiled[0], /held: quotes a percentage/);
});

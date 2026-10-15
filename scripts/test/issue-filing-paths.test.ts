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
import { fileTaskIssues, parseExtractedTasks, privateSignal, proposeTasksFromDigest } from "../../lib/agent/propose-tasks.js";
import { FILING_ERRORS } from "../../lib/agent/issue-filing-alert.js";
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
  assert.deepEqual(r, { filed: 0, skipped: 0, filed_issues: [], filing_error: null, filing_errors: [], unfiled_titles: [] });
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
  assert.equal(createFailed.unfiled.length, 1);
  assert.match(createFailed.unfiled[0], /^\[create_failed\] Fix the grape stomp page title \(spec: spec;/);
  assert.equal(createFailed.proposed, 1);

  const dropped = await fileTaskIssues(fakeClient({ dropLabels: true }), tasks, OPTS);
  assert.equal(dropped.error, "labels_dropped");
  assert.equal(dropped.proposed, 2);
});

test("privateSignal holds back any figure or email; only public digit tokens pass", () => {
  const t = (body: string) => ({ title: "Fix the newsletter confirm email", body, rationale: "" });
  for (const leaky of [
    "Confirm rate fell to 40% this week",
    "12 of 30 signups never confirmed",
    "The newsletter list grew from 180 to 212",
    "Newsletter net was +12 this week",
    "1,400 impressions at position 8.2",
    "Sponsorship pays 300 dollars",
    "Murphys Irish Pub drove 2031 clicks",
    "list stuck at `212` confirmed",
    "see /admin/growth-memo/123",
    "Hwy 4 newsletter has 212 readers",
    "Highway 40 traffic was 900",
    "Newsletter list stalled near 500 signups",
    "Murphys Irish Pub sent 2025 referral clicks",
    "The venue drove forty clicks",
    "Only fifteen people confirmed last week",
    "Twelve referrals went to Murphys Pour House",
    "Confirm rate is ten percent",
    "Signups rose to 2026",
  ]) {
    assert.equal(privateSignal(t(leaky)), "a figure", leaky);
  }
  assert.equal(privateSignal(t("Ask owner@brice.example about the feed")), "an email address");
  // the kind of signal, a year, a page path or a code span is fine
  for (const clean of [
    "Newsletter confirmations are leaking; resend the confirm link after a day",
    "Lead the /events/grape-stomp-2026 title with the search phrasing for 2027",
    "Add a filter to the /free page and to `lib/market-pages.ts` hub",
    "Year-less URL for the 2027 festival, not /events/hermitfest-west-2026",
    "Add a Hwy 4 events link to the footer",
    "Link hwy4events.com town pages from the newsletter",
    "Give each Highway 4 town page a FAQ block",
    "Fix the broken link on /towns/arnold",
    "Grape stomp 2026-10-15 alias, follow-up to #325 and HWY-78",
    "Sharpen the /things-to-do title and H1 for the wine tasting query",
  ]) {
    assert.equal(privateSignal(t(clean)), null, clean);
  }
});

test("fileTaskIssues: a proposal quoting private figures is held, not filed", async () => {
  const leaky = parseExtractedTasks(
    JSON.stringify([{ title: "Resend the confirm link", body: "confirm rate is 40%", type: "growth", priority: "p2" }])
  );
  const client = fakeClient({});
  const r = await fileTaskIssues(client, leaky, OPTS);
  assert.equal(client.created.length, 0);
  assert.equal(r.error, "privacy_hold");
  assert.match(r.unfiled[0], /^\[privacy_hold, quotes a figure\] Resend the confirm link \(spec: confirm rate is 40%/);
});

test("both writers stop at the deadline and report what they didn't file", async () => {
  const past = Date.now() - 1;
  const qaClient = fakeClient({});
  const qa = await fileQaFindings(qaClient, [agg("/free")], past);
  assert.equal(qa.filing_error, "deadline_exceeded");
  assert.deepEqual(qa.unfiled_titles, ["QA: /free returns an error"]);
  assert.equal(qaClient.created.length, 0);

  const memoClient = fakeClient({});
  const memo = await fileTaskIssues(memoClient, tasks, OPTS, new Date(), past);
  assert.equal(memo.error, "deadline_exceeded");
  assert.equal(memo.unfiled.length, 2);
  assert.equal(memoClient.created.length, 0);

  // no deadline means no limit
  const free = await fileQaFindings(fakeClient({}), [agg("/free")]);
  assert.equal(free.filed, 1);
});

test("proposeTasksFromDigest: no time left for extraction is a filing failure the Inbox sees", async () => {
  const r = await proposeTasksFromDigest(
    { runId: "r1", digest: { summary: "x" }, deadline: Date.now() - 1 },
    fakeClient({})
  );
  assert.equal(r.error, "deadline_exceeded");
  assert.equal(r.unfiled.length, 1);
  assert.ok(FILING_ERRORS.has(r.error!));
});

test("a held proposal's alert text includes the rationale that may have tripped it", async () => {
  const leaky = parseExtractedTasks(
    JSON.stringify([{ title: "Resend the confirm link", body: "clean spec", rationale: "confirmations fell to 40", type: "growth" }])
  );
  const r = await fileTaskIssues(fakeClient({}), leaky, OPTS);
  assert.match(r.unfiled[0], /why now: confirmations fell to 40/);
});

test("one run's failures don't mask each other", async () => {
  const mixed = parseExtractedTasks(
    JSON.stringify([
      { title: "Resend the confirm link", body: "rate is 40%", type: "growth" },
      { title: "Fix the grape stomp page title", body: "spec", type: "bug" },
    ])
  );
  const r = await fileTaskIssues(fakeClient({ createFails: () => true }), mixed, OPTS);
  assert.deepEqual(r.errors.sort(), ["create_failed", "privacy_hold"]);
});

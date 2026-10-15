// Regression lock for the GitHub issues client (lib/github-issues.ts, issue #325).
// The agents that file issues dedup on the `check_key:` body line and on which
// existing issues suppress a refile. Both are pure and pinned here, plus the
// client's fail-closed paths against a stub fetch.
//
// Run: `cd scripts && npm test`

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bodyCheckKey,
  checkKeyLine,
  coveredCheckKeys,
  githubIssuesClient,
  issuesRepo,
  suppressesRefile,
  DEFAULT_ISSUES_REPO,
  type IssueLite,
} from "../../lib/github-issues.js";

const NOW = new Date("2026-10-15T12:00:00Z");

function issue(over: Partial<IssueLite>): IssueLite {
  return {
    number: 1,
    title: "t",
    body: null,
    state: "open",
    state_reason: null,
    closed_at: null,
    html_url: "https://github.com/x/y/issues/1",
    ...over,
  };
}

test("checkKeyLine round-trips through bodyCheckKey, anywhere in the body", () => {
  const body = `**Suggested priority: p2.**\n\n## Problem\nx\n\n${checkKeyLine("qa:status:/free")}`;
  assert.equal(bodyCheckKey(body), "qa:status:/free");
  assert.equal(bodyCheckKey(`${checkKeyLine("persona-qa/weather-range")}\n\nmore`), "persona-qa/weather-range");
  assert.equal(bodyCheckKey("no key here"), null);
  assert.equal(bodyCheckKey(null), null);
  // a mention mid-sentence is not a key line
  assert.equal(bodyCheckKey("see check_key: foo in the other issue"), null);
});

test("suppressesRefile: open always, not-planned or duplicate for 30 days, completed never", () => {
  assert.equal(suppressesRefile(issue({ state: "open" }), NOW), true);
  assert.equal(
    suppressesRefile(issue({ state: "closed", state_reason: "not_planned", closed_at: "2026-10-01T00:00:00Z" }), NOW),
    true
  );
  assert.equal(
    suppressesRefile(issue({ state: "closed", state_reason: "not_planned", closed_at: "2026-09-01T00:00:00Z" }), NOW),
    false
  );
  // closed as a duplicate is a decline too, or the next run refiles it
  assert.equal(
    suppressesRefile(issue({ state: "closed", state_reason: "duplicate", closed_at: "2026-10-12T00:00:00Z" }), NOW),
    true
  );
  // a fixed bug that regresses must be filed again
  assert.equal(
    suppressesRefile(issue({ state: "closed", state_reason: "completed", closed_at: "2026-10-14T00:00:00Z" }), NOW),
    false
  );
});

test("coveredCheckKeys collects keys only from suppressing issues", () => {
  const keys = coveredCheckKeys(
    [
      issue({ body: checkKeyLine("a") }),
      issue({ state: "closed", state_reason: "completed", closed_at: "2026-10-14T00:00:00Z", body: checkKeyLine("b") }),
      issue({ state: "closed", state_reason: "not_planned", closed_at: "2026-10-10T00:00:00Z", body: checkKeyLine("c") }),
      issue({ body: "no key" }),
    ],
    NOW
  );
  assert.deepEqual([...keys].sort(), ["a", "c"]);
});

test("issuesRepo defaults and rejects a malformed override", () => {
  assert.equal(issuesRepo({}), DEFAULT_ISSUES_REPO);
  assert.equal(issuesRepo({ GITHUB_ISSUES_REPO: "someone/fork" }), "someone/fork");
  assert.equal(issuesRepo({ GITHUB_ISSUES_REPO: "not a repo" }), DEFAULT_ISSUES_REPO);
});

test("githubIssuesClient is null without a token", () => {
  assert.equal(githubIssuesClient({}), null);
  assert.equal(githubIssuesClient({ GITHUB_ISSUES_TOKEN: "  " }), null);
});

test("listRecent drops pull requests and throws on a non-200 (fail closed)", async () => {
  const calls: string[] = [];
  const ok = (async (url: string) => {
    calls.push(String(url));
    const rows = String(url).includes("state=open")
      ? [
          { number: 5, title: "an issue", body: checkKeyLine("k"), state: "open", state_reason: null, closed_at: null, html_url: "u5" },
          { number: 6, title: "a PR", body: null, state: "open", state_reason: null, closed_at: null, html_url: "u6", pull_request: {} },
        ]
      : [];
    return new Response(JSON.stringify(rows), { status: 200 });
  }) as unknown as typeof fetch;
  const client = githubIssuesClient({ GITHUB_ISSUES_TOKEN: "t" }, ok)!;
  const got = await client.listRecent(NOW);
  assert.deepEqual(got.map((i) => i.number), [5]);
  assert.ok(calls.some((c) => c.includes("state=closed") && c.includes("since=")));

  const bad = (async () => new Response("rate limited", { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(githubIssuesClient({ GITHUB_ISSUES_TOKEN: "t" }, bad)!.listRecent(NOW));
});

test("listRecent fails closed when the page cap is reached", async () => {
  const full = Array.from({ length: 100 }, (_, n) => ({
    number: n,
    title: "x",
    body: null,
    state: "open",
    state_reason: null,
    closed_at: null,
    html_url: "u",
  }));
  const always = (async () => new Response(JSON.stringify(full), { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(githubIssuesClient({ GITHUB_ISSUES_TOKEN: "t" }, always)!.listRecent(NOW), /raise MAX_PAGES/);
});

test("create reports whether the proposed label survived", async () => {
  const respond = (labels: unknown[]) =>
    (async () =>
      new Response(JSON.stringify({ number: 9, title: "t", html_url: "u9", labels }), { status: 201 })) as unknown as typeof fetch;
  const kept = await githubIssuesClient({ GITHUB_ISSUES_TOKEN: "t" }, respond([{ name: "proposed" }, { name: "bug" }]))!.create({
    title: "t",
    body: "b",
    labels: ["bug", "proposed"],
  });
  assert.equal(kept.gated, true);
  const dropped = await githubIssuesClient({ GITHUB_ISSUES_TOKEN: "t" }, respond([]))!.create({
    title: "t",
    body: "b",
    labels: ["bug", "proposed"],
  });
  assert.equal(dropped.gated, false);
});

// Agents file GitHub issues, not board rows (issue #325: GitHub Issues is the
// only backlog). A zero-dep REST client for the two agent writers that run in
// Vercel: the weekly QA audit (lib/agent/qa-audit.ts) and the growth memo's
// ticket proposer (lib/agent/propose-tasks.ts). Persona QA files through `gh`
// on Rob's Mac and does not use this.
//
// Token: GITHUB_ISSUES_TOKEN, a fine-grained token with Issues read/write on
// this repo only, set in Vercel Production. Unset means the writers are logged
// no-ops (GITHUB_ISSUES_TOKEN_MISSING), never a throw into the cron.
//
// The `proposed` label is the human gate. Rob accepts an issue by moving it to
// Ready on the GitHub Project (which auto-adds every new issue) and declines it
// by closing it as not planned.
//
// Dedup fails closed: if the issue list cannot be read, nothing is filed, so a
// GitHub hiccup can never turn into a weekly duplicate.

// Relative import so the scripts/ test runner can load this module.
import { SITE_NAME } from "./constants";

export const DEFAULT_ISSUES_REPO = "robgabel/hwy4-events";
const API = "https://api.github.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
/** A closed-as-not-planned issue suppresses a refile for this long. */
export const DECLINED_SUPPRESS_DAYS = 30;

export type IssueLite = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  state_reason: string | null;
  closed_at: string | null;
  html_url: string;
};

export type NewIssue = { title: string; body: string; labels: string[] };
export type FiledIssue = { number: number; html_url: string; title: string };

export type IssuesClient = {
  repo: string;
  /** Open issues plus issues closed in the last DECLINED_SUPPRESS_DAYS. Throws on failure. */
  listRecent(now?: Date): Promise<IssueLite[]>;
  /** Creates one issue. Throws on failure. */
  create(issue: NewIssue): Promise<FiledIssue>;
};

/** The body line that makes an issue findable by a later run. One per issue. */
export function checkKeyLine(key: string): string {
  return `check_key: ${key}`;
}

/** Read the `check_key:` line back out of an issue body. Null when absent. */
export function bodyCheckKey(body: string | null | undefined): string | null {
  if (!body) return null;
  const m = /^check_key:\s*(\S+)\s*$/m.exec(body);
  return m ? m[1] : null;
}

/**
 * Does this existing issue stop a refile of the same finding? Open always does.
 * Closed as not planned does for DECLINED_SUPPRESS_DAYS, so a declined idea is
 * not re-nagged every week. Closed as completed does not: a fixed bug that
 * regressed should be filed again.
 */
export function suppressesRefile(issue: IssueLite, now: Date = new Date()): boolean {
  if (issue.state === "open") return true;
  if (issue.state_reason !== "not_planned" || !issue.closed_at) return false;
  const closedMs = Date.parse(issue.closed_at);
  if (Number.isNaN(closedMs)) return false;
  return now.getTime() - closedMs <= DECLINED_SUPPRESS_DAYS * 86_400_000;
}

/** check_keys that are already covered (open, or recently declined). */
export function coveredCheckKeys(issues: IssueLite[], now: Date = new Date()): Set<string> {
  const keys = new Set<string>();
  for (const i of issues) {
    if (!suppressesRefile(i, now)) continue;
    const k = bodyCheckKey(i.body);
    if (k) keys.add(k);
  }
  return keys;
}

export function issuesRepo(env: { [k: string]: string | undefined } = process.env): string {
  const r = env.GITHUB_ISSUES_REPO?.trim();
  return r && /^[\w.-]+\/[\w.-]+$/.test(r) ? r : DEFAULT_ISSUES_REPO;
}

export function issuesUrl(repo: string = issuesRepo()): string {
  return `https://github.com/${repo}/issues`;
}

type RawIssue = IssueLite & { pull_request?: unknown };

function toLite(r: RawIssue): IssueLite {
  return {
    number: r.number,
    title: r.title,
    body: r.body ?? null,
    state: r.state,
    state_reason: r.state_reason ?? null,
    closed_at: r.closed_at ?? null,
    html_url: r.html_url,
  };
}

/**
 * The live client, or null when GITHUB_ISSUES_TOKEN is unset. Callers treat
 * null as "file nothing" and log GITHUB_ISSUES_TOKEN_MISSING.
 */
export function githubIssuesClient(
  env: { [k: string]: string | undefined } = process.env,
  fetchImpl: typeof fetch = fetch
): IssuesClient | null {
  const token = env.GITHUB_ISSUES_TOKEN?.trim();
  if (!token) return null;
  const repo = issuesRepo(env);
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": `${SITE_NAME} agent`,
  };

  async function listPages(query: string): Promise<IssueLite[]> {
    const out: IssueLite[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetchImpl(`${API}/repos/${repo}/issues?${query}&per_page=${PAGE_SIZE}&page=${page}`, {
        headers,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`GitHub list issues ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const rows = (await res.json()) as RawIssue[];
      // The issues endpoint also returns pull requests; they never carry a finding.
      for (const r of rows) if (!r.pull_request) out.push(toLite(r));
      if (rows.length < PAGE_SIZE) break;
    }
    return out;
  }

  return {
    repo,
    async listRecent(now = new Date()) {
      const since = new Date(now.getTime() - DECLINED_SUPPRESS_DAYS * 86_400_000).toISOString();
      const [open, closed] = await Promise.all([
        listPages("state=open"),
        listPages(`state=closed&since=${encodeURIComponent(since)}`),
      ]);
      return [...open, ...closed];
    },
    async create(issue) {
      const res = await fetchImpl(`${API}/repos/${repo}/issues`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(issue),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`GitHub create issue ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const r = (await res.json()) as RawIssue;
      return { number: r.number, html_url: r.html_url, title: r.title };
    },
  };
}

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
// Relative (not "@/") imports so the scripts/ test runner can import this module.
import { MEDIUM_EFFORT, REASONER_MODEL } from "./models";
import { messageText } from "./message-text";
import { githubIssuesClient, hasTimeFor, REQUEST_TIMEOUT_MS, suppressesRefile, type IssuesClient } from "../github-issues";

// Turn the weekly growth memo into proposed dev tickets (issue #325: GitHub
// Issues is the only backlog). The memo already reasons over the site's signals
// and writes an agent_runs row; this reads that digest and proposes a ticket for
// any item that is a concrete DEV change (a feature, a bug fix, a data/SEO fix, a
// page), NOT an ops task like "review a submission" or "send an email", which
// have their own queues. The daily chief-of-staff digest no longer proposes:
// it refiled one Brice Station problem three times under different titles, and
// #332 retires that digest.
//
// Propose-first: the repo is public and the memo reasons over private figures,
// so this never calls issues.create. Each ticket becomes a proposed
// `file_github_issue` row in agent_actions, private in the Inbox. Rob approves
// it at /admin/actions and lib/agent/file-github-issue.ts files the issue then
// (with the `proposed` label, so it still lands in Proposed on the GitHub
// Project). privateSignal() is a warning badge on the row, not a hold.
//
// Best-effort + idempotent: it never throws into the reasoner (a proposal failure
// must not fail the memo), and it dedups by normalized title against open and
// recently decided proposals and against open and recently declined issues, so a
// weekly memo can't re-propose an idea.

export const TASK_TYPES = ["feature", "bug", "qa", "growth", "chore"] as const;
export const TASK_PRIORITIES = ["p0", "p1", "p2", "p3"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

const MODEL = REASONER_MODEL;
const MAX_PER_RUN = 2; // a reasoner proposes at most 2 tickets/run — precision over volume

export type ProposeTasksResult = {
  /** Proposed agent_actions rows staged this run. */
  proposed: number;
  skipped: number;
  /** Staged rows that carry a privacy_warning badge. */
  warned: number;
  /** The first failure of the run (null when everything was staged). */
  error: string | null;
  /** Every distinct failure in the run, so one can't mask another. */
  errors: string[];
  /** Proposals that didn't reach the Inbox, each with its reason, spec and rationale (the extraction is saved nowhere else). */
  unfiled: string[];
};

export type ExtractedTask = { title: string; body: string; type: TaskType; priority: TaskPriority; rationale: string };

const SYSTEM_PROMPT = `You triage a daily/weekly ops digest for Hwy4Events.com (a one-person community events site) into DEVELOPER tickets for a GitHub issue backlog.

A ticket is warranted ONLY for a concrete change to the CODEBASE or the SITE that a developer (Claude Code) would implement: a new feature or page, a bug fix, a data-quality or SEO fix, a UX change, a script.

Do NOT file a ticket for:
- routine ops that already have a queue (reviewing a community submission, verifying an event date, approving a poster, sending an outreach email) — those are human clicks, not code changes.
- vague aspirations ("grow the newsletter") with no concrete change behind them.
- anything the digest only mentions as fine / informational.

Most digests warrant ZERO tickets. That is the correct and common answer. Only propose when the digest clearly implies a specific build. Never invent work the digest does not support.

For each real dev ticket, write:
- title: a short imperative (e.g. "Add a /free filter to town pages").
- body: 2-4 sentences of spec — what to change and why, grounded in the digest signal that prompted it. This is what the developer reads.
- type: one of feature | bug | qa | growth | chore.
- priority: one of p0 | p1 | p2 | p3 (p0 = urgent/breaking, p2 = normal, p3 = someday). Reserve p0/p1 for genuine breakage.
- rationale: one line on why it is worth doing now.

The ticket becomes an issue in a PUBLIC GitHub repo that anyone can read. Never put private numbers or people in title, body or rationale: no subscriber, open, confirm or referral counts or rates, no revenue, no traffic numbers for a named business, no names or emails of subscribers, submitters or organizers. Describe the change and the kind of signal behind it ("newsletter confirmations are leaking", "a venue page gets impressions but no clicks"), not the figures.

Voice: plain, direct, dry. No hype, no emojis, NO EM DASHES (use commas, periods, parentheses).

Output STRICT JSON only, no markdown fences, no preamble: an array (possibly empty) of {"title","body","type","priority","rationale"}. Return [] if nothing qualifies.`;

function safeJsonArray(text: string): unknown[] {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const tryParse = (s: string): unknown[] | null => {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(cleaned);
  if (direct) return direct;
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start !== -1 && end > start) return tryParse(cleaned.slice(start, end + 1)) ?? [];
  return [];
}

// Parse the model's JSON-array output into validated tasks, capped. Pure — locked
// by scripts/test/propose-tasks.test.ts so the coercion/defaults can't drift.
export function parseExtractedTasks(text: string, max = MAX_PER_RUN): ExtractedTask[] {
  return safeJsonArray(text)
    .map(coerce)
    .filter((t): t is ExtractedTask => t !== null)
    .slice(0, max);
}

function coerce(raw: unknown): ExtractedTask | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title) return null;
  const type = (TASK_TYPES as readonly string[]).includes(String(r.type)) ? (r.type as TaskType) : "chore";
  const priority = (TASK_PRIORITIES as readonly string[]).includes(String(r.priority)) ? (r.priority as TaskPriority) : "p3";
  return {
    title: title.slice(0, 200),
    body: typeof r.body === "string" ? r.body.trim() : "",
    type,
    priority,
    rationale: typeof r.rationale === "string" ? r.rationale.trim() : "",
  };
}

// Word-set for dedup: lowercase, alphanumerics only, drop short stopwords.
const STOP = new Set(["the", "a", "an", "to", "for", "of", "and", "on", "in", "add", "fix", "with"]);
function words(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 2 && !STOP.has(w))
  );
}
function similar(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return inter / union >= 0.6; // Jaccard — a daily reasoner re-wording the same idea still dedups
}

// Two ticket titles "collide" (are the same idea) if their significant word sets
// overlap enough. Pure — locked by scripts/test/propose-tasks.test.ts.
export function titlesCollide(a: string, b: string): boolean {
  return similar(words(a), words(b));
}

// The repo is public, and the growth memo reasons over private signals
// (newsletter counts, referrals per named business, outreach drafts). The prompt
// tells the model to leave figures out; this flags a proposal that still carries
// one, as a warning badge on its Inbox row (Rob reads every proposal before it
// is filed, so this is no longer a hold). The rule is blunt: any figure at all.
// The exceptions are public tokens that carry digits but no data: the site's
// own name and road (Hwy 4, hwy4events.com, Highway 4, Route 4), an ISO date, a
// year only where it reads as a year ("in 2027", "the 2027 festival", "-2026" in
// a slug), and an issue or board ref (#325, HWY-81). Any other digit, a
// spelled-out number from two up or "percent", or an email address raises the
// badge. Known gaps: a count written as "one", a figure phrased with no number
// ("doubled"), a count that sits where a year would ("the 2024 signups"), and
// people's names pass without a badge, which is why the human read, not this
// check, is the gate. An HTTP code ("a 301") is a false positive.
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;
// "one" is left out on purpose: it is in most sentences and would hold every proposal.
const SPELLED_COUNT_RE =
  /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|dozens?|million|percent)\b/i;
const ALLOWED_DIGITS_RE = new RegExp(
  [
    String.raw`\b(?:hwy|highway|route|sr|state route)[\s-]?4(?!\d)`, // the corridor and the brand (hwy4events.com)
    String.raw`\b202[4-9]-\d\d-\d\d\b`, // an ISO date
    // a year only in a year-shaped position, never as a bare count ("sent 2025 clicks")
    String.raw`(?:\b(?:in|for|of|since|by|until|the)\s+|[-/])202[4-9]\b`,
    String.raw`#\d+\b`, // GitHub issue / PR refs
    String.raw`\bH[1-6]\b`, // heading levels ("the title and H1")
    String.raw`\bHWY-\d+\b`, // old board refs
  ].join("|"),
  "gi"
);

/** Why this ticket text must not go to a public issue, or null when it's clean. Pure. */
export function privateSignal(t: Pick<ExtractedTask, "title" | "body" | "rationale">): string | null {
  const text = [t.title, t.body, t.rationale].join("\n");
  if (EMAIL_RE.test(text)) return "an email address";
  if (/\d/.test(text.replace(ALLOWED_DIGITS_RE, " "))) return "a figure";
  if (SPELLED_COUNT_RE.test(text)) return "a figure";
  return null;
}


// PURE: the GitHub issue one extracted ticket would become. The check_key line
// is not here: the executor appends one per agent_actions row when it files
// (lib/agent/file-github-issue.ts). Locked by scripts/test/propose-tasks.test.ts.
export function taskIssue(
  t: ExtractedTask,
  opts: { runId: string | null; date: string }
): { title: string; body: string; labels: string[] } {
  const lines = [
    `**Suggested priority: ${t.priority}.** Proposed by the weekly growth memo, ${opts.date}${
      opts.runId ? ` (agent run \`${opts.runId}\`)` : ""
    }.`,
    "",
    "## Proposed change",
    t.body || t.title,
  ];
  if (t.rationale) lines.push("", "## Why now", t.rationale);
  return { title: t.title, body: lines.join("\n"), labels: [t.type, "proposed", "lens:growth-memo"] };
}

// Each ticket is a proposed agent_actions row, private in the Inbox, until Rob
// approves it at /admin/actions (lib/agent/file-github-issue.ts files it then).
export const FILE_GITHUB_ISSUE_TYPE = "file_github_issue";

export type FileGithubIssuePayload = {
  title?: string;
  /** The issue body without its check_key line; the executor appends that. */
  body?: string;
  labels?: string[];
  /** What privateSignal() saw at proposal time ("a figure", "an email address"), or null. A warning, not a hold. */
  privacy_warning?: string | null;
  source?: string;
  run_id?: string | null;
};

// PURE: the agent_actions row for one ticket. outward_facing (it publishes to a
// public repo) and irreversible (an issue can be closed, not unfiled), so
// canAutoExecute can never pass and Approve is the only path. Locked by
// scripts/test/propose-tasks.test.ts.
export function proposalRow(
  t: ExtractedTask,
  opts: { runId: string | null; date: string }
): Record<string, unknown> {
  const issue = taskIssue(t, opts);
  const payload: FileGithubIssuePayload = {
    title: issue.title,
    body: issue.body,
    labels: issue.labels,
    privacy_warning: privateSignal(t),
    source: "growth_memo",
    run_id: opts.runId,
  };
  return {
    type: FILE_GITHUB_ISSUE_TYPE,
    run_id: opts.runId,
    title: issue.title,
    rationale: t.rationale || null,
    payload,
    blast_radius: "med",
    reversible: false,
    outward_facing: true,
    status: "proposed",
  };
}

/** How long a rejected or decided proposal blocks a re-proposal of the same idea. */
const PROPOSAL_SUPPRESS_DAYS = 30;

export type ProposalStore = {
  /** Titles of file_github_issue rows that block a re-proposal: open ones of any age, and any created in the last 30 days. Throws on failure. */
  blockingTitles(now: Date): Promise<string[]>;
  /** Inserts the rows. Throws on failure. */
  insert(rows: Record<string, unknown>[]): Promise<void>;
};

export function supabaseProposalStore(supabase: SupabaseClient): ProposalStore {
  const titlesOf = (rows: { title: string | null; payload: { title?: string } | null }[] | null) =>
    (rows ?? []).flatMap((r) => [r.title, r.payload?.title].filter((x): x is string => Boolean(x)));
  return {
    async blockingTitles(now) {
      const since = new Date(now.getTime() - PROPOSAL_SUPPRESS_DAYS * 86_400_000).toISOString();
      const [open, recent] = await Promise.all([
        supabase.from("agent_actions").select("title, payload").eq("type", FILE_GITHUB_ISSUE_TYPE).in("status", ["proposed", "approved"]),
        supabase.from("agent_actions").select("title, payload").eq("type", FILE_GITHUB_ISSUE_TYPE).gte("created_at", since),
      ]);
      if (open.error) throw new Error(open.error.message);
      if (recent.error) throw new Error(recent.error.message);
      return [...titlesOf(open.data), ...titlesOf(recent.data)];
    },
    async insert(rows) {
      const { error } = await supabase.from("agent_actions").insert(rows);
      if (error) throw new Error(error.message);
    },
  };
}

export async function proposeTasksFromDigest(
  /** deadline: epoch ms by which the run must stop, so the route can still write the Inbox alert. */
  opts: { runId: string | null; digest: unknown; deadline?: number },
  store: ProposalStore,
  issues: IssuesClient | null = githubIssuesClient()
): Promise<ProposeTasksResult> {
  const none = (error: string | null = null, unfiled: string[] = []): ProposeTasksResult => ({
    proposed: 0,
    skipped: 0,
    warned: 0,
    error,
    errors: error ? [error] : [],
    unfiled,
  });
  if (!opts.digest) return none();
  // The extraction shares the route's budget with the memo call before it.
  // Bound it so a slow model reply ends in an Inbox alert, not a killed function:
  // it must finish with room left for one GitHub list and the row insert.
  const NOT_EXTRACTED = "Growth memo build proposals (not extracted in time; reread this week's memo)";
  let extractTimeoutMs: number | undefined;
  if (opts.deadline !== undefined) {
    extractTimeoutMs = opts.deadline - Date.now() - 2 * REQUEST_TIMEOUT_MS;
    if (extractTimeoutMs < 5_000) return none("deadline_exceeded", [NOT_EXTRACTED]);
  }
  // 1. Extract candidate dev tickets from the digest (best-effort, never throw).
  let extracted: ExtractedTask[];
  try {
    const anthropic = new Anthropic();
    const message = await anthropic.messages.create(
      {
      model: MODEL,
      max_tokens: 3000,
      output_config: MEDIUM_EFFORT,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Here is the weekly growth memo as JSON. File dev tickets for any concrete build it implies (usually none).\n\n${JSON.stringify(
            opts.digest,
            null,
            2
          )}`,
        },
      ],
      },
      extractTimeoutMs !== undefined ? { timeout: extractTimeoutMs, maxRetries: 0 } : undefined
    );
    extracted = parseExtractedTasks(messageText(message.content));
  } catch (err) {
    console.error("[propose-tasks] extraction failed:", err);
    // A timeout against the deadline is a failure the Inbox must show; any
    // other model error stays a plain extraction failure, as before.
    if (err instanceof Anthropic.APIConnectionTimeoutError) return none("deadline_exceeded", [NOT_EXTRACTED]);
    return none("extraction_failed");
  }
  if (extracted.length === 0) return none();

  return stageTaskProposals(
    store,
    extracted,
    { runId: opts.runId, date: new Date().toISOString().slice(0, 10) },
    issues,
    new Date(),
    opts.deadline
  );
}

// One Inbox line per proposal that couldn't be staged. The extraction isn't
// saved anywhere else and the memo never re-proposes, so the spec and the
// rationale travel with it; this text lands only in the private agent_actions row.
function unfiledEntry(t: ExtractedTask, reason: string): string {
  return `[${reason}] ${t.title} (spec: ${t.body || "none"}; why now: ${t.rationale || "none"})`;
}

// Dedup + stage the extracted tickets as proposed agent_actions rows. Never
// calls issues.create: the GitHub client, when there is one, is only read, to
// skip an idea an open or recently declined issue already covers (best-effort;
// the executor runs that check again, fail-closed, at approval). Split out so
// the paths can be driven with fakes. Locked by scripts/test/issue-filing-paths.test.ts.
export async function stageTaskProposals(
  store: ProposalStore,
  extracted: ExtractedTask[],
  opts: { runId: string | null; date: string },
  issues: IssuesClient | null = null,
  now: Date = new Date(),
  deadline?: number
): Promise<ProposeTasksResult> {
  const failed = (error: string): ProposeTasksResult => ({
    proposed: 0,
    skipped: 0,
    warned: 0,
    error,
    errors: [error],
    unfiled: extracted.map((t) => unfiledEntry(t, error)),
  });
  // Our own queue: an open proposal, or one decided in the last 30 days. Fail
  // closed: if the queue can't be read, the insert would likely fail too, and a
  // blind insert could double a still-open proposal.
  let seen: Set<string>[];
  try {
    seen = (await store.blockingTitles(now)).map(words);
  } catch (err) {
    console.error("[propose-tasks] reading proposals failed:", err);
    return failed("inbox_write_failed");
  }
  // GitHub: open issues and issues declined in the last 30 days. Read-only and
  // best-effort; the approval re-checks before it files.
  if (issues && hasTimeFor(deadline)) {
    try {
      const recent = await issues.listRecent(now, deadline);
      seen.push(...recent.filter((i) => suppressesRefile(i, now)).map((i) => words(i.title)));
    } catch (err) {
      console.error("[propose-tasks] listing issues failed (the approval re-checks):", err);
    }
  }

  const rows: Record<string, unknown>[] = [];
  const staged: ExtractedTask[] = [];
  let skipped = 0;
  for (const t of extracted) {
    const w = words(t.title);
    if (seen.some((s) => similar(w, s))) {
      skipped++;
      continue;
    }
    seen.push(w); // guard against two near-identical candidates in the same run
    rows.push(proposalRow(t, opts));
    staged.push(t);
  }
  if (rows.length === 0) return { proposed: 0, skipped, warned: 0, error: null, errors: [], unfiled: [] };
  try {
    await store.insert(rows);
  } catch (err) {
    console.error("[propose-tasks] inserting proposals failed:", err);
    return {
      proposed: 0,
      skipped,
      warned: 0,
      error: "inbox_write_failed",
      errors: ["inbox_write_failed"],
      unfiled: staged.map((t) => unfiledEntry(t, "inbox_write_failed")),
    };
  }
  const warned = rows.filter((r) => (r.payload as FileGithubIssuePayload).privacy_warning).length;
  return { proposed: rows.length, skipped, warned, error: null, errors: [], unfiled: [] };
}

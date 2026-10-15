import Anthropic from "@anthropic-ai/sdk";
// Relative (not "@/") imports so the scripts/ test runner can import this module.
import { MEDIUM_EFFORT, REASONER_MODEL } from "./models";
import { messageText } from "./message-text";
import { checkKeyLine, githubIssuesClient, suppressesRefile, type FiledIssue, type IssuesClient } from "../github-issues";

// Turn the weekly growth memo into `proposed` GitHub issues (issue #325: GitHub
// Issues is the only backlog). The memo already reasons over the site's signals
// and writes an agent_runs row; this reads that digest and files an issue for any
// item that is a concrete DEV change (a feature, a bug fix, a data/SEO fix, a
// page), NOT an ops task like "review a submission" or "send an email", which
// have their own queues. The daily chief-of-staff digest no longer files here:
// it refiled one Brice Station problem three times under different titles, and
// #332 retires that digest.
//
// Filed issues carry `proposed` (the human gate) and land in Proposed on the
// GitHub Project. Rob moves one to Ready or closes it as not planned.
//
// Best-effort + idempotent: it never throws into the reasoner (a proposal failure
// must not fail the memo), and it dedups by normalized title against open issues
// and issues declined in the last 30 days, so a weekly memo can't refile an idea.

export const TASK_TYPES = ["feature", "bug", "qa", "growth", "chore"] as const;
export const TASK_PRIORITIES = ["p0", "p1", "p2", "p3"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

const MODEL = REASONER_MODEL;
const MAX_PER_RUN = 2; // a reasoner proposes at most 2 tickets/run — precision over volume

export type ProposeTasksResult = {
  proposed: number;
  skipped: number;
  filed: FiledIssue[];
  error: string | null;
  /** Titles that didn't reach GitHub because of `error`. */
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

// PURE: the GitHub issue for one extracted ticket. Locked by
// scripts/test/propose-tasks.test.ts.
export function taskIssue(
  t: ExtractedTask,
  opts: { runId: string | null; date: string }
): { title: string; body: string; labels: string[] } {
  const slug = t.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const lines = [
    `**Suggested priority: ${t.priority}.** Filed by the weekly growth memo, ${opts.date}${
      opts.runId ? ` (agent run \`${opts.runId}\`)` : ""
    }.`,
    "",
    "## Proposed change",
    t.body || t.title,
  ];
  if (t.rationale) lines.push("", "## Why now", t.rationale);
  lines.push("", checkKeyLine(`growth-memo/${slug || "untitled"}`));
  return { title: t.title, body: lines.join("\n"), labels: [t.type, "proposed", "lens:growth-memo"] };
}

export async function proposeTasksFromDigest(
  opts: { runId: string | null; digest: unknown },
  issues: IssuesClient | null = githubIssuesClient()
): Promise<ProposeTasksResult> {
  const none = (error: string | null = null, unfiled: string[] = []): ProposeTasksResult => ({
    proposed: 0,
    skipped: 0,
    filed: [],
    error,
    unfiled,
  });
  if (!opts.digest) return none();
  // 1. Extract candidate dev tickets from the digest (best-effort, never throw).
  let extracted: ExtractedTask[];
  try {
    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
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
    });
    extracted = parseExtractedTasks(messageText(message.content));
  } catch (err) {
    console.error("[propose-tasks] extraction failed:", err);
    return none("extraction_failed");
  }
  if (extracted.length === 0) return none();
  // Checked after extraction so a missing token reports what it failed to file.
  if (!issues) {
    console.error("[propose-tasks] GITHUB_ISSUES_TOKEN_MISSING: not filing");
    return none("GITHUB_ISSUES_TOKEN_MISSING", extracted.map((t) => t.title));
  }

  return fileTaskIssues(issues, extracted, { runId: opts.runId, date: new Date().toISOString().slice(0, 10) });
}

// Dedup + file the extracted tickets. Split out so the error paths can be driven
// with a fake client. Locked by scripts/test/propose-tasks.test.ts.
export async function fileTaskIssues(
  issues: IssuesClient,
  extracted: ExtractedTask[],
  opts: { runId: string | null; date: string },
  now: Date = new Date()
): Promise<ProposeTasksResult> {
  // Dedup against open issues + issues declined in the last 30 days. Fail
  // closed: no list, no filing.
  let seen: Set<string>[];
  try {
    seen = (await issues.listRecent(now)).filter((i) => suppressesRefile(i, now)).map((i) => words(i.title));
  } catch (err) {
    console.error("[propose-tasks] listing issues failed:", err);
    return { proposed: 0, skipped: 0, filed: [], error: "list_failed", unfiled: extracted.map((t) => t.title) };
  }

  const filed: FiledIssue[] = [];
  const unfiled: string[] = [];
  let skipped = 0;
  let error: string | null = null;
  for (const t of extracted) {
    const w = words(t.title);
    if (seen.some((s) => similar(w, s))) {
      skipped++;
      continue;
    }
    seen.push(w); // guard against two near-identical candidates in the same run
    try {
      const issue = await issues.create(taskIssue(t, opts));
      filed.push(issue);
      if (!issue.gated) {
        console.error(`[propose-tasks] #${issue.number} was filed without the proposed label`);
        error ??= "labels_dropped";
      }
    } catch (err) {
      console.error("[propose-tasks] create issue failed:", err);
      error = "create_failed";
      unfiled.push(t.title);
      skipped++;
    }
  }
  return { proposed: filed.length, skipped, filed, error, unfiled };
}

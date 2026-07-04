import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
// Relative (not "@/") import so the scripts/ test runner can import this module.
import { TASK_PRIORITIES, TASK_TYPES, type TaskPriority, type TaskType } from "../tasks";

// Phase 2 of the Roadmap board (PRD-roadmap-board.md §5): turn a cockpit reasoner's
// digest into `proposed` hwy4_tasks tickets. The chief-of-staff (daily) and the
// growth-memo (weekly) already reason over the site's signals and write an
// agent_runs row; this reads that digest and files a ticket for any item that is a
// concrete DEV change (a feature, a bug fix, a data/SEO fix, a page) — NOT an ops
// task like "review a submission" or "send an email", which have their own queues.
//
// Agent-filed tickets land status='proposed' and wait for a human to Promote them
// in /admin/roadmap (the approval gate), same as every other cockpit proposal.
//
// Best-effort + idempotent: it never throws into the reasoner (a proposal failure
// must not fail the digest), and it dedups against open + recently-dismissed
// tickets by normalized title so a daily reasoner can't refile the same idea.

const MODEL = "claude-sonnet-4-6";
const MAX_PER_RUN = 2; // a reasoner proposes at most 2 tickets/run — precision over volume

export type ProposeTasksResult = { proposed: number; skipped: number };

type ExtractedTask = { title: string; body: string; type: TaskType; priority: TaskPriority; rationale: string };

const SYSTEM_PROMPT = `You triage a daily/weekly ops digest for Hwy4Events.com (a one-person community events site) into DEVELOPER tickets for a kanban board.

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
  const type = (TASK_TYPES as string[]).includes(String(r.type)) ? (r.type as TaskType) : "chore";
  const priority = (TASK_PRIORITIES as string[]).includes(String(r.priority)) ? (r.priority as TaskPriority) : "p3";
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

export async function proposeTasksFromDigest(
  supabase: SupabaseClient,
  opts: { source: "chief_of_staff" | "growth_memo"; runId: string | null; digest: unknown }
): Promise<ProposeTasksResult> {
  if (!opts.digest) return { proposed: 0, skipped: 0 };

  // 1. Extract candidate dev tickets from the digest (best-effort — never throw).
  let extracted: ExtractedTask[];
  try {
    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Here is the ${opts.source === "growth_memo" ? "weekly growth memo" : "daily chief-of-staff digest"} as JSON. File dev tickets for any concrete build it implies (usually none).\n\n${JSON.stringify(
            opts.digest,
            null,
            2
          )}`,
        },
      ],
    });
    const block = message.content[0];
    const text = block && block.type === "text" ? block.text : "";
    extracted = safeJsonArray(text).map(coerce).filter((t): t is ExtractedTask => t !== null).slice(0, MAX_PER_RUN);
  } catch (err) {
    console.error(`[propose-tasks:${opts.source}] extraction failed:`, err);
    return { proposed: 0, skipped: 0 };
  }
  if (extracted.length === 0) return { proposed: 0, skipped: 0 };

  // 2. Dedup against open tickets + tickets dismissed in the last 30 days (so a
  //    rejected idea doesn't get re-nagged every run). Two simple selects, merged —
  //    clearer than one nested PostgREST .or() with a timestamp.
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [openRows, dismissedRows] = await Promise.all([
    supabase
      .from("hwy4_tasks")
      .select("title")
      .in("status", ["proposed", "backlog", "ready", "in_progress", "in_review"]),
    supabase.from("hwy4_tasks").select("title").eq("status", "wont_do").gte("updated_at", cutoff),
  ]);
  const seen = [...((openRows.data ?? []) as { title: string }[]), ...((dismissedRows.data ?? []) as { title: string }[])].map(
    (t) => words(t.title)
  );

  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const t of extracted) {
    const w = words(t.title);
    if (seen.some((s) => similar(w, s))) {
      skipped++;
      continue;
    }
    seen.push(w); // guard against two near-identical candidates in the same run
    rows.push({
      title: t.title,
      body: t.body || null,
      type: t.type,
      priority: t.priority,
      status: "proposed",
      source: opts.source,
      created_by: opts.source,
      linked_run_id: opts.runId,
      ai_rationale: { rationale: t.rationale, from: opts.source, run_id: opts.runId },
    });
  }

  let proposed = 0;
  if (rows.length > 0) {
    const { error, count } = await supabase.from("hwy4_tasks").insert(rows, { count: "exact" });
    if (error) {
      console.error(`[propose-tasks:${opts.source}] insert failed:`, error.message);
    } else {
      proposed = count ?? rows.length;
    }
  }
  return { proposed, skipped: skipped + (rows.length - proposed) };
}

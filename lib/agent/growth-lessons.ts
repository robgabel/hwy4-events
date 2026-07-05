import type { SupabaseClient } from "@supabase/supabase-js";

// The growth agent's memory loop (Roadmap ticket HWY-5). Two durable channels the
// weekly growth-memo reasoner reads back so it compounds instead of starting fresh:
//   1. growth_lessons: distilled "what worked / what flopped", auto-captured from
//      concluded experiments (+ human-added at /admin/experiments).
//   2. prior moves: the move_of_the_week from its own recent agent_runs, so it can
//      check whether last week's recommendation actually moved anything.
//
// Pure formatting (experimentToLesson) is locked by scripts/test/growth-lessons.test.ts.
// Relative-import-free of any "@/" so the scripts test runner can import this.

// The concluded-experiment shape we distill a lesson from (a subset of
// growth_experiments). id is the dedup key so a re-run can't double-capture.
export type ConcludedExperiment = {
  id: string;
  name: string;
  metric: string | null;
  status: string; // won | lost | inconclusive | abandoned
  result: string | null;
};

const VERDICT_VERB: Record<string, string> = {
  won: "Worked",
  lost: "Did not work",
  inconclusive: "Unclear",
};

/**
 * Distill a concluded experiment into a one-line lesson, or null if it isn't
 * lesson-worthy yet (still running, abandoned, or no result written). PURE.
 */
export function experimentToLesson(e: ConcludedExperiment): string | null {
  const verb = VERDICT_VERB[e.status];
  const result = (e.result ?? "").trim();
  if (!verb || !result) return null; // abandoned/running or no verdict text -> not a lesson
  const metric = e.metric?.trim();
  const tail = metric ? ` (metric: ${metric})` : "";
  return `${verb}: ${e.name.trim()}. ${result}${tail}`;
}

export type PriorMove = { date: string; title: string };

// ── IO ────────────────────────────────────────────────────────────────────────

/**
 * Auto-capture: turn every concluded experiment with a written result into a
 * growth_lessons row, deduped by the experiment id (the unique index makes the
 * insert idempotent). Best-effort; returns how many new lessons it wrote.
 */
export async function captureLessonsFromConcludedExperiments(
  supabase: SupabaseClient
): Promise<number> {
  const { data: concluded } = await supabase
    .from("growth_experiments")
    .select("id, name, metric, status, result")
    .in("status", ["won", "lost", "inconclusive"])
    .not("result", "is", null);
  const rows = (concluded ?? []) as ConcludedExperiment[];
  if (rows.length === 0) return 0;

  // Which experiments already have a lesson? Skip them (belt-and-suspenders on top
  // of the unique index, so we don't fire pointless inserts every run).
  const { data: existing } = await supabase
    .from("growth_lessons")
    .select("source_ref")
    .eq("source", "experiment");
  const seen = new Set(
    ((existing ?? []) as { source_ref: string | null }[]).map((r) => r.source_ref).filter(Boolean)
  );

  const toInsert = rows
    .filter((e) => !seen.has(e.id))
    .map((e) => ({ lesson: experimentToLesson(e), source_ref: e.id }))
    .filter((r): r is { lesson: string; source_ref: string } => r.lesson !== null)
    .map((r) => ({ lesson: r.lesson, source: "experiment", source_ref: r.source_ref, status: "active" }));

  if (toInsert.length === 0) return 0;
  // ignoreDuplicates so a race with the unique index degrades to a no-op, not an error.
  const { error, count } = await supabase
    .from("growth_lessons")
    .upsert(toInsert, { onConflict: "source_ref", ignoreDuplicates: true, count: "exact" });
  if (error) {
    console.error("[growth-lessons] capture failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

/** Active lessons, newest first, as plain strings for the prompt. */
export async function getActiveLessons(supabase: SupabaseClient, limit = 20): Promise<string[]> {
  const { data } = await supabase
    .from("growth_lessons")
    .select("lesson")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as { lesson: string }[]).map((r) => r.lesson);
}

/**
 * The move_of_the_week from the agent's own recent memos, so it can ask "did last
 * week's move land?" Reads agent_runs (run_type=growth_memo), skips degraded/empty.
 */
export async function getPriorMoves(supabase: SupabaseClient, limit = 4): Promise<PriorMove[]> {
  const { data } = await supabase
    .from("agent_runs")
    .select("created_at, digest")
    .eq("run_type", "growth_memo")
    .eq("status", "ok")
    .order("created_at", { ascending: false })
    .limit(limit);
  const out: PriorMove[] = [];
  for (const r of (data ?? []) as { created_at: string; digest: unknown }[]) {
    const move = (r.digest as { move_of_the_week?: { title?: string } } | null)?.move_of_the_week;
    if (move?.title) out.push({ date: String(r.created_at).split("T")[0], title: move.title });
  }
  return out;
}

import type { SupabaseClient } from "@supabase/supabase-js";

// The KB capture loop (the structured companion to docs/LOCAL-KNOWLEDGE-BASE.md).
// When a human approves or corrects a venue blurb at /admin/venues, that is the
// highest-trust knowledge the system ever sees — human-authored, about one named
// venue. This module persists it to `local_facts` (provenance-carrying) and reads
// it back so vetted knowledge grounds future regenerations. Pure helpers live here
// too so they can be unit-tested (scripts/test/local-facts.test.ts).
//
// Importable from both the Next app (@/lib/local-facts) and the tsx drafter
// (../lib/local-facts.js) — it depends only on a passed-in SupabaseClient.

export type LocalFact = {
  kind: string;
  fact: string;
  confidence: string;
  captured_at: string;
};

// Did the human change the AI's draft? Whitespace-insensitive so a trailing
// newline doesn't read as an edit. null when there was no AI draft to compare
// against (a blurb written from scratch) — distinct from false ("kept verbatim").
export function computeWasEdited(
  priorDraft: string | null,
  finalBlurb: string
): boolean | null {
  if (priorDraft == null) return null;
  return priorDraft.trim() !== finalBlurb.trim();
}

// Record a human-approved venue blurb as a durable local_facts row (Tier B,
// human confidence). When an AI draft was pending, store it as prior_value and
// flag whether the human edited it. Supersedes any earlier active blurb fact for
// the venue so "active" is always the current one.
//
// Best-effort by contract: the caller (saveBlurb) ignores failures — a capture
// error must NEVER block the publish it rides on. Returns a result for tests/logs.
export async function captureBlurbFact(
  supabase: SupabaseClient,
  input: { venueKey: string; blurb: string; priorDraft: string | null }
): Promise<{ ok: boolean; was_edited: boolean | null; error?: string }> {
  const fact = input.blurb.trim();
  const wasEdited = computeWasEdited(input.priorDraft, fact);
  if (!fact) return { ok: false, was_edited: wasEdited, error: "empty blurb" };
  try {
    // Demote the prior active blurb fact so the drafter only grounds on the latest.
    await supabase
      .from("local_facts")
      .update({ status: "superseded" })
      .eq("subject_type", "venue")
      .eq("subject_key", input.venueKey)
      .eq("kind", "blurb")
      .eq("status", "active");

    const { error } = await supabase.from("local_facts").insert({
      subject_type: "venue",
      subject_key: input.venueKey,
      kind: "blurb",
      fact,
      prior_value: input.priorDraft?.trim() || null,
      was_edited: wasEdited,
      source: "blurb_review",
      confidence: "human",
      captured_by: "admin",
    });
    if (error) return { ok: false, was_edited: wasEdited, error: error.message };
    return { ok: true, was_edited: wasEdited };
  } catch (e) {
    return { ok: false, was_edited: wasEdited, error: e instanceof Error ? e.message : String(e) };
  }
}

// Active human-vetted facts for a subject, newest first — read by the blurb
// drafter to ground a regeneration in what a human already approved. Never
// throws; returns [] on any error so generation degrades gracefully.
export async function getActiveFacts(
  supabase: SupabaseClient,
  subjectType: string,
  subjectKey: string
): Promise<LocalFact[]> {
  try {
    const { data } = await supabase
      .from("local_facts")
      .select("kind, fact, confidence, captured_at")
      .eq("subject_type", subjectType)
      .eq("subject_key", subjectKey)
      .eq("status", "active")
      .order("captured_at", { ascending: false });
    return (data ?? []) as LocalFact[];
  } catch {
    return [];
  }
}

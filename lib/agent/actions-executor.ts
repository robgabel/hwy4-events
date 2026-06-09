import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentActionRow } from "@/lib/agent/policy";

// The action executor (PRD-agent-cockpit.md, Stage 1). Performs the same write a
// human would do by hand, AFTER capturing before_snapshot for reversibility. The
// caller (the /admin/actions approve server action) gates on the policy guardrail,
// then writes the returned target_* / before_snapshot back onto the agent_actions
// row. Every action type here is internal + reversible.

export type ExecuteResult = {
  ok: boolean;
  targetTable?: string;
  targetId?: string;
  beforeSnapshot?: Record<string, unknown> | null;
  error?: string;
};

export type CreateOrgRowPayload = {
  slug?: string;
  display_name?: string;
  canonical_url?: string;
  match_patterns?: string[];
  town?: string;
};

export async function executeAction(
  supabase: SupabaseClient,
  action: AgentActionRow
): Promise<ExecuteResult> {
  switch (action.type) {
    case "create_org_row":
      return execCreateOrgRow(supabase, action.payload as CreateOrgRowPayload);
    case "flag_spam_submission":
      return execFlagSpam(supabase, action.payload as { submission_id?: string });
    default:
      return { ok: false, error: `Unknown action type: ${action.type}` };
  }
}

// Reverse an executed action. create_org_row deletes the inserted org (creating
// an org row never mutates events — orgs match events by match_patterns at
// resolve time — so the delete can't orphan anything). flag_spam restores the
// submission's pre-flag status from before_snapshot.
export async function revertAction(
  supabase: SupabaseClient,
  action: AgentActionRow
): Promise<{ ok: boolean; error?: string }> {
  if (!action.target_id) return { ok: false, error: "Nothing to revert (no target recorded)." };
  switch (action.type) {
    case "create_org_row": {
      const { error } = await supabase.from("hwy4_orgs").delete().eq("id", action.target_id);
      return error ? { ok: false, error: error.message } : { ok: true };
    }
    case "flag_spam_submission": {
      const snap = (action.before_snapshot ?? {}) as { status?: string; review_note?: string | null };
      const { error } = await supabase
        .from("event_submissions")
        .update({
          status: snap.status ?? "pending",
          review_note: snap.review_note ?? null,
          reviewed_at: null,
        })
        .eq("id", action.target_id);
      return error ? { ok: false, error: error.message } : { ok: true };
    }
    default:
      return { ok: false, error: `Cannot revert unknown type: ${action.type}` };
  }
}

async function execCreateOrgRow(
  supabase: SupabaseClient,
  p: CreateOrgRowPayload
): Promise<ExecuteResult> {
  const slug = (p.slug ?? "").trim();
  const display_name = (p.display_name ?? "").trim();
  const canonical_url = (p.canonical_url ?? "").trim();
  if (!slug) return { ok: false, error: "Missing slug." };
  if (!display_name) return { ok: false, error: "Missing display name." };
  if (!canonical_url) {
    return { ok: false, error: "Missing canonical URL — research the organizer's events page and fill it in first." };
  }

  // Friendlier than surfacing a raw 23505 unique-violation.
  const { data: existing } = await supabase
    .from("hwy4_orgs")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) return { ok: false, error: `An org with slug "${slug}" already exists.` };

  const row: Record<string, unknown> = {
    slug,
    display_name,
    canonical_url,
    // Leave canonical_check_enabled false: a durable LINK works without it, but
    // date-verification needs a server-rendered page, which we haven't confirmed.
    // The curator can flip it on later for a server-renderable events page.
    town: p.town?.trim() || null,
    notes: "Created from a cockpit create_org_row proposal (link-gap drain).",
  };
  const patterns = (p.match_patterns ?? []).map((s) => s.trim()).filter(Boolean);
  if (patterns.length) row.match_patterns = patterns;

  const { data: inserted, error } = await supabase
    .from("hwy4_orgs")
    .insert(row)
    .select("id")
    .single();
  if (error || !inserted) return { ok: false, error: error?.message ?? "Insert returned no row." };

  // Insert: nothing to restore on revert beyond deleting target_id.
  return { ok: true, targetTable: "hwy4_orgs", targetId: inserted.id as string, beforeSnapshot: null };
}

async function execFlagSpam(
  supabase: SupabaseClient,
  p: { submission_id?: string }
): Promise<ExecuteResult> {
  const id = (p.submission_id ?? "").trim();
  if (!id) return { ok: false, error: "Missing submission_id." };

  const { data: before } = await supabase
    .from("event_submissions")
    .select("status, review_note")
    .eq("id", id)
    .maybeSingle();
  if (!before) return { ok: false, error: "Submission not found." };

  const { error } = await supabase
    .from("event_submissions")
    .update({
      status: "rejected",
      review_note: "Flagged as spam via the cockpit.",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    targetTable: "event_submissions",
    targetId: id,
    beforeSnapshot: before as Record<string, unknown>,
  };
}

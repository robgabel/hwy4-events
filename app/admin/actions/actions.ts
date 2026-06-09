"use server";

import { revalidatePath } from "next/cache";
import { getAdminClient } from "@/lib/admin/db";
import { failRedirect, flashRedirect, field, requireField } from "@/lib/admin/flash";
import { executeAction, revertAction } from "@/lib/agent/actions-executor";
import type { AgentActionRow } from "@/lib/agent/policy";
import { proposeLinkGapActions } from "@/lib/agent/propose-link-gaps";
import { runAutoExecutor } from "@/lib/agent/auto-runner";

const ADMIN_PATH = "/admin/actions";

async function load(supabase: ReturnType<typeof getAdminClient>, id: string): Promise<AgentActionRow | null> {
  const { data } = await supabase.from("agent_actions").select("*").eq("id", id).maybeSingle();
  return (data as AgentActionRow | null) ?? null;
}

// Build the executed payload by overlaying the human's form edits onto the
// proposal. For create_org_row the canonical URL is the human's required input.
function mergeEdits(action: AgentActionRow, formData: FormData): Record<string, unknown> {
  if (action.type === "create_org_row") {
    const p = action.payload as Record<string, unknown>;
    const mp = field(formData, "match_patterns");
    return {
      ...p,
      slug: field(formData, "slug") || (p.slug as string),
      display_name: field(formData, "display_name") || (p.display_name as string),
      canonical_url: field(formData, "canonical_url"),
      town: field(formData, "town") || (p.town as string) || null,
      match_patterns: mp
        ? mp.split(",").map((s) => s.trim()).filter(Boolean)
        : (p.match_patterns ?? []),
    };
  }
  return action.payload;
}

// Approve + execute. The human IS the gate here (Stage 1), so the policy guardrail
// isn't consulted — it governs Stage 2 auto-run. We persist the edited payload,
// run the executor (which snapshots before_snapshot), and record the result.
export async function approveAction(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "action id");
  const supabase = getAdminClient();
  const action = await load(supabase, id);
  if (!action) failRedirect(ADMIN_PATH, "Action not found.");
  if (action.status !== "proposed" && action.status !== "approved") {
    failRedirect(ADMIN_PATH, `Action is "${action.status}", not approvable.`);
  }

  const payload = mergeEdits(action, formData);
  await supabase
    .from("agent_actions")
    .update({
      status: "approved",
      payload,
      decided_at: new Date().toISOString(),
      decided_note: field(formData, "decided_note") || null,
    })
    .eq("id", id);

  const result = await executeAction(supabase, { ...action, payload });
  if (!result.ok) {
    await supabase
      .from("agent_actions")
      .update({ status: "failed", error: result.error ?? "execution failed" })
      .eq("id", id);
    failRedirect(ADMIN_PATH, `Couldn't execute: ${result.error}`);
  }

  await supabase
    .from("agent_actions")
    .update({
      status: "executed",
      executed_at: new Date().toISOString(),
      target_table: result.targetTable ?? null,
      target_id: result.targetId ?? null,
      before_snapshot: result.beforeSnapshot ?? null,
      error: null,
    })
    .eq("id", id);

  // A new org row changes link resolution on every matching event page.
  revalidatePath(ADMIN_PATH);
  revalidatePath("/");
  flashRedirect(ADMIN_PATH, "Approved and executed.");
}

export async function rejectAction(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "action id");
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("agent_actions")
    .update({
      status: "rejected",
      decided_at: new Date().toISOString(),
      decided_note: field(formData, "decided_note") || null,
    })
    .eq("id", id)
    .in("status", ["proposed", "approved"]);
  if (error) failRedirect(ADMIN_PATH, error.message);
  revalidatePath(ADMIN_PATH);
  flashRedirect(ADMIN_PATH, "Rejected.");
}

// Undo an executed action via the type's reverse handler (delete the org row /
// restore the submission), then mark it reverted.
export async function revertExecuted(formData: FormData) {
  const id = requireField(formData, "id", ADMIN_PATH, "action id");
  const supabase = getAdminClient();
  const action = await load(supabase, id);
  if (!action) failRedirect(ADMIN_PATH, "Action not found.");
  if (action.status !== "executed") failRedirect(ADMIN_PATH, "Only executed actions can be reverted.");

  const result = await revertAction(supabase, action);
  if (!result.ok) failRedirect(ADMIN_PATH, `Revert failed: ${result.error}`);

  await supabase
    .from("agent_actions")
    .update({ status: "reverted", reverted_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath(ADMIN_PATH);
  revalidatePath("/");
  flashRedirect(ADMIN_PATH, "Reverted.");
}

// Manual trigger for the proposer (the cron's twin). Drains the link-gap worklist
// into fresh `proposed` rows (web-researching each), then runs the auto-executor
// for any graduated types. Idempotent, so safe to click any time.
export async function scanForActions() {
  const supabase = getAdminClient();
  const result = await proposeLinkGapActions(supabase);
  const auto = await runAutoExecutor(supabase);
  revalidatePath(ADMIN_PATH);
  if (auto.executed > 0) revalidatePath("/");
  const autoBit = auto.executed > 0 ? `, ${auto.executed} auto-executed` : "";
  flashRedirect(
    ADMIN_PATH,
    `Scan: ${result.proposed} new proposal(s) from ${result.gaps} gap venue(s) (${result.researched} web-researched)${autoBit}.`
  );
}

// Stage 2 graduation toggle: flip a type's autonomy. Turning it ON immediately runs
// the auto-executor over already-staged proposals (the guardrail + readiness checks
// still gate each one). Outward-facing types can't be graduated meaningfully — the
// canAutoExecute guardrail forbids them no matter what this flag says.
export async function setPolicy(formData: FormData) {
  const actionType = requireField(formData, "action_type", ADMIN_PATH, "action type");
  const on = field(formData, "auto_execute") === "true";
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("agent_policy")
    .update({ auto_execute: on, updated_at: new Date().toISOString() })
    .eq("action_type", actionType);
  if (error) failRedirect(ADMIN_PATH, error.message);

  let note = on
    ? `Graduated "${actionType}" to autonomous.`
    : `Paused autonomy for "${actionType}".`;
  if (on) {
    const auto = await runAutoExecutor(supabase);
    if (auto.executed > 0) {
      revalidatePath("/");
      note += ` ${auto.executed} eligible proposal(s) auto-executed.`;
    }
  }
  revalidatePath(ADMIN_PATH);
  flashRedirect(ADMIN_PATH, note);
}

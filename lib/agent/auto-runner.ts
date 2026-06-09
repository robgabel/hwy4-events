import type { SupabaseClient } from "@supabase/supabase-js";
import { canAutoExecute, type AgentActionRow } from "@/lib/agent/policy";
import { executeAction } from "@/lib/agent/actions-executor";

// Stage 2 (PRD-agent-cockpit.md): execute the proposals whose type has graduated
// to autonomous. An action runs WITHOUT a human only if both hold:
//   1. canAutoExecute — low blast + reversible + internal + policy.auto_execute
//      (the test-locked guardrail; outward-facing can never pass).
//   2. isAutoReady — it has the inputs it needs. For create_org_row that means a
//      canonical URL AND a HIGH-confidence research result. A medium/low-confidence
//      or blank URL still waits for a human, even after the type is graduated.
// Everything else stays queued for a click.

export type AutoRunResult = { executed: number; failed: number; skipped: number };

function isAutoReady(action: AgentActionRow): boolean {
  if (action.type === "create_org_row") {
    const p = action.payload as {
      canonical_url?: string;
      research?: { confidence?: string };
    };
    return Boolean(p.canonical_url?.trim()) && p.research?.confidence === "high";
  }
  return true;
}

export async function runAutoExecutor(supabase: SupabaseClient): Promise<AutoRunResult> {
  const { data: policies } = await supabase
    .from("agent_policy")
    .select("action_type, auto_execute");
  const all = (policies ?? []) as { action_type: string; auto_execute: boolean }[];
  const autoTypes = all.filter((p) => p.auto_execute).map((p) => p.action_type);
  if (autoTypes.length === 0) return { executed: 0, failed: 0, skipped: 0 };
  const policyByType = new Map(all.map((p) => [p.action_type, p]));

  const { data: proposed } = await supabase
    .from("agent_actions")
    .select("*")
    .eq("status", "proposed")
    .in("type", autoTypes);
  const rows = (proposed ?? []) as AgentActionRow[];

  let executed = 0;
  let failed = 0;
  let skipped = 0;
  for (const action of rows) {
    if (!canAutoExecute(action, policyByType.get(action.type)) || !isAutoReady(action)) {
      skipped++;
      continue;
    }
    const result = await executeAction(supabase, action);
    if (result.ok) {
      await supabase
        .from("agent_actions")
        .update({
          status: "executed",
          executed_at: new Date().toISOString(),
          decided_at: new Date().toISOString(),
          decided_note: "Auto-executed (graduated type).",
          target_table: result.targetTable ?? null,
          target_id: result.targetId ?? null,
          before_snapshot: result.beforeSnapshot ?? null,
          error: null,
        })
        .eq("id", action.id);
      executed++;
    } else {
      await supabase
        .from("agent_actions")
        .update({ status: "failed", error: result.error ?? "auto-execution failed" })
        .eq("id", action.id);
      failed++;
    }
  }
  return { executed, failed, skipped };
}

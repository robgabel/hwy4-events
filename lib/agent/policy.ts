// The agent cockpit's single guardrail (PRD-agent-cockpit.md, "the Dario layer").
// `canAutoExecute` is the ONE definition of "can this run without a human." The
// executor imports it; scripts/test/agent-policy.test.ts locks it. The invariant
// that matters: an outward-facing action can NEVER auto-run, regardless of the
// policy row — humans stay in the driver's seat for anything the world sees.

export type BlastRadius = "low" | "med" | "high";

export type ActionStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "executed"
  | "reverted"
  | "failed";

// The action types the executor knows how to run (Stage 1). Add a type here and
// give it a handler in actions-executor.ts + a row in agent_policy.
export type ActionType = "create_org_row" | "flag_spam_submission";

export type AgentActionRow = {
  id: string;
  created_at: string;
  run_id: string | null;
  type: string;
  title: string | null;
  rationale: string | null;
  payload: Record<string, unknown>;
  blast_radius: BlastRadius;
  reversible: boolean;
  outward_facing: boolean;
  status: ActionStatus;
  before_snapshot: Record<string, unknown> | null;
  target_table: string | null;
  target_id: string | null;
  decided_note: string | null;
  error: string | null;
  decided_at: string | null;
  executed_at: string | null;
  reverted_at: string | null;
};

export type AgentPolicyRow = {
  action_type: string;
  auto_execute: boolean;
  min_clean_weeks: number;
  notes: string | null;
};

// Auto-run iff: low blast radius AND reversible AND NOT outward-facing AND the
// per-type policy explicitly says so. Anything else queues for a human click.
// This is a WHERE clause, not a vibe — the four conjuncts each veto autonomy.
export function canAutoExecute(
  action: Pick<AgentActionRow, "blast_radius" | "reversible" | "outward_facing">,
  policy: Pick<AgentPolicyRow, "auto_execute"> | null | undefined
): boolean {
  return (
    action.blast_radius === "low" &&
    action.reversible === true &&
    action.outward_facing === false &&
    policy?.auto_execute === true
  );
}

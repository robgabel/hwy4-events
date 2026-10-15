import type { SupabaseClient } from "@supabase/supabase-js";
// Relative import so the scripts/ test runner can load this module.
import type { FileIssueResult } from "./file-github-issue";

// The writes approveAction makes after the executor runs. Each one applies only
// while the row is still `approved`: a Reject clicked in another tab while the
// executor was talking to GitHub must win, not be overwritten. Every write's
// outcome is checked, so a filed issue is never reported as a clean success
// while its row stays stuck. Locked by scripts/test/file-github-issue.test.ts.

export type ApprovalDb = {
  /** Update the row only if its status is `approved`. Returns how many rows matched. Throws on a write error. */
  updateIfApproved(id: string, fields: Record<string, unknown>): Promise<number>;
};

export function supabaseApprovalDb(supabase: SupabaseClient): ApprovalDb {
  return {
    async updateIfApproved(id, fields) {
      const { data, error } = await supabase
        .from("agent_actions")
        .update(fields)
        .eq("id", id)
        .eq("status", "approved")
        .select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },
  };
}

export type RecordOutcome = { ok: boolean; message: string };

export async function recordExecution(
  db: ApprovalDb,
  id: string,
  result: FileIssueResult,
  now: Date = new Date()
): Promise<RecordOutcome> {
  let matched: number;
  try {
    matched = result.ok
      ? await db.updateIfApproved(id, {
          status: "executed",
          executed_at: now.toISOString(),
          target_table: result.targetTable ?? null,
          target_id: result.targetId ?? null,
          before_snapshot: result.beforeSnapshot ?? null,
          error: null,
        })
      : // A retryable failure wrote nothing, so the row goes back to the queue
        // with the reason on it; anything else is final.
        await db.updateIfApproved(id, {
          status: result.retryable ? "proposed" : "failed",
          error: result.error ?? "execution failed",
        });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return result.ok
      ? {
          ok: false,
          message: `${result.note ?? "Executed."} But saving the row failed (${why}), so it still reads approved. Approve it again to finish; a retry will not file twice.`,
        }
      : { ok: false, message: `Couldn't execute: ${result.error}. Saving that on the row also failed (${why}).` };
  }
  if (matched === 0) {
    // Someone rejected (or otherwise moved) the row while the executor ran.
    return result.ok
      ? {
          ok: false,
          message: `${result.note ?? "Executed."} The row was rejected while this ran, so it stays rejected. If you didn't want it, undo it by hand (for an issue, close it on GitHub).`,
        }
      : { ok: false, message: `Couldn't execute: ${result.error}. The row was rejected meanwhile and stays rejected.` };
  }
  if (!result.ok) return { ok: false, message: `Couldn't execute: ${result.error}` };
  return { ok: true, message: result.note ? `Approved. ${result.note}` : "Approved and executed." };
}

/** The /admin/actions function limit. An `approved` row older than this is stuck, not in flight. */
export const APPROVAL_IN_FLIGHT_MS = 120_000;

/**
 * May this row be approved (again)? A proposed row, yes. An approved row only
 * once its approval is past the function limit: before that the first request
 * may still be talking to GitHub, and a second executor could race it. Pure.
 */
export function approvable(
  a: { status: string; decided_at: string | null },
  now: number = Date.now()
): boolean {
  if (a.status === "proposed") return true;
  if (a.status !== "approved") return false;
  const at = a.decided_at ? Date.parse(a.decided_at) : NaN;
  return Number.isNaN(at) || now - at > APPROVAL_IN_FLIGHT_MS;
}

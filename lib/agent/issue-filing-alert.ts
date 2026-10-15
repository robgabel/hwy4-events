// When an agent can't file its GitHub issues (token unset or expired, GitHub
// down, labels dropped), the findings would otherwise vanish. Standing rule: a
// finding a person has to act on goes to agent_actions, not Slack alone. So the
// QA audit and the growth memo file one proposed row here instead (issue #325).
//
// Same shape as the scrape alerts (lib/scrape-alerts.ts): `agent_actions.type`
// is unconstrained text, `reversible: false` keeps it out of auto-execute, and
// there is no executor handler. Reject dismisses it. One open row per source:
// a second failure while the first is still in the Inbox is not filed again.

import type { SupabaseClient } from "@supabase/supabase-js";

export const ISSUE_FILING_ALERT_TYPE = "issue_filing_alert";

export type IssueFilingSource = "qa_audit" | "growth_memo";

/** Errors that mean "findings did not reach GitHub". An LLM extraction failure is not one. */
export const FILING_ERRORS = new Set(["GITHUB_ISSUES_TOKEN_MISSING", "list_failed", "create_failed", "labels_dropped"]);

const SOURCE_LABEL: Record<IssueFilingSource, string> = {
  qa_audit: "Weekly QA audit",
  growth_memo: "Growth memo",
};

const FIX: Record<string, string> = {
  GITHUB_ISSUES_TOKEN_MISSING: "GITHUB_ISSUES_TOKEN is not set in Vercel Production. Set it and redeploy.",
  list_failed: "Reading the repo's issues failed. If it is a 401, the fine-grained GITHUB_ISSUES_TOKEN expired; re-mint it.",
  create_failed: "Creating an issue failed. Check the Vercel logs for the GitHub status code.",
  labels_dropped:
    "An issue was filed without its `proposed` label, so GitHub dropped the labels. Give the token Issues read/write and add the label by hand.",
};

// PURE: the proposed row, or null when the error isn't a filing failure.
// Locked by scripts/test/issue-filing-alert.test.ts.
export function buildIssueFilingAlert(args: {
  source: IssueFilingSource;
  error: string | null;
  unfiled: string[];
  /** URLs of issues that were filed but lost the `proposed` label. */
  ungated?: string[];
}): Record<string, unknown> | null {
  const ungated = (args.ungated ?? []).slice(0, 10);
  // A create failure and a dropped label can happen in the same run; the
  // ungated issues must still be named even when the headline error is the other.
  const error = args.error ?? (ungated.length ? "labels_dropped" : null);
  if (!error || !FILING_ERRORS.has(error)) return null;
  const titles = args.unfiled.slice(0, 10);
  return {
    type: ISSUE_FILING_ALERT_TYPE,
    title: `${SOURCE_LABEL[args.source]} could not file GitHub issues (${error})`,
    rationale: [
      FIX[error],
      titles.length ? `Not filed: ${titles.join("; ")}.` : null,
      ungated.length ? `Filed without \`proposed\` (add it by hand): ${ungated.join(" ")}.` : null,
    ]
      .filter(Boolean)
      .join(" "),
    payload: { source: args.source, error, unfiled: titles, ungated },
    blast_radius: "low",
    reversible: false,
    outward_facing: false,
    status: "proposed",
  };
}

/** Best-effort: never throws into the cron. */
export async function fileIssueFilingAlert(
  supabase: SupabaseClient,
  args: { source: IssueFilingSource; error: string | null; unfiled: string[]; ungated?: string[] }
): Promise<"inserted" | "duplicate" | "skipped" | "error"> {
  const row = buildIssueFilingAlert(args);
  if (!row) return "skipped";
  try {
    const { data: open, error: readErr } = await supabase
      .from("agent_actions")
      .select("id")
      .eq("type", ISSUE_FILING_ALERT_TYPE)
      .eq("status", "proposed")
      .eq("payload->>source", args.source)
      .limit(1);
    if (readErr) throw new Error(readErr.message);
    if ((open ?? []).length > 0) return "duplicate";
    const { error } = await supabase.from("agent_actions").insert(row);
    if (error) throw new Error(error.message);
    return "inserted";
  } catch (err) {
    console.error(`[issue-filing-alert:${args.source}] failed:`, err);
    return "error";
  }
}

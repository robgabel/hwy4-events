// Propose-first GitHub issues for the growth memo. The repo is public and the
// memo reasons over private signals (newsletter counts, referrals per named
// business), so its tickets no longer go to GitHub on their own: each one is a
// proposed `agent_actions` row of this type, private in the Inbox. Rob reads it
// at /admin/actions, may edit the title and body, and Approve files the issue
// through lib/github-issues.ts. Reject dismisses it. The QA audit still files
// directly (its bodies hold only public page-check results).
//
// Idempotent: the issue body carries `check_key: agent-action/<row id>`, so an
// approval that crashed after GitHub created the issue finds it on retry
// instead of filing a second one. The title dedup against open and recently
// declined issues runs again at approval, because a week can pass between the
// proposal and the click.
//
// Relative imports only, so the scripts/ test runner can load this module.
import { titlesCollide, type FileGithubIssuePayload } from "./propose-tasks";
import { bodyCheckKey, checkKeyLine, suppressesRefile, type IssuesClient } from "../github-issues";

export { FILE_GITHUB_ISSUE_TYPE, type FileGithubIssuePayload } from "./propose-tasks";

/** Same fields as ExecuteResult in actions-executor.ts. */
export type FileIssueResult = {
  ok: boolean;
  targetTable?: string;
  targetId?: string;
  beforeSnapshot?: Record<string, unknown> | null;
  error?: string;
  /** The row goes back to proposed (not failed): nothing was filed and approving again may work. */
  retryable?: boolean;
  /** Shown in the approve flash on success. */
  note?: string;
};

/** The check_key that ties one agent_actions row to the one issue it files. */
export function actionCheckKey(actionId: string): string {
  return `agent-action/${actionId}`;
}

// PURE: the issue this row files, or why it can't. Locked by
// scripts/test/file-github-issue.test.ts.
export function issueForAction(
  actionId: string,
  p: FileGithubIssuePayload
): { title: string; body: string; labels: string[] } | { error: string } {
  const title = (p.title ?? "").trim();
  if (!title) return { error: "Missing issue title." };
  // A pasted check_key line would fight the row's own; drop it.
  const body = (p.body ?? "")
    .split("\n")
    .filter((l) => !/^check_key:/.test(l))
    .join("\n")
    .trim();
  const labels = (p.labels ?? []).map((l) => String(l).trim()).filter(Boolean);
  return {
    title: title.slice(0, 200),
    body: [body || title, "", checkKeyLine(actionCheckKey(actionId))].join("\n"),
    labels,
  };
}

/**
 * File the row's issue. Never throws. Fails closed: if the issue list can't be
 * read, nothing is filed. A failure that filed nothing is `retryable`.
 */
export async function fileIssueForAction(
  issues: IssuesClient | null,
  action: { id: string; payload: Record<string, unknown> },
  now: Date = new Date()
): Promise<FileIssueResult> {
  const issue = issueForAction(action.id, action.payload as FileGithubIssuePayload);
  if ("error" in issue) return { ok: false, error: issue.error };
  if (!issues) {
    return {
      ok: false,
      retryable: true,
      error: "GITHUB_ISSUES_TOKEN is not set in Vercel Production, so nothing was filed. Set it, redeploy, and approve again.",
    };
  }

  let recent;
  try {
    recent = await issues.listRecent(now);
  } catch (err) {
    console.error("[file-github-issue] listing issues failed:", err);
    return {
      ok: false,
      retryable: true,
      error: `Couldn't read the repo's issues (${errText(err)}), so nothing was filed. If it is a 401, re-mint GITHUB_ISSUES_TOKEN. Approve again to retry.`,
    };
  }

  // This row already filed its issue (an earlier approval crashed after create).
  const key = actionCheckKey(action.id);
  const mine = recent.find((i) => bodyCheckKey(i.body) === key);
  if (mine) {
    return { ok: true, targetTable: "github_issues", targetId: String(mine.number), beforeSnapshot: null, note: `Already filed as #${mine.number}.` };
  }

  // Another issue covers the same idea (open, or declined in the last 30 days).
  const covering = recent.find((i) => suppressesRefile(i, now) && titlesCollide(i.title, issue.title));
  if (covering) {
    const why = covering.state === "open" ? "open" : `closed as ${covering.state_reason}`;
    return {
      ok: false,
      error: `Not filed: #${covering.number} (${why}) already covers this: ${covering.html_url}`,
    };
  }

  try {
    const filed = await issues.create(issue);
    return {
      ok: true,
      targetTable: "github_issues",
      targetId: String(filed.number),
      beforeSnapshot: null,
      note: filed.gated
        ? `Filed #${filed.number}.`
        : `Filed #${filed.number}, but GitHub dropped the labels. Add \`proposed\` by hand: ${filed.html_url}`,
    };
  } catch (err) {
    console.error("[file-github-issue] create failed:", err);
    // A timeout may still have created it; the check_key finds it on retry.
    return {
      ok: false,
      retryable: true,
      error: `Creating the issue failed (${errText(err)}). Approve again to retry; a retry will not file it twice.`,
    };
  }
}

function errText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}

/**
 * PURE: overlay Rob's approve-form edits on the row's payload. A field that was
 * submitted wins even when empty: clearing the body to drop a flagged figure
 * must file a title-only issue, never fall back to the stored text. A field
 * that was not submitted (null) keeps the stored value. Locked by
 * scripts/test/file-github-issue.test.ts.
 */
export function mergeIssueEdits(
  payload: Record<string, unknown>,
  edits: { title: string | null; body: string | null }
): Record<string, unknown> {
  return {
    ...payload,
    // An empty title can't be filed; issueForAction refuses it rather than guessing.
    ...(edits.title !== null ? { title: edits.title } : {}),
    ...(edits.body !== null ? { body: edits.body } : {}),
  };
}

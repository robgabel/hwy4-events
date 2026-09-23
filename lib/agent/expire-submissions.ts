// Pure rules for the daily "pending submission outlived its date" job.
//
// /api/agent/expire-submissions rejects those rows and, when it is safe to,
// emails the submitter. This file decides which rows qualify and whether to
// send. Copy lives in submission-reply.ts (`expired`). No DB, no send.

export const EXPIRED_REVIEW_NOTE = "Expired: event date passed without review";

/** Pending, and the event's civil date is strictly before Pacific today. */
export function isExpiredPending(
  row: { status: string; event_date: string },
  todayIso: string
): boolean {
  return row.status === "pending" && row.event_date < todayIso;
}

export type ExpiredNotifyDecision = "send" | "no_email" | "spam";

function flagList(analysis: unknown): string[] {
  if (!analysis || typeof analysis !== "object") return [];
  const flags = (analysis as { flags?: unknown }).flags;
  if (!Array.isArray(flags)) return [];
  return flags.filter((f): f is string => typeof f === "string");
}

/**
 * Same skip spirit as dismissSubmission's skipSpam: no address, or triage
 * flagged possible_spam. An email that is only whitespace counts as none.
 */
/** What the admin reply panel should show. auto_sent wins, so a sent copy
 *  never falls through to the Gmail compose link. */
export function replyPanelMode(reply: {
  auto_sent?: boolean;
  to?: string | null;
}): "sent" | "draft" | "none" {
  if (reply.auto_sent) return "sent";
  if (!reply.to) return "none";
  return "draft";
}

export function expiredNotifyDecision(row: {
  submitter_email: string | null;
  ai_analysis: unknown;
}): ExpiredNotifyDecision {
  const email = row.submitter_email?.trim() ?? "";
  if (!email) return "no_email";
  if (flagList(row.ai_analysis).includes("possible_spam")) return "spam";
  return "send";
}

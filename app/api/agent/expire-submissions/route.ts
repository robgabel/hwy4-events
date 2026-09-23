import { NextResponse } from "next/server";
import { Resend } from "resend";
import { requireCronAuth } from "@/lib/cron-auth";
import { getAdminClient } from "@/lib/admin/db";
import { pacificToday } from "@/lib/date-windows";
import { newsletterFromHeader, newsletterReplyTo } from "@/lib/newsletter";
import { resendErrorMessage } from "@/lib/newsletter-send";
import {
  EXPIRED_REVIEW_NOTE,
  expiredNotifyDecision,
  type ExpiredNotifyDecision,
} from "@/lib/agent/expire-submissions";
import {
  generateReply,
  markReplyAutoSent,
  type SubmissionForReply,
} from "@/lib/agent/submission-reply";

export const maxDuration = 60;

// Daily clear of pending community submissions whose event date has passed.
//
// Cron: vercel.json schedule "30 14 * * *" (7:30am PDT / 6:30am PST).
// Quiet morning Pacific slot. Minute 0 of hour 14 is already the Friday
// weekend briefing and the Monday moose-lodge scrape; nothing else uses :30.
// It runs after Pacific midnight, so `event_date < today` is the calendar
// date Rob sees, and it stays clear of the 15:00 UTC verify/newsletter
// cluster. Triage remains at 18:30 UTC and does not overlap.
//
// Rejects the row (status, reviewed_at, review_note) and emails the submitter
// through Resend, the same from/reply-to the newsletter uses. Does not publish,
// does not email Rob, and does not touch an already-rejected row. `?dry_run=1`
// counts only (`emailed` is how many would be sent). `?limit=` caps the batch
// (default 40) so a backlog drains across runs instead of timing the function out.

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

const SELECT =
  "id, event_name, event_date, start_time, venue_name, town, description, event_url, submitter_name, submitter_email, ai_analysis";

type ExpiredRow = SubmissionForReply & {
  id: string;
  ai_analysis: unknown;
};

function clampLimit(raw: string | null): number {
  const n = Number(raw ?? "");
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(n));
}

export async function GET(request: Request) {
  const cronDenied = requireCronAuth(request);
  if (cronDenied) return cronDenied;

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const limit = clampLimit(url.searchParams.get("limit"));
  const today = pacificToday().iso;

  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("event_submissions")
    .select(SELECT)
    .eq("status", "pending")
    .lt("event_date", today)
    .order("event_date", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[expire-submissions] select failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as ExpiredRow[];
  const decisions = rows.map((row) => expiredNotifyDecision(row));
  const needsSend = decisions.includes("send");

  if (!dryRun && needsSend && !process.env.RESEND_API_KEY) {
    console.error(
      "[expire-submissions] RESEND_API_KEY unset; left pending rows in the queue"
    );
    return NextResponse.json(
      {
        ok: false,
        error: "RESEND_API_KEY is not set",
        today,
        pending: rows.length,
      },
      { status: 500 }
    );
  }

  const counts = {
    expired: 0,
    emailed: 0,
    skipped_no_email: 0,
    skipped_spam: 0,
    email_failed: 0,
    claim_failed: 0,
    claimed_by_other: 0,
  };

  const resend = needsSend && !dryRun ? new Resend(process.env.RESEND_API_KEY) : null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const decision = decisions[i];
    if (dryRun) {
      counts.expired++;
      if (decision === "send") counts.emailed++;
      else bumpSkip(counts, decision);
      continue;
    }

    const reviewedAt = new Date().toISOString();
    const { data: claimed, error: claimError } = await supabase
      .from("event_submissions")
      .update({
        status: "rejected",
        reviewed_at: reviewedAt,
        review_note: EXPIRED_REVIEW_NOTE,
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id");

    if (claimError) {
      console.error(`[expire-submissions] claim failed ${row.id}:`, claimError.message);
      counts.claim_failed++;
      continue;
    }
    if (!claimed || claimed.length === 0) {
      counts.claimed_by_other++;
      continue;
    }

    counts.expired++;
    if (decision !== "send") {
      bumpSkip(counts, decision);
      continue;
    }

    try {
      const reply = await generateReply(row, null, "expired");
      const to = row.submitter_email?.trim();
      if (!to || !resend) {
        throw new Error(to ? "RESEND_API_KEY is not set" : "submitter email missing");
      }
      const sent = await resend.emails.send({
        from: newsletterFromHeader(),
        replyTo: newsletterReplyTo(),
        to,
        subject: reply.subject,
        text: reply.body,
      });
      // Resend resolves API failures as { error } instead of throwing.
      if (sent.error || !sent.data) {
        throw new Error(resendErrorMessage(sent.error));
      }
      const sentAt = new Date().toISOString();
      const { error: stampError } = await supabase
        .from("event_submissions")
        .update({ ai_reply: markReplyAutoSent(reply, sentAt) })
        .eq("id", row.id);
      if (stampError) {
        console.error(
          `[expire-submissions] sent but could not store ai_reply ${row.id}:`,
          stampError.message
        );
      }
      counts.emailed++;
    } catch (err) {
      counts.email_failed++;
      console.error(
        `[expire-submissions] EXPIRE_EMAIL_FAILED ${row.id}:`,
        err instanceof Error ? err.message : err
      );
      try {
        const reply = await generateReply(row, null, "expired");
        await supabase.from("event_submissions").update({ ai_reply: reply }).eq("id", row.id);
      } catch (draftErr) {
        console.error(
          `[expire-submissions] could not store unsent draft ${row.id}:`,
          draftErr instanceof Error ? draftErr.message : draftErr
        );
      }
    }
  }

  const summary = {
    ok: true,
    today,
    dry_run: dryRun,
    limit,
    hit_limit: rows.length === limit,
    ...counts,
  };
  console.log("[expire-submissions]", JSON.stringify(summary));
  return NextResponse.json(summary);
}

function bumpSkip(
  counts: { skipped_no_email: number; skipped_spam: number },
  decision: ExpiredNotifyDecision
): void {
  if (decision === "no_email") counts.skipped_no_email++;
  else if (decision === "spam") counts.skipped_spam++;
}

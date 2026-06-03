import { NextResponse } from "next/server";
import {
  getServiceClient,
  getUpcomingEvents,
  getRecentBriefings,
  generateNewsletter,
  buildSubject,
  nextThursdayISO,
  NEWSLETTER_MODEL,
} from "@/lib/newsletter";
import { SITE_URL } from "@/lib/constants";

export const maxDuration = 120;

// Wednesday cron (after the weekday data jobs settle). Generates the weekly
// newsletter body and stores it as a PENDING draft for the coming Thursday, then
// pings Slack so a human has ~24h to edit or VETO it at /admin/newsletter before
// /api/newsletter/send auto-sends it. Generates nothing-irreversible: it only
// writes a draft row; it never emails anyone.
//
// Idempotent per target Thursday (target_send_date is UNIQUE): re-running upserts
// the same row. To avoid clobbering a human's work, an existing vetoed/sent/edited
// draft is preserved unless ?force=1 is passed.
export async function GET(request: Request) {
  const url = new URL(request.url);

  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = url.searchParams.get("force") === "1";
  const targetSendDate = nextThursdayISO();

  try {
    const supabase = getServiceClient();

    // Don't trample a human's work. If a draft for this Thursday already exists
    // and someone has approved, sent, or hand-edited it, leave it alone unless
    // forced.
    const { data: existing } = await supabase
      .from("newsletter_drafts")
      .select("id, status, edited")
      .eq("target_send_date", targetSendDate)
      .maybeSingle();

    if (
      existing &&
      !force &&
      (existing.status !== "pending" || existing.edited)
    ) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: `Draft for ${targetSendDate} already exists (status=${existing.status}, edited=${existing.edited}). Pass ?force=1 to regenerate.`,
        target_send_date: targetSendDate,
      });
    }

    const [events, recentBriefings] = await Promise.all([
      getUpcomingEvents(),
      getRecentBriefings(),
    ]);

    const content = await generateNewsletter(events, recentBriefings);
    const subject = buildSubject(targetSendDate);

    const { error } = await supabase.from("newsletter_drafts").upsert(
      {
        target_send_date: targetSendDate,
        subject,
        content,
        status: "pending",
        model: NEWSLETTER_MODEL,
        event_count: events.length,
        edited: false,
        approved_at: null,
        sent_at: null,
        sent_count: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "target_send_date" }
    );

    if (error) throw error;

    // Slack doorbell — a one-liner linking to the review page.
    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (webhook) {
      try {
        await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text:
              `*📨 Newsletter draft ready for ${targetSendDate}* (${events.length} events)\n` +
              `Review or edit → ${SITE_URL}/admin/newsletter\n` +
              `_It auto-sends Thursday morning unless you veto it (you have ~24h)._`,
          }),
        });
      } catch (err) {
        console.error("[newsletter/prepare] Slack post failed:", err);
      }
    }

    return NextResponse.json({
      ok: true,
      target_send_date: targetSendDate,
      subject,
      event_count: events.length,
      status: "pending",
    });
  } catch (err) {
    console.error("[newsletter/prepare] failed:", err);
    return NextResponse.json(
      { error: "Failed to prepare newsletter draft" },
      { status: 500 }
    );
  }
}

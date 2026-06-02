import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { SITE_URL, SITE_NAME } from "@/lib/constants";
import {
  getServiceClient,
  getRobNote,
  getActiveSubscribers,
  getUpcomingEvents,
  getRecentBriefings,
  generateNewsletter,
  buildEmailHtml,
  buildSubject,
  todayISO,
} from "@/lib/newsletter";

export const maxDuration = 120;

// Thursday cron. The weekly newsletter is now GATED: this route ships ONLY a
// draft that a human approved at /admin/newsletter (prepared the day before by
// /api/newsletter/prepare). If no approved draft exists for today, it sends
// nothing and warns on Slack — the safe failure mode for the single most
// outward-facing action in the system (never ship unreviewed copy).
//
//   ?preview=1            read-only HTML preview of the current draft (no auth)
//   ?test_email=you@x.com generate fresh + send only to that address (for testing)
export async function GET(request: Request) {
  const url = new URL(request.url);
  const testEmail = url.searchParams.get("test_email");
  const preview = url.searchParams.get("preview") === "1";

  // preview=1 is read-only (no send) — exempt from CRON_SECRET so the admin
  // page's "Preview email →" link works in a normal browser session.
  if (!preview) {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (preview) {
    return renderPreview();
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return NextResponse.json({ error: "Missing RESEND_API_KEY" }, { status: 500 });
  }

  try {
    // test_email path: generate fresh content and send only to the tester. This
    // bypasses the approval gate on purpose (it's a template smoke-test to one
    // address you control) and never archives or touches a draft row.
    if (testEmail) {
      const [events, recentBriefings, robNoteResult] = await Promise.all([
        getUpcomingEvents(),
        getRecentBriefings(),
        getRobNote(),
      ]);
      const content = await generateNewsletter(events, recentBriefings);
      const subject = buildSubject(todayISO());
      const resend = new Resend(resendApiKey);
      const unsubscribeUrl = `${SITE_URL}/api/newsletter/unsubscribe?token=test-token`;
      await resend.emails.send({
        from: `${SITE_NAME} <newsletter@hwy4events.com>`,
        replyTo: "robgabel@gmail.com",
        to: testEmail,
        subject,
        html: buildEmailHtml(robNoteResult.body, content, unsubscribeUrl),
        headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
      });
      return NextResponse.json({ ok: true, test: true, sent: 1, subject });
    }

    // Real send: ship ONLY today's approved draft.
    const supabase = getServiceClient();
    const today = todayISO();
    const { data: draft } = await supabase
      .from("newsletter_drafts")
      .select("id, subject, content, status")
      .eq("target_send_date", today)
      .maybeSingle();

    if (!draft || draft.status !== "approved") {
      const reason = !draft
        ? `No newsletter draft exists for ${today}.`
        : `Draft for ${today} is "${draft.status}", not approved.`;
      console.warn(`[newsletter/send] Skipping send — ${reason}`);

      const webhook = process.env.SLACK_WEBHOOK_URL;
      if (webhook) {
        try {
          await fetch(webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text:
                `*⏸️ Weekly newsletter NOT sent (${today})* — ${reason}\n` +
                `Nothing shipped (safe default). Approve a draft at ${SITE_URL}/admin/newsletter to send.`,
            }),
          });
        } catch (err) {
          console.error("[newsletter/send] Slack post failed:", err);
        }
      }

      return NextResponse.json({ ok: true, sent: 0, skipped: true, reason });
    }

    const [subscribers, robNoteResult] = await Promise.all([
      getActiveSubscribers(),
      getRobNote(),
    ]);
    const robNote = robNoteResult.body;

    if (subscribers.length === 0) {
      return NextResponse.json({ ok: true, message: "No active subscribers", sent: 0 });
    }

    const content = draft.content;
    const subject = draft.subject;
    const resend = new Resend(resendApiKey);

    let sent = 0;
    const errors: string[] = [];

    // Send individually so each email has a personalized unsubscribe link
    for (const sub of subscribers) {
      const unsubscribeUrl = `${SITE_URL}/api/newsletter/unsubscribe?token=${sub.unsubscribe_token}`;
      try {
        await resend.emails.send({
          from: `${SITE_NAME} <newsletter@hwy4events.com>`,
          // Replies go to Gmail until ImprovMX forwarding for the domain is live.
          replyTo: "robgabel@gmail.com",
          to: sub.email,
          subject,
          html: buildEmailHtml(robNote, content, unsubscribeUrl),
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
          },
        });
        sent++;
      } catch (err) {
        errors.push(`${sub.email}: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    }

    // Mark the draft sent and archive the body for the public "latest newsletter".
    await supabase
      .from("newsletter_drafts")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        sent_count: sent,
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id);

    await supabase
      .from("site_config")
      .upsert({ key: "latest_newsletter", value: content }, { onConflict: "key" });
    await supabase
      .from("site_config")
      .upsert(
        { key: "latest_newsletter_date", value: new Date().toISOString() },
        { onConflict: "key" }
      );

    return NextResponse.json({
      ok: true,
      sent,
      total: subscribers.length,
      subject,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("Newsletter send failed:", err);
    return NextResponse.json({ error: "Failed to send newsletter" }, { status: 500 });
  }
}

// Read-only preview: prefers the most recent draft (so you see exactly what's
// queued/approved), then the last archived newsletter, then a placeholder.
async function renderPreview() {
  let body =
    `_[Placeholder — no newsletter draft exists yet, so this is sample text. Once Wednesday's prepare cron runs, this preview will show the real draft.]_\n\n` +
    `Quick hello from the corridor — it's shaping up to be a busy weekend.\n\n` +
    `Friday brings bluegrass to [the Lube in Murphys](https://hwy4events.com/events/example-event-murphys) at 7pm. Saturday is the big one: Bear Valley's opening day plus a packed slate at the Resort.\n\n` +
    `— Millie 🐾`;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceKey) {
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: draft } = await supabase
      .from("newsletter_drafts")
      .select("content")
      .order("target_send_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (draft?.content) {
      body = draft.content;
    } else {
      const { data } = await supabase
        .from("site_config")
        .select("value")
        .eq("key", "latest_newsletter")
        .maybeSingle();
      if (data?.value) body = data.value;
    }
  }

  const { body: robNote } = await getRobNote();
  return new NextResponse(
    buildEmailHtml(robNote, body, `${SITE_URL}/api/newsletter/unsubscribe?token=preview`),
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

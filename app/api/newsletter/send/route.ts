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
  buildSlugToEventId,
  buildSubject,
  todayISO,
} from "@/lib/newsletter";

// Bumped from 120s: the send loop below paces each send to respect Resend's
// rate limit, so a larger subscriber list needs more wall-clock headroom.
export const maxDuration = 300;

// Delay between individual Resend sends (~2/sec). A no-delay burst is what
// tripped Resend's rate limit on 2026-06-18 and got 25 sends silently rejected.
const SEND_THROTTLE_MS = 500;

// Thursday cron. The weekly newsletter now ships on a 24h veto window: the day
// before, /api/newsletter/prepare stored a draft; a human had ~24h to edit or
// VETO it at /admin/newsletter. This route AUTO-SENDS today's draft unless it was
// vetoed. If NO draft exists (prepare didn't run), it sends nothing and warns on
// Slack — it never auto-generates-and-blasts unsupervised; it only ships a draft
// that sat in the veto window.
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
    // test_email path: send the current stored draft to one address so you can
    // preview exactly what subscribers will receive (including your edits). Falls
    // back to generating fresh content only when no draft exists yet (e.g. before
    // Wednesday's prepare cron has run). Never writes to newsletter_drafts.
    if (testEmail) {
      const supabase = getServiceClient();
      const { data: draft } = await supabase
        .from("newsletter_drafts")
        .select("id, subject, content, status")
        .in("status", ["pending", "vetoed"])
        .order("target_send_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      const [events, robNoteResult] = await Promise.all([
        getUpcomingEvents(),
        getRobNote(),
      ]);
      const slugToEventId = buildSlugToEventId(events);

      let content: string;
      let subject: string;
      let campaignId: string;

      if (draft) {
        // Use the stored (possibly hand-edited) draft — this is what will actually ship.
        content = draft.content as string;
        subject = draft.subject as string;
        campaignId = draft.id as string;
      } else {
        // No draft yet — fall back to generating fresh content.
        const [recentBriefings] = await Promise.all([getRecentBriefings()]);
        content = await generateNewsletter(events, recentBriefings);
        subject = buildSubject(todayISO());
        campaignId = "test";
      }

      const resend = new Resend(resendApiKey);
      const unsubscribeUrl = `${SITE_URL}/api/newsletter/unsubscribe?token=test-token`;
      const testTracking = { campaignId, slugToEventId };
      await resend.emails.send({
        from: `${SITE_NAME} <newsletter@hwy4events.com>`,
        replyTo: "robgabel@gmail.com",
        to: testEmail,
        subject: `[TEST] ${subject}`,
        html: buildEmailHtml(robNoteResult.body, content, unsubscribeUrl, testTracking),
        headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
      });
      return NextResponse.json({
        ok: true,
        test: true,
        sent: 1,
        subject,
        used_draft: !!draft,
        draft_status: draft?.status ?? null,
      });
    }

    // Real send: AUTO-SEND today's draft unless it was vetoed (or already sent).
    const supabase = getServiceClient();
    const today = todayISO();
    const { data: draft } = await supabase
      .from("newsletter_drafts")
      .select("id, subject, content, status")
      .eq("target_send_date", today)
      .maybeSingle();

    if (!draft || draft.status !== "pending") {
      const reason = !draft
        ? `No newsletter draft exists for ${today} (prepare didn't run).`
        : draft.status === "vetoed"
        ? `Draft for ${today} was vetoed — held by a human.`
        : `Draft for ${today} is "${draft.status}", not sendable.`;
      console.warn(`[newsletter/send] Skipping send — ${reason}`);

      const webhook = process.env.SLACK_WEBHOOK_URL;
      if (webhook) {
        const icon = draft?.status === "vetoed" ? "🛑" : "⏸️";
        try {
          await fetch(webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text:
                `*${icon} Weekly newsletter NOT sent (${today})* — ${reason}\n` +
                `Nothing shipped. See ${SITE_URL}/admin/newsletter.`,
            }),
          });
        } catch (err) {
          console.error("[newsletter/send] Slack post failed:", err);
        }
      }

      return NextResponse.json({ ok: true, sent: 0, skipped: true, reason });
    }

    const [subscribers, robNoteResult, eventsForLinks] = await Promise.all([
      getActiveSubscribers(),
      getRobNote(),
      getUpcomingEvents(),
    ]);
    const robNote = robNoteResult.body;
    const tracking = { campaignId: draft.id, slugToEventId: buildSlugToEventId(eventsForLinks) };

    if (subscribers.length === 0) {
      return NextResponse.json({ ok: true, message: "No active subscribers", sent: 0 });
    }

    const content = draft.content;
    const subject = draft.subject;
    const resend = new Resend(resendApiKey);

    let sent = 0;
    const failures: { email: string; error: string }[] = [];

    // One Resend call per subscriber so each gets a personalized unsubscribe link.
    // CRITICAL: resend.emails.send() returns { data, error } and does NOT throw on
    // API errors (rate-limit, validation, suppression). The old code did
    // `await send(); sent++` without inspecting the result, so a rejected send was
    // silently counted as delivered — on 2026-06-18 that reported 81 sent when only
    // 56 actually went out (25 rate-limited away, incl. the owner's own address).
    // We now check the result, throttle to stay under the rate limit, and retry.
    const sendOne = async (sub: {
      email: string;
      unsubscribe_token: string;
    }): Promise<{ ok: boolean; error?: string }> => {
      const unsubscribeUrl = `${SITE_URL}/api/newsletter/unsubscribe?token=${sub.unsubscribe_token}`;
      try {
        const { data, error } = await resend.emails.send({
          from: `${SITE_NAME} <newsletter@hwy4events.com>`,
          // Replies go to Gmail until ImprovMX forwarding for the domain is live.
          replyTo: "robgabel@gmail.com",
          to: sub.email,
          subject,
          html: buildEmailHtml(robNote, content, unsubscribeUrl, tracking),
          headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
        });
        if (error) return { ok: false, error: error.message || "resend error" };
        if (!data?.id) return { ok: false, error: "resend returned no id" };
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "unknown error" };
      }
    };

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // First pass — throttled so a burst doesn't trip Resend's rate limit.
    for (const sub of subscribers) {
      const res = await sendOne(sub);
      if (res.ok) sent++;
      else failures.push({ email: sub.email, error: res.error || "unknown" });
      await sleep(SEND_THROTTLE_MS);
    }

    // Retry pass — most first-pass failures are transient 429s. Back off, try once
    // more, and only then give up on a recipient.
    if (failures.length > 0) {
      const toRetry = failures.splice(0, failures.length);
      for (const f of toRetry) {
        const sub = subscribers.find((s) => s.email === f.email);
        if (!sub) continue;
        await sleep(1200);
        const res = await sendOne(sub);
        if (res.ok) sent++;
        else failures.push({ email: sub.email, error: res.error || "unknown" });
      }
    }

    // Never fail silently again: if anyone was dropped (or the delivered count came
    // up short of the active list), log it and shout in Slack with the addresses.
    if (failures.length > 0 || sent < subscribers.length) {
      console.error(
        `[newsletter/send] delivered ${sent}/${subscribers.length}; ${failures.length} failed:`,
        failures
      );
      const webhook = process.env.SLACK_WEBHOOK_URL;
      if (webhook) {
        const sample = failures.slice(0, 25).map((f) => f.email).join(", ");
        try {
          await fetch(webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text:
                `*⚠️ Newsletter ${today}: delivered ${sent}/${subscribers.length}*` +
                (failures.length > 0
                  ? `\n${failures.length} not sent: ${sample}${failures.length > 25 ? " …" : ""}`
                  : "") +
                `\nSee ${SITE_URL}/admin/newsletter.`,
            }),
          });
        } catch (err) {
          console.error("[newsletter/send] Slack alert failed:", err);
        }
      }
    }

    // Mark the draft sent and archive the body for the public "latest newsletter".
    const now = new Date().toISOString();
    await supabase
      .from("newsletter_drafts")
      .update({
        status: "sent",
        sent_at: now,
        sent_count: sent,
        updated_at: now,
      })
      .eq("id", draft.id);

    // site_config.updated_at defaults to now() only on INSERT; on the upsert's
    // UPDATE branch it would stay frozen at the row's first-insert time, so set
    // it explicitly here to keep the archive timestamp honest on every send.
    await supabase
      .from("site_config")
      .upsert(
        { key: "latest_newsletter", value: content, updated_at: now },
        { onConflict: "key" }
      );
    await supabase
      .from("site_config")
      .upsert(
        { key: "latest_newsletter_date", value: now, updated_at: now },
        { onConflict: "key" }
      );

    return NextResponse.json({
      ok: true,
      sent,
      total: subscribers.length,
      subject,
      failures: failures.length > 0 ? failures : undefined,
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

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
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
  newsletterFromHeader,
  newsletterReplyTo,
} from "@/lib/newsletter";
import {
  sendCampaign,
  rankSubscribersForSend,
  shouldMarkDraftSent,
  pickCampaignDraft,
  NEWSLETTER_DAILY_SEND_BUDGET,
  type RankableSubscriber,
} from "@/lib/newsletter-send";

// Bumped from 120s: the retry pass paces its sends, so a larger subscriber
// list needs more wall-clock headroom.
export const maxDuration = 300;

// Pause between Batch API requests (and pacing for the retry pass) inside
// sendCampaign. ~2/sec keeps us clear of Resend's 5 req/sec limit. (A no-delay
// per-message burst is what tripped the rate limit on 2026-06-18.)
const SEND_THROTTLE_MS = 500;

// Thursday cron + Friday resume. The weekly newsletter ships on a 24h veto
// window: the day before, /api/newsletter/prepare stored a draft; a human had
// ~24h to edit or VETO it at /admin/newsletter. Thursday AUTO-SENDS today's
// pending draft unless it was vetoed, capped at NEWSLETTER_DAILY_SEND_BUDGET
// so confirm/test mail still fits under Resend's free-tier day cap. If anyone
// remains, the draft stays pending. Friday hits this same route and resumes
// that campaign_id (same subject/HTML, ledger skips already-sent) until the
// remainder is 0, then marks the draft sent.
//
// If NO draft exists (prepare didn't run), Thursday sends nothing and warns
// on Slack. Friday with nothing to resume is a quiet skip. It never
// auto-generates-and-blasts unsupervised.
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
    const cronDenied = requireCronAuth(request);
    if (cronDenied) return cronDenied;
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
        from: newsletterFromHeader(),
        replyTo: newsletterReplyTo(),
        to: testEmail,
        subject: `[TEST] ${subject}`,
        html: buildEmailHtml(robNoteResult.body, content, unsubscribeUrl, testTracking),
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          // RFC 8058 one-click (Gmail/Yahoo bulk-sender requirement): mail
          // clients POST to the URL above, which the unsubscribe route handles.
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
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

    // Real send: Thursday auto-sends today's pending draft (wave 1, daily
    // budget). Friday (same path, new cron) resumes any still-pending older
    // campaign_id. Same subject/HTML; the ledger skips anyone already sent.
    const supabase = getServiceClient();
    const today = todayISO();
    const utcWeekday = new Date().getUTCDay();

    const [{ data: todayDraft }, { data: incompleteDrafts }] = await Promise.all([
      supabase
        .from("newsletter_drafts")
        .select("id, subject, content, status, target_send_date, sent_count")
        .eq("target_send_date", today)
        .maybeSingle(),
      supabase
        .from("newsletter_drafts")
        .select("id, subject, content, status, target_send_date, sent_count")
        .eq("status", "pending")
        .lt("target_send_date", today)
        .order("target_send_date", { ascending: false })
        .limit(3),
    ]);

    const pick = pickCampaignDraft({
      today,
      utcWeekday,
      todayDraft: todayDraft ?? null,
      incompleteDrafts: incompleteDrafts ?? [],
    });

    if (pick.action === "skip") {
      console.warn(`[newsletter/send] Skipping send — ${pick.reason}`);

      const webhook = process.env.SLACK_WEBHOOK_URL;
      if (pick.slack && webhook) {
        const icon = todayDraft?.status === "vetoed" ? "🛑" : "⏸️";
        try {
          await fetch(webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text:
                `*${icon} Weekly newsletter NOT sent (${today})* — ${pick.reason}\n` +
                `Nothing shipped. See ${SITE_URL}/admin/newsletter.`,
            }),
          });
        } catch (err) {
          console.error("[newsletter/send] Slack post failed:", err);
        }
      }

      return NextResponse.json({ ok: true, sent: 0, skipped: true, reason: pick.reason });
    }

    const draft = pick.draft;
    const resume = pick.resume;

    const [rawSubscribers, robNoteResult, eventsForLinks] = await Promise.all([
      getActiveSubscribers(),
      getRobNote(),
      getUpcomingEvents(),
    ]);
    // newsletter_clicks has no recipient column, so the click tier is empty
    // until a future path can prove an email. Rank still orders local/hub then
    // newest confirmed, which is the honest Thursday wave-1 list.
    const subscribers = rankSubscribersForSend(
      rawSubscribers as RankableSubscriber[]
    );
    const robNote = robNoteResult.body;
    const tracking = { campaignId: draft.id, slugToEventId: buildSlugToEventId(eventsForLinks) };

    if (subscribers.length === 0) {
      return NextResponse.json({ ok: true, message: "No active subscribers", sent: 0 });
    }

    const content = draft.content;
    const subject = draft.subject;
    const resend = new Resend(resendApiKey);

    // Build one message per subscriber, each with its own personalized unsubscribe
    // link. Same subject/HTML as any later resume of this campaign_id.
    const buildMessage = (sub: { email: string; unsubscribe_token: string }) => {
      const unsubscribeUrl = `${SITE_URL}/api/newsletter/unsubscribe?token=${sub.unsubscribe_token}`;
      return {
        from: newsletterFromHeader(),
        // Replies go to Gmail until ImprovMX forwarding for the domain is live.
        replyTo: newsletterReplyTo(),
        to: sub.email,
        subject,
        html: buildEmailHtml(robNote, content, unsubscribeUrl, tracking),
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    };

    // Ledger-backed idempotent send. Recipients already `sent` for this draft
    // are skipped; the daily budget slices who is attempted THIS run so ~15
    // headroom remains for confirms/tests. Re-running (Friday cron, or a crash
    // recovery) resumes instead of re-blasting.
    const summary = await sendCampaign({
      supabase,
      resend,
      campaignId: draft.id,
      subscribers,
      buildMessage,
      throttleMs: SEND_THROTTLE_MS,
      dailyBudget: NEWSLETTER_DAILY_SEND_BUDGET,
    });
    const sent = summary.deliveredTotal;
    const drained = shouldMarkDraftSent(summary);

    const webhook = process.env.SLACK_WEBHOOK_URL;
    const shortfall =
      summary.failures.length > 0 || summary.blockedPending.length > 0;
    if (shortfall) {
      console.error(
        `[newsletter/send] delivered ${sent}/${subscribers.length}; ` +
          `${summary.failures.length} failed, ${summary.blockedPending.length} blocked-pending:`,
        summary.failures,
        summary.blockedPending
      );
      if (webhook) {
        const failSample = summary.failures.slice(0, 25).map((f) => f.email).join(", ");
        const pendSample = summary.blockedPending.slice(0, 25).join(", ");
        try {
          await fetch(webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text:
                `*⚠️ Newsletter ${draft.target_send_date}: delivered ${sent}/${subscribers.length}*` +
                (summary.failures.length > 0
                  ? `\n${summary.failures.length} failed: ${failSample}${summary.failures.length > 25 ? " …" : ""}`
                  : "") +
                (summary.blockedPending.length > 0
                  ? `\n${summary.blockedPending.length} blocked as \`pending\` from a prior run (delivery unknown — check newsletter_send_log): ${pendSample}`
                  : "") +
                (summary.remainder > 0
                  ? `\n${summary.remainder} held for the next resume (daily budget ${NEWSLETTER_DAILY_SEND_BUDGET}).`
                  : "") +
                `\nRecover with POST /api/newsletter/send {"targets":[…]} — the ledger skips anyone already sent.\nSee ${SITE_URL}/admin/newsletter.`,
            }),
          });
        } catch (err) {
          console.error("[newsletter/send] Slack alert failed:", err);
        }
      }
    } else if (summary.remainder > 0 && webhook) {
      try {
        await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text:
              `*📬 Newsletter ${draft.target_send_date}: wave ${resume ? "2" : "1"} delivered ${sent}/${subscribers.length}.* ` +
              `${summary.remainder} held for Friday resume (daily budget ${NEWSLETTER_DAILY_SEND_BUDGET}). Same draft, same body.\n` +
              `See ${SITE_URL}/admin/newsletter.`,
          }),
        });
      } catch (err) {
        console.error("[newsletter/send] Slack wave note failed:", err);
      }
    }

    const now = new Date().toISOString();
    if (drained) {
      await supabase
        .from("newsletter_drafts")
        .update({
          status: "sent",
          sent_at: now,
          sent_count: sent,
          updated_at: now,
        })
        .eq("id", draft.id);
    } else {
      await supabase
        .from("newsletter_drafts")
        .update({
          sent_count: sent,
          updated_at: now,
        })
        .eq("id", draft.id);
    }

    // Archive on first successful delivery so Thursday readers see this week's
    // issue even while Friday still owes the remainder. sent_at stays null
    // until the draft is actually closed.
    if (sent > 0) {
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
    }

    return NextResponse.json({
      ok: true,
      sent: summary.sentNow,
      delivered_total: sent,
      total: subscribers.length,
      already_sent: summary.alreadySent,
      suppressed: summary.suppressed,
      remainder: summary.remainder,
      drained,
      resume,
      daily_budget: NEWSLETTER_DAILY_SEND_BUDGET,
      blocked_pending:
        summary.blockedPending.length > 0 ? summary.blockedPending : undefined,
      subject,
      failures: summary.failures.length > 0 ? summary.failures : undefined,
    });
  } catch (err) {
    console.error("Newsletter send failed:", err);
    return NextResponse.json({ error: "Failed to send newsletter" }, { status: 500 });
  }
}

// Targeted re-send of the most recent SENT issue to an explicit address list, for
// recovering recipients a prior send dropped. Runs through the same ledger-backed
// sendCampaign as the weekly cron (newsletter_send_log dedups, so it can never
// double-send) and stays deliberately targets-scoped so it can never blast the
// whole list. CRON_SECRET-gated.
//
//   POST /api/newsletter/send  { "targets": ["a@b.com", ...] }
export async function POST(request: Request) {
  const cronDenied = requireCronAuth(request);
  if (cronDenied) return cronDenied;

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return NextResponse.json({ error: "Missing RESEND_API_KEY" }, { status: 500 });
  }

  let targets: string[] = [];
  try {
    const body = await request.json();
    targets = Array.isArray(body?.targets) ? body.targets : [];
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body; expected { targets: string[] }" },
      { status: 400 }
    );
  }
  targets = targets.filter((t): t is string => typeof t === "string" && t.includes("@"));
  if (targets.length === 0) {
    return NextResponse.json({ error: "No valid target addresses" }, { status: 400 });
  }

  try {
    const supabase = getServiceClient();

    const today = todayISO();
    // Prefer an in-flight campaign (pending with a sent_count) so Thursday
    // wave-1 failures can be recovered before Friday closes the draft. Else
    // the most recent already-sent issue, same as before.
    const { data: inflight } = await supabase
      .from("newsletter_drafts")
      .select("id, subject, content")
      .eq("status", "pending")
      .not("sent_count", "is", null)
      .lte("target_send_date", today)
      .order("target_send_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: sentDraft } = inflight
      ? { data: null }
      : await supabase
          .from("newsletter_drafts")
          .select("id, subject, content")
          .eq("status", "sent")
          .order("target_send_date", { ascending: false })
          .limit(1)
          .maybeSingle();
    const draft = inflight ?? sentDraft;
    if (!draft) {
      return NextResponse.json({ error: "No sent draft to re-send" }, { status: 400 });
    }

    // Only re-send to addresses that are still active subscribers.
    const { data: subs } = await supabase
      .from("newsletter_subscribers")
      .select("email, unsubscribe_token")
      .in("email", targets)
      .eq("confirmed", true)
      .is("unsubscribed_at", null);
    const recipients = subs || [];

    const [events, robNoteResult] = await Promise.all([getUpcomingEvents(), getRobNote()]);
    const tracking = {
      campaignId: draft.id as string,
      slugToEventId: buildSlugToEventId(events),
    };
    const resend = new Resend(resendApiKey);

    const buildMessage = (sub: { email: string; unsubscribe_token: string }) => {
      const unsubscribeUrl = `${SITE_URL}/api/newsletter/unsubscribe?token=${sub.unsubscribe_token}`;
      return {
        from: newsletterFromHeader(),
        replyTo: newsletterReplyTo(),
        to: sub.email,
        subject: draft.subject as string,
        html: buildEmailHtml(
          robNoteResult.body,
          draft.content as string,
          unsubscribeUrl,
          tracking
        ),
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          // RFC 8058 one-click (Gmail/Yahoo bulk-sender requirement): mail
          // clients POST to the URL above, which the unsubscribe route handles.
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    };

    // Same ledger-backed send as the weekly cron: anyone newsletter_send_log
    // already records as `sent` for this campaign is skipped, so a recovery
    // can never double-send. Issues that predate the ledger have no rows and
    // behave exactly as before (every requested active address gets the send,
    // now recorded).
    const summary = await sendCampaign({
      supabase,
      resend,
      campaignId: draft.id as string,
      subscribers: recipients,
      buildMessage,
      throttleMs: SEND_THROTTLE_MS,
    });

    // Surface any requested addresses that were not active subscribers (skipped).
    const skipped = targets.filter(
      (t) => !recipients.some((r) => r.email.toLowerCase() === t.toLowerCase())
    );

    return NextResponse.json({
      ok: true,
      mode: "resend",
      subject: draft.subject,
      requested: targets.length,
      eligible: recipients.length,
      resent: summary.sentNow,
      already_sent: summary.alreadySent,
      suppressed: summary.suppressed,
      blocked_pending:
        summary.blockedPending.length > 0 ? summary.blockedPending : undefined,
      skipped_not_active: skipped.length > 0 ? skipped : undefined,
      failures: summary.failures.length > 0 ? summary.failures : undefined,
    });
  } catch (err) {
    console.error("Newsletter re-send failed:", err);
    return NextResponse.json({ error: "Failed to re-send newsletter" }, { status: 500 });
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

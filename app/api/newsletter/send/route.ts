import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { generateEventSlug } from "@/lib/slugs";
import { SITE_URL, SITE_NAME } from "@/lib/constants";

export const maxDuration = 120;

const NEWSLETTER_SYSTEM_PROMPT = `You write the weekly newsletter for Hwy4Events.com — a community events site for the Highway 4 corridor (Angels Camp to Bear Valley) in the California Sierra. Bylined "Millie" (a Sheepadoodle), but you write as a knowledgeable local, not a dog.

Voice: Warm, opinionated, dry humor. Like a friend who lives up here. Not a tourism board. One subtle dog reference max per newsletter — most weeks skip it.

Rules:
- This is a WEEKLY EMAIL newsletter sent Thursday mornings. Cover the upcoming weekend (Fri-Sun) and the following week.
- 3-5 short paragraphs. Total length: 150-250 words.
- P1: Quick hello and weekend highlights — what's worth showing up for.
- P2: Saturday/Sunday specifics. Name-drop venues and artists.
- P3: Next week preview — anything notable coming up Mon-Thu.
- P4 (optional): Rob's Picks or standout events.
- P5: One-line invitation in Millie's voice, then the sign-off on its own line. Vary the invitation each week — examples (do NOT copy verbatim): "Forward this to the buddy who always asks what's happening up here." / "If we missed something you know about, hit reply or use the submit form." / "Send this to the friend coming up next weekend." End with: — Millie 🐾
- Use day names with dates on first mention: "Friday, March 27" or "Saturday the 28th". After that, just day names.
- Name-drop specific events and venues. Be honest if it's a quiet week.
- No corporate language, no emojis in body text (sign-off paw print is the only exception).
- FRESHNESS: Never reuse jokes, openers, closers, structural patterns, OR closing invitations from recent briefings below.
- LINKS: Include event links as [event text](url). Keep natural — don't link every single event.
- FORMAT: Output plain text with markdown-style links. No HTML tags. No JSON. No code fences. No preamble. Paragraphs separated by ONE blank line. Just the newsletter body — nothing else.`;

async function getUpcomingEvents() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase credentials");

  const supabase = createClient(supabaseUrl, serviceKey);

  const today = new Date().toISOString().split("T")[0];
  const tenDaysOut = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const { data, error } = await supabase
    .from("hwy4_events")
    .select(
      "name, date, start_time, venue_name, town, category, artists, price, robs_pick, status, description, event_url"
    )
    .gte("date", today)
    .lte("date", tenDaysOut)
    .neq("status", "cancelled")
    .eq("visibility", "public")
    .order("date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getRecentBriefings() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];

  const supabase = createClient(supabaseUrl, serviceKey);

  const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const { data } = await supabase
    .from("briefing_history")
    .select("briefing_date, text")
    .gte("briefing_date", fourWeeksAgo)
    .order("briefing_date", { ascending: false })
    .limit(4);

  return data || [];
}

async function getActiveSubscribers() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase credentials");

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data, error } = await supabase
    .from("newsletter_subscribers")
    .select("email, unsubscribe_token")
    .eq("confirmed", true)
    .is("unsubscribed_at", null);

  if (error) throw error;
  return data || [];
}

async function generateNewsletter(
  events: Record<string, unknown>[],
  recentBriefings: { briefing_date: string; text: string }[]
) {
  const anthropic = new Anthropic();

  const today = new Date();
  const dayOfWeek = today.toLocaleDateString("en-US", { weekday: "long" });
  const dateStr = today.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const formatEvent = (e: Record<string, unknown>) => {
    const slug = generateEventSlug(
      e.name as string,
      e.date as string,
      e.town as string
    );
    const internalUrl = `${SITE_URL}/events/${slug}`;
    const parts = [
      `${e.name} at ${e.venue_name} (${e.town})`,
      `on ${e.date}`,
      e.start_time ? `at ${e.start_time}` : "",
      e.category ? `[${e.category}]` : "",
      e.price ? `${e.price}` : "",
      e.robs_pick ? "[ROB'S PICK]" : "",
      e.artists ? `Artists: ${(e.artists as string[]).join(", ")}` : "",
      `URL: ${internalUrl}`,
    ].filter(Boolean);
    return parts.join(" — ");
  };

  const eventList =
    events.length > 0
      ? events.map(formatEvent).join("\n")
      : "No events listed for the upcoming period.";

  let historySection = "";
  if (recentBriefings.length > 0) {
    const entries = recentBriefings
      .map((b) => {
        const d = new Date(b.briefing_date + "T00:00:00");
        const label = d.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        });
        return `--- ${label} ---\n${b.text}`;
      })
      .join("\n\n");
    historySection = `\n\nRECENT BRIEFINGS (for freshness — do NOT repeat jokes, phrases, or structural patterns):\n\n${entries}`;
  }

  const message = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1500,
    system: NEWSLETTER_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Today is ${dayOfWeek}, ${dateStr}. Write the weekly newsletter for Hwy4Events.com.\n\nUPCOMING EVENTS (next 10 days):\n${eventList}${historySection}`,
      },
    ],
  });

  const block = message.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");

  // Defensive: if the LLM accidentally returns a JSON wrapper, unwrap it so we
  // never leak raw JSON into the email body. Otherwise return text as-is.
  return unwrapAccidentalJson(block.text);
}

function unwrapAccidentalJson(raw: string): string {
  const stripped = raw
    .trim()
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  if (!stripped.startsWith("{") || !/"body"\s*:/i.test(stripped)) {
    return stripped;
  }

  // Try strict JSON.parse first
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === "object" && typeof parsed.body === "string") {
      return parsed.body.trim();
    }
  } catch {
    // fall through to regex extraction
  }

  // Truncated JSON — extract whatever's after "body":"  and decode common escapes
  const bodyMatch = stripped.match(/"body"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (bodyMatch) {
    const decoded = bodyMatch[1]
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    return decoded.trim();
  }

  return stripped;
}

function withUtm(url: string, content: string): string {
  try {
    const u = new URL(url);
    if (!/(^|\.)hwy4events\.com$/i.test(u.hostname)) return url;
    if (u.searchParams.has("utm_source")) return u.toString();
    u.searchParams.set("utm_source", "newsletter");
    u.searchParams.set("utm_medium", "email");
    u.searchParams.set("utm_campaign", "weekly");
    u.searchParams.set("utm_content", content);
    return u.toString();
  } catch {
    return url;
  }
}

function markdownLinksToHtml(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
    let utmContent = "body_link";
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length > 0) utmContent = parts[parts.length - 1];
    } catch {
      // ignore — keep default
    }
    const tagged = withUtm(url, utmContent);
    return `<a href="${tagged}" style="color: #2d5016; text-decoration: underline;">${label}</a>`;
  });
}

function buildEmailHtml(content: string, unsubscribeUrl: string): string {
  const htmlContent = markdownLinksToHtml(content)
    .split("\n\n")
    .map((p) => `<p style="color: #333; line-height: 1.7; margin: 0 0 16px;">${p}</p>`)
    .join("");

  const primaryHref = withUtm(SITE_URL, "primary_cta");
  const submitHref = withUtm(`${SITE_URL}/submit`, "submit_cta");
  const subscribeHref = withUtm(`${SITE_URL}/?subscribe=1`, "resubscribe");

  const forwardSubject = encodeURIComponent("Thought you'd like this");
  const forwardBody = encodeURIComponent(
    `Found this — it's the Hwy 4 events roundup (Angels Camp to Bear Valley). Worth a look:\n\n${SITE_URL}`
  );
  const forwardHref = `mailto:?subject=${forwardSubject}&body=${forwardBody}`;

  const smsBody = encodeURIComponent(
    `Found this — it's the Hwy 4 events roundup. ${SITE_URL}`
  );
  const smsHref = `sms:?&body=${smsBody}`;

  const secondaryBtn = (href: string, label: string) => `
        <tr>
          <td style="padding: 0 0 10px;">
            <a href="${href}" style="display: block; box-sizing: border-box; width: 100%; padding: 14px 16px; background: #faf9f6; color: #2d5016; text-decoration: none; text-align: center; border: 1px solid #2d5016; border-radius: 8px; font-size: 15px; font-weight: 500;">${label}</a>
          </td>
        </tr>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #faf9f6; margin: 0; padding: 0;">
  <div style="max-width: 560px; margin: 0 auto; padding: 32px 20px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h1 style="color: #2d5016; font-size: 22px; margin: 0;">Hwy 4 Events</h1>
      <p style="color: #888; font-size: 13px; margin: 4px 0 0;">Weekly roundup — Angels Camp to Bear Valley</p>
    </div>
    <div style="background: white; border-radius: 12px; padding: 28px 24px; border: 1px solid #e8e4de;">
      ${htmlContent}
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top: 20px;">
      <tr>
        <td style="padding: 0 0 12px;">
          <a href="${primaryHref}" style="display: block; box-sizing: border-box; width: 100%; padding: 16px 18px; background: #2d5016; color: #ffffff; text-decoration: none; text-align: center; border-radius: 8px; font-size: 16px; font-weight: 600;">Open this week on hwy4events.com →</a>
        </td>
      </tr>
      ${secondaryBtn(forwardHref, "📩  Forward to a friend")}
      ${secondaryBtn(smsHref, "💬  Text it to someone")}
      ${secondaryBtn(submitHref, "📅  Submit an event we missed")}
    </table>
    <p style="color: #666; font-size: 13px; line-height: 1.5; text-align: center; margin: 18px 0 0;">
      Got this forwarded? <a href="${subscribeHref}" style="color: #2d5016; font-weight: 500;">Subscribe yourself →</a>
    </p>
    <div style="text-align: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e8e4de;">
      <p style="color: #888; font-size: 12px; margin: 0 0 8px;">
        <a href="${withUtm(SITE_URL, "footer")}" style="color: #2d5016;">hwy4events.com</a> · Angels Camp to Bear Valley, CA
      </p>
      <p style="color: #aaa; font-size: 11px; margin: 0;">
        <a href="${unsubscribeUrl}" style="color: #aaa;">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const testEmail = url.searchParams.get("test_email");
  const preview = url.searchParams.get("preview") === "1";

  if (preview) {
    const sampleBody = `Quick hello from the corridor — it's shaping up to be a busy weekend.

Friday, March 27 brings bluegrass to [the Lube in Murphys](https://hwy4events.com/events/example-event-murphys) at 7pm. Saturday is the big one: Bear Valley's opening day plus a packed slate at the Resort. Sunday slows down — perfect for a coffee at Aria and a stroll through downtown Arnold.

Next week is quieter. Watch for Tuesday trivia at the Black Bear and a community potluck Wednesday in Avery.

Forward this to the buddy who always asks what's happening up here.

— Millie 🐾`;
    return new NextResponse(buildEmailHtml(sampleBody, `${SITE_URL}/api/newsletter/unsubscribe?token=preview`), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return NextResponse.json(
      { error: "Missing RESEND_API_KEY" },
      { status: 500 }
    );
  }

  try {
    const [events, recentBriefings, realSubscribers] = await Promise.all([
      getUpcomingEvents(),
      getRecentBriefings(),
      getActiveSubscribers(),
    ]);

    const subscribers = testEmail
      ? [{ email: testEmail, unsubscribe_token: "test-token" }]
      : realSubscribers;

    if (subscribers.length === 0) {
      return NextResponse.json({ ok: true, message: "No active subscribers", sent: 0 });
    }

    const content = await generateNewsletter(events, recentBriefings);
    const resend = new Resend(resendApiKey);

    const today = new Date();
    const subject = `What's happening on the 4 — ${today.toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric" }
    )}`;

    let sent = 0;
    const errors: string[] = [];

    // Send individually so each email has a personalized unsubscribe link
    for (const sub of subscribers) {
      const unsubscribeUrl = `${SITE_URL}/api/newsletter/unsubscribe?token=${sub.unsubscribe_token}`;
      try {
        await resend.emails.send({
          from: `${SITE_NAME} <newsletter@hwy4events.com>`,
          to: sub.email,
          subject,
          html: buildEmailHtml(content, unsubscribeUrl),
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
          },
        });
        sent++;
      } catch (err) {
        errors.push(`${sub.email}: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    }

    // Archive the newsletter content (skip for test sends so we don't pollute history)
    if (!testEmail) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && serviceKey) {
        const supabase = createClient(supabaseUrl, serviceKey);
        await supabase.from("site_config").upsert(
          { key: "latest_newsletter", value: content },
          { onConflict: "key" }
        );
        await supabase.from("site_config").upsert(
          { key: "latest_newsletter_date", value: new Date().toISOString() },
          { onConflict: "key" }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      sent,
      total: subscribers.length,
      subject,
      test: Boolean(testEmail),
      errors: errors.length > 0 ? errors : undefined,
      eventCount: events.length,
    });
  } catch (err) {
    console.error("Newsletter send failed:", err);
    return NextResponse.json(
      { error: "Failed to send newsletter" },
      { status: 500 }
    );
  }
}

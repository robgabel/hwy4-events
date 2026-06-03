// Shared newsletter generation + rendering helpers.
//
// Both /api/newsletter/prepare (Wednesday: generate a draft) and
// /api/newsletter/send (Thursday: ship the approved draft) import from here, plus
// the /admin/newsletter regenerate action, so the system prompt, event/briefing
// gathering, generation, subject line, and email HTML have a single definition
// and can't drift between "what you preview/approve" and "what ships".

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { generateEventSlug } from "@/lib/slugs";
import { SITE_URL } from "@/lib/constants";

export const NEWSLETTER_MODEL = "claude-opus-4-7";

export const DEFAULT_ROB_NOTE = `Hey, Rob here. I built Hwy4Events because I kept missing things happening five miles from my house. Every week Millie (my sheepadoodle, our actual editor) rounds up what's on. Hope you find something worth driving to.`;

const NEWSLETTER_SYSTEM_PROMPT = `You write the weekly newsletter for Hwy4Events.com — a community events site for the Highway 4 corridor (Angels Camp to Bear Valley) in the California Sierra. Bylined "Millie" (a Sheepadoodle), but you write as a knowledgeable local, not a dog.

Voice: Warm, opinionated, dry humor. Like a friend who lives up here. Not a tourism board. One subtle dog reference max per newsletter — most weeks skip it.

Rules:
- This is a WEEKLY EMAIL newsletter sent Thursday mornings. Cover the upcoming weekend (Fri-Sun) and the following week.
- 3-5 short paragraphs. Total length: 150-250 words.
- P1: Quick hello and weekend highlights — what's worth showing up for.
- P2: Saturday/Sunday specifics. Name-drop venues and artists.
- P3: Next week preview — anything notable coming up Mon-Thu.
- P4 (optional): Rob's Picks or standout events.
- P5: One-line invitation in Millie's voice, then the sign-off on its own line. Vary the invitation each week — examples (do NOT copy verbatim): "Forward this to the buddy who always asks what's happening up here." / "Got an event we missed? Email Rob at robgabel@gmail.com." / "Send this to the friend coming up next weekend." Do NOT say "hit reply" — replies aren't monitored. End with: — Millie 🐾
- Use day names with dates on first mention: "Friday, March 27" or "Saturday the 28th". After that, just day names.
- Name-drop specific events and venues. Be honest if it's a quiet week.
- No corporate language, no emojis in body text (sign-off paw print is the only exception).
- FRESHNESS: Never reuse jokes, openers, closers, structural patterns, OR closing invitations from recent briefings below.
- LINKS: Include event links as [event text](url). Keep natural — don't link every single event.
- FORMAT: Output plain text with markdown-style links. No HTML tags. No JSON. No code fences. No preamble. Paragraphs separated by ONE blank line. Just the newsletter body — nothing else.`;

export function getServiceClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase credentials");
  return createClient(supabaseUrl, serviceKey);
}

// The Thursday a draft prepared "now" should ship on. On Wednesday this is
// tomorrow; on Thursday it is today (so the send route, which looks the draft up
// by today's date, matches the draft prepare created). Computed in UTC because
// the crons run in UTC.
export function nextThursdayISO(from: Date = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const delta = (4 - d.getUTCDay() + 7) % 7; // 0 == already Thursday
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().split("T")[0];
}

export function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export function buildSubject(targetSendDate: string): string {
  const d = new Date(targetSendDate + "T12:00:00Z");
  return `What's happening on the 4 — ${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })}`;
}

export async function getRobNote(): Promise<{ body: string; isOverride: boolean }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { body: DEFAULT_ROB_NOTE, isOverride: false };
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const today = todayISO();
  const { data } = await supabase
    .from("newsletter_notes")
    .select("body")
    .lte("starts_at", today)
    .gte("ends_at", today)
    .limit(1);

  const body = data?.[0]?.body?.trim();
  if (!body) return { body: DEFAULT_ROB_NOTE, isOverride: false };
  return { body, isOverride: true };
}

export async function getUpcomingEvents() {
  const supabase = getServiceClient();

  const today = todayISO();
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

export async function getRecentBriefings() {
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

export async function getActiveSubscribers() {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from("newsletter_subscribers")
    .select("email, unsubscribe_token")
    .eq("confirmed", true)
    .is("unsubscribed_at", null);

  if (error) throw error;
  return data || [];
}

export async function generateNewsletter(
  events: Record<string, unknown>[],
  recentBriefings: { briefing_date: string; text: string }[]
): Promise<string> {
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
    model: NEWSLETTER_MODEL,
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

// Render a markdown-ish block (with [label](url) links) into stacked <p> tags.
// Normalizes line endings FIRST: hand-edits saved from the /admin/newsletter
// <textarea> come back with CRLF (browsers normalize textarea newlines to \r\n on
// form submit), so a paragraph break is "\r\n\r\n" — which a naive split on "\n\n"
// misses, collapsing the whole email into one block. Normalize CRLF/CR to LF, then
// split on one-or-more blank lines so runs of 3+ newlines don't yield empty <p>s.
function renderParagraphs(text: string, pStyle: string): string {
  return markdownLinksToHtml(text.replace(/\r\n?/g, "\n"))
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="${pStyle}">${p}</p>`)
    .join("");
}

export function buildEmailHtml(robNote: string, content: string, unsubscribeUrl: string): string {
  const htmlContent = renderParagraphs(content, "color: #333; line-height: 1.7; margin: 0 0 16px;");

  const robNoteHtml = renderParagraphs(
    robNote.trim(),
    "color: #3a3a3a; font-size: 14px; line-height: 1.65; margin: 0 0 12px;"
  );

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
    <div style="background: #f4efe6; border-radius: 12px; padding: 18px 20px; border: 1px solid #e0d9cb; margin-bottom: 14px;">
      <p style="color: #2d5016; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 8px;">From Rob —</p>
      ${robNoteHtml}
      <p style="color: #555; font-size: 13px; font-style: italic; margin: 4px 0 0;">— Rob</p>
    </div>
    <div style="background: white; border-radius: 12px; padding: 28px 24px; border: 1px solid #e8e4de;">
      ${htmlContent}
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top: 20px;">
      <tr>
        <td style="padding: 0 0 12px;">
          <a href="${primaryHref}" style="display: block; box-sizing: border-box; width: 100%; padding: 16px 18px; background: #2d5016; color: #ffffff; text-decoration: none; text-align: center; border-radius: 8px; font-size: 16px; font-weight: 600;">See all events →</a>
        </td>
      </tr>
      ${secondaryBtn(forwardHref, "📩  Forward to a friend")}
      ${secondaryBtn(smsHref, "💬  Text it to someone")}
      ${secondaryBtn(submitHref, "📅  Submit an event we missed")}
    </table>
    <p style="color: #666; font-size: 13px; line-height: 1.5; text-align: center; margin: 18px 0 0;">
      Got this forwarded? <a href="${subscribeHref}" style="color: #2d5016; font-weight: 500;">Subscribe yourself →</a>
    </p>
    <p style="color: #666; font-size: 13px; line-height: 1.5; text-align: center; margin: 10px 0 0;">
      Got a tip or an event we missed? Email Rob directly at <a href="mailto:robgabel@gmail.com" style="color: #2d5016; font-weight: 500;">robgabel@gmail.com</a>
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

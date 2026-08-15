// Shared newsletter generation + rendering helpers.
//
// Both /api/newsletter/prepare (Wednesday: generate a draft) and
// /api/newsletter/send (Thursday: ship the approved draft) import from here, plus
// the /admin/newsletter regenerate action, so the system prompt, event/briefing
// gathering, generation, subject line, and email HTML have a single definition
// and can't drift between "what you preview/approve" and "what ships".

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
// Relative (not "@/") imports so the scripts/ test runner, which doesn't load
// the app's tsconfig path alias, can import this module directly.
import { generateEventSlug } from "./slugs";
import {
  repairEventLinks,
  logLinkRepairs,
  type LinkableEvent,
} from "./briefing-links";
import { SITE_URL, SITE_NAME } from "./constants";
import { REGION } from "./region";
import { REGION_OPS } from "./region-ops";
import { isHttpUrl } from "./url";
import {
  renderParagraphs as renderParagraphsSafe,
  type HrefResolver,
} from "./newsletter-render";
import { withVoice } from "./voice";

export const NEWSLETTER_MODEL = "claude-opus-4-7";

// Sender identity for every newsletter-adjacent send (weekly issue, welcome,
// confirm, feedback). Env wins over region config so a deployment can override
// without a code change; the composed header is byte-identical to the old
// hardcoded literal for Calaveras. Defined once here so the send/subscribe/
// confirm/feedback routes can't drift.
export function newsletterFromHeader(): string {
  const addr = process.env.NEWSLETTER_FROM || REGION_OPS.emails.newsletterFrom;
  return `${SITE_NAME} <${addr}>`;
}

export function newsletterReplyTo(): string {
  return process.env.NEWSLETTER_REPLY_TO || REGION_OPS.emails.replyTo;
}

// First-party host test for UTM tagging + click-tracking rewrites. Built from
// the region domain; matches the domain and any subdomain, case-insensitive
// (identical semantics to the old inline /(^|\.)hwy4events\.com$/i).
const escapedDomain = REGION.domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const INTERNAL_HOST_RE = new RegExp(`(^|\\.)${escapedDomain}$`, "i");

export const DEFAULT_ROB_NOTE = `Hey, Rob here. I built Hwy4Events because I kept missing things happening five miles from my house. Every week Millie (my sheepadoodle, our actual editor) rounds up what's on. Hope you find something worth driving to.`;

const NEWSLETTER_SYSTEM_PROMPT = `You write the weekly newsletter for Hwy4Events.com — a community events site for the Highway 4 corridor (Angels Camp to Bear Valley) in the California Sierra. Bylined "Millie" (a Sheepadoodle), but you write as a knowledgeable local, not a dog.

Voice: Warm, opinionated, dry humor. Like a friend who lives up here. Not a tourism board. One subtle dog reference max per newsletter — most weeks skip it.

Rules:
- This is a WEEKLY EMAIL newsletter sent Thursday mornings. Cover the upcoming weekend (Fri-Sun) and the following week.
- 3-5 short paragraphs. Total length: 150-250 words.
- TEASER, NOT THE FULL CALENDAR: this email exists to pull readers to the site, not to be the complete listing. Be selective — feature the standouts and the can't-miss picks, and it is good to leave things out. The website carries the full lineup; the email earns the click. Better to make six events feel irresistible than to cram in twenty.
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
- URLS ARE NOT YOURS TO WRITE: when you link an event, copy its "URL:" value from the event list above character for character. Never construct, guess, or edit a URL, and never reuse a URL from RECENT BRIEFINGS — those may be stale.
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
  return `${REGION_OPS.newsletter.subjectPrefix} — ${d.toLocaleDateString("en-US", {
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
      "id, name, date, start_time, venue_name, town, category, artists, price, robs_pick, status, description, event_url"
    )
    .gte("date", today)
    .lte("date", tenDaysOut)
    .neq("status", "cancelled")
    .neq("is_routine", true)
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
    system: withVoice(NEWSLETTER_SYSTEM_PROMPT),
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
  const body = unwrapAccidentalJson(block.text);

  // Enforce link integrity before the draft is stored: a minted slug here
  // would bypass the click-tracking rewrite (buildSlugToEventId only maps
  // known slugs) and ship as a permanent dead link in an immutable email.
  const repair = repairEventLinks(body, events as unknown as LinkableEvent[]);
  logLinkRepairs("newsletter", repair);
  return repair.text;
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
    if (!INTERNAL_HOST_RE.test(u.hostname)) return url;
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

// Per-send click tracking: when present, event-page links are rewritten to the
// first-party redirect (/r/n/<campaign>/<eventId>) that logs the click. The map
// is slug -> hwy4_events.id; only links whose slug is in it get rewritten, so a
// drifted or hand-edited link just stays a plain (untracked) event link. See
// PRD-newsletter-click-tracking.md.
export type NewsletterTracking = {
  campaignId: string;
  slugToEventId: Map<string, string>;
};

export function buildSlugToEventId(
  events: Record<string, unknown>[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of events) {
    if (!e.id) continue;
    const slug = generateEventSlug(e.name as string, e.date as string, e.town as string);
    map.set(slug, e.id as string);
  }
  return map;
}

// If url is an internal /events/<slug> link, return the slug; else null.
function eventSlugFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!INTERNAL_HOST_RE.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    return parts.length === 2 && parts[0] === "events" ? parts[1] : null;
  } catch {
    return null;
  }
}

// Build the href resolver handed to the (pure, escaping) renderer. Encapsulates
// the three URL rules: (1) an event link with a click-tracking map hit rewrites
// to the first-party /r/n redirect; (2) any other http(s) link gets UTM tags;
// (3) a non-http(s) link (javascript:/data:/junk) resolves to null so the label
// renders as inert escaped text instead of a live href. Escaping of the label
// and the returned href happens in lib/newsletter-render.ts.
function makeHrefResolver(tracking?: NewsletterTracking): HrefResolver {
  return (rawUrl: string): string | null => {
    if (tracking) {
      const slug = eventSlugFromUrl(rawUrl);
      const eventId = slug ? tracking.slugToEventId.get(slug) : undefined;
      if (eventId) {
        return `${SITE_URL}/r/n/${encodeURIComponent(tracking.campaignId)}/${eventId}`;
      }
    }
    // Only http(s) may become a link. mailto:/tel: aren't used in the body;
    // javascript:/data: must never render as an href.
    if (!isHttpUrl(rawUrl)) return null;
    let utmContent = "body_link";
    try {
      const u = new URL(rawUrl);
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length > 0) utmContent = parts[parts.length - 1];
    } catch {
      // ignore — keep default
    }
    return withUtm(rawUrl, utmContent);
  };
}

// Render a markdown-ish block into stacked, HTML-escaped <p> tags. Thin wrapper
// over the pure renderer with this module's href resolver. `emphasizeAnchors`
// bolds the scannable spine (dated weekday anchors + the "Rob's Pick" lead-in).
function renderParagraphs(
  text: string,
  pStyle: string,
  emphasizeAnchors = false,
  tracking?: NewsletterTracking
): string {
  return renderParagraphsSafe(text, pStyle, emphasizeAnchors, makeHrefResolver(tracking));
}

export function buildEmailHtml(
  robNote: string,
  content: string,
  unsubscribeUrl: string,
  tracking?: NewsletterTracking
): string {
  const htmlContent = renderParagraphs(content, "color: #333; font-size: 18px; line-height: 1.6; margin: 0 0 18px;", true, tracking);

  const robNoteHtml = renderParagraphs(
    robNote.trim(),
    "color: #3a3a3a; font-size: 18px; line-height: 1.6; margin: 0 0 14px;"
  );

  const primaryHref = withUtm(SITE_URL, "primary_cta");
  const submitHref = withUtm(`${SITE_URL}/submit`, "submit_cta");
  const subscribeHref = withUtm(`${SITE_URL}/?subscribe=1`, "resubscribe");

  const forwardSubject = encodeURIComponent("Thought you'd like this");
  const forwardBody = encodeURIComponent(
    `${REGION_OPS.newsletter.forwardBodyLede}\n\n${SITE_URL}`
  );
  const forwardHref = `mailto:?subject=${forwardSubject}&body=${forwardBody}`;

  const smsBody = encodeURIComponent(
    `${REGION_OPS.newsletter.smsBodyLede} ${SITE_URL}`
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
  <div style="max-width: 640px; margin: 0 auto; padding: 32px 16px;">
    <!-- Forest-green hero, mirroring the site header: Big Trees flank the title; Millie peeks onto the cream below. -->
    <div style="background: #1B3A2D; border-radius: 12px; padding: 26px 20px 22px; text-align: center;">
      <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
        <tr>
          <td valign="middle" style="padding: 0 12px 0 0;"><img src="${SITE_URL}${REGION_OPS.newsletter.assets.tree}" width="25" height="36" alt="" style="display: block; border: 0;"></td>
          <td valign="middle"><h1 style="color: #ffffff; font-size: 30px; font-weight: 800; letter-spacing: -0.01em; line-height: 1; margin: 0;">${SITE_NAME}</h1></td>
          <td valign="middle" style="padding: 0 0 0 12px;"><img src="${SITE_URL}${REGION_OPS.newsletter.assets.tree}" width="25" height="36" alt="" style="display: block; border: 0;"></td>
        </tr>
      </table>
      <p style="color: #B5C4A8; font-size: 14px; margin: 11px 0 0;">${REGION_OPS.newsletter.heroSubline}</p>
    </div>
    <div style="text-align: center; line-height: 0; margin: 0 0 14px;">
      <img src="${SITE_URL}${REGION_OPS.newsletter.assets.mascot}" width="88" height="99" alt="${REGION_OPS.newsletter.assets.mascotAlt}" style="display: inline-block; border: 0; margin-top: -2px;">
    </div>
    <div style="background: #f4efe6; border-radius: 12px; padding: 18px 20px; border: 1px solid #e0d9cb; margin-bottom: 14px;">
      <p style="color: #2d5016; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 8px;">From Rob —</p>
      ${robNoteHtml}
    </div>
    <div style="background: white; border-radius: 12px; padding: 28px 24px; border: 1px solid #e8e4de;">
      <p style="color: #2d5016; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 14px;">Highlights for the upcoming week —</p>
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
      Got a tip or an event we missed? Email Rob directly at <a href="mailto:${REGION_OPS.emails.owner}" style="color: #2d5016; font-weight: 500;">${REGION_OPS.emails.owner}</a>
    </p>
    <div style="text-align: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e8e4de;">
      <p style="color: #888; font-size: 12px; margin: 0 0 8px;">
        <a href="${withUtm(SITE_URL, "footer")}" style="color: #2d5016;">${REGION.domain}</a> · ${REGION_OPS.newsletter.footerSpan}
      </p>
      <p style="color: #aaa; font-size: 11px; margin: 0;">
        <a href="${unsubscribeUrl}" style="color: #aaa;">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Welcome email, sent once when a subscriber first confirms. Reuses the same
 * shell as the Thursday issue (buildEmailHtml) so the first thing a new
 * subscriber sees matches what they signed up for. Copy lives here, not in a
 * prompt — it's fixed, human-written, and voice-locked by
 * scripts/test/newsletter-welcome.test.ts.
 */
export function buildWelcomeEmailHtml(unsubscribeUrl: string): {
  subject: string;
  html: string;
} {
  const robNote = `Hey, Rob here. You're in. Every Thursday, Millie and I send one quick read on what's happening along the 4, from Angels Camp up to Bear Valley. The good stuff first, no filler.`;

  const content = `Your first issue lands Thursday morning. Between issues the site updates daily, and [this weekend's lineup](${SITE_URL}/this-weekend) is the fast answer when you're making plans.

Know about something happening that we don't? [Send it in](${SITE_URL}/submit) and it goes on the calendar. A lot of the good stuff gets here that way.

One favor: if a neighbor would use this, forward it along. Word of mouth is the whole engine up here.`;

  return {
    subject: "You're on the list",
    html: buildEmailHtml(robNote, content, unsubscribeUrl),
  };
}

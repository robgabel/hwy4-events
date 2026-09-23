// Agent Cockpit — submission reply drafts (the CRM loop).
//
// After the owner decides on a submission, draft a short, warm reply to the
// submitter in the Hwy4Events neighbor voice. Outcomes:
//   - approved:  "your event is live, here's the link"
//   - questions: targeted ask for the exact gaps the triage found (so the owner
//                can publish once the submitter answers)
//   - declined:  gracious "not a fit right now", invite future submissions
//   - expired:   the date passed before anyone reviewed it (fixed copy, no model)
//
// approved / questions / declined only GENERATE copy (no DB, no send). The caller
// stores it on the submission and the admin UI offers a one-click Gmail compose
// deep-link; the human edits and sends from their own Gmail.
//
// `expired` is the one exception: /api/agent/expire-submissions sends that copy
// itself through Resend (the newsletter transactional stack) and stamps
// `auto_sent` so the admin UI does not ask Rob to compose it again. The wording
// is a template, not a model call, so a missing API key or a bad generation
// cannot invent a fact or block the queue clear.

import Anthropic from "@anthropic-ai/sdk";
import type { TriageAnalysis } from "@/lib/agent/submission-triage";
import { SITE_URL } from "../constants";
import { MEDIUM_EFFORT, REASONER_MODEL } from "./models";
import { messageText } from "./message-text";

const REPLY_MODEL = REASONER_MODEL;

export type ReplyOutcome = "approved" | "questions" | "declined" | "expired";

export interface SubmissionReply {
  outcome: ReplyOutcome;
  subject: string;
  body: string;
  to: string | null;
  generated_at: string;
  model: string;
  /** Set only after /api/agent/expire-submissions actually sent this copy. */
  auto_sent?: boolean;
  sent_at?: string;
}

/** model value on the fixed expired template (no Anthropic call). */
export const EXPIRED_REPLY_MODEL = "template";

export interface SubmissionForReply {
  event_name: string;
  event_date: string;
  start_time: string | null;
  venue_name: string | null;
  town: string;
  description: string | null;
  event_url: string | null;
  submitter_name: string | null;
  submitter_email: string | null;
}

export interface ReplyContext {
  eventUrl?: string; // approved: the live event page
  reason?: string; // declined: the owner's dismissal note (shapes tone, not quoted)
}

function blank(v: string | null | undefined): boolean {
  if (v == null) return true;
  const s = String(v).trim();
  return s === "" || s.toUpperCase() === "TBA";
}

// What the triage could NOT pin down (submission blank AND research blank). These
// become the specific things the "questions" email asks for.
function computeGaps(sub: SubmissionForReply, analysis: TriageAnalysis | null): string[] {
  const sg = analysis?.suggested ?? {};
  const flags = analysis?.flags ?? [];
  const gaps: string[] = [];
  if (blank(sub.start_time) && blank(sg.start_time))
    gaps.push("the start time (and end time, if there is one)");
  if (blank(sub.venue_name) && blank(sg.venue_name))
    gaps.push("the exact venue or street address");
  if (blank(sub.description) && blank(sg.description))
    gaps.push("a sentence or two describing the event");
  if (!sg.cost_tier || sg.cost_tier === "unknown")
    gaps.push("whether there is an admission fee, and how much");
  if (blank(sub.event_url) && blank(sg.event_url))
    gaps.push("a link with more info (a website or Facebook event), if there is one");
  if (flags.includes("date_unconfirmed")) gaps.push("confirmation that the date is right");
  return gaps;
}

const BASE_SYSTEM = `You write short replies on behalf of Hwy4Events.com, a community events site for the California Highway 4 corridor in Calaveras County (Angels Camp, Copperopolis, Murphys, Arnold, Avery, Camp Connell, Dorrington, White Pines, Bear Valley). A neighbor submitted an event through the site. Write a brief email back to them.

Voice: a local neighbor who runs the town calendar, warm and direct, not a corporate support desk. Plain text only. Short (2 to 4 short paragraphs, fewer is better). Address the person by first name if one is given. Sign off simply as "Rob" on its own line (Rob runs the site). Do not add a title, company line, address, or any signature block; the email client adds the signature.

Hard rules: no em dashes (use commas, periods, or parentheses), no emojis, no marketing fluff, no exclamation overload. Never invent facts about the event. Mention the event by name.

Output STRICT JSON only, no markdown fences: {"subject": string, "body": string}. The subject is plain and specific (it references the event). The body uses real line breaks between paragraphs.`;

function safeJson(text: string): { subject?: string; body?: string } | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Belt-and-suspenders on the no-em-dash rule.
function stripDashes(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ", ");
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-09-12" → "September 12, 2026". Null when the string is not a real calendar date. */
export function formatSubmissionDate(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const day = Number(m[3]);
  const month = MONTHS[monthIndex];
  if (!month) return null;
  const check = new Date(Date.UTC(year, monthIndex, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== monthIndex ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return `${month} ${day}, ${year}`;
}

function submissionFirstName(raw: string | null | undefined): string | null {
  const token = raw?.trim().split(/\s+/)[0] ?? "";
  if (!token || token.includes("@") || token.length > 40) return null;
  if (!/[A-Za-z]/.test(token)) return null;
  return token;
}

function submissionEventName(raw: string | null | undefined): string {
  const name = (raw ?? "").replace(/\s+/g, " ").trim();
  return name || "your event";
}

/**
 * Fixed expired-submission email. Neighbor voice, no model: the only facts are
 * the event name, its date (omitted when we cannot format it), and the public
 * submit URL. Signs as Rob.
 */
export function buildExpiredReply(
  sub: SubmissionForReply,
  now: Date = new Date()
): SubmissionReply {
  const eventName = stripDashes(submissionEventName(sub.event_name));
  const first = submissionFirstName(sub.submitter_name);
  const dateLabel = formatSubmissionDate(sub.event_date);
  const when = dateLabel
    ? `It was dated ${dateLabel}, and that day has passed, so I couldn't get it on the calendar in time.`
    : `The date on it has passed, so I couldn't get it on the calendar in time.`;
  const greeting = first ? `Hi ${first},\n\n` : "";
  const subject =
    eventName === "your event"
      ? "Your Hwy4Events submission"
      : `Your Hwy4Events submission: ${eventName}`;

  const body = `${greeting}Thanks for sending ${eventName} in. ${when}

If you have another event along the Highway 4 corridor, send it in at ${SITE_URL}/submit and I'll take a look.

Rob`;

  return {
    outcome: "expired",
    subject: stripDashes(subject).slice(0, 200),
    body: stripDashes(body).slice(0, 4000),
    to: sub.submitter_email,
    generated_at: now.toISOString(),
    model: EXPIRED_REPLY_MODEL,
  };
}

/** Stamp a generated reply after Resend accepted it. Drafts leave these off. */
export function markReplyAutoSent(reply: SubmissionReply, sentAt: string): SubmissionReply {
  return { ...reply, auto_sent: true, sent_at: sentAt };
}

export async function generateReply(
  sub: SubmissionForReply,
  analysis: TriageAnalysis | null,
  outcome: ReplyOutcome,
  ctx: ReplyContext = {}
): Promise<SubmissionReply> {
  if (outcome === "expired") return buildExpiredReply(sub);

  const first = sub.submitter_name?.trim().split(/\s+/)[0] ?? null;

  const facts = {
    event_name: sub.event_name,
    event_date: sub.event_date,
    town: sub.town,
    venue: sub.venue_name,
    start_time: sub.start_time,
    submitter_first_name: first,
  };

  let task: string;
  if (outcome === "approved") {
    task = `Outcome: APPROVED and published. Thank them for sending it in, tell them the event is now listed on Hwy4Events, and include this link on its own line: ${
      ctx.eventUrl ?? SITE_URL
    }. Keep it warm and short.`;
  } else if (outcome === "questions") {
    const gaps = computeGaps(sub, analysis);
    const gapList = gaps.length
      ? gaps.map((g) => `- ${g}`).join("\n")
      : "- confirmation that the date, time, and venue are correct";
    task = `Outcome: QUESTIONS. You want to list this event but need a few details before publishing. Ask ONLY about these gaps, phrased so they are easy to answer:\n${gapList}\nBe friendly and specific, not bureaucratic. Let them know it goes up as soon as they reply.`;
  } else {
    task = `Outcome: DECLINED. Politely let them know this one is not a fit for the calendar right now. Context for your tone (do not quote verbatim): ${
      ctx.reason ?? "not a fit for the corridor calendar"
    }. Be gracious, no hard feelings, and invite them to send future Highway 4 corridor events. Keep it short.`;
  }

  const anthropic = new Anthropic();
  const message = await anthropic.messages.create({
    model: REPLY_MODEL,
    // 2500, not 700: a thinking block shares this cap, and 700 would finish
    // before the subject/body JSON starts.
    max_tokens: 2500,
    output_config: MEDIUM_EFFORT,
    system: BASE_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Event submission facts (JSON):\n${JSON.stringify(facts, null, 2)}\n\n${task}`,
      },
    ],
  });

  const text = messageText(message.content);
  const parsed = safeJson(text);

  const fallbackSubject =
    outcome === "approved"
      ? `Your event is live on Hwy4Events: ${sub.event_name}`
      : outcome === "questions"
        ? `A couple questions about ${sub.event_name}`
        : `About your Hwy4Events submission: ${sub.event_name}`;

  return {
    outcome,
    subject: stripDashes((parsed?.subject || fallbackSubject).slice(0, 200)),
    body: stripDashes((parsed?.body || "").slice(0, 4000)),
    to: sub.submitter_email,
    generated_at: new Date().toISOString(),
    model: REPLY_MODEL,
  };
}

// Pre-filled Gmail compose deep-link. Opens a compose window with to/subject/body
// already set; the human reviews, edits, and sends from their own account. Manual
// encoding (not URLSearchParams) so spaces are %20 and a literal "+" survives.
export function gmailComposeUrl(to: string, subject: string, body: string): string {
  const enc = encodeURIComponent;
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(to)}&su=${enc(subject)}&body=${enc(body)}`;
}

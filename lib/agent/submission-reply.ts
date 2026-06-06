// Agent Cockpit — submission reply drafts (the CRM loop).
//
// After the owner decides on a submission, draft a short, warm reply to the
// submitter in the Hwy4Events neighbor voice. Three outcomes:
//   - approved:  "your event is live, here's the link"
//   - questions: targeted ask for the exact gaps the triage found (so the owner
//                can publish once the submitter answers)
//   - declined:  gracious "not a fit right now", invite future submissions
//
// This module only GENERATES copy (pure, no DB, no send). The caller stores it on
// the submission and the admin UI offers a one-click Gmail compose deep-link; the
// human edits and sends from their own Gmail. We never send mail from the app.

import Anthropic from "@anthropic-ai/sdk";
import type { TriageAnalysis } from "@/lib/agent/submission-triage";

const REPLY_MODEL = "claude-sonnet-4-6";

export type ReplyOutcome = "approved" | "questions" | "declined";

export interface SubmissionReply {
  outcome: ReplyOutcome;
  subject: string;
  body: string;
  to: string | null;
  generated_at: string;
  model: string;
}

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

export async function generateReply(
  sub: SubmissionForReply,
  analysis: TriageAnalysis | null,
  outcome: ReplyOutcome,
  ctx: ReplyContext = {}
): Promise<SubmissionReply> {
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
      ctx.eventUrl ?? "https://hwy4events.com"
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
    max_tokens: 700,
    system: BASE_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Event submission facts (JSON):\n${JSON.stringify(facts, null, 2)}\n\n${task}`,
      },
    ],
  });

  const block = message.content[0];
  const text = block && block.type === "text" ? block.text : "";
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

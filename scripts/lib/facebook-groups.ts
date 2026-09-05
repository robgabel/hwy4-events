// Facebook GROUP posts → pending event_submissions (the pure, network-free core).
//
// A front door, not a new pipeline. Corridor Facebook groups carry long-tail
// community events no aggregator lists (the June 2026 one-off run surfaced the
// SIRs branch walking the 4th of July parade behind a restored 1942 Willys MB,
// a punk lineup with no venue named, and the Homemakers Swap at The Urban
// Ladybug Farm) — but a group post is NOT a listing, and that distinction is
// the whole design:
//
//   A calendar feed ASSERTS a date, a venue and a stable per-event id. A
//   neighbour writes "punk show on the 4th" and the model has to supply the
//   rest. Every safeguard downstream (dedup_key, correctFromUrl, the stale
//   sweeps, verification) keys off a per-event URL a group post does not have.
//   Three of the four rows that earlier run wrote straight into hwy4_events
//   carried NEITHER source_event_id NOR event_url — the exact unverifiable,
//   uncorrectable, unretractable shape of the 36 Murphys Irish Pub phantoms,
//   and precisely what the HWY-17 unpinned guard exists to flag.
//
// So group posts land as PENDING event_submissions rows and never touch
// hwy4_events. From there they ride the shipped Agent Cockpit Stage 1 engine
// unchanged, exactly as inbound email does: triageSubmissionById dup-checks
// them against the shared isSameEvent matcher and web-searches for the
// organizer's canonical page (which is how an unpinned post gets PINNED — that
// Homemakers Swap post already yielded theurbanladybug.com), then a human
// clicks Publish / Merge / Dismiss at /admin/submissions. The blast radius of a
// bad extraction is therefore one row in a review queue, not a phantom on the
// homepage.
//
// Everything here is deterministic and side-effect-free so it is unit-testable
// with no network and no DB (scripts/test/facebook-groups.test.ts). The scraper
// (scripts/scrapers/hwy4-fb-groups.ts) owns the impure edges: the Apify call,
// the Anthropic call, and the DB writes.

import type { NormalizedEvent } from "../../lib/inbound-email.js";
import {
  buildExtractionPrompt,
  type ExtractionContext,
} from "../../lib/inbound-email.js";

/** One corridor Facebook group we read. */
export interface GroupConfig {
  /** Stable slug; also the site_config cursor key suffix. */
  slug: string;
  /** Public group URL, e.g. "https://www.facebook.com/groups/uh4ccc". */
  url: string;
  /** Human label used in logs and the submitter_name field. */
  label: string;
}

/** A post as we care about it, after mapping Apify's shape. */
export interface GroupPost {
  /** Stable per-post id — the permalink when the actor gives us one, else the
   *  actor's own post id. Used for idempotency and as the event_url. */
  id: string;
  /** Canonical permalink back to the post, when the actor supplies one. */
  url: string | null;
  text: string;
  /** ISO timestamp of when the post was made, when determinable. */
  postedAt: string | null;
}

// ─── Post mapping ───────────────────────────────────────────────────────────
//
// Apify's group actors are not schema-stable across versions and the store has
// several competing ones, so read permissively rather than pinning to one
// field set. An unmappable post yields null and is skipped, never guessed at.

function firstString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Normalize an epoch-seconds / epoch-ms / ISO-ish value to an ISO timestamp.
 *  Returns null when the value states no usable time — never "now", because a
 *  fabricated timestamp would silently advance the high-water cursor past posts
 *  we never actually read. */
export function normalizePostedAt(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Below ~1e11 is seconds; above is milliseconds.
    const ms = raw < 1e11 ? raw * 1000 : raw;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof raw === "string" && raw.trim()) {
    const s = raw.trim();
    if (/^\d+$/.test(s)) return normalizePostedAt(Number(s));
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/** Map one raw Apify item to a GroupPost. Returns null when the item carries no
 *  text or no usable identity (either of which makes it unusable: no text means
 *  nothing to extract, no id means we could re-ingest it every single run). */
export function mapGroupPost(raw: unknown): GroupPost | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const text = firstString(o, ["text", "postText", "message", "content", "caption"]);
  if (!text) return null;

  const url = firstString(o, ["url", "postUrl", "facebookUrl", "permalink", "link"]);
  const id = firstString(o, ["postId", "id", "post_id", "legacyId"]);
  const identity = url ?? id;
  if (!identity) return null;

  return {
    id: identity,
    url,
    text,
    postedAt: normalizePostedAt(
      o.time ?? o.timestamp ?? o.date ?? o.publishedAt ?? o.createdAt
    ),
  };
}

// ─── The candidate filter ───────────────────────────────────────────────────
//
// A venue Page posts about its own events; a community GROUP is mostly chatter
// (lost dogs, road conditions, "is the pool open?"). The loose keyword gate in
// facebook.ts is wrong here — it fires on the bare token "pm", on any month
// name, and on "food", so it would pass most of a group's traffic into a paid
// model call and then into Rob's review queue. Triage precision IS the product:
// a queue that fills with noise stops being opened, and then this becomes the
// fourth dead Facebook source.
//
// So require BOTH halves of an actual announcement: something that anchors a
// DAY, and something that says an EVENT is happening.

const DATE_SIGNALS: RegExp[] = [
  // Weekday, optionally qualified ("this Saturday", "next Fri").
  /\b(this|next|coming)?\s*(mon|tues?|wed(nes)?|thur?s?|fri|sat(ur)?|sun)(day)?\b/i,
  // Month name + day number ("July 4", "Sept 12th").
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i,
  // Numeric dates: 7/4, 7-4-26, 2026-07-04.
  /\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/,
  /\b\d{4}-\d{2}-\d{2}\b/,
  // Explicit relative days.
  /\b(today|tonight|tomorrow|this weekend|next weekend)\b/i,
  // A clock time is a weak day-anchor but a strong announcement signal.
  /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i,
];

const EVENT_SIGNALS: RegExp[] = [
  /\b(event|festival|fundraiser|benefit|parade|potluck|meeting|market|swap|sale)\b/i,
  /\b(live music|concert|show|band|dj|karaoke|open mic|performing|performance)\b/i,
  /\b(tickets?|admission|cover charge|rsvp|sign[- ]?ups?|register|registration)\b/i,
  /\b(doors open|starts at|kicks off|join us|come out|save the date|mark your calendar)\b/i,
  /\b(bbq|barbecue|dinner|breakfast|brunch|pancake|crab feed|tri[- ]?tip)\b/i,
  /\b(class|workshop|clinic|tournament|race|run|ride|hike|cleanup|clean[- ]?up|work day)\b/i,
  /\b(car show|craft fair|farmers.? market|trivia|bingo|auction|raffle)\b/i,
];

/** Posts that are asking rather than announcing. A question about an event is
 *  not an event announcement, and it is the single most common false positive
 *  in a community group ("anyone know if the parade is still on Saturday?"). */
const QUESTION_ONLY = /^\s*(does |do |did |is |are |was |were |has |have |any(one|body)\b|who |what |when |where |why |how |looking for|need |wanted|lost |found |missing |for sale|isr?o\b)/i;

export const MIN_POST_CHARS = 40;

/** True when a post is worth spending a model call on. Deliberately strict:
 *  needs a day anchor AND an event signal, enough text to carry details, and
 *  must not read as a question or a classified ad. */
export function looksLikeEventPost(text: string): boolean {
  const t = (text ?? "").trim();
  if (t.length < MIN_POST_CHARS) return false;
  if (QUESTION_ONLY.test(t) && !/\b(save the date|join us|come out)\b/i.test(t)) {
    return false;
  }
  const hasDate = DATE_SIGNALS.some((re) => re.test(t));
  const hasEvent = EVENT_SIGNALS.some((re) => re.test(t));
  return hasDate && hasEvent;
}

// ─── Extraction prompt ──────────────────────────────────────────────────────
//
// One model call PER POST, not one per batch. That is what fixes the pinning
// problem at the root: with a single post in context, every event the model
// returns provably came from that post, so it inherits that post's permalink
// with no bookkeeping for the model to get wrong. A batched call would make the
// model responsible for attributing each event back to a post, which is exactly
// the kind of invented cross-reference this whole module exists to avoid.

export function groupExtractionContext(groupLabel: string): ExtractionContext {
  return {
    noun: "post",
    intro: `You are reading a single post from "${groupLabel}", a community Facebook group for the Highway 4 corridor in California`,
    introTail:
      "Group posts are casual and often bury the details in the middle of a chatty paragraph. Extract every distinct real-world event the post announces. A post merely ASKING about an event, reminiscing about a past one, or selling an item is not an event announcement.",
    headerLabel: "Group",
    bodyLabel: "Post text",
  };
}

export function buildGroupPostPrompt(opts: {
  today: string;
  groupLabel: string;
  post: GroupPost;
}): string {
  const posted = opts.post.postedAt
    ? `${opts.groupLabel} (post made ${opts.post.postedAt.slice(0, 10)})`
    : opts.groupLabel;
  return buildExtractionPrompt({
    today: opts.today,
    subject: posted,
    body: opts.post.text,
    context: groupExtractionContext(opts.groupLabel),
  });
}

// ─── Submission rows ────────────────────────────────────────────────────────

/** Prefix for the idempotency key. `source_message_id` carries a UNIQUE partial
 *  index, so a re-ingested post is refused by the database, not just by our
 *  cursor — the same belt-and-braces the Resend email_id gate uses. */
export const GROUP_MESSAGE_PREFIX = "fbgroup";

export function groupMessageId(post: GroupPost, index: number): string {
  return `${GROUP_MESSAGE_PREFIX}:${post.id}#${index}`;
}

export interface SubmissionRow {
  event_name: string;
  event_date: string;
  start_time: string | null;
  venue_name: string | null;
  town: string;
  description: string | null;
  category: string;
  event_url: string | null;
  submitter_name: string;
  submitter_email: null;
  source: string;
  source_message_id: string;
  raw_email: Record<string, unknown>;
}

/** The `source` value these rows carry, alongside the existing 'form' and
 *  'email'. /admin/submissions keys its badge off this. */
export const GROUP_SOURCE = "facebook_group";

/** Build the pending submission rows for one post's extracted events.
 *
 *  event_url is the POST PERMALINK. That is the deliberate answer to the
 *  unpinned-row problem: every group-sourced submission carries a link back to
 *  the human sentence it was derived from, so a reviewer can read the original
 *  before publishing, and the triage agent has a citation to research from. */
export function buildSubmissionRows(opts: {
  post: GroupPost;
  group: GroupConfig;
  events: NormalizedEvent[];
}): SubmissionRow[] {
  return opts.events.map((e, i) => ({
    event_name: e.name,
    event_date: e.date,
    start_time: e.start_time,
    venue_name: e.venue_name,
    town: e.town ?? "",
    description: e.description,
    category: e.category,
    event_url: opts.post.url,
    submitter_name: opts.group.label,
    submitter_email: null,
    source: GROUP_SOURCE,
    source_message_id: groupMessageId(opts.post, i),
    raw_email: {
      group: opts.group.label,
      group_url: opts.group.url,
      post_url: opts.post.url,
      post_id: opts.post.id,
      posted_at: opts.post.postedAt,
      text: opts.post.text,
      confidence: e.confidence,
      artists: e.artists,
      price: e.price,
      end_time: e.end_time,
    },
  }));
}

// ─── Cursor ─────────────────────────────────────────────────────────────────

export function cursorKey(group: GroupConfig): string {
  return `fb_group_cursor_${group.slug}`;
}

/** Advance the per-group high-water mark to the newest post actually READ this
 *  run (not the newest that produced an event — a post we read and correctly
 *  found nothing in must never be re-read and re-billed tomorrow).
 *
 *  Returns the existing cursor unchanged when this run read nothing datable, so
 *  a broken fetch can never skip the window forward past unread posts. */
export function nextCursor(
  existing: string | null,
  postsRead: GroupPost[]
): string | null {
  const stamps = postsRead
    .map((p) => p.postedAt)
    .filter((s): s is string => typeof s === "string" && s.length > 0);
  if (stamps.length === 0) return existing;
  const newest = stamps.reduce((a, b) => (a > b ? a : b));
  if (!existing) return newest;
  return newest > existing ? newest : existing;
}

/** Posts strictly newer than the cursor. A post with no timestamp is KEPT (we
 *  cannot prove it is old, and the source_message_id unique index stops it
 *  being ingested twice anyway) — the cursor is a cost optimization, the index
 *  is the correctness guarantee. */
export function postsAfterCursor(
  posts: GroupPost[],
  cursor: string | null
): GroupPost[] {
  if (!cursor) return posts;
  return posts.filter((p) => !p.postedAt || p.postedAt > cursor);
}

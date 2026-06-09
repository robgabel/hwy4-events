// Description quality: sanitize scraped junk, then gate meaningless text so it
// never reaches a reader. ONE place, shared by the render path (cards, detail,
// meta, JSON-LD), the ingestion write path (scripts/lib/dedup.ts + the raw-insert
// writers), and the read-only backfill/report (scripts/content-fixes/).
//
// Pure and dependency-free on purpose: it must be safe inside client component
// bundles AND inside tsx scripts. No `fs`, no DOM, no Node APIs.
//
// Design split:
//   sanitizeDescription  — strips calendar-widget junk + collapses noise (WS-1.2)
//   assessDescription    — verdict: pass | suppress | rewrite (WS-2 §5)
//   displayDescription   — render helper: clean text to show, or null to suppress
//   truncateMeta         — word/sentence-boundary meta truncation (WS-2)
//
// Identity/dedup logic deliberately does NOT use these — it keeps operating on
// raw description text so the "same event" rule can't shift under it.

// ---------------------------------------------------------------------------
// Sanitizer (WS-1.2)
// ---------------------------------------------------------------------------

// EventON / generic calendar-widget chrome that scrapers drag in. Matched as a
// whole trimmed line, case-insensitive. A trailing colon is optional so both
// "Date:" and "Date" are caught.
const WIDGET_LINE_TOKENS = new Set([
  "add to calendar",
  "google calendar",
  "icalendar",
  "ical",
  "+ ical export",
  "ical export",
  "outlook 365",
  "outlook live",
  "outlook",
  "details",
  "date",
  "time",
  "venue",
  "cost",
  "website",
  "related events",
  "export",
  "+ google calendar",
]);

function isWidgetLine(line: string): boolean {
  const t = line.trim().toLowerCase().replace(/:$/, "").trim();
  if (t.length === 0) return false;
  return WIDGET_LINE_TOKENS.has(t);
}

// Orphan single-character lines a stripped widget leaves behind ("@", "·", "-").
function isOrphanLine(line: string): boolean {
  const t = line.trim();
  return t.length === 1 && !/[a-z0-9]/i.test(t);
}

export interface SanitizeResult {
  /** Cleaned text (may be ""). */
  text: string;
  /** removed meaningful lines / original meaningful lines, in [0,1]. */
  strippedRatio: number;
  /** True if any calendar-widget token was removed. */
  removedWidget: boolean;
}

/**
 * Strip calendar-widget junk and collapse noise, per PRD §4.1.2, in order:
 *  1. drop whole-line widget tokens (Add to calendar, Google Calendar, …)
 *  2. drop orphan single-character lines (@, ·, -)
 *  3. collapse 3+ blank lines to 2
 *  4. trim
 * Keeps the real prose intact (the Native Sons pancake breakfast survives; only
 * the iCal/Outlook chrome is removed).
 */
export function sanitizeDescriptionDetailed(
  input: string | null | undefined,
): SanitizeResult {
  if (!input) return { text: "", strippedRatio: 0, removedWidget: false };

  const lines = input.replace(/\r\n/g, "\n").split("\n");
  let meaningfulOriginal = 0;
  let removed = 0;
  let removedWidget = false;

  const kept = lines.filter((line) => {
    const hasContent = line.trim().length > 0;
    if (hasContent) meaningfulOriginal++;
    if (isWidgetLine(line)) {
      removed++;
      removedWidget = true;
      return false;
    }
    if (isOrphanLine(line)) {
      removed++;
      return false;
    }
    return true;
  });

  const text = kept
    .join("\n")
    .replace(/[ \t]+\n/g, "\n") // strip trailing spaces before newlines
    .replace(/\n{3,}/g, "\n\n") // collapse blank runs
    .replace(/[ \t]{2,}/g, " ") // collapse runs of spaces
    .trim();

  const strippedRatio = meaningfulOriginal > 0 ? removed / meaningfulOriginal : 0;
  return { text, strippedRatio, removedWidget };
}

/** Convenience: just the cleaned string. */
export function sanitizeDescription(input: string | null | undefined): string {
  return sanitizeDescriptionDetailed(input).text;
}

// ---------------------------------------------------------------------------
// Quality gate (WS-2 §5)
// ---------------------------------------------------------------------------

export type DescriptionVerdict = "pass" | "suppress" | "rewrite";

export interface Assessment {
  verdict: DescriptionVerdict;
  reasons: string[];
}

const MIN_WORDS = 15;
const REWRITE_MAX_CHARS = 1200;
const REWRITE_STRIP_RATIO = 0.3;

// Filler/scaffolding that carries no event-specific information. Used to decide
// whether a description adds anything beyond restating title + venue + town.
const SCAFFOLD_WORDS = new Set([
  "a", "an", "the", "this", "that", "these", "those", "and", "or", "but", "for",
  "of", "to", "in", "on", "at", "by", "with", "from", "as", "is", "are", "was",
  "were", "be", "been", "being", "will", "would", "can", "come", "join", "us",
  "our", "your", "you", "we", "they", "it", "its", "all", "welcome", "event",
  "events", "held", "hosting", "hosts", "host", "presents", "presented",
  "featuring", "features", "located", "runs", "run", "running", "takes",
  "place", "more", "info", "information", "details", "please", "there", "here",
  "where", "when", "what", "who", "out", "up", "down", "over", "into", "about",
  "their", "his", "her", "them", "some", "any", "each",
]);

const TERMINAL_PUNCT = /[.!?…)"'’"]$/;

// Tokens that signal the description adds genuine value beyond scaffolding:
// money, instructions, audience cues. (Times/dates are intentionally NOT here —
// the card already shows date + start time, so a date-only "value add" is not
// enough to keep a stub.)
const VALUE_HINT = /\b(free|tickets?|ticketed|rsvp|reserv|register|admission|donation|byob|bring|ages?|kids?|family|members?|doors?|menu|raffle|prizes?|cash|proceeds|benefit|vendors?|live music|potluck|no fee|sign[- ]?up|call|21\+?)\b/i;

function words(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9$']+/gi) || []).map((w) => w.toLowerCase());
}

function contentWords(s: string): string[] {
  return words(s).filter((w) => w.length > 2 && !SCAFFOLD_WORDS.has(w));
}

function hasDigit(s: string): boolean {
  return /\d/.test(s);
}

/**
 * Verdict for a description. Call on the ALREADY-SANITIZED text. `eventTitle`
 * and `venueName` (+ optional `town`) ground the title-restatement check.
 *
 * suppress (do not render) if any:
 *   - < 15 words
 *   - ends with ":" or its final sentence has no terminal punctuation
 *   - title/venue restatement that adds no new value (overlap >60%, or <3 novel
 *     content words once title/venue/town/dates/scaffolding are removed)
 *   - pure exclamatory hype: no digits, ≥1 "!", no proper noun beyond title/venue
 * rewrite (usable, but flag for condensing/cleanup) if:
 *   - sanitizer stripped >30% of meaningful lines
 *   - length > 1200 chars
 */
export function assessDescription(
  text: string | null | undefined,
  eventTitle?: string | null,
  venueName?: string | null,
  opts?: { town?: string | null; strippedRatio?: number },
): Assessment {
  const reasons: string[] = [];
  const t = (text ?? "").trim();

  if (t.length === 0) return { verdict: "suppress", reasons: ["empty"] };

  const wordCount = words(t).length;
  if (wordCount < MIN_WORDS) reasons.push(`too_short(${wordCount}w)`);

  // Ends with ":" → always a tease/stub. Missing terminal punctuation only
  // counts when there's NO sentence punctuation anywhere (a single unterminated
  // fragment) — a complete description that merely ends on an address line
  // ("389 Main Street, Murphys") is fine and must not be suppressed.
  if (t.endsWith(":")) reasons.push("ends_with_colon");
  else if (!TERMINAL_PUNCT.test(t) && !/[.!?…]/.test(t))
    reasons.push("no_terminal_punctuation");

  // Title / venue restatement.
  const scaffoldRef = new Set(
    contentWords(`${eventTitle ?? ""} ${venueName ?? ""} ${opts?.town ?? ""}`),
  );
  const tWords = contentWords(t);
  if (tWords.length > 0) {
    const overlap = tWords.filter((w) => scaffoldRef.has(w)).length / tWords.length;
    // Novel = content words not in title/venue/town and not date/number tokens.
    const novel = tWords.filter((w) => !scaffoldRef.has(w) && !/^\d/.test(w));
    // A date the card already shows is NOT value — only money / clock times /
    // explicit instruction words count, so a "runs June 13–14" stub still fails.
    const addsValue =
      VALUE_HINT.test(t) ||
      /\$\s?\d/.test(t) ||
      /\b\d{1,2}(:\d{2})?\s?[ap]\.?m\.?\b/i.test(t);
    if ((overlap > 0.6 || novel.length < 3) && !addsValue) {
      reasons.push("title_restatement");
    }
  }

  // Pure exclamatory hype with nothing concrete.
  if (!hasDigit(t) && /!/.test(t)) {
    const properNouns = (t.match(/(?<!^)(?<![.!?]\s)\b[A-Z][a-zA-Z]+/g) || []).filter(
      (w) => !scaffoldRef.has(w.toLowerCase()),
    );
    if (properNouns.length === 0) reasons.push("generic_hype");
  }

  if (reasons.length > 0) return { verdict: "suppress", reasons };

  // Passed suppression — is it a rewrite candidate (still rendered)?
  if (opts?.strippedRatio != null && opts.strippedRatio > REWRITE_STRIP_RATIO) {
    reasons.push(`heavily_stripped(${opts.strippedRatio.toFixed(2)})`);
  }
  if (t.length > REWRITE_MAX_CHARS) reasons.push(`too_long(${t.length}c)`);
  if (reasons.length > 0) return { verdict: "rewrite", reasons };

  return { verdict: "pass", reasons: [] };
}

// ---------------------------------------------------------------------------
// Render helper (WS-1.3)
// ---------------------------------------------------------------------------

interface DescribableEvent {
  description?: string | null;
  name?: string | null;
  venue_name?: string | null;
  town?: string | null;
}

/**
 * The one call render sites use. Sanitizes, then gates: returns clean text to
 * show, or null to suppress (caller falls back to venue blurb → nothing).
 * "rewrite" still renders (usable content) — the verdict is a backfill signal,
 * not a reader-facing hide.
 */
export function displayDescription(event: DescribableEvent): string | null {
  const { text, strippedRatio } = sanitizeDescriptionDetailed(event.description);
  if (text.length === 0) return null;
  const { verdict } = assessDescription(text, event.name, event.venue_name, {
    town: event.town,
    strippedRatio,
  });
  return verdict === "suppress" ? null : text;
}

/**
 * Return a shallow copy of an event with its `description` replaced by the gated
 * value (clean text or null). Applied ONCE in the read loaders (lib/events-data.ts
 * after dedupe, lib/events.ts findEventBySlug) so every consumer — cards, detail,
 * meta, JSON-LD, poster — gets gated text without each render site re-checking,
 * while identity/dedup keeps operating on raw description.
 */
export function gateEventDescription<
  T extends {
    description?: string | null;
    name?: string | null;
    venue_name?: string | null;
    town?: string | null;
  },
>(event: T): T {
  return { ...event, description: displayDescription(event) } as T;
}

// ---------------------------------------------------------------------------
// Meta truncation (WS-2)
// ---------------------------------------------------------------------------

/**
 * Truncate for a meta/OG description: prefer the last full sentence ≤ max; if
 * the first sentence already exceeds max, cut at the last word boundary and
 * append "…". Never ends mid-word (kills the "for purc" / "find a w" SERP tell).
 */
export function truncateMeta(text: string, max = 155): string {
  const t = text.trim();
  if (t.length <= max) return t;

  const window = t.slice(0, max);
  const lastSentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );
  // A sentence boundary is only useful if it leaves a substantial lead.
  if (lastSentence >= 60) return t.slice(0, lastSentence + 1).trim();

  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace > 0 ? window.slice(0, lastSpace) : window;
  return `${cut.replace(/[\s.,;:]+$/, "")}…`;
}

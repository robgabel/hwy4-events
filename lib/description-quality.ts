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

// Raw HTML / entities that page-builder + calendar sources drag into descriptions.
// The scrapers already entity-decode at extract time, so this is idempotent on a
// clean write; running it here in the SHARED layer also cleans legacy rows at
// render and covers any future writer. Decode entities FIRST so encoded markup
// ("&lt;p&gt;") becomes real tags and gets stripped too. Conservative: a tag must
// open with a letter or "/", so "5 < 10" and "<3" survive untouched.
const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&rdquo;": "”",
  "&ldquo;": "“",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, (e) => NAMED_ENTITIES[e.toLowerCase()] ?? e);
}

function stripHtml(input: string): string {
  return decodeEntities(input)
    .replace(/<\s*(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n") // structure → newlines
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ") // drop script/style wholesale
    .replace(/<\/?[a-zA-Z][^>]*>/g, ""); // remaining tags
}

// ---------------------------------------------------------------------------
// Reseller-copy scrub (HWY-11)
//
// Concert listings that reach us via ticket-reseller pages arrive carrying junk
// that a calendar-widget stripper was never built to see. Three shapes, all
// observed live on Ironstone shows and all hand-cleaned once already (July 16),
// which is the tell that the fix belongs in the write path rather than in a
// curator's afternoon:
//
//   1. Markdown emphasis the extractor never rendered, usually wrapped around a
//      keyword-stuffed phrase: "This is **Gene Simmons - Murphys Murphys**".
//   2. A doubled town name inside that phrase ("Murphys Murphys").
//   3. Copy written in a fake-local voice by a party with no local standing:
//      "in Murphys, a local favorite for live entertainment", "at Ironstone
//      Vineyards-one of the area's go-to spots for live entertainment". This is
//      a voice violation (content/VOICE.md: the neighbor voice is ours, and it
//      is earned) as much as a quality one.
//
// Plus the reader-harm case: links to ticket-resale marketplaces, where a
// neighbor can pay well over face value for a show whose venue sells tickets
// directly (regtixs.com was the live instance).
// ---------------------------------------------------------------------------

/** Ticket-resale marketplaces. A link to one of these is stripped from
 *  description text outright: the reader loses nothing (every event page
 *  already carries the organizer/venue link) and can only be overcharged by
 *  following it.
 *
 *  Deliberately a DENYLIST, not the allowlist the ticket sketched ("organizer,
 *  venue, or a known legitimate ticket seller"). Checked against live data
 *  first: all 22 URLs currently sitting in upcoming descriptions are legitimate
 *  — organizer sites (murphyscreektheatre.org, angelsmurphysrotary.org) and
 *  real sellers (ticketleap.com, onecau.se) — and an allowlist would have
 *  silently deleted every one of them, since this is a pure function with no
 *  view of the org/venue registry. Stripping good links to catch bad ones is
 *  the worse trade. `findSuspectTicketLinks` in lib/audit-checks.ts covers the
 *  whack-a-mole gap by FLAGGING unrecognized ticket-ish hosts for a human,
 *  which is how a new reseller ends up on this list. */
export const TICKET_RESALE_HOSTS = [
  "regtixs.com",
  "stubhub.com",
  "vividseats.com",
  "ticketnetwork.com",
  "tickpick.com",
  "ticketliquidator.com",
  "ticketsmarter.com",
  "ticketcity.com",
  "razorgator.com",
  "eventticketscenter.com",
  "event-tickets-center.com",
  "tickets-center.com",
  "ticketsonsale.com",
  "boxofficeticketsales.com",
  "superseats.com",
  "goldcoasttickets.com",
] as const;

/** True when `host` is a resale marketplace (exact match or a subdomain). */
export function isTicketResaleHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return TICKET_RESALE_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

function hostOf(url: string): string {
  const m = url.match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : "";
}

/** Bare URLs in free text. Trailing sentence punctuation is left out of the
 *  match so "…at stubhub.com/x." keeps its period. */
const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;!?]/gi;

/** Every http(s) URL in a block of text. */
export function extractUrls(text: string | null | undefined): string[] {
  return (text ?? "").match(URL_IN_TEXT) ?? [];
}

/** Drop links to ticket-resale marketplaces, plus the "book at"/"tickets at"
 *  lead-in they hang off, so the sentence doesn't end mid-phrase. */
function stripResaleLinks(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const out = text.replace(URL_IN_TEXT, (url) => {
    if (!isTicketResaleHost(hostOf(url))) return url;
    removed.push(url);
    return "";
  });
  if (removed.length === 0) return { text, removed };
  return {
    // Tidy the hole the URL left: a dangling "Tickets at ." or double space.
    text: out
      .replace(/\b(?:tickets?|buy|book|get yours?|order)\s+(?:at|from|via|here)?\s*([.!?])/gi, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([.!?,])/g, "$1"),
    removed,
  };
}

/** Strip markdown emphasis / heading markers the extractor left as literal
 *  characters. Scraped prose never means them: "**Kane Brown California**" is
 *  an artifact, not typography. Conservative — `**` must wrap actual content
 *  on one line, so a stray asterisk (a footnote marker, "2 * 4") survives. */
function stripMarkdownArtifacts(text: string): string {
  return text
    .replace(/\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/g, "$1")
    .replace(/__(?!\s)([^_\n]+?)(?<!\s)__/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "");
}

/** Collapse a town name repeated back to back ("… Murphys Murphys" → "…
 *  Murphys"), the signature of a reseller template that appends the city to a
 *  title that already ends in it.
 *
 *  Scoped to the event's OWN town rather than any doubled word on purpose:
 *  genuine reduplicated place names exist (Walla Walla is a wine region, and
 *  this is wine country), so a blanket rule would eventually eat a real one. */
function collapseDoubledTown(text: string, town: string | null | undefined): string {
  const t = (town ?? "").trim();
  if (t.length < 3) return text;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`\\b(${esc})(?:\\s+\\1\\b)+`, "gi"), "$1");
}

/** Marketing appositives that claim local standing on our behalf. */
const FAKE_LOCAL_APPOSITIVE =
  /\s*[,—–-]\s*([^.!?]{0,120}?\b(?:local favorite|go-to spot|favorite local spot|beloved local spot|hometown favorite)s?\b[^.!?]*)(?=[.!?]|$)/gi;

/** Remove a fake-local clause describing the venue.
 *
 *  Narrow by construction, because the phrase alone is not the problem — the
 *  APPOSITIVE is. It must hang off a comma or dash and run to the end of its
 *  sentence, which is the shape a reseller template produces ("at Ironstone
 *  Vineyards in Murphys, a local favorite for live entertainment"). Checked
 *  against every live row that trips a naive phrase match: the farmers market's
 *  "shopping your favorite local vendors", the Rotary listing's "Live Music:
 *  Local favorites The Fabulous Off Brothers", and the craft fair's "one of our
 *  favorite events of the year" are all organizer copy about vendors, bands and
 *  events rather than a claim about a venue, and none of them match. Note the
 *  delimiter set excludes ":" for exactly that reason. */
function stripFakeLocalAppositive(text: string): string {
  return text.replace(FAKE_LOCAL_APPOSITIVE, "");
}

export interface SanitizeResult {
  /** Cleaned text (may be ""). */
  text: string;
  /** removed meaningful lines / original meaningful lines, in [0,1]. */
  strippedRatio: number;
  /** True if any calendar-widget token was removed. */
  removedWidget: boolean;
  /** Resale URLs removed from the text, for logging / audit. */
  removedResaleLinks: string[];
}

export interface SanitizeOptions {
  /** The event's town, enabling the doubled-town collapse. */
  town?: string | null;
}

/**
 * Strip raw HTML, calendar-widget junk, and collapse noise, in order:
 *  0. strip HTML tags + decode common entities (stripHtml)
 *  1. drop whole-line widget tokens (Add to calendar, Google Calendar, …)
 *  2. drop orphan single-character lines (@, ·, -)
 *  3. collapse 3+ blank lines to 2
 *  4. scrub reseller junk: markdown artifacts, a doubled town name, a
 *     fake-local venue appositive, and links to ticket-resale sites (HWY-11)
 *  5. trim
 * Keeps the real prose intact (the Native Sons pancake breakfast survives; only
 * the iCal/Outlook chrome + page-builder markup is removed).
 */
export function sanitizeDescriptionDetailed(
  input: string | null | undefined,
  opts?: SanitizeOptions,
): SanitizeResult {
  if (!input)
    return { text: "", strippedRatio: 0, removedWidget: false, removedResaleLinks: [] };

  const lines = stripHtml(input).replace(/\r\n/g, "\n").split("\n");
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

  const joined = kept
    .join("\n")
    .replace(/[ \t]+\n/g, "\n") // strip trailing spaces before newlines
    .replace(/\n{3,}/g, "\n\n") // collapse blank runs
    .replace(/[ \t]{2,}/g, " "); // collapse runs of spaces

  // Reseller-copy scrub. Order matters: emphasis markers come off first so the
  // doubled town inside "**… Murphys Murphys**" is visible to the collapse.
  const resale = stripResaleLinks(joined);
  const text = collapseDoubledTown(
    stripFakeLocalAppositive(stripMarkdownArtifacts(resale.text)),
    opts?.town,
  )
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  const strippedRatio = meaningfulOriginal > 0 ? removed / meaningfulOriginal : 0;
  return { text, strippedRatio, removedWidget, removedResaleLinks: resale.removed };
}

/** Convenience: just the cleaned string. */
export function sanitizeDescription(
  input: string | null | undefined,
  opts?: SanitizeOptions,
): string {
  return sanitizeDescriptionDetailed(input, opts).text;
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
// money, instructions, audience cues. (A bare clock time or a calendar date is
// intentionally NOT enough on its own — the card already shows date + start
// time, so "Bingo. Doors open 5:30pm" and "runs June 13–14" stay stubs.)
const VALUE_HINT = /\b(free|tickets?|ticketed|rsvp|reserv|register|admission|donation|byob|bring|ages?|kids?|family|members?|doors?|menu|raffle|prizes?|cash|proceeds|benefit|vendors?|live music|potluck|no fee|sign[- ]?up|call|21\+?)\b/i;

const CLOCK_TIME = /\b\d{1,2}(:\d{2})?\s?[ap]\.?m\.?\b/i;
const MONEY = /\$\s?\d/;

// Month names are dates, not acts. "June" in "runs June 13–14" must not read
// as a rescuing proper noun.
const MONTHS = new Set([
  "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december",
]);

// Mid-sentence capitals. Sentence-initial words ("The event…", "Doors open…")
// are syntax, not names — the same lookbehind the hype check uses.
const PROPER_NOUN_RE = /(?<!^)(?<![.!?]\s)\b[A-Z][a-zA-Z]+\b/g;

// A comma-separated item longer than this is a clause, not a lineup/menu entry.
const LIST_ITEM_MAX_WORDS = 8;

function words(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9$']+/gi) || []).map((w) => w.toLowerCase());
}

function contentWords(s: string): string[] {
  return words(s).filter((w) => w.length > 2 && !SCAFFOLD_WORDS.has(w));
}

function hasDigit(s: string): boolean {
  return /\d/.test(s);
}

function isStubReason(reason: string): boolean {
  return (
    reason.startsWith("too_short") ||
    reason === "no_terminal_punctuation" ||
    reason === "generic_hype"
  );
}

/** Commas that are not inside parentheses, so "(Elton John and Billy Joel)"
 *  stays one lineup entry. */
function splitCommaOutsideParens(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;
    else if (ch === "," && depth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  return parts;
}

/**
 * How many comma-separated items look like a concrete list (lineup, menu,
 * activity list). A bare date ("June 13-14, 2026") and a two-clause sentence
 * do not qualify — items have to be short and carry a real word.
 */
function concreteListCount(text: string): number {
  let n = 0;
  for (const part of splitCommaOutsideParens(text)) {
    const w = words(part);
    if (w.length < 1 || w.length > LIST_ITEM_MAX_WORDS) continue;
    const lexical = w.filter(
      (x) =>
        /[a-z]/i.test(x) &&
        !/^\d/.test(x) &&
        x.length > 2 &&
        !SCAFFOLD_WORDS.has(x) &&
        !MONTHS.has(x),
    );
    if (lexical.length === 0) continue;
    n++;
  }
  return n;
}

/**
 * Names worth showing even in a short description.
 *
 * Title words count: "Miss Debbie" is the point of the sentence, and filtering
 * her out because she is also in the title is how Storytime was suppressed.
 * Venue and town words do not count — the card already prints them, and
 * counting them would let "held at Bear Valley Mountain Resort" rescue the
 * date-only archery stub. Month names do not count, for the same reason.
 *
 * A sentence-initial word counts only when the description is a finished
 * multi-word sentence AND that word is in the event title ("Oktoberfest
 * dinner at the lodge."). A normal opener ("Get your costumes ready…") is
 * not a name, and a one-word title echo ("Bingo.") is not either.
 */
function rescuingProperNouns(
  text: string,
  eventTitle?: string | null,
  venueName?: string | null,
  town?: string | null,
): string[] {
  const blocked = new Set(contentWords(`${venueName ?? ""} ${town ?? ""}`));
  const seen = new Set<string>();
  const found: string[] = [];
  const keep = (w: string) => {
    const lw = w.toLowerCase();
    if (seen.has(lw) || SCAFFOLD_WORDS.has(lw) || MONTHS.has(lw) || blocked.has(lw)) return;
    seen.add(lw);
    found.push(w);
  };

  for (const w of text.match(PROPER_NOUN_RE) || []) keep(w);

  if (TERMINAL_PUNCT.test(text)) {
    const first = text.match(/^([A-Z][a-zA-Z]{2,})\b/);
    const firstSentence = text.split(/[.!?]/)[0] ?? "";
    const inTitle = new Set(words(eventTitle ?? "")).has((first?.[1] ?? "").toLowerCase());
    if (first && inTitle && words(firstSentence).length >= 4) keep(first[1]);
  }
  return found;
}

/**
 * Verdict for a description. Call on the ALREADY-SANITIZED text. `eventTitle`
 * and `venueName` (+ optional `town`) ground the title-restatement check.
 *
 * suppress (do not render) if any hard reason remains:
 *   - empty
 *   - ends with ":" (always a tease, even when the words before it are concrete)
 *   - title/venue restatement that adds no new value (overlap >60%, or <3 novel
 *     content words once title/venue/town/dates/scaffolding are removed), unless
 *     `addsValue` (hint / money / clock / a concrete list / a rescuing name)
 *   - stub shape, UNLESS a concrete-value override fires (HWY-46):
 *       too_short (< 15 words), no_terminal_punctuation, generic_hype
 *     yield to a price, ≥2 comma-separated concrete items, or a proper noun
 *     (including one that also appears in the title). A clock time or a lone
 *     hint word does not override those — the card already shows the hour, and
 *     "family activities all day long" is still a truncated stub.
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
  const hasMoney = MONEY.test(t);
  const hasClock = CLOCK_TIME.test(t);
  const hasHint = VALUE_HINT.test(t);
  const listCount = concreteListCount(t);
  const named = rescuingProperNouns(t, eventTitle, venueName, opts?.town);
  // Concrete enough to show a short lineup, a price fragment, or a one-sentence
  // note whose only name is already in the title. Hoisted so both the
  // title-restatement guard and the stub veto see the same signal.
  const concreteValue = hasMoney || listCount >= 2 || named.length > 0;
  // Title restatement keeps this guard. The original trio (hint / money /
  // clock) still counts; a list or a rescuing name does too. A date-only
  // restatement ("runs June 13–14") matches none of them.
  const addsValue = hasHint || hasMoney || hasClock || concreteValue;

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
    if ((overlap > 0.6 || novel.length < 3) && !addsValue) {
      reasons.push("title_restatement");
    }
  }

  // Pure exclamatory hype with nothing concrete. A name counts even when it
  // is also in the title — "with Miss Debbie!" is not generic hype.
  if (!hasDigit(t) && /!/.test(t)) {
    const properNouns = t.match(PROPER_NOUN_RE) || [];
    if (properNouns.length === 0) reasons.push("generic_hype");
  }

  // empty already returned. ends_with_colon and title_restatement stay.
  // Stub-shaped reasons yield when the text is actually informative.
  if (concreteValue) {
    for (let i = reasons.length - 1; i >= 0; i--) {
      if (isStubReason(reasons[i])) reasons.splice(i, 1);
    }
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
  const { text, strippedRatio } = sanitizeDescriptionDetailed(event.description, {
    town: event.town,
  });
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

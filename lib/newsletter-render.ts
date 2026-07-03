// Pure, dependency-free rendering of the newsletter's markdown-ish body into
// safe email HTML. Kept free of `@/` imports so it can be unit-tested by the
// scripts test runner (scripts/test/newsletter-render.test.ts); lib/newsletter.ts
// wraps it with the SITE_URL / UTM / click-tracking href logic.
//
// Security (2026-07-02 upstream review, P8): the body comes from the LLM and
// from admin textarea edits, and it name-drops scraped event titles — all
// untrusted. Previously the text was interpolated into `<p>…</p>` with only
// [label](url) → <a> conversion, so a raw `<img src=x onerror=…>` in a title or
// note passed straight into the outgoing email, and link labels/hrefs were
// unescaped. Here EVERY text node and link label is HTML-escaped, and only an
// http(s) href (validated by the injected resolver) becomes an <a> — a
// javascript:/data: link renders as inert escaped text. Locked by
// scripts/test/newsletter-render.test.ts.

/** Escape a string for HTML *text* content (between tags). Only &, <, > are
 *  special there; quotes are left literal so boldEventAnchors' apostrophe-aware
 *  regexes still match ("Rob's Pick"). */
export function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape a validated href for a double-quoted HTML attribute. */
export function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const LINK_STYLE = "color: #2d5016; text-decoration: underline;";

// Bold the "scannable spine" so a skimming reader gets the plan at a glance.
// Render-time + deterministic, so it lands on EVERY draft (freshly generated,
// hand-edited, or already queued) with no dependency on the model emitting
// markup. Scoped to DATED weekday anchors ("Friday, June 5", "Saturday the
// 6th") and the "Rob's Pick" lead-in; a bare day name is left alone. Runs on
// already-escaped, non-link text, so it can never inject into a tag or an href.
const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";
const DATED_DAY_ANCHOR = new RegExp(
  "\\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)" +
    "(,?\\s+(?:the\\s+\\d{1,2}(?:st|nd|rd|th)|(?:" +
    MONTHS +
    ")\\s+\\d{1,2}(?:st|nd|rd|th)?))",
  "g"
);
const ROBS_PICK_LEADIN = /\bRob['’]s(?:\s+family)?\s+[Pp]ick\b[^:\n.]*:/g;

function boldEventAnchors(escapedText: string): string {
  return escapedText
    .replace(ROBS_PICK_LEADIN, (m) => `<strong>${m}</strong>`)
    .replace(DATED_DAY_ANCHOR, (m) => `<strong>${m}</strong>`);
}

const MARKDOWN_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * Resolve a markdown link's raw URL to a final, safe href — or null to render
 * the label as plain (escaped) text (used to drop non-http schemes). Injected
 * by lib/newsletter.ts so the UTM/click-tracking logic (which needs SITE_URL)
 * stays out of this pure module.
 */
export type HrefResolver = (rawUrl: string) => string | null;

/** Render one raw text segment (between links): escape it, then optionally bold
 *  the scannable-spine anchors. */
function renderTextSegment(raw: string, emphasizeAnchors: boolean): string {
  const escaped = escapeHtmlText(raw);
  return emphasizeAnchors ? boldEventAnchors(escaped) : escaped;
}

/**
 * Render a single markdown-ish paragraph to safe HTML: split on [label](url),
 * escape the text between links, and turn each link into an <a> only when the
 * resolver approves an http(s) href (otherwise the label renders as plain text).
 */
export function renderInline(
  raw: string,
  emphasizeAnchors: boolean,
  resolveHref: HrefResolver
): string {
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  MARKDOWN_LINK.lastIndex = 0;
  while ((m = MARKDOWN_LINK.exec(raw)) !== null) {
    out += renderTextSegment(raw.slice(last, m.index), emphasizeAnchors);
    const [, label, rawUrl] = m;
    const href = resolveHref(rawUrl);
    out += href
      ? `<a href="${escapeHtmlAttr(href)}" style="${LINK_STYLE}">${escapeHtmlText(label)}</a>`
      : escapeHtmlText(label);
    last = m.index + m[0].length;
  }
  out += renderTextSegment(raw.slice(last), emphasizeAnchors);
  return out;
}

/**
 * Render a markdown-ish block into stacked <p> tags. Normalizes line endings
 * FIRST: hand-edits saved from the /admin/newsletter <textarea> come back with
 * CRLF (browsers normalize textarea newlines to \r\n on submit), so a paragraph
 * break is "\r\n\r\n" — a naive split on "\n\n" misses it and collapses the whole
 * email into one block. Normalize CRLF/CR → LF, then split on one-or-more blank
 * lines so runs of 3+ newlines don't yield empty <p>s.
 */
export function renderParagraphs(
  text: string,
  pStyle: string,
  emphasizeAnchors: boolean,
  resolveHref: HrefResolver
): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="${pStyle}">${renderInline(p, emphasizeAnchors, resolveHref)}</p>`)
    .join("");
}

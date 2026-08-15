// Deterministic post-generation repair for LLM-written event links.
//
// The daily briefing, weekend briefing, and newsletter generators all hand the
// model a per-event `URL:` computed by generateEventSlug — but nothing forced
// the emitted markdown to actually use it. In practice Opus prose-renames
// events (artist-first: "Kane Brown at Ironstone" for a row named "Ironstone
// Summer Concert Series") and then RECONSTRUCTS the URL to match its prose
// instead of copying the given one, minting plausible-but-dead slugs
// (kane-brown-murphys-2026-08-16-murphys, live-music-brice-station-vineyards-
// 2026-08-15-murphys — both live 404s in the 2026-08-15 briefing). A link can
// also rot AFTER an honest generation when the row it pointed at is renamed or
// merged away (rotarys-annual-shrimp-feed-auction-2026-08-15-murphys died when
// the 2026-08-11 hand merge kept the other title).
//
// Same philosophy as boldEventAnchors and the newsletter click-tracking
// rewrite: never depend on the model emitting correct markup — enforce it
// deterministically at the boundary. Every internal /events/ link is checked
// against the event set that was actually in the prompt; a slug that doesn't
// resolve is re-mapped to the event it plainly meant (same date, and the link
// text / slug carries the event's act, name, or venue) or downgraded to plain
// text. A plain-text mention beats a 404.
//
// Callers: the two briefing cron routes + the newsletter generator (repair
// before save, so briefing_history stays clean and can't launder dead URLs
// back into future prompts via the freshness section), and the homepage render
// path (repair stored text against the live feed, so post-generation renames/
// merges self-heal without waiting for the next generation).

import { generateEventSlug, townSlug } from "./slugs";
import { SITE_URL } from "./constants";

export type LinkableEvent = {
  name: string;
  date: string;
  town: string;
  venue_name?: string | null;
  artists?: string[] | null;
  visibility?: string | null;
};

export type LinkRepair = { linkText: string; from: string; to: string };
export type LinkUnlink = { linkText: string; from: string };

export type RepairResult = {
  text: string;
  repaired: LinkRepair[];
  unlinked: LinkUnlink[];
};

// Grammatical glue only — anything with meaning stays a signal token.
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "in",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

// Slug-space tokenizer: identical normalization to generateEventSlug so link
// text, slugs, and event fields all compare in the same alphabet.
function tokenize(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .split(/[\s-]+/)
    .filter(Boolean);
}

/** Same prefix-tolerant match as the stale-slug fallback in lib/events.ts:
 * equal, or one is a ≥4-char prefix of the other (rotary ↔ rotarys). */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

const MD_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const DATE_RE = /\d{4}-\d{2}-\d{2}/;

function siteHost(): string | null {
  try {
    return new URL(SITE_URL).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Parse an internal event URL into its slug + surrounding pieces, or null for
 * anything that isn't ours to touch (external hosts, non-event paths). */
function parseEventUrl(
  rawUrl: string
): { slug: string; absolute: boolean; suffix: string } | null {
  const m = rawUrl.match(
    /^(https?:\/\/([^/]+))?\/events\/([a-z0-9-]+)\/?([?#][^)]*)?$/i
  );
  if (!m) return null;
  const host = m[2]?.toLowerCase();
  if (host && host !== siteHost()) return null;
  return { slug: m[3].toLowerCase(), absolute: !!m[1], suffix: m[4] ?? "" };
}

function canonicalUrl(e: LinkableEvent, absolute: boolean, suffix: string) {
  const slug = generateEventSlug(e.name, e.date, e.town);
  return `${absolute ? SITE_URL : ""}/events/${slug}${suffix}`;
}

const MIN_SCORE = 0.5;
const MIN_MATCHED = 2;
const AMBIGUITY_MARGIN = 0.2;

/** Pick the event a broken link plainly meant: same date, and the link's own
 * words (text + slug head, minus the town) land on the event's name, artists,
 * or venue. Null when nothing is confident or two candidates tie. */
function matchBrokenLink(
  linkText: string,
  slug: string,
  events: LinkableEvent[]
): LinkableEvent | null {
  const date = slug.match(DATE_RE)?.[0];
  if (!date) return null;

  const dateIdx = slug.indexOf(`-${date}`);
  const namePart = dateIdx > 0 ? slug.slice(0, dateIdx) : "";
  const townPart = slug.slice(slug.indexOf(date) + date.length + 1);
  const townTokens = new Set(tokenize(townPart));

  const req = [
    ...new Set([...tokenize(linkText), ...tokenize(namePart)]),
  ].filter((t) => !STOPWORDS.has(t) && !townTokens.has(t));
  if (req.length === 0) return null;

  let candidates = events.filter(
    (e) => e.date === date && e.visibility !== "private"
  );
  const sameTown = candidates.filter((e) => townSlug(e.town) === townPart);
  if (townPart && sameTown.length > 0) candidates = sameTown;

  const scored = candidates
    .map((e) => {
      const haystack = [
        ...tokenize(e.name),
        ...(e.artists ?? []).flatMap((a) => tokenize(a)),
        ...tokenize(e.venue_name),
      ];
      const matched = req.filter((t) =>
        haystack.some((h) => tokensMatch(t, h))
      ).length;
      return { e, matched, score: matched / req.length };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < MIN_SCORE || best.matched < MIN_MATCHED) {
    return null;
  }
  const runnerUp = scored[1];
  if (runnerUp && runnerUp.score > best.score - AMBIGUITY_MARGIN) return null;
  return best.e;
}

/**
 * Validate and repair every internal event link in a briefing/newsletter
 * markdown text against the events the text was generated from.
 *
 * - A link whose slug matches an event's canonical slug is untouched.
 * - A broken slug is re-mapped to its confident match, else unlinked.
 * - External links and non-event internal links are never touched.
 * - `activeRange` (render-time callers): only slugs dated inside
 *   [start, end] are judged — a stored briefing's links to days outside the
 *   supplied feed (e.g. yesterday's, once it drops out of the upcoming
 *   window) can't be misread as broken. Generation-time callers omit it:
 *   every event link must come from the prompt's list, so anything
 *   unresolvable there is provably wrong.
 */
export function repairEventLinks(
  text: string,
  events: LinkableEvent[],
  opts: { activeRange?: { start: string; end: string } } = {}
): RepairResult {
  const repaired: LinkRepair[] = [];
  const unlinked: LinkUnlink[] = [];
  if (!text) return { text, repaired, unlinked };

  // Any supplied event's canonical slug is a working page (including
  // members-only rows — they resolve; the prompt just declines to link them).
  const validSlugs = new Set(
    events.map((e) => generateEventSlug(e.name, e.date, e.town))
  );

  const result = text.replace(
    MD_LINK_RE,
    (whole, linkText: string, rawUrl: string) => {
      const parsed = parseEventUrl(rawUrl.trim());
      if (!parsed) return whole;
      if (validSlugs.has(parsed.slug)) return whole;

      const slugDate = parsed.slug.match(DATE_RE)?.[0];
      if (opts.activeRange) {
        // Render-time: never judge a link the supplied feed can't see.
        if (
          !slugDate ||
          slugDate < opts.activeRange.start ||
          slugDate > opts.activeRange.end
        ) {
          return whole;
        }
      }

      const match = matchBrokenLink(linkText, parsed.slug, events);
      if (match) {
        const to = canonicalUrl(match, parsed.absolute, parsed.suffix);
        repaired.push({ linkText, from: rawUrl, to });
        return `[${linkText}](${to})`;
      }
      unlinked.push({ linkText, from: rawUrl });
      return linkText;
    }
  );

  return { text: result, repaired, unlinked };
}

/** Loud, greppable audit trail (the URL_DATE_CORRECTION idiom): a repair
 * firing means a generator emitted a link that didn't match its own event
 * list — visible, not silent. */
export function logLinkRepairs(where: string, result: RepairResult): void {
  for (const r of result.repaired) {
    console.warn(
      `BRIEFING_LINK_REPAIR [${where}] "${r.linkText}": ${r.from} -> ${r.to}`
    );
  }
  for (const u of result.unlinked) {
    console.warn(
      `BRIEFING_LINK_UNLINK [${where}] "${u.linkText}": ${u.from} (no confident match)`
    );
  }
}

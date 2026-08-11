/**
 * Pure parsing for Wix-hosted venue event pages (murphysirishpubca.com — the
 * Murphys Irish Pub's site, also served as goirishinmurphys.com).
 *
 * WHY THIS EXISTS (2026-08-09). The pub was a generic Firecrawl + LLM source
 * pointed at the site's homepage. The homepage events widget does not expose
 * absolute dates in a form a text scrape can read, so the extractor INVENTED
 * them: each run re-emitted the same act lineup shifted a few days forward
 * (rows landed on Mondays and Tuesdays, when the pub is closed, and
 * contradicted the pub's own event permalinks), and every shifted copy minted
 * a new title+date dedup_key and inserted as a fresh row — no source_event_id,
 * no event_url, invisible to every dedup layer (different dates are never
 * compared) and to correctFromUrl (nothing to correct from). At cleanup time
 * 36 of the venue's 50 upcoming rows were unverifiable phantoms.
 *
 * The fix is the Brice Station move: read structure, not renderings. Each Wix
 * event has a per-event page at /event-details/<slug> carrying schema.org
 * Event JSON-LD (name + startDate/endDate), and recurring occurrences get a
 * dated slug (open-mic-night-2026-08-05-18-00). This module extracts BOTH and
 * never guesses: a page that yields no unambiguous date yields no event, so a
 * site redesign degrades to zero coverage, never to fiction.
 *
 * Locked by scripts/test/wix-events.test.ts.
 */

const DEFAULT_TZ = "America/Los_Angeles";

export interface LocalDateTime {
  /** YYYY-MM-DD in venue-local time. */
  date: string;
  /** HH:MM venue-local, or null when the source states no clock time. */
  time: string | null;
}

export interface WixEventPage {
  slug: string;
  /** From JSON-LD; null when only the dated slug carried the date. */
  name: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  description: string | null;
  imageUrl: string | null;
  /** Where the date came from — jsonld is authoritative, slug is the fallback. */
  dateSource: "jsonld" | "slug";
  /** True when JSON-LD and a dated slug disagree on the date (JSON-LD wins). */
  dateConflict: boolean;
}

function isValidCalendarDate(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
  );
}

/** Last path segment of an /event-details/ URL, or null for any other URL. */
export function eventSlugFromUrl(url: string): string | null {
  const path = url.replace(/[?#].*$/, "");
  const m = /\/event-details\/([^/]+?)\/?$/.exec(path);
  return m ? m[1] : null;
}

/**
 * All /event-details/ links in a rendered page, absolutized against baseUrl
 * and deduped BY SLUG (the site answers on two domains; one page per event).
 */
export function extractEventDetailLinks(html: string, baseUrl: string): string[] {
  const origin = baseUrl.replace(/^(https?:\/\/[^/]+).*$/, "$1");
  const out: string[] = [];
  const seenSlugs = new Set<string>();
  const re =
    /href\s*=\s*"([^"]*\/event-details\/[^"]+)"|https?:\/\/[^\s"'<>\\]*\/event-details\/[^\s"'<>\\]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let candidate = (m[1] ?? m[0]).trim();
    if (candidate.startsWith("/")) candidate = `${origin}${candidate}`;
    if (!/^https?:\/\//i.test(candidate)) continue;
    candidate = candidate.replace(/[?#].*$/, "").replace(/[),.;]+$/, "");
    const slug = eventSlugFromUrl(candidate);
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    out.push(candidate);
  }
  return out;
}

/**
 * Date (and optional time) stated in a Wix occurrence slug:
 * "open-mic-night-2026-08-05-18-00" → 2026-08-05 18:00. A slug with no dated
 * suffix ("kyle-cox-2") parses to null — never guessed.
 */
export function parseDatedSlug(slug: string): LocalDateTime | null {
  const m = /-(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})-(\d{2}))?$/.exec(slug);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!isValidCalendarDate(y, mo, d)) return null;
  let time: string | null = null;
  if (m[4] !== undefined) {
    const [hh, mm] = [Number(m[4]), Number(m[5])];
    if (hh < 24 && mm < 60) time = `${m[4]}:${m[5]}`;
  }
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time };
}

/**
 * Venue-local date/time from a schema.org ISO datetime. An explicit offset
 * (or no zone marker at all) means the literal Y-M-D/H:M portion IS the
 * venue-local reading — take it verbatim, no Date math. A trailing Z is UTC
 * and gets converted via Intl. Anything else (bare month names, garbage)
 * returns null rather than a guess.
 */
export function isoToLocalParts(iso: string, timeZone: string = DEFAULT_TZ): LocalDateTime | null {
  const s = iso.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    if (!isValidCalendarDate(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3])))
      return null;
    return { date: s, time: null };
  }
  const m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|z|[+-]\d{2}:?\d{2})?$/.exec(
      s
    );
  if (!m) return null;
  if (!isValidCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]))) return null;
  if (Number(m[4]) > 23 || Number(m[5]) > 59) return null;

  const marker = m[6];
  if (!marker || (marker !== "Z" && marker !== "z")) {
    return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
  }

  const utc = new Date(s);
  if (Number.isNaN(utc.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(utc);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { date, time: `${hour}:${get("minute")}` };
}

interface JsonLdEvent {
  name: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  imageUrl: string | null;
}

function isEventType(t: unknown): boolean {
  if (typeof t === "string") return /Event$/.test(t);
  if (Array.isArray(t)) return t.some((x) => typeof x === "string" && /Event$/.test(x));
  return false;
}

function jsonLdImageUrl(image: unknown): string | null {
  const first = Array.isArray(image) ? image[0] : image;
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && typeof (first as { url?: unknown }).url === "string")
    return (first as { url: string }).url;
  return null;
}

/** Every schema.org Event object in the page's ld+json blocks (incl. @graph). */
export function extractJsonLdEvents(html: string): JsonLdEvent[] {
  const out: JsonLdEvent[] = [];
  const blockRe =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      continue; // malformed block — skip, never guess
    }
    const queue: unknown[] = [parsed];
    while (queue.length) {
      const node = queue.shift();
      if (Array.isArray(node)) {
        queue.push(...node);
        continue;
      }
      if (!node || typeof node !== "object") continue;
      const obj = node as Record<string, unknown>;
      if (Array.isArray(obj["@graph"])) queue.push(...(obj["@graph"] as unknown[]));
      if (!isEventType(obj["@type"])) continue;
      out.push({
        name: typeof obj.name === "string" ? obj.name : null,
        startDate: typeof obj.startDate === "string" ? obj.startDate : null,
        endDate: typeof obj.endDate === "string" ? obj.endDate : null,
        description: typeof obj.description === "string" ? obj.description : null,
        imageUrl: jsonLdImageUrl(obj.image),
      });
    }
  }
  return out;
}

/**
 * One event page → one dated event, or null when the page states no
 * unambiguous date (fails closed). JSON-LD startDate is authoritative; a
 * dated occurrence slug is the fallback; a bare slug alone yields nothing.
 */
export function parseWixEventPage(
  html: string,
  url: string,
  timeZone: string = DEFAULT_TZ
): WixEventPage | null {
  const slug = eventSlugFromUrl(url);
  if (!slug) return null;
  const slugDate = parseDatedSlug(slug);

  for (const ld of extractJsonLdEvents(html)) {
    if (!ld.startDate) continue;
    const start = isoToLocalParts(ld.startDate, timeZone);
    if (!start) continue;
    const end = ld.endDate ? isoToLocalParts(ld.endDate, timeZone) : null;
    return {
      slug,
      name: ld.name,
      date: start.date,
      startTime: start.time,
      // An end on a different local date (an overnight close, a series span)
      // is not this evening's end time — leave it unknown.
      endTime: end && end.date === start.date ? end.time : null,
      description: ld.description,
      imageUrl: ld.imageUrl,
      dateSource: "jsonld",
      dateConflict: slugDate !== null && slugDate.date !== start.date,
    };
  }

  if (slugDate) {
    return {
      slug,
      name: null,
      date: slugDate.date,
      startTime: slugDate.time,
      endTime: null,
      description: null,
      imageUrl: null,
      dateSource: "slug",
      dateConflict: false,
    };
  }
  return null;
}

/** "kyle-cox-2" → "Kyle Cox"; "open-mic-night-2026-08-05-18-00" → "Open Mic Night". */
export function humanizeEventSlug(slug: string): string {
  return slug
    .replace(/-(\d{4})-(\d{2})-(\d{2})(-(\d{2})-(\d{2}))?$/, "")
    .replace(/-\d+$/, "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

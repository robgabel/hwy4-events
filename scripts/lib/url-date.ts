/**
 * Recover an event's date (and sometimes its start time) from its own URL.
 *
 * Why (2026-07-26, the Wolf Jett bug): our Brice Station scraper wrote a row
 * dated **2026-07-26** for an event whose own product URL says
 * `…/products/wolf-jett-july-25-2026-7pm`. The correct July 25 row already
 * existed, so the site showed a duplicate advertising a show that had already
 * happened — a reader could have driven out for a concert the night after it
 * ended. The LLM extractor simply got the date wrong; nothing downstream could
 * tell, because a date is a date.
 *
 * But the organizer had already told us, in a string they authored themselves:
 * the slug. Shopify/WooCommerce/Tribe permalinks routinely carry the occurrence
 * date (`wolf-jett-july-25-2026-7pm`, `/event/music-on-the-rooftop/2026-07-31/`),
 * and that beats a model's reading of a rendered page.
 *
 * This is deliberately a *correction*, not a source: it only overrides a date we
 * already extracted, and only when the URL states one unambiguously. It cannot
 * invent an event.
 *
 * Pure + dependency-free so `scripts/test/url-date.test.ts` can lock it.
 */

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

/** "july-25-2026" / "july-25th-2026" — a month NAME, a day, and a 4-digit year. */
const SLUG_DATE = new RegExp(
  `\\b(${MONTH_ALT})[-_]?(\\d{1,2})(?:st|nd|rd|th)?[-_](20\\d{2})\\b`,
  "i"
);

/** "/2026-07-31/" — an ISO date as its own path segment (Tribe permalinks). */
const ISO_DATE = /(?:^|[/\-_])(20\d{2})-(\d{2})-(\d{2})(?:[/\-_]|$)/;

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Reject a day that doesn't exist in that month (e.g. february-31).
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Extract a YYYY-MM-DD the URL states outright, or null. */
export function dateFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = String(url);

  const isoM = ISO_DATE.exec(s);
  if (isoM) {
    const hit = iso(Number(isoM[1]), Number(isoM[2]), Number(isoM[3]));
    if (hit) return hit;
  }

  const slugM = SLUG_DATE.exec(s);
  if (slugM) {
    const month = MONTHS[slugM[1].toLowerCase()];
    return iso(Number(slugM[3]), month, Number(slugM[2]));
  }

  return null;
}

/**
 * Extract a start time the URL states outright ("…-7pm", "…-6-30pm"), or null.
 * Requires a meridiem: a bare number in a slug is far too ambiguous to trust.
 */
export function timeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /[-_](\d{1,2})(?:[-_:](\d{2}))?\s*(am|pm)\b/i.exec(String(url));
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const pm = m[3].toLowerCase() === "pm";
  if (pm && hour !== 12) hour += 12;
  if (!pm && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export interface UrlDateCorrection {
  correctedDate: boolean;
  correctedTime: boolean;
  fromDate?: string;
  toDate?: string;
  fromTime?: string | null;
  toTime?: string;
}

export interface DateCorrectable {
  date: string;
  start_time: string | null;
  event_url?: string | null;
  /**
   * True when the extractor read the date from the page's own LIVE structured
   * data (e.g. Wix schema.org Event JSON-LD). A dated URL slug is frozen at
   * event creation, so on a reschedule the slug is the STALE side — the
   * correction must defer or it re-breaks the date every night (2026-08-09
   * review finding on the rescheduled-occurrence case).
   */
  date_authoritative?: boolean;
}

/**
 * Override an event's date/start_time with what its own URL states.
 *
 * Only acts when the URL states a value unambiguously, and only on the event's
 * own `event_url` (never a source/listing URL, which may name an unrelated
 * date). Returns what changed so the caller can log it — a silent correction
 * would hide a broken extractor.
 */
export function applyUrlDate(event: DateCorrectable): UrlDateCorrection {
  const result: UrlDateCorrection = { correctedDate: false, correctedTime: false };
  // A date read from live structured data outranks the URL: dated slugs are
  // frozen at creation, so on a reschedule the URL is the stale side.
  if (event.date_authoritative) return result;
  const url = event.event_url;
  if (!url) return result;

  const urlDate = dateFromUrl(url);
  if (urlDate && urlDate !== event.date) {
    result.correctedDate = true;
    result.fromDate = event.date;
    result.toDate = urlDate;
    event.date = urlDate;
  }

  const urlTime = timeFromUrl(url);
  if (urlTime && urlTime !== event.start_time) {
    result.correctedTime = true;
    result.fromTime = event.start_time;
    result.toTime = urlTime;
    event.start_time = urlTime;
  }

  return result;
}

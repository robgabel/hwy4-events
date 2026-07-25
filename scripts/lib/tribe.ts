/**
 * Shared client for "The Events Calendar" (Tribe) WordPress REST API.
 *
 * Several corridor organizers run the same plugin, which exposes clean,
 * structured event JSON at `/wp-json/tribe/events/v1/events` — venue, address,
 * exact start/end datetimes, categories, cost, image. That is strictly better
 * than Firecrawl-markdown + LLM extraction, and (critically) it is the
 * *organizer's own* data, so times stay correct when the organizer edits them.
 *
 * Extracted from `scripts/scrapers/visit-murphys.ts` when a second Tribe source
 * (arnold-rim-trail) landed, so the transport + parsing live in one place.
 *
 * Bot walls: several of these sites 403 a plain server-side fetch, or return a
 * 200 whose body is an HTML challenge page instead of JSON (visitmurphys.com
 * since late June 2026; arnoldrimtrail.org as of July 2026). `fetchTribePage`
 * tries the plain fetch first (free, fast, works if the wall ever lifts) and
 * falls back to fetching the same URL through Firecrawl (`formats: ["rawHtml"]`,
 * which returns the endpoint's raw JSON body unprocessed) — the same escape
 * hatch `red-cross.ts` and `sequoia-woods.ts` use.
 */

import FirecrawlApp from "@mendable/firecrawl-js";

// ---------- Tribe REST API response shape (only the fields we read) ----------

export interface TribeEvent {
  id: number;
  title: string;
  description: string | null;
  url: string;
  start_date: string; // "YYYY-MM-DD HH:MM:SS" in the event's timezone
  end_date: string;
  all_day: boolean;
  status: string;
  cost: string | null;
  /** ISO timestamp of the organizer's last edit. Not read by the mappers, but
   *  invaluable when debugging a stale time (it tells you when they moved it). */
  modified?: string;
  venue?: {
    venue?: string;
    address?: string;
    city?: string;
    state?: string | null;
    zip?: string;
  };
  categories?: Array<{ name: string; slug: string }>;
  image?: { url?: string } | null;
}

export interface TribeResponse {
  events: TribeEvent[];
  total: number;
  total_pages: number;
  next_rest_url?: string;
}

// ---------- HTML → plain text ----------

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
  "&hellip;": "…",
  "&ndash;": "–",
  "&mdash;": "—",
  "&lsquo;": "‘",
  "&rsquo;": "’",
  "&ldquo;": "“",
  "&rdquo;": "”",
};

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&\w+;/g, (e) => ENTITIES[e.toLowerCase()] ?? e)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- Field mappers ----------

/** Split Tribe's "YYYY-MM-DD HH:MM:SS" into a date + an HH:MM time. An all-day
 *  event (or a midnight stamp, which Tribe uses for "no time set") yields a
 *  null time rather than a fake "00:00". */
export function splitDateTime(
  tribeDateTime: string,
  allDay: boolean
): { date: string; time: string | null } {
  const [d, t] = tribeDateTime.split(" ");
  if (!t || allDay || t.startsWith("00:00")) return { date: d, time: null };
  return { date: d, time: t.slice(0, 5) };
}

export function joinAddress(v: TribeEvent["venue"]): string | null {
  if (!v) return null;
  const street = v.address?.trim();
  const city = v.city?.trim();
  const state = v.state?.trim() || "CA";
  const zip = v.zip?.trim();
  if (!street && !city) return null;
  const cityPart = city
    ? `${city}, ${state}${zip ? ` ${zip}` : ""}`
    : `${state}${zip ? ` ${zip}` : ""}`;
  return street ? `${street}, ${cityPart}` : cityPart;
}

/**
 * Strip a trailing date suffix an organizer bakes into the event title so each
 * occurrence of a series gets a unique WordPress post ("Guided Sunset Hike to
 * Cougar Rock – July 25, 2026" → "Guided Sunset Hike to Cougar Rock").
 *
 * The date already lives in its own column, so repeating it in the name makes
 * for a noisy card, a noisy slug, and a title that reads as a *different* event
 * to the cross-source matcher every month. Only strips a real trailing date —
 * an en/em dash or hyphen, a month name, a day, and a 4-digit year — so a title
 * that legitimately ends in a place or act name is untouched.
 */
const TITLE_DATE_SUFFIX =
  /\s*[–—-]\s*(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4}\s*$/i;

export function stripTitleDateSuffix(title: string): string {
  const stripped = title.replace(TITLE_DATE_SUFFIX, "").trim();
  // Never strip a title down to nothing — if the whole name was a date, keep it.
  return stripped.length > 0 ? stripped : title.trim();
}

/** Tribe's `cost` is free text ("15", "$15", "Free", ""). Normalize a bare
 *  number to a dollar amount; leave prose alone; empty → null. */
export function normalizeCost(cost: string | null | undefined): string | null {
  const c = cost?.trim();
  if (!c) return null;
  return /^\d/.test(c) ? `$${c}` : c;
}

// ---------- Transport ----------

/**
 * Fetch one Tribe API page, falling back to Firecrawl when the site's bot wall
 * blocks a plain fetch. Returns null on the natural end-of-results 400.
 */
export async function fetchTribePage(
  url: string,
  page: number
): Promise<TribeResponse | null> {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Hwy4EventsScraper/1.0)",
      Accept: "application/json",
    },
  });

  if (resp.ok) {
    const text = await resp.text();
    try {
      return JSON.parse(text) as TribeResponse;
    } catch {
      console.warn(
        `  page ${page}: 200 but not JSON (bot-wall challenge page) — retrying via Firecrawl`
      );
      return fetchTribePageViaFirecrawl(url, page);
    }
  }

  // Tribe returns 400 for pages past the last one — that's the natural stop.
  if (resp.status === 400 && page > 1) {
    return null;
  }

  console.warn(
    `  page ${page}: direct fetch failed (${resp.status}) — retrying via Firecrawl`
  );
  return fetchTribePageViaFirecrawl(url, page);
}

async function fetchTribePageViaFirecrawl(
  url: string,
  page: number
): Promise<TribeResponse | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error(
      `Tribe API request blocked on page ${page} and FIRECRAWL_API_KEY is unset — no fallback available`
    );
  }

  const firecrawl = new FirecrawlApp({ apiKey });
  const result = await firecrawl.scrapeUrl(url, {
    formats: ["rawHtml"],
    onlyMainContent: false,
    timeout: 30000,
  });

  if (!result.success || !result.rawHtml) {
    throw new Error(
      `Tribe API request failed on page ${page}: Firecrawl fallback also failed`
    );
  }

  try {
    return JSON.parse(result.rawHtml) as TribeResponse;
  } catch {
    throw new Error(
      `Tribe API request failed on page ${page}: Firecrawl fallback did not return valid JSON`
    );
  }
}

export interface FetchAllOptions {
  /** Only events starting on/after this date (YYYY-MM-DD). Defaults to today. */
  startDate?: string;
  perPage?: number;
  /** Safety bound on pagination. */
  maxPages?: number;
}

/** Page through a Tribe events endpoint until it runs out. */
export async function fetchAllTribeEvents(
  apiUrl: string,
  opts: FetchAllOptions = {}
): Promise<TribeEvent[]> {
  const startDate = opts.startDate ?? new Date().toISOString().slice(0, 10);
  const perPage = opts.perPage ?? 50;
  const maxPages = opts.maxPages ?? 20;
  const events: TribeEvent[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `${apiUrl}?per_page=${perPage}&start_date=${startDate}&page=${page}`;
    console.log(`  fetching page ${page} …`);
    const data = await fetchTribePage(url, page);
    if (!data) {
      console.log(`  page ${page} returned 400 — end of results`);
      break;
    }
    if (!data.events || data.events.length === 0) {
      console.log(`  page ${page} empty — stopping`);
      break;
    }
    events.push(...data.events);
    console.log(`    +${data.events.length} (running total ${events.length})`);
    if (data.events.length < perPage) break;
    if (!data.next_rest_url) break;
  }

  return events;
}

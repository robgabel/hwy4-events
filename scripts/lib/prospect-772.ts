/**
 * Prospect 772 Winery — Square Online event products.
 *
 * The calendar page (https://www.prospect772.com/calendar) is a Square / Weebly
 * site. It does not list the shows in the HTML. A featured-events block on the
 * CMS page carries `featuredEventIds`, and the store products API returns each
 * id as an event product: name, start/end, permalink, price.
 *
 * Verified 2026-10-06 against the live calendar:
 *   October 10th - Breakaway - Prospect 772 Concert Series   Sat 5:00–9:00 PM  $12.77
 *   October 24th - Boomer - Prospect 772 Concert Series      Sat 5:00–9:00 PM  $17.72
 *
 * GoCalaveras titles the same nights "Live Music @ Prospect 772" and leaves
 * `artists` empty. The public title is built with `titleWithNamedAct` so it
 * keeps "Live Music" ("Breakaway Live Music @ Prospect 772"). That is the
 * string the Oct 5 hand retitle already stored for Breakaway, so
 * `generateEventSlug` does not move that URL. Boomer's hand title
 * ("Boomer Live Music @Prospect 772 Winery") gains a space and drops "Winery";
 * the old slug 301s through `pickFallbackEvent`.
 *
 * Pure. The scraper in scripts/scrapers/prospect-772.ts does the fetch.
 * Tests must not hit the network.
 */

import { normalizeName } from "../../lib/event-identity.js";
import { displayActName, isNamedAct, titleWithNamedAct } from "../../lib/lineup-acts.js";
import { parseStatedTime } from "../../lib/verify-times.js";
import { htmlToText } from "./tribe.js";

export const PROSPECT_PAGE_URL = "https://www.prospect772.com/calendar";
export const PROSPECT_VENUE_NAME = "Prospect 772 Winery";
export const PROSPECT_TOWN = "Angels Camp";
/** Actless calendar stem. `titleWithNamedAct` prefixes the band and keeps this. */
export const PROSPECT_CALENDAR_TITLE = "Live Music @ Prospect 772";
export const PROSPECT_SITE_ORIGIN = "https://www.prospect772.com";

/**
 * CMS page that holds the featured-events block. Verified 2026-10-06
 * (`properties.route` is "calendar"). A 404 here is a moved page, not an
 * empty season: the scraper throws so the run is an error, not a silent zero.
 */
export const PROSPECT_CMS_PAGE_URL =
  "https://www.prospect772.com/app/website/cms/api/v1/pages/e6d03af0-b9ee-11f1-b818-99d64766b95d";

/** Square store the calendar's event products live in. User + site ids are
 *  the ones the calendar page publishes in its analytics block. */
export const PROSPECT_PRODUCTS_URL =
  "https://cdn5.editmysite.com/app/store/api/v28/editor/users/135798428/sites/163681804486933032/products";

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sept: 9, sep: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};

const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

/** Leading "October 10th - " the venue types in front of the act. */
const LEAD_DATE = new RegExp(
  String.raw`^(?<month>${MONTH_ALT})\.?\s+(?<day>\d{1,2})(?:st|nd|rd|th)?\s*[-–—]\s*`,
  "i"
);

/** Trailing " - Prospect 772 Concert Series". The act is whatever sits between
 *  the date and this suffix, so a dash inside the band name stays in the act. */
const SERIES_TAIL =
  /\s*[-–—]\s*prospect\s+772(?:\s+winery)?(?:\s+concert\s+series)?\s*$/i;

const NOT_AN_ACT = new Set([
  "prospect 772",
  "prospect 772 winery",
  "prospect 772 concert series",
  "concert series",
]);

export interface ProspectShow {
  sourceEventId: string;
  act: string;
  /** "{Act} Live Music @ Prospect 772". Null when the act cannot title a row. */
  name: string;
  date: string;
  startTime: string;
  endTime: string | null;
  price: string | null;
  eventUrl: string | null;
  imageUrl: string | null;
  description: string | null;
}

/** First `featuredEventIds` string array in a CMS page document, de-duplicated
 *  in document order. An empty page (off season) returns []. */
export function featuredEventIds(page: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const rec = node as Record<string, unknown>;
    const ids = rec.featuredEventIds;
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === "string" && id.trim()) found.push(id.trim());
      }
    }
    for (const value of Object.values(rec)) walk(value);
  };
  walk(page);
  return [...new Set(found)];
}

/** Products request for one featured-id list. Event products only. */
export function squareProductsUrl(ids: readonly string[]): string {
  const url = new URL(PROSPECT_PRODUCTS_URL);
  url.searchParams.set("page", "1");
  url.searchParams.set("per_page", "50");
  url.searchParams.append("product_types[]", "event");
  for (const id of ids) url.searchParams.append("ids[]", id);
  return url.toString();
}

/**
 * Act from "October 10th - Breakaway - Prospect 772 Concert Series".
 * Returns null when the title is not that shape, or the middle token is a
 * placeholder / the venue itself. Never guesses an act out of a description.
 */
export function actFromProspectTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const flat = title.replace(/\s+/g, " ").trim();
  if (!SERIES_TAIL.test(flat)) return null;
  const dated = flat.replace(SERIES_TAIL, "").trim();
  if (!LEAD_DATE.test(dated)) return null;
  const act = dated.replace(LEAD_DATE, "").replace(/\s*[-–—]\s*$/, "").trim();
  if (!act) return null;
  const key = normalizeName(act);
  if (NOT_AN_ACT.has(key)) return null;
  if (!isNamedAct(act)) return null;
  const named = displayActName(act);
  return named || null;
}

/** Month and day the title states, for a cross-check against `start_date`.
 *  The title has no year. Null when the title is not the concert-series shape. */
export function titleMonthDay(
  title: string | null | undefined
): { month: number; day: number } | null {
  if (!title) return null;
  const flat = title.replace(/\s+/g, " ").trim();
  if (!SERIES_TAIL.test(flat)) return null;
  const dated = flat.replace(SERIES_TAIL, "").trim();
  const m = LEAD_DATE.exec(dated);
  if (!m?.groups) return null;
  const month = MONTHS[m.groups.month.toLowerCase().replace(/\.$/, "")];
  const day = Number(m.groups.day);
  if (!month || !day) return null;
  return { month, day };
}

function realIsoDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function noEndFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

/**
 * Date and clock from `product_type_details`. The structured fields are the
 * source; the title is only the act. Null when the start date is missing,
 * impossible, or a multi-day span (this schema is one date), or when the
 * start time is absent or ambiguous. An unstated end stays null.
 */
export function squareEventWhen(details: unknown): {
  date: string;
  startTime: string;
  endTime: string | null;
} | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  const date = typeof d.start_date === "string" ? d.start_date.trim() : "";
  if (!realIsoDate(date)) return null;
  const endDate = typeof d.end_date === "string" ? d.end_date.trim() : "";
  if (endDate && endDate !== date) return null;
  const startTime = parseStatedTime(typeof d.start_time === "string" ? d.start_time : null);
  if (!startTime) return null;
  const endTime = noEndFlag(d.has_no_end_time)
    ? null
    : parseStatedTime(typeof d.end_time === "string" ? d.end_time : null);
  return { date, startTime, endTime };
}

/** Stated ticket price. A single amount uses `low_formatted` ("$12.77").
 *  A real low/high split becomes "$10-$15" (hyphen, not an em dash).
 *  Null when the product states no formatted price. */
export function squareEventPrice(price: unknown): string | null {
  if (!price || typeof price !== "object") return null;
  const p = price as Record<string, unknown>;
  const lowFmt = typeof p.low_formatted === "string" ? p.low_formatted.trim() : "";
  if (!lowFmt) return null;
  const highFmt = typeof p.high_formatted === "string" ? p.high_formatted.trim() : "";
  const low = typeof p.low === "number" ? p.low : null;
  const high = typeof p.high === "number" ? p.high : null;
  if (low != null && high != null && low !== high && highFmt && highFmt !== lowFmt) {
    return `${lowFmt}-${highFmt}`;
  }
  return lowFmt;
}

/** Ticket permalink. Prefers `absolute_site_link`. A root-relative `site_link`
 *  is joined to the winery origin. Anything that is not https is dropped. */
export function squareEventPermalink(product: unknown): string | null {
  if (!product || typeof product !== "object") return null;
  const p = product as Record<string, unknown>;
  const absolute = typeof p.absolute_site_link === "string" ? p.absolute_site_link.trim() : "";
  if (/^https:\/\//i.test(absolute)) return absolute;
  const relative = typeof p.site_link === "string" ? p.site_link.trim() : "";
  if (relative && !/^[a-z][a-z0-9+.-]*:/i.test(relative)) {
    return `${PROSPECT_SITE_ORIGIN}/${relative.replace(/^\//, "")}`;
  }
  return null;
}

function squareImageUrl(product: Record<string, unknown>): string | null {
  const thumb = product.thumbnail;
  if (!thumb || typeof thumb !== "object") return null;
  const data = (thumb as Record<string, unknown>).data;
  if (!data || typeof data !== "object") return null;
  const url = (data as Record<string, unknown>).absolute_url;
  if (typeof url !== "string" || !/^https:\/\//i.test(url.trim())) return null;
  return url.trim();
}

/**
 * One Square event product → the row we want to write. Null (skip, do not
 * guess) when it is not a visible event, the act will not parse, the title's
 * month/day disagrees with `start_date`, or the clock is missing.
 */
export function mapProspectProduct(product: unknown): ProspectShow | null {
  if (!product || typeof product !== "object") return null;
  const p = product as Record<string, unknown>;
  const id = typeof p.id === "string" ? p.id.trim() : "";
  if (!id) return null;
  if (typeof p.visibility === "string" && p.visibility !== "visible") return null;
  if (typeof p.product_type === "string" && p.product_type !== "event") return null;

  const title = typeof p.name === "string" ? p.name : "";
  const act = actFromProspectTitle(title);
  if (!act) return null;
  const name = titleWithNamedAct(act, PROSPECT_CALENDAR_TITLE, PROSPECT_VENUE_NAME, PROSPECT_TOWN);
  if (!name) return null;

  const when = squareEventWhen(p.product_type_details);
  if (!when) return null;
  const titled = titleMonthDay(title);
  if (titled) {
    const month = Number(when.date.slice(5, 7));
    const day = Number(when.date.slice(8, 10));
    if (titled.month !== month || titled.day !== day) return null;
  }

  const description =
    typeof p.short_description === "string" && p.short_description.trim()
      ? htmlToText(p.short_description) || null
      : null;

  return {
    sourceEventId: id,
    act,
    name,
    date: when.date,
    startTime: when.startTime,
    endTime: when.endTime,
    price: squareEventPrice(p.price),
    eventUrl: squareEventPermalink(p),
    imageUrl: squareImageUrl(p),
    description,
  };
}

import { classifyEventCategory } from "../../lib/categorize.js";
import type { ExtractedEvent } from "./extract.js";

export type FeedFormat = "localist" | "tribe" | "rss" | "ical";

export interface FeedSource {
  slug: string;
  name: string;
  format: FeedFormat;
  endpoint: string;
  sourceUrl: string;
  defaultVenue: string;
  defaultTown: string;
  defaultAddress?: string;
  defaultCategory?: string;
  perPage?: number;
  maxPages?: number;
  days?: number;
  usePubDateAsEventDate?: boolean;
  enrichDetailJsonLd?: boolean;
  includeTitlePatterns?: string[];
  excludeTitlePatterns?: string[];
  includeLocationPatterns?: string[];
  excludeLocationPatterns?: string[];
  titleTransform?: "goducks";
  defaultPrice?: string;
}

export interface FetchFeedOptions {
  fetchImpl?: typeof fetch;
  today?: string;
}

const DEFAULT_PER_PAGE = 50;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_DAYS = 90;
const BOT_UA =
  "Mozilla/5.0 (compatible; ThisWeekInEugeneBot/0.1; +https://thisweekineugene.com)";

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
  "&hellip;": "...",
  "&ndash;": "-",
  "&mdash;": "-",
  "&lsquo;": "'",
  "&rsquo;": "'",
  "&ldquo;": '"',
  "&rdquo;": '"',
  "&bull;": "•",
};

export function decodeEntities(str: string): string {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-zA-Z]+;/g, (entity) => ENTITIES[entity] ?? entity);
}

export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = decodeEntities(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

function tagRe(tag: string): RegExp {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i");
}

function tagAllRe(tag: string): RegExp {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "gi");
}

function readTag(xml: string, tag: string): string | null {
  const m = tagRe(tag).exec(xml);
  return m ? decodeEntities(m[1]).trim() : null;
}

function readTags(xml: string, tag: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(tagAllRe(tag))) {
    const v = decodeEntities(m[1]).trim();
    if (v) out.push(v);
  }
  return out;
}

function attrValue(html: string, attr: string): string | null {
  const re = new RegExp(`${attr}=["']([^"']+)["']`, "i");
  const m = re.exec(html);
  return m ? decodeEntities(m[1]) : null;
}

function firstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s<>"')]+/);
  return m ? m[0] : null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = decodeEntities(value).replace(/\s+/g, " ").trim();
  return s || null;
}

function matchesAnyPattern(value: string | null | undefined, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) return false;
  const text = value ?? "";
  return patterns.some((pattern) => new RegExp(pattern, "i").test(text));
}

function passesSourceFilters(
  source: FeedSource,
  title: string,
  location?: string | null
): boolean {
  if (
    source.includeTitlePatterns?.length &&
    !matchesAnyPattern(title, source.includeTitlePatterns)
  ) {
    return false;
  }
  if (matchesAnyPattern(title, source.excludeTitlePatterns)) return false;

  if (
    source.includeLocationPatterns?.length &&
    !matchesAnyPattern(location ?? "", source.includeLocationPatterns)
  ) {
    return false;
  }
  if (matchesAnyPattern(location ?? "", source.excludeLocationPatterns)) return false;

  return true;
}

function cleanTitleForSource(title: string, source: FeedSource): string {
  if (source.titleTransform !== "goducks") return title;

  const withoutResult = title.replace(/^\[[A-Z]\]\s*/, "").trim();
  const rest = withoutResult.replace(/^Oregon,\s*University of\s+/, "");
  const sports = [
    "Acrobatics & Tumbling",
    "Baseball",
    "Beach Volleyball",
    "Cross Country",
    "Football",
    "Men's Basketball",
    "Men's Golf",
    "Men's Tennis",
    "Softball",
    "Track and Field",
    "Women's Basketball",
    "Women's Golf",
    "Women's Lacrosse",
    "Women's Soccer",
    "Women's Tennis",
    "Women's Volleyball",
  ];
  const sport = sports.find((name) =>
    new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(rest)
  );

  if (sport) {
    const opponent = rest.slice(sport.length).trim();
    return opponent ? `Oregon ${sport}: ${opponent}` : `Oregon ${sport}`;
  }

  return withoutResult.replace(/^Oregon,\s*University of\s+/, "Oregon ");
}

function sourceId(prefix: string, value: unknown, fallback: string): string {
  const raw = typeof value === "string" || typeof value === "number" ? String(value) : fallback;
  return `${prefix}:${raw}`;
}

function sourceDateTime(
  raw: string | null | undefined,
  allDay = false
): { date: string; time: string | null } | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const time =
    allDay || !m[2] ? null : `${m[2].padStart(2, "0")}:${m[3] ?? "00"}`;
  if (time === "00:00") return { date: m[1], time: null };
  return { date: m[1], time };
}

function joinAddress(parts: Array<string | null | undefined>): string | null {
  const clean = parts.map((p) => cleanText(p)).filter((p): p is string => !!p);
  if (clean.length === 0) return null;
  return clean.join(", ");
}

function townFromText(text: string | null | undefined, fallback: string): string {
  const lower = (text ?? "").toLowerCase();
  const towns = [
    "Eugene",
    "Springfield",
    "Veneta",
    "Creswell",
    "Cottage Grove",
    "Coburg",
    "Junction City",
    "Florence",
    "Oakridge",
  ];
  for (const town of towns) {
    const escaped = town.toLowerCase().replace(/\s+/g, "\\s+");
    if (new RegExp(`\\b(in|at|near)\\s+${escaped}\\b`).test(lower)) return town;
    if (new RegExp(`,\\s*${escaped}\\s*,?\\s*(or|oregon)\\b`).test(lower)) return town;
  }
  return towns.find((t) => lower.includes(t.toLowerCase())) ?? fallback;
}

function priceFromSignals(
  free: unknown,
  ticketCost: unknown,
  fallback: string | null = null
): string | null {
  const ticket = cleanText(ticketCost);
  if (ticket) return ticket;
  if (free === true) return "Free";
  return fallback;
}

function categoryFrom(source: FeedSource, parts: Array<string | null | undefined>): string {
  const text = parts.filter(Boolean).join(" ");
  const category = classifyEventCategory(text);
  return category === "other" && source.defaultCategory ? source.defaultCategory : category;
}

type LocalistEvent = {
  id?: number | string;
  title?: string;
  url?: string;
  localist_url?: string;
  description?: string | null;
  description_text?: string | null;
  location?: string | null;
  location_name?: string | null;
  room_number?: string | null;
  status?: string;
  private?: boolean;
  rejected?: boolean;
  free?: boolean;
  ticket_cost?: string | null;
  photo_url?: string | null;
  address?: string | null;
  geo?: { street?: string; city?: string; state?: string; zip?: string };
  filters?: Record<string, Array<{ name?: string }>>;
  event_instances?: Array<{
    event_instance?: {
      id?: number | string;
      start?: string;
      end?: string | null;
      all_day?: boolean;
    };
  }>;
  first_date?: string;
};

export function mapLocalistResponse(data: unknown, source: FeedSource): ExtractedEvent[] {
  const wrappers = Array.isArray((data as { events?: unknown[] }).events)
    ? (data as { events: Array<{ event?: LocalistEvent }> }).events
    : [];
  const events: ExtractedEvent[] = [];

  for (const wrapper of wrappers) {
    const ev = wrapper.event;
    if (!ev || ev.status !== "live" || ev.private || ev.rejected) continue;

    const title = cleanText(ev.title);
    if (!title) continue;

    const filterNames = Object.values(ev.filters ?? {})
      .flat()
      .map((f) => f.name)
      .filter((v): v is string => !!v);
    const instances =
      ev.event_instances?.map((i) => i.event_instance).filter(Boolean) ?? [];
    const fallbackInstance = ev.first_date
      ? [{ id: ev.id, start: `${ev.first_date}T00:00:00`, end: null, all_day: true }]
      : [];

    for (const inst of instances.length > 0 ? instances : fallbackInstance) {
      const start = sourceDateTime(inst?.start, inst?.all_day);
      if (!start) continue;
      const end = sourceDateTime(inst?.end ?? null, inst?.all_day);
      const venue = cleanText(ev.location_name) ?? cleanText(ev.location) ?? source.defaultVenue;
      const address =
        cleanText(ev.address) ??
        joinAddress([ev.geo?.street, ev.geo?.city, ev.geo?.state, ev.geo?.zip]) ??
        source.defaultAddress ??
        null;
      const town = ev.geo?.city ?? townFromText(address, source.defaultTown);
      const description = cleanText(ev.description_text) ?? htmlToText(ev.description);
      const url = cleanText(ev.localist_url) ?? cleanText(ev.url) ?? source.sourceUrl;

      events.push({
        name: title,
        description,
        date: start.date,
        start_time: start.time,
        end_time: end?.time ?? null,
        venue_name: venue,
        town,
        address,
        category: categoryFrom(source, [title, description, ...filterNames]),
        price: priceFromSignals(ev.free, ev.ticket_cost),
        artists: null,
        event_url: url,
        image_url: cleanText(ev.photo_url),
        source_event_id: sourceId(source.slug, inst?.id, `${ev.id ?? title}:${start.date}`),
      });
    }
  }

  return events;
}

type TribeEvent = {
  id?: number | string;
  status?: string;
  title?: string;
  description?: string | null;
  url?: string;
  start_date?: string;
  end_date?: string;
  all_day?: boolean;
  cost?: string | null;
  venue?: {
    venue?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  categories?: Array<{ name?: string; slug?: string }>;
  image?: { url?: string } | null;
};

export function mapTribeResponse(data: unknown, source: FeedSource): ExtractedEvent[] {
  const rows = Array.isArray((data as { events?: unknown[] }).events)
    ? ((data as { events: TribeEvent[] }).events)
    : [];

  return rows.flatMap((ev) => {
    if (ev.status !== "publish") return [];
    const title = cleanText(ev.title);
    const start = sourceDateTime(ev.start_date, ev.all_day);
    if (!title || !start) return [];
    const end = sourceDateTime(ev.end_date, ev.all_day);
    const venue = cleanText(ev.venue?.venue) ?? source.defaultVenue;
    const address =
      joinAddress([ev.venue?.address, ev.venue?.city, ev.venue?.state ?? "OR", ev.venue?.zip]) ??
      source.defaultAddress ??
      null;
    const town = cleanText(ev.venue?.city) ?? townFromText(address, source.defaultTown);
    const description = htmlToText(ev.description);
    const cats = (ev.categories ?? []).map((c) => c.name ?? c.slug ?? "");
    const cost = cleanText(ev.cost);

    return [{
      name: title,
      description,
      date: start.date,
      start_time: start.time,
      end_time: end?.time ?? null,
      venue_name: venue,
      town,
      address,
      category: categoryFrom(source, [title, description, ...cats]),
      price: cost || null,
      artists: null,
      event_url: cleanText(ev.url) ?? source.sourceUrl,
      image_url: cleanText(ev.image?.url),
      source_event_id: sourceId(source.slug, ev.id, `${title}:${start.date}`),
    }];
  });
}

function splitItems(xml: string): string[] {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
}

function dateFromText(text: string): string | null {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];

  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (numeric) {
    const [, month, day, year] = numeric;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const named = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/i
  );
  if (named) {
    const months = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];
    const month = months.indexOf(named[1].toLowerCase()) + 1;
    return `${named[3]}-${String(month).padStart(2, "0")}-${named[2].padStart(2, "0")}`;
  }

  return null;
}

function timeFromText(text: string): string | null {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ?? "00";
  const pm = /^p/i.test(m[3]);
  if (pm && hour < 12) hour += 12;
  if (!pm && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function rfc822DateOnly(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(20\d{2})\b/i);
  if (!m) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = months.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
  if (month === 0) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function rssDate(
  item: string,
  searchable: string,
  source: FeedSource
): { date: string; time: string | null } | null {
  if (source.usePubDateAsEventDate) {
    const pubDate = rfc822DateOnly(readTag(item, "pubDate"));
    if (pubDate) return { date: pubDate, time: null };
  }

  const dateTags = [
    "calendarEvent:StartDate",
    "calendarEvent:startDate",
    "event:startdate",
    "event:startDate",
    "dtstart",
    "startDate",
  ];
  for (const tag of dateTags) {
    const value = readTag(item, tag);
    const parsed = sourceDateTime(value) ?? (value ? { date: dateFromText(value), time: timeFromText(value) } : null);
    if (parsed?.date) return { date: parsed.date, time: parsed.time };
  }
  const date = dateFromText(searchable);
  if (!date) return null;
  return { date, time: timeFromText(searchable) };
}

function imageFromHtml(html: string): string | null {
  const dataImage = attrValue(html, "data-image");
  if (dataImage) return dataImage;
  const src = attrValue(html, "src");
  return src;
}

function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = decodeEntities(m[1]).trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Ignore malformed analytics/config blocks. Event detail pages often have
      // exactly one clean JSON-LD block, but we should not fail the feed on one.
    }
  }
  return blocks;
}

function flattenJsonLd(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const graph = obj["@graph"];
    return graph ? [obj, ...flattenJsonLd(graph)] : [obj];
  }
  return [];
}

function jsonLdTypeIncludes(obj: Record<string, unknown>, type: string): boolean {
  const raw = obj["@type"];
  if (Array.isArray(raw)) return raw.some((v) => String(v).toLowerCase() === type.toLowerCase());
  return String(raw ?? "").toLowerCase() === type.toLowerCase();
}

function firstString(value: unknown): string | null {
  if (typeof value === "string") return cleanText(value);
  if (Array.isArray(value)) return value.map(firstString).find(Boolean) ?? null;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return firstString(obj.url) ?? firstString(obj["@id"]);
  }
  return null;
}

function eventJsonLdFromHtml(html: string): Record<string, unknown> | null {
  for (const block of jsonLdBlocks(html)) {
    for (const node of flattenJsonLd(block)) {
      if (
        node &&
        typeof node === "object" &&
        jsonLdTypeIncludes(node as Record<string, unknown>, "Event")
      ) {
        return node as Record<string, unknown>;
      }
    }
  }
  return null;
}

export function enrichEventFromJsonLd(event: ExtractedEvent, html: string): ExtractedEvent {
  const jsonLd = eventJsonLdFromHtml(html);
  if (!jsonLd) return event;

  const location = jsonLd.location && typeof jsonLd.location === "object"
    ? (jsonLd.location as Record<string, unknown>)
    : null;
  const postal = location?.address && typeof location.address === "object"
    ? (location.address as Record<string, unknown>)
    : null;
  const venue = cleanText(location?.name) ?? event.venue_name;
  const address = postal
    ? joinAddress([
        postal.streetAddress as string | undefined,
        postal.addressLocality as string | undefined,
        postal.addressRegion as string | undefined,
        postal.postalCode as string | undefined,
      ]) ?? event.address
    : event.address;
  const town =
    cleanText(postal?.addressLocality) ??
    townFromText(address ?? event.description ?? "", event.town);
  const description = event.description ?? cleanText(jsonLd.description);

  return {
    ...event,
    description,
    venue_name: venue,
    town,
    address,
    image_url: event.image_url ?? firstString(jsonLd.image),
  };
}

export function parseRssFeed(xml: string, source: FeedSource): ExtractedEvent[] {
  const items = splitItems(xml);
  const events: ExtractedEvent[] = [];
  for (const item of items) {
    const title = readTag(item, "title");
    if (!title) continue;
    const link = readTag(item, "link") ?? source.sourceUrl;
    const descriptionHtml = readTag(item, "description") ?? "";
    const contentHtml = readTag(item, "content:encoded") ?? "";
    const contentText = htmlToText(contentHtml);
    const description = htmlToText(descriptionHtml) ?? contentText;
    const categories = readTags(item, "category");
    const guid = readTag(item, "guid") ?? link;
    const searchable = [title, link, descriptionHtml, contentHtml].join(" ");
    const start = rssDate(item, searchable, source);
    if (!start) continue;
    const address = source.defaultAddress ?? null;
    const town = townFromText(
      [description, contentText, link, address].filter(Boolean).join(" "),
      source.defaultTown
    );

    events.push({
      name: title,
      description,
      date: start.date,
      start_time: start.time,
      end_time: null,
      venue_name: source.defaultVenue,
      town,
      address,
      category: categoryFrom(source, [title, description, ...categories]),
      price: /\bfree\b/i.test(searchable) ? "Free" : null,
      artists: null,
      event_url: link,
      image_url: imageFromHtml(contentHtml || descriptionHtml),
      source_event_id: sourceId(source.slug, guid, `${title}:${start.date}`),
    });
  }
  return events;
}

function unfoldIcal(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function parseIcalProps(block: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const line of unfoldIcal(block)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const rawName = line.slice(0, idx).split(";")[0].toUpperCase();
    const value = line.slice(idx + 1).replace(/\\n/g, "\n").replace(/\\,/g, ",");
    props[rawName] = decodeEntities(value).trim();
  }
  return props;
}

function pacificDateTime(date: Date): { date: string; time: string | null } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
  };
}

function parseIcalDate(value: string | undefined): { date: string; time: string | null } | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
  if (!m) return null;
  if (m[4] && value.endsWith("Z")) {
    return pacificDateTime(
      new Date(Date.UTC(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5])
      ))
    );
  }
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: m[4] ? `${m[4]}:${m[5]}` : null,
  };
}

function cleanIcalLocation(location: string | undefined, source: FeedSource): {
  venue: string;
  address: string | null;
  town: string;
} {
  const clean = (htmlToText(location ?? "") ?? location ?? "")
    .replace(/\s+-\s+/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || /^-\s*eugene\s+or/i.test(clean) || /^eugene\s+or/i.test(clean)) {
    return {
      venue: source.defaultVenue,
      address: source.defaultAddress ?? null,
      town: source.defaultTown,
    };
  }
  const [venuePart, addressPart] = clean.split(" - ", 2);
  const venue = venuePart?.trim() || source.defaultVenue;
  const address = addressPart?.trim() || clean || source.defaultAddress || null;
  return {
    venue,
    address,
    town: townFromText(address, source.defaultTown),
  };
}

export function parseICalFeed(text: string, source: FeedSource): ExtractedEvent[] {
  const blocks = [...text.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)].map((m) => m[1]);
  const events: ExtractedEvent[] = [];
  for (const block of blocks) {
    const props = parseIcalProps(block);
    const rawTitle = cleanText(props.SUMMARY);
    const start = parseIcalDate(props.DTSTART);
    if (!rawTitle || !start) continue;
    if (!passesSourceFilters(source, rawTitle, props.LOCATION)) continue;
    const title = cleanTitleForSource(rawTitle, source);
    const end = parseIcalDate(props.DTEND);
    const location = cleanIcalLocation(props.LOCATION, source);
    const description = cleanText(props.DESCRIPTION);
    const eventUrl = firstUrl(description) ?? (props.URL?.startsWith("http") ? props.URL : source.sourceUrl);

    events.push({
      name: title,
      description,
      date: start.date,
      start_time: start.time,
      end_time: end?.time ?? null,
      venue_name: location.venue,
      town: location.town,
      address: location.address,
      category: categoryFrom(source, [title, description]),
      price: source.defaultPrice ?? (/\bfree\b/i.test(`${title} ${description ?? ""}`) ? "Free" : null),
      artists: null,
      event_url: eventUrl,
      image_url: null,
      source_event_id: sourceId(source.slug, props.UID, `${title}:${start.date}`),
    });
  }
  return events;
}

function withSearch(url: string, params: Record<string, string | number | undefined>): string {
  const u = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && !u.searchParams.has(key)) {
      u.searchParams.set(key, String(value));
    }
  }
  return u.toString();
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const resp = await fetchImpl(url, {
    headers: { "User-Agent": BOT_UA, Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`Feed request failed ${resp.status}: ${url}`);
  return resp.json();
}

async function fetchText(fetchImpl: typeof fetch, url: string): Promise<string> {
  const resp = await fetchImpl(url, {
    headers: { "User-Agent": BOT_UA, Accept: "*/*" },
  });
  if (!resp.ok) throw new Error(`Feed request failed ${resp.status}: ${url}`);
  return resp.text();
}

async function enrichDetailPages(
  fetchImpl: typeof fetch,
  events: ExtractedEvent[]
): Promise<ExtractedEvent[]> {
  const enriched: ExtractedEvent[] = [];
  for (const event of events) {
    if (!event.event_url?.startsWith("http")) {
      enriched.push(event);
      continue;
    }
    try {
      const html = await fetchText(fetchImpl, event.event_url);
      enriched.push(enrichEventFromJsonLd(event, html));
    } catch {
      enriched.push(event);
    }
  }
  return enriched;
}

export async function fetchFeedEvents(
  source: FeedSource,
  opts: FetchFeedOptions = {}
): Promise<ExtractedEvent[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const perPage = source.perPage ?? DEFAULT_PER_PAGE;
  const maxPages = source.maxPages ?? DEFAULT_MAX_PAGES;
  const days = source.days ?? DEFAULT_DAYS;

  if (source.format === "localist") {
    const events: ExtractedEvent[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const url = withSearch(source.endpoint, { days, pp: perPage, page });
      const data = await fetchJson(fetchImpl, url);
      const pageEvents = mapLocalistResponse(data, source);
      events.push(...pageEvents);
      const rawCount = Array.isArray((data as { events?: unknown[] }).events)
        ? (data as { events: unknown[] }).events.length
        : 0;
      if (rawCount < perPage) break;
    }
    return events;
  }

  if (source.format === "tribe") {
    const events: ExtractedEvent[] = [];
    const today = opts.today ?? new Date().toISOString().slice(0, 10);
    for (let page = 1; page <= maxPages; page++) {
      const url = withSearch(source.endpoint, { per_page: perPage, start_date: today, page });
      const data = await fetchJson(fetchImpl, url);
      const pageEvents = mapTribeResponse(data, source);
      events.push(...pageEvents);
      const rawCount = Array.isArray((data as { events?: unknown[] }).events)
        ? (data as { events: unknown[] }).events.length
        : 0;
      const totalPages = Number((data as { total_pages?: unknown }).total_pages ?? 0);
      if (rawCount < perPage || (totalPages > 0 && page >= totalPages)) break;
    }
    return events;
  }

  const text = await fetchText(fetchImpl, source.endpoint);
  if (source.format === "ical") return parseICalFeed(text, source);
  const events = parseRssFeed(text, source);
  return source.enrichDetailJsonLd ? enrichDetailPages(fetchImpl, events) : events;
}

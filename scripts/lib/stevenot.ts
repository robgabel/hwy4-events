/**
 * Stevenot Winery — the venue's own Tribe (The Events Calendar) feed.
 *
 * GoCalaveras is the only ingest today, and it is wrong (issue #373): the
 * Oct 25 Sunday show is stored as Perarez while Stevenot bills Skull Country,
 * the Halloween party is stored 7–10pm with no price while the feed says
 * 4–8pm and $25, and the later Sunday shows are missing.
 *
 * A naive copy of the Arnold Rim Trail scraper would INSERT those, because a
 * different act and a three-hour start gap both fail `isSameEvent`, and the
 * new titles would not share a `dedup_key` with the rows already on the site.
 * That leaves two cards, and a renamed Sunday title changes `generateEventSlug`.
 *
 * So this module pairs each feed event to a resident Stevenot row and says
 * which name to write:
 *   - same title (the Halloween party), or the same act under a shorter stored
 *     name (Greg Sutton / Gregory Sutton, Private Reserve / Private Reserve
 *     Band): keep the stored name byte for byte, so the public URL does not move;
 *   - a Sunday "Live Music @ Stevenot Winery" row whose act is a different
 *     band (Perarez): write "{Act} Live Music @ Stevenot Winery" onto THAT row.
 *     The old slug 301s through `pickFallbackEvent` (one Stevenot listing that
 *     day). A second Stevenot row the same day would make that 301 ambiguous,
 *     which is why the correction updates in place instead of inserting.
 *
 * The scraper omits `source_event_id` on a correction so GoCalaveras's EventON
 * id stays the exact-match key, and it clears `artists` in memory before
 * `buildExactMatchUpdate` when the act is wrong. That fill replaces the list.
 * The stock union would keep Perarez beside Skull Country.
 *
 * Town is Murphys. The feed's city is Vallecito, the winery's postal city, and
 * every stored row is already Murphys. Writing Vallecito would move the slug
 * town and the dedup key.
 *
 * Pure. The scraper in scripts/scrapers/stevenot.ts does the fetch. Tests must
 * not hit the network.
 */

import { artistIdentityKey } from "../../lib/artist-identity.js";
import { classifyEventCategory } from "../../lib/categorize.js";
import { normalizeName } from "../../lib/event-identity.js";
import { parseStatedTime } from "../../lib/verify-times.js";
import { decodeEntities, htmlToText, normalizeCost, splitDateTime } from "./tribe.js";

export const STEVENOT_API_URL = "https://www.stevenotwinery.com/wp-json/tribe/events/v1/events";
export const STEVENOT_PAGE_URL = "https://www.stevenotwinery.com/events/";
export const STEVENOT_VENUE_NAME = "Stevenot Winery";
export const STEVENOT_TOWN = "Murphys";
export const STEVENOT_ORG_SLUG = "stevenot";
export const STEVENOT_SOURCE_NAME = "Stevenot Winery";

/**
 * Identifying UA. Probed 2026-10-09: this string gets HTTP 200 JSON from the
 * Tribe endpoint. The shared Tribe client's Mozilla UA, and a Chrome UA, get
 * a SiteGround 403 page (no captcha challenge). The scraper uses this UA and
 * throws on anything that is not JSON. It does not call Firecrawl.
 */
export const STEVENOT_UA = "Hwy4EventsBot/1.0 (+https://hwy4events.com)";

const CLICK_HERE_TAIL = /\s*[–—-]\s*click here\s*$/i;
const SUNDAY_TITLE = /^(.+?)\s*[–—-]\s*free live music\s*$/i;
/** Stored public form, with or without an act in front. */
const STORED_SUNDAY = /^(.*?)\s*live music @ stevenot winery\s*$/i;

export interface StevenotShow {
  sourceEventId: string;
  /** Act on a Sunday live-music bill. Null for the party, the wine club, the open house. */
  act: string | null;
  /** Public title. Sunday bills are "{Act} Live Music @ Stevenot Winery". */
  name: string;
  date: string;
  startTime: string;
  endTime: string | null;
  price: string | null;
  eventUrl: string | null;
  imageUrl: string | null;
  description: string | null;
  sundayMusic: boolean;
}

export interface StevenotResident {
  id: string;
  name: string;
  date: string;
  start_time: string | null;
  artists?: string[] | null;
}

export interface StevenotAssignment<T extends StevenotResident = StevenotResident> {
  show: StevenotShow;
  resident: T | null;
  /** Name the row should carry. The stored name when the slug must not move. */
  nameToWrite: string;
  /**
   * True when the stored artists list is the wrong act. The caller passes the
   * resident to `buildExactMatchUpdate` with `artists: []` so the fill writes
   * this show's act instead of leaving the old one in place.
   */
  replaceArtists: boolean;
}

export function clockHHMM(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{2}:\d{2})/.exec(value.trim());
  return m ? m[1] : null;
}

function cleanTitle(title: string): string {
  return decodeEntities(title).replace(CLICK_HERE_TAIL, "").replace(/\s+/g, " ").trim();
}

/** Act from "Skull Country – FREE Live Music". Null when that is not the shape. */
function sundayAct(cleaned: string): string | null {
  const m = SUNDAY_TITLE.exec(cleaned);
  if (!m) return null;
  const act = m[1].replace(/\s+/g, " ").trim();
  if (act.length < 2) return null;
  if (/^stevenot(?:\s+winery)?$/i.test(act)) return null;
  return act;
}

/**
 * Drop a line that is only a "Click here" CTA, or a clock line whose start
 * disagrees with the structured start. The Halloween blurb still says
 * "7–10 PM" while `start_date` is 16:00. The card's clock is the structured
 * field (issue #373). Leaving the contradictory line in the description would
 * put the wrong time back on the page. A clock buried in a sentence (the
 * Sunday "1:00-4:00pm" food list) does not lead the line and stays.
 */
function descriptionText(html: string, startTime: string): string | null {
  const text = htmlToText(html);
  if (!text) return null;
  const kept = text.split("\n").filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^click here\b/i.test(trimmed)) return false;
    if (/^\d{1,2}(?::\d{2})?\s*[-–—]/.test(trimmed)) {
      const stated = parseStatedTime(trimmed);
      if (stated && stated !== startTime) return false;
    }
    return true;
  });
  const out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out || null;
}

function imageUrl(image: unknown): string | null {
  if (!image || typeof image !== "object") return null;
  const url = (image as { url?: unknown }).url;
  return typeof url === "string" && url.startsWith("http") ? url : null;
}

/** One Tribe event, or null when it is not a publishable Stevenot listing. */
export function mapStevenotEvent(raw: unknown): StevenotShow | null {
  if (!raw || typeof raw !== "object") return null;
  const ev = raw as Record<string, unknown>;
  if (ev.status !== "publish") return null;
  if (ev.hide_from_listings === true) return null;

  const title = typeof ev.title === "string" ? ev.title : "";
  const start = typeof ev.start_date === "string" ? ev.start_date : "";
  if (!title.trim() || !start) return null;

  const venueRec = ev.venue && typeof ev.venue === "object" ? (ev.venue as { venue?: unknown }) : null;
  const venueName = typeof venueRec?.venue === "string" ? venueRec.venue.trim() : "";
  if (venueName && !/stevenot/i.test(venueName)) return null;

  const allDay = ev.all_day === true;
  const { date, time: startTime } = splitDateTime(start, allDay);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !startTime) return null;
  const endRaw = typeof ev.end_date === "string" ? ev.end_date : "";
  const end = endRaw ? splitDateTime(endRaw, allDay) : null;
  if (end?.date && end.date !== date) return null;

  const cleaned = cleanTitle(title);
  const act = sundayAct(cleaned);
  const name = act ? `${act} Live Music @ ${STEVENOT_VENUE_NAME}` : cleaned;
  if (!name) return null;

  const id = ev.id;
  const sourceEventId = typeof id === "number" || typeof id === "string" ? String(id) : "";
  if (!sourceEventId) return null;

  const url = typeof ev.url === "string" && /^https?:\/\//i.test(ev.url) ? ev.url : null;
  const cost = typeof ev.cost === "string" ? ev.cost : null;
  const html = typeof ev.description === "string" ? ev.description : "";

  return {
    sourceEventId,
    act,
    name,
    date,
    startTime,
    endTime: end?.time ?? null,
    price: act ? "Free" : normalizeCost(cost),
    eventUrl: url,
    imageUrl: imageUrl(ev.image),
    description: descriptionText(html, startTime),
    sundayMusic: act !== null,
  };
}

/**
 * Category from the title when the title already classifies. A Halloween
 * description that mentions a DJ would otherwise take the soft live-music
 * rule ahead of "winery", and the party would leave `wine`. Sunday titles
 * contain "Live Music", so they are live_music from the name alone.
 */
export function categoryForStevenot(show: StevenotShow): ReturnType<typeof classifyEventCategory> {
  const fromName = classifyEventCategory(show.name);
  if (fromName !== "other") return fromName;
  return classifyEventCategory(show.name, show.description);
}

/** Act prefix of a stored "{Act} Live Music @ Stevenot Winery" title.
 *  Undefined when the title is not that shape. Null when it is the actless stem. */
function storedSundayAct(name: string): string | null | undefined {
  const m = STORED_SUNDAY.exec(name.trim());
  if (!m) return undefined;
  const prefix = m[1].trim();
  return prefix || null;
}

/** Same act, including "Private Reserve" / "Private Reserve Band" (identity key)
 *  and a short nickname ("Greg" / "Gregory": the longer word adds at most four
 *  letters). Not a general prefix: "Miss" must not match "Mississippi". */
export function actsCompatible(a: string, b: string): boolean {
  if (artistIdentityKey(a) === artistIdentityKey(b)) return true;
  const wa = normalizeName(a).split(" ").filter(Boolean);
  const wb = normalizeName(b).split(" ").filter(Boolean);
  if (wa.length === 0 || wa.length !== wb.length) return false;
  return wa.every((word, i) => {
    const other = wb[i];
    if (word === other) return true;
    const [short, long] = word.length <= other.length ? [word, other] : [other, word];
    return short.length >= 4 && long.startsWith(short) && long.length - short.length <= 4;
  });
}

function clocksEqual(a: string | null, b: string | null): boolean {
  const left = clockHHMM(a);
  const right = clockHHMM(b);
  return !!left && left === right;
}

interface PairScore {
  residentIndex: number;
  score: number;
  keepName: boolean;
}

function scoreResident(show: StevenotShow, resident: StevenotResident, residentIndex: number): PairScore | null {
  if (resident.date !== show.date) return null;
  const titleMatch = normalizeName(show.name) === normalizeName(resident.name);
  const storedAct = storedSundayAct(resident.name);
  const namedAct = typeof storedAct === "string" && storedAct ? storedAct : null;
  const actMatch = !!show.act && !!namedAct && actsCompatible(show.act, namedAct);
  const sundaySlot =
    show.sundayMusic &&
    storedAct !== undefined &&
    clocksEqual(show.startTime, resident.start_time);

  if (titleMatch) return { residentIndex, score: 100, keepName: true };
  if (actMatch) return { residentIndex, score: 80, keepName: true };
  if (sundaySlot) return { residentIndex, score: 40, keepName: false };
  return null;
}

/**
 * Pair each show to at most one resident. Highest score wins, so a row that
 * already carries the right act beats a same-day wrong-act leftover, and one
 * show cannot claim two rows. Unpaired shows are inserts.
 */
export function assignStevenotShows<T extends StevenotResident>(
  shows: readonly StevenotShow[],
  residents: readonly T[]
): StevenotAssignment<T>[] {
  const candidates: { showIndex: number; pair: PairScore }[] = [];
  shows.forEach((show, showIndex) => {
    residents.forEach((resident, residentIndex) => {
      const pair = scoreResident(show, resident, residentIndex);
      if (pair) candidates.push({ showIndex, pair });
    });
  });
  candidates.sort(
    (a, b) => b.pair.score - a.pair.score || a.showIndex - b.showIndex || a.pair.residentIndex - b.pair.residentIndex
  );

  const usedShows = new Set<number>();
  const usedResidents = new Set<number>();
  const chosen = new Map<number, { resident: T; keepName: boolean }>();
  for (const c of candidates) {
    if (usedShows.has(c.showIndex) || usedResidents.has(c.pair.residentIndex)) continue;
    usedShows.add(c.showIndex);
    usedResidents.add(c.pair.residentIndex);
    chosen.set(c.showIndex, { resident: residents[c.pair.residentIndex], keepName: c.pair.keepName });
  }

  return shows.map((show, i) => {
    const hit = chosen.get(i);
    const nameToWrite = hit?.keepName ? hit.resident.name : show.name;
    return {
      show,
      resident: hit?.resident ?? null,
      nameToWrite,
      replaceArtists: !!hit && !hit.keepName && !!show.act,
    };
  });
}

/** Resident snapshot for `buildExactMatchUpdate`. Times are HH:MM so a stored
 *  `13:00:00` (Postgres `time`) does not look like a change. A wrong act is
 *  presented as an empty list so the fill writes the feed's act. */
export function correctionSnapshot<T extends { start_time: string | null; end_time: string | null; artists?: string[] | null }>(
  resident: T,
  replaceArtists: boolean
): T {
  return {
    ...resident,
    start_time: clockHHMM(resident.start_time),
    end_time: clockHHMM(resident.end_time),
    ...(replaceArtists ? { artists: [] as string[] } : {}),
  };
}

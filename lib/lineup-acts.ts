// Act names that live on a lineup poster or a source subtitle, not in the
// calendar title (HWY-59).
//
// GoCalaveras titles a Murphys Irish Pub night "Live Music" (or "Live Music @
// Murphys Irish Pub") and hangs the whole week on one image. The band is on
// the poster, or in evcal_subtitle, which is artist/host text and must not be
// used as the venue. This module reads those two sources and stamps
// `discovered_act` on the row that already exists for that date. It never
// inserts a night the calendar did not list.
//
// The public title keeps the generic stem and the venue ("Kiana Chanelle Live
// Music @ Murphys Irish Pub") so the old live-music slug still shares enough
// tokens to resolve, and loses to a different same-day "Live Music @ …" row.
// The write path applies that title only while the stored name is still an
// actless placeholder, so a later generic scrape cannot revert it and a flaky
// second reading cannot rename the night. No name_locked column.

import {
  isActlessPlaceholderTitle,
  normalizeName,
  normalizeVenue,
} from "./event-identity";

export interface LineupNight {
  /** ISO date printed on the poster, or null when a flyer names an act and no date. */
  date: string | null;
  /** Billed performer. Null for open mic, an unreadable night, or a rejected token. */
  act: string | null;
  /** The night is an open mic. Not an act; the calendar row is left alone. */
  open_mic: boolean;
}

export interface LineupEvent {
  name: string;
  date: string;
  venue_name: string;
  town?: string | null;
  artists?: string[] | null;
  image_url?: string | null;
  /** Artist/host line from the source (GoCalaveras evcal_subtitle). Not a column. */
  source_subtitle?: string | null;
  /**
   * Act this run read off a poster or subtitle. Not a column. The upsert
   * applies it only while the calendar title is still an actless placeholder.
   */
  discovered_act?: string | null;
}

export interface ActAppend {
  date: string;
  from: string;
  to: string;
  artists: string[];
  via: "poster" | "subtitle";
}

export type LineupPosterReader = (
  imageUrl: string,
  hint: { years: number[] }
) => Promise<unknown>;

const NOT_AN_ACT = new Set([
  "live",
  "music",
  "live music",
  "live entertainment",
  "live tunes",
  "entertainment",
  "band",
  "bands",
  "tba",
  "tbd",
  "solo",
  "acoustic",
  "singer",
  "songwriter",
  "original music",
  "original music and covers",
  "covers",
  "good times",
  "all are welcome",
]);

const SMALL_WORDS = new Set(["and", "of", "the", "a", "an"]);

const SUBTITLE_PREFIX =
  /^(?:featuring|feat\.?|hosted by|host(?:ed)?|with|w\/)\s+/i;

/** Open mic is a format, not a billed act. "Open Mic Night" stays that shape. */
export function isOpenMicLabel(text: string): boolean {
  const n = normalizeName(text)
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^open mic( night)?$/.test(n);
}

/**
 * A performer name, not a role, a placeholder, or a poster slogan.
 * "Plan B" and "Blue Monday Band" pass. "Band", "acoustic", and "Live Music" do not.
 */
export function isNamedAct(text: string): boolean {
  const n = normalizeName(text)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (n.length < 2) return false;
  if (isOpenMicLabel(text)) return false;
  if (NOT_AN_ACT.has(n)) return false;
  if (
    /^(singer|songwriter|acoustic|band|trio)( (singer|songwriter|acoustic|band|trio))*$/.test(
      n
    )
  ) {
    return false;
  }
  return true;
}

/** Poster type is often all caps. Mixed case is left alone ("Plan B", "DJ Shadow"). */
export function displayActName(act: string): string {
  const trimmed = act.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  const shouted = letters.length > 0 && letters === letters.toUpperCase();
  if (!shouted) return trimmed;
  return trimmed
    .toLowerCase()
    .split(" ")
    .map((word, i) => {
      if (word === "&") return "&";
      const bare = word.replace(/[^a-z]/g, "");
      if (bare.length > 0 && bare.length <= 2 && !SMALL_WORDS.has(bare)) {
        return word.toUpperCase();
      }
      if (i > 0 && SMALL_WORDS.has(bare)) return word;
      return word.replace(/[a-z]/, (c) => c.toUpperCase());
    })
    .join(" ");
}

function actIsPlace(act: string, venue: string, town?: string | null): boolean {
  const core = normalizeVenue(act);
  if (!core) return false;
  if (venue && core === normalizeVenue(venue)) return true;
  if (town && normalizeName(act) === normalizeName(town)) return true;
  return false;
}

/**
 * Public title for an actless calendar row.
 * "Live Music @ Murphys Irish Pub" + "Kiana Chanelle" →
 * "Kiana Chanelle Live Music @ Murphys Irish Pub".
 * A bare "Live Music" picks up " @ {venue}" so the old slug's venue tokens survive.
 * Returns null when the row should not be retitled (already specific, open mic,
 * or the "act" is the venue).
 */
export function titleWithNamedAct(
  act: string,
  calendarName: string,
  venueName: string,
  town?: string | null
): string | null {
  const name = displayActName(act);
  if (!name || !isNamedAct(name) || isOpenMicLabel(name)) return null;
  if (actIsPlace(name, venueName, town)) return null;
  if (!isActlessPlaceholderTitle(calendarName)) return null;
  const cal = calendarName.trim().replace(/\s+/g, " ");
  const venue = venueName.trim();
  let titled = `${name} ${cal}`;
  const calNorm = normalizeName(cal);
  const venueNorm = normalizeVenue(venue);
  const venueInTitle =
    /@/.test(cal) || (venueNorm.length > 0 && calNorm.includes(normalizeName(venue)));
  const genericVenue =
    !venue || venueNorm === "unknown venue" || venueNorm === "tbd" || venueNorm === "tba";
  if (!venueInTitle && !genericVenue) {
    titled = `${titled} @ ${venue}`;
  }
  return titled.replace(/\s+/g, " ").trim();
}

/**
 * Artist/host subtitle → billed act. "Featuring Ali & Heidi Crooks" passes.
 * Open mic, a placeholder, the venue's own name, and a sentence do not.
 */
export function actFromSubtitle(
  subtitle: string | null | undefined,
  venueName?: string | null,
  town?: string | null
): string | null {
  if (!subtitle) return null;
  let s = subtitle
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  s = s
    .replace(
      /\s+\d{1,2}(?::\d{2})?\s*(?:-|–|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*$/i,
      ""
    )
    .trim();
  s = s.replace(SUBTITLE_PREFIX, "").trim();
  s = s.replace(/^[:\-–]\s*/, "").trim();
  s = s.replace(SUBTITLE_PREFIX, "").trim();
  if (!s || s.length > 80) return null;
  if (/[.!?]/.test(s)) return null;
  if (isOpenMicLabel(s) || !isNamedAct(s)) return null;
  if (isActlessPlaceholderTitle(s)) return null;
  if (actIsPlace(s, venueName ?? "", town)) return null;
  return displayActName(s);
}

/** Accept a model JSON array (or `{ nights: [...] }`). Drop anything that is not a printed act. */
export function parseLineupReading(raw: unknown): LineupNight[] {
  const arr = Array.isArray(raw)
    ? raw
    : raw &&
        typeof raw === "object" &&
        Array.isArray((raw as { nights?: unknown }).nights)
      ? (raw as { nights: unknown[] }).nights
      : [];
  const nights: LineupNight[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const date =
      typeof rec.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec.date)
        ? rec.date
        : null;
    const open =
      rec.open_mic === true ||
      (typeof rec.act === "string" && isOpenMicLabel(rec.act));
    let act: string | null = null;
    if (!open && typeof rec.act === "string") {
      const named = displayActName(rec.act);
      if (
        isNamedAct(named) &&
        !isOpenMicLabel(named) &&
        !isActlessPlaceholderTitle(named)
      ) {
        act = named;
      }
    }
    if (!date && !act && !open) continue;
    nights.push({ date, act: open ? null : act, open_mic: open });
  }
  return nights;
}

function yearsOf(events: { date: string }[]): number[] {
  const years = new Set<number>();
  for (const e of events) {
    const y = Number(e.date.slice(0, 4));
    if (y >= 2000 && y <= 2100) years.add(y);
  }
  return [...years];
}

/**
 * Instructions for the vision read. The model transcribes; it does not decide
 * the public title. Years are the only hint, so a misread day simply fails to
 * match a row instead of being pinned to a date we supplied.
 */
export function lineupPosterPrompt(years: number[]): string {
  const yearHint =
    years.length > 0
      ? `Dates on the poster may omit the year. Use ${years.join(" or ")}.`
      : "Dates on the poster may omit the year. If you cannot place the year, omit that night.";
  return `You transcribe a venue live-music poster. It may be a weekly lineup (several dated nights on one image) or a single-night flyer.

Return ONLY a JSON array. One object per night whose performer is printed:
{"date":"YYYY-MM-DD" or null,"act":"the billed performer" or null,"open_mic":false}

Rules:
- Copy only names and dates you can read on the image. If a night's act is unreadable, omit that night.
- Do not invent a band, a date, or a venue. A photo of a room, a logo, or a poster with no performer name returns [].
- Open mic / open mic night is not a person: {"date":"YYYY-MM-DD","act":null,"open_mic":true}.
- "Singer", "songwriter", "acoustic", and "original music & covers" are descriptions under a name, not the act.
- One billed name per night. "Ali & Heidi Crooks" is a single act. Do not split on &.
- ${yearHint} If the printed date cannot be placed, omit the night.
- A flyer that names one act and no date: one object with "date": null.`;
}

function stampAct<T extends LineupEvent>(
  event: T,
  act: string,
  via: ActAppend["via"]
): ActAppend | null {
  const name = displayActName(act);
  if (!name || !isNamedAct(name) || actIsPlace(name, event.venue_name, event.town)) {
    return null;
  }
  const titled = titleWithNamedAct(name, event.name, event.venue_name, event.town);
  if (!titled) {
    // Already specific. Fill a blank artists list only when this act already leads the title.
    if (
      normalizeName(event.name).startsWith(normalizeName(name)) &&
      !(event.artists ?? []).some((a) => a?.trim())
    ) {
      event.discovered_act = name;
      event.artists = [name];
      return {
        date: event.date,
        from: event.name,
        to: event.name,
        artists: [name],
        via,
      };
    }
    return null;
  }
  event.discovered_act = name;
  event.artists = [name];
  return {
    date: event.date,
    from: event.name,
    to: titled,
    artists: [name],
    via,
  };
}

/**
 * Match a reading onto the rows that already exist. A poster date with no row
 * is ignored. Two rows on the same date are left alone. Two acts for one date
 * are left alone. An open-mic night is left alone.
 */
export function applyLineupReading<T extends LineupEvent>(
  events: T[],
  nights: LineupNight[],
  via: ActAppend["via"] = "poster"
): ActAppend[] {
  const appended: ActAppend[] = [];
  const dated = nights.filter((n) => n.date);
  const byDate = new Map<string, LineupNight | "ambiguous">();
  for (const n of dated) {
    const key = n.date as string;
    if (byDate.has(key)) byDate.set(key, "ambiguous");
    else byDate.set(key, n);
  }

  const undatedActs = nights.filter((n) => !n.date && n.act && !n.open_mic);
  const onlyUndated =
    dated.length === 0 && undatedActs.length === 1 && events.length === 1;
  if (onlyUndated) {
    const hit = stampAct(events[0], undatedActs[0].act as string, via);
    if (hit) appended.push(hit);
    return appended;
  }

  const rowsByDate = new Map<string, T[]>();
  for (const e of events) {
    const list = rowsByDate.get(e.date) ?? [];
    list.push(e);
    rowsByDate.set(e.date, list);
  }
  for (const [date, group] of rowsByDate) {
    const night = byDate.get(date);
    if (!night || night === "ambiguous" || night.open_mic || !night.act) continue;
    if (group.length !== 1) continue;
    const hit = stampAct(group[0], night.act, via);
    if (hit) appended.push(hit);
  }
  return appended;
}

/**
 * Stamp discovered acts onto an ingest batch.
 * Shared image (2+ rows) → one poster read, matched by the date printed on it.
 * A shared image does not take a subtitle: one series subtitle must not name
 * every night of the week when the poster read fails.
 * A single row takes a subtitle first, then its own flyer if the title is
 * still an actless placeholder.
 */
export async function applyDiscoveredActs<T extends LineupEvent>(
  events: T[],
  readPoster: LineupPosterReader
): Promise<ActAppend[]> {
  const appended: ActAppend[] = [];
  const groups = new Map<string, T[]>();
  for (const e of events) {
    const url = e.image_url?.trim();
    if (!url) continue;
    const list = groups.get(url) ?? [];
    list.push(e);
    groups.set(url, list);
  }
  const shared = new Set<string>();
  for (const [url, group] of groups) {
    if (group.length < 2) continue;
    shared.add(url);
    if (!group.some((e) => isActlessPlaceholderTitle(e.name))) continue;
    let nights: LineupNight[] = [];
    try {
      nights = parseLineupReading(
        await readPoster(url, { years: yearsOf(group) })
      );
    } catch {
      nights = [];
    }
    appended.push(...applyLineupReading(group, nights, "poster"));
  }

  for (const e of events) {
    if (e.discovered_act) continue;
    if (!isActlessPlaceholderTitle(e.name)) continue;
    const url = e.image_url?.trim() ?? "";
    if (url && shared.has(url)) continue;
    const fromSubtitle = actFromSubtitle(e.source_subtitle, e.venue_name, e.town);
    if (fromSubtitle) {
      const hit = stampAct(e, fromSubtitle, "subtitle");
      if (hit) {
        appended.push(hit);
        continue;
      }
    }
    if (!url) continue;
    let nights: LineupNight[] = [];
    try {
      nights = parseLineupReading(
        await readPoster(url, { years: yearsOf([e]) })
      );
    } catch {
      nights = [];
    }
    appended.push(...applyLineupReading([e], nights, "poster"));
  }
  return appended;
}

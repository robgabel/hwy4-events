/**
 * Server-safe date-window helpers for the evergreen temporal pages
 * (/this-weekend, /this-week, /this-month).
 *
 * These run in server components on Vercel (UTC), but the corridor is in
 * Pacific time. Computing "today" / "this weekend" in UTC would roll over
 * to tomorrow at 5pm Pacific, skipping the evening's events. So all window
 * math is done against the Pacific civil date.
 *
 * Returns inclusive ISO date strings (YYYY-MM-DD) for use with Supabase
 * `.gte("date", start)` / `.lte("date", end)`.
 */

import { REGION } from "./region";

const TZ = REGION.timezone;

const DOW: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Current Pacific civil date + day-of-week, regardless of server TZ. */
export function pacificToday(): { iso: string; dow: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    iso: `${get("year")}-${get("month")}-${get("day")}`,
    dow: DOW[get("weekday")],
  };
}

/** Add n days to an ISO date string (anchored at noon UTC to dodge DST edges). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

export interface DateWindow {
  start: string; // inclusive ISO
  end: string; // inclusive ISO
}

/**
 * Classify an event's date relative to a Pacific "today" anchor, for the
 * homepage date-group labels ("Today", "Tomorrow", "This Friday").
 *
 * Pure + string-based (ISO dates compare lexicographically = chronologically),
 * so it returns the SAME answer on the server (UTC runtime) and the client (any
 * browser TZ) as long as both pass a Pacific `todayIso`/`dow` from
 * pacificToday(). This replaces the old browser-local isToday/isTomorrow, which
 * were computed with the UTC clock during SSR — mislabeling a Pacific-evening
 * event as "Tomorrow" and tripping a hydration mismatch when the client re-ran
 * them in local time (2026-07-02 review, P5). "this-week" preserves the prior
 * Sun–Sat calendar-week semantics (through this week's Saturday).
 */
export function pacificDateGroupKind(
  eventIso: string,
  todayIso: string,
  dow: number
): "today" | "tomorrow" | "this-week" | "future" {
  if (eventIso === todayIso) return "today";
  const tomorrowIso = addDays(todayIso, 1);
  if (eventIso === tomorrowIso) return "tomorrow";
  const saturdayIso = addDays(todayIso, 6 - dow); // Saturday of the current Sun–Sat week
  if (eventIso > tomorrowIso && eventIso <= saturdayIso) return "this-week";
  return "future";
}

/**
 * This weekend = Friday through Sunday.
 * Fri/Sat/Sun → the weekend in progress. Mon–Thu → the upcoming weekend.
 * Mirrors components/EventList.tsx::getThisWeekendRange so the dedicated
 * page and the homepage quick-filter agree.
 */
export function thisWeekendRange(today = pacificToday()): DateWindow {
  const { iso, dow } = today;
  if (dow === 5) return { start: iso, end: addDays(iso, 2) }; // Fri
  if (dow === 6) return { start: addDays(iso, -1), end: addDays(iso, 1) }; // Sat
  if (dow === 0) return { start: addDays(iso, -2), end: iso }; // Sun
  // Mon–Thu: next Friday is (5 - dow) days out
  const fri = addDays(iso, 5 - dow);
  return { start: fri, end: addDays(fri, 2) };
}

/** Sunday 6:00 PM Pacific. From here, /this-weekend points at the next weekend
 *  even if a late show is still on. */
export const NEXT_WEEKEND_FROM_MINUTE = 18 * 60;

export type PacificNow = {
  iso: string;
  dow: number;
  /** Minutes since Pacific midnight, 0–1439. */
  minutesOfDay: number;
};

/** Pacific civil date, weekday, and minutes since midnight for one instant. */
export function pacificNow(instant: Date = new Date()): PacificNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  let hour = parseInt(get("hour"), 10);
  const minute = parseInt(get("minute"), 10);
  // A few engines report midnight as 24:00.
  if (hour === 24) hour = 0;
  return {
    iso: `${get("year")}-${get("month")}-${get("day")}`,
    dow: DOW[get("weekday")],
    minutesOfDay: hour * 60 + minute,
  };
}

/**
 * The Friday–Sunday after `weekend`. `weekend.end` is that weekend's Sunday;
 * the next Friday is five days later. Does not change what "this weekend"
 * means. The canonical /this-weekend page keeps `thisWeekendRange`.
 */
export function nextWeekendRange(weekend: DateWindow): DateWindow {
  const start = addDays(weekend.end, 5);
  return { start, end: addDays(start, 2) };
}

/** Stay-overlay URL for the weekend after `weekend`. Same shape as HWY-40. */
export function nextWeekendPath(weekend: DateWindow): string {
  const next = nextWeekendRange(weekend);
  return `/this-weekend?from=${next.start}&to=${next.end}`;
}

/**
 * Show the next-weekend link on the canonical weekend page.
 *
 * True when nothing in the window is still on, or on that window's Sunday
 * from 6:00 PM Pacific even if a late show remains. Mon–Thu already list the
 * upcoming weekend, so the link stays off, unless this render is a cached
 * page still showing the weekend that just ended.
 */
export function shouldOfferNextWeekend(args: {
  pageRange: DateWindow;
  today: { iso: string; dow: number };
  minutesOfDay: number;
  stillOnCount: number;
}): boolean {
  const { pageRange, today, minutesOfDay, stillOnCount } = args;
  const weekendDay = today.dow === 5 || today.dow === 6 || today.dow === 0;
  const pageIsThisWeekend =
    today.iso >= pageRange.start && today.iso <= pageRange.end;
  const pageWeekendHasPassed = today.iso > pageRange.end;

  if (!weekendDay && !pageWeekendHasPassed) return false;
  if (weekendDay && !pageIsThisWeekend && !pageWeekendHasPassed) return false;

  if (stillOnCount === 0) return true;
  return (
    today.dow === 0 &&
    today.iso === pageRange.end &&
    minutesOfDay >= NEXT_WEEKEND_FROM_MINUTE
  );
}

/** One sentence above the next-weekend link. No em dashes. */
export function nextWeekendHandoffLead(args: {
  stillOnCount: number;
  listedCount: number;
  todayIso: string;
  pageRange: DateWindow;
}): string {
  if (args.stillOnCount > 0) return "A few things are still on tonight.";
  if (args.listedCount > 0) return "This weekend's events have wrapped up.";
  if (args.todayIso >= args.pageRange.start) {
    return "Nothing else is listed for the rest of this weekend.";
  }
  return "Nothing is listed this weekend yet.";
}

/** This week = today through the next 6 days (rolling 7-day window). */
export function thisWeekRange(): DateWindow {
  const { iso } = pacificToday();
  return { start: iso, end: addDays(iso, 6) };
}

/** This month = today through the last day of the current Pacific month. */
export function thisMonthRange(): DateWindow {
  const { iso } = pacificToday();
  const [y, m] = iso.split("-").map(Number);
  // Day 0 of next month = last day of this month.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start: iso, end };
}

// ─── Page config ────────────────────────────────────────────────────────

export type WindowKey = "weekend" | "week" | "month";

export interface TemporalConfig {
  key: WindowKey;
  path: string;
  /** Breadcrumb + nav label. */
  label: string;
  h1: string;
  /** Lead sentence shown under the H1, before the date-range line. */
  lead: string;
  metaTitle: string;
  metaDescription: string;
  getRange: () => DateWindow;
}

export const TEMPORAL_CONFIG: Record<WindowKey, TemporalConfig> = {
  weekend: {
    key: "weekend",
    path: "/this-weekend",
    label: "This Weekend",
    h1: "What's on this weekend on Hwy 4",
    lead: "The live weekend lineup along the Highway 4 corridor, from Angels Camp at the bottom of the hill to Bear Valley at the summit. One page you can send a guest.",
    metaTitle: "What's on this weekend on Hwy 4",
    metaDescription:
      "The live weekend lineup along the Highway 4 corridor, Angels Camp to Bear Valley. Live music, festivals, hikes, and community events. Updated daily.",
    getRange: thisWeekendRange,
  },
  week: {
    key: "week",
    path: "/this-week",
    label: "This Week",
    h1: "What's happening this week on the 4?",
    lead: "Every event along the Highway 4 corridor in the next seven days, from Angels Camp to Bear Valley.",
    metaTitle: "This Week on Highway 4 (Calaveras County Events)",
    metaDescription:
      "Every event in the next seven days along the Highway 4 corridor, Angels Camp to Bear Valley. Live music, festivals, community events. Updated daily.",
    getRange: thisWeekRange,
  },
  month: {
    key: "month",
    path: "/this-month",
    label: "This Month",
    h1: "What's happening this month on the 4?",
    lead: "Every event along the Highway 4 corridor through the end of the month, from Angels Camp to Bear Valley. Plan your weekends in the foothills.",
    metaTitle: "This Month on Highway 4 (Calaveras County Events)",
    metaDescription:
      "Every event this month along the Highway 4 corridor, Angels Camp to Bear Valley. Plan your trips to the Sierra foothills. Updated daily.",
    getRange: thisMonthRange,
  },
};

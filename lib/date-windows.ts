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

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "Fri, Oct 9". Noon UTC so the civil date's weekday does not depend on server TZ. */
function shortCivilDate(iso: string): string {
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return `${WEEKDAY_SHORT[dow]}, ${MONTH_SHORT[month - 1]} ${day}`;
}

export interface WeekendPreview {
  /** Friday of the previewed weekend, YYYY-MM-DD. */
  friday: string;
  /** Sunday of that weekend, YYYY-MM-DD. */
  sunday: string;
  /** "Fri, Oct 9 – Sun, Oct 11". The site_config label the refresh compares. */
  label: string;
}

/**
 * The weekend the homepage preview is written for. Distinct from
 * `thisWeekendRange`, which on Fri–Sun returns the weekend already underway.
 *
 * Mon–Thu: the coming Fri–Sun (the tab reads "This Weekend"). A midweek run
 * rewrites that same window.
 * Fri–Sun: the following Fri–Sun (the tab reads "Next Weekend"). The Friday
 * cron builds that preview; Sat/Sun stay on it so a manual re-run does not
 * jump back to the weekend in progress.
 *
 * Pacific civil date. The old route helper used the server clock, so a
 * Thursday evening (already Friday in UTC) previewed the week after.
 */
export function upcomingWeekendPreview(today = pacificToday()): WeekendPreview {
  const { iso, dow } = today;
  const daysToFriday =
    dow === 5 ? 7 : dow === 6 ? 6 : dow === 0 ? 5 : 5 - dow;
  const friday = addDays(iso, daysToFriday);
  const sunday = addDays(friday, 2);
  return {
    friday,
    sunday,
    label: `${shortCivilDate(friday)} \u2013 ${shortCivilDate(sunday)}`,
  };
}

/**
 * The Friday run is the one `briefing_history` row for a weekend. A later run
 * with the same label is a refresh of that Fri–Sun: rewrite the live text,
 * do not insert a second history row. Two rows for one weekend make the
 * anti-repetition lookback argue with the draft it is replacing, and a
 * Thursday insert would also overwrite that day's daily briefing.
 */
export function shouldArchiveWeekendBriefing(
  previousLabel: string | null | undefined,
  nextLabel: string
): boolean {
  return (previousLabel ?? "") !== nextLabel;
}

/**
 * Pacific civil date of a stored briefing timestamp, for the "Updated …" line.
 * The homepage renders on UTC; formatting without a zone would label a late
 * Pacific evening as the next day, and the stamp would not match the text.
 */
export function formatBriefingUpdated(generatedAt: string, timeZone = TZ): string {
  return new Date(generatedAt).toLocaleDateString("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
  });
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

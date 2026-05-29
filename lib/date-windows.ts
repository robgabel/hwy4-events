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

const TZ = "America/Los_Angeles";

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
 * This weekend = Friday through Sunday.
 * Fri/Sat/Sun → the weekend in progress. Mon–Thu → the upcoming weekend.
 * Mirrors components/EventList.tsx::getThisWeekendRange so the dedicated
 * page and the homepage quick-filter agree.
 */
export function thisWeekendRange(): DateWindow {
  const { iso, dow } = pacificToday();
  if (dow === 5) return { start: iso, end: addDays(iso, 2) }; // Fri
  if (dow === 6) return { start: addDays(iso, -1), end: addDays(iso, 1) }; // Sat
  if (dow === 0) return { start: addDays(iso, -2), end: iso }; // Sun
  // Mon–Thu: next Friday is (5 - dow) days out
  const fri = addDays(iso, 5 - dow);
  return { start: fri, end: addDays(fri, 2) };
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
    h1: "What's happening this weekend on the 4?",
    lead: "Every event along the Highway 4 corridor this weekend, from Angels Camp at the bottom of the hill to Bear Valley at the summit.",
    metaTitle: "This Weekend on Highway 4 (Calaveras County Events)",
    metaDescription:
      "Every event this weekend along the Highway 4 corridor, from Angels Camp to Bear Valley. Live music, festivals, lodge nights, and more. Updated daily.",
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

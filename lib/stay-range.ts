/**
 * Guest-stay date range for /this-weekend?from=&to= (HWY-40).
 *
 * Karen (absentee Airbnb host) pastes one URL into a welcome message.
 * This is a bounded overlay on the existing weekend temporal page, not a
 * new product: live rows only via getEventsInRange, never invented.
 *
 * Invalid / overlong / calendar-impossible input returns null so the page
 * falls back to this weekend. Custom ranges stay out of the sitemap.
 *
 * Relative imports so the scripts/ test runner can import this.
 */

import { addDays } from "./date-windows";

/** Inclusive calendar days. A 2-week stay is 15 days; 16 is the pad. */
export const STAY_MAX_DAYS = 16;

export const THIS_WEEKEND_PATH = "/this-weekend";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export type StayRange = {
  start: string;
  end: string;
  /** Inclusive day count (1 = a single day). */
  dayCount: number;
};

export type StayParams = {
  from?: string | null;
  to?: string | null;
};

/** Calendar-valid ISO date, or null. Refuses Feb 30 and absurd years. */
export function parseIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = ISO_DATE.exec(raw.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2020 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function inclusiveDayCount(start: string, end: string): number {
  const a = new Date(`${start}T12:00:00Z`).getTime();
  const b = new Date(`${end}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Parse a guest-stay window. Both ends required, start <= end, span
 * <= STAY_MAX_DAYS inclusive. Does not clamp to "today"; the upcoming
 * feed already drops past rows, so a mid-stay link stays honest.
 */
export function parseStayRange(params: StayParams): StayRange | null {
  const start = parseIsoDate(params.from);
  const end = parseIsoDate(params.to);
  if (!start || !end) return null;
  if (end < start) return null;
  const dayCount = inclusiveDayCount(start, end);
  if (dayCount < 1 || dayCount > STAY_MAX_DAYS) return null;
  return { start, end, dayCount };
}

/** Path a host pastes: /this-weekend?from=YYYY-MM-DD&to=YYYY-MM-DD */
export function stayHref(range: StayRange): string {
  return `${THIS_WEEKEND_PATH}?from=${range.start}&to=${range.end}`;
}

export function stayOgPath(range?: StayRange | null): string {
  if (!range) return "/og/weekend";
  return `/og/weekend?from=${range.start}&to=${range.end}`;
}

/** Short label for OG / title tags: "Mar 14 to 16". */
export function formatStayShort(range: StayRange): string {
  const a = splitIso(range.start);
  const b = splitIso(range.end);
  if (range.start === range.end) return `${MONTHS_SHORT[a.mo]} ${a.d}`;
  if (a.y === b.y && a.mo === b.mo) {
    return `${MONTHS_SHORT[a.mo]} ${a.d} to ${b.d}`;
  }
  return `${MONTHS_SHORT[a.mo]} ${a.d} to ${MONTHS_SHORT[b.mo]} ${b.d}`;
}

export function stayMeta(range: StayRange): {
  title: string;
  description: string;
} {
  const when = formatStayShort(range);
  return {
    title: `What's on Hwy 4, ${when}`,
    description: `Live events along the Highway 4 corridor ${when}, Angels Camp to Bear Valley. Updated daily.`,
  };
}

/** Last inclusive date still allowed for a given check-in. */
export function stayMaxEnd(start: string): string {
  return addDays(start, STAY_MAX_DAYS - 1);
}

function splitIso(iso: string): { y: number; mo: number; d: number } {
  const [y, mo, d] = iso.split("-").map(Number);
  return { y, mo: mo - 1, d };
}

/**
 * Recurrence expansion for hand-curated, rule-based schedules.
 *
 * Some venues publish their calendar as recurrence *rules* in prose, not as
 * dated rows: "Creek Critters: June 13th - August 15th, Tuesdays and Saturdays."
 * The scrapers can't read that, so we transcribe the rule once and expand it to
 * concrete dated occurrences here, in deterministic + tested code. The rule is
 * the human judgment; the dates are pure arithmetic. Keeping the two separate is
 * the whole point: an LLM (or a person) can get a rule wrong, but the date math
 * never should, so it lives here under a regression test.
 *
 * All math is done in UTC against `YYYY-MM-DD` strings so it can't drift with the
 * runner's local timezone (a `new Date("2026-06-13")` is midnight UTC; reading it
 * back with local getters in PST would report June 12).
 *
 * Used by scripts/lib/bigtrees-schedule.ts (and any future canonical seed).
 */

/** Day of week, matching `Date.getUTCDay()`: 0 = Sunday ... 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const SUN: Weekday = 0;
export const MON: Weekday = 1;
export const TUE: Weekday = 2;
export const WED: Weekday = 3;
export const THU: Weekday = 4;
export const FRI: Weekday = 5;
export const SAT: Weekday = 6;

/** Every day but Tuesday — the State Parks "daily except Tuesday" pattern. */
export const DAILY_EXCEPT_TUE: Weekday[] = [SUN, MON, WED, THU, FRI, SAT];
export const EVERY_DAY: Weekday[] = [SUN, MON, TUE, WED, THU, FRI, SAT];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

function parseISODateUTC(d: string): number {
  if (!ISO_DATE.test(d)) {
    throw new Error(`recurrence: expected YYYY-MM-DD, got "${d}"`);
  }
  const ms = Date.parse(`${d}T00:00:00.000Z`);
  if (Number.isNaN(ms)) {
    throw new Error(`recurrence: invalid date "${d}"`);
  }
  return ms;
}

function toISODateUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Every date in [startDate, endDate] (inclusive, both ends) whose weekday is in
 * `days`. Returns sorted `YYYY-MM-DD` strings. An empty range (end before start)
 * or empty `days` yields `[]`.
 */
export function expandWeekly(
  days: readonly Weekday[],
  startDate: string,
  endDate: string
): string[] {
  if (days.length === 0) return [];
  const want = new Set<number>(days);
  const start = parseISODateUTC(startDate);
  const end = parseISODateUTC(endDate);
  const out: string[] = [];
  for (let ms = start; ms <= end; ms += MS_PER_DAY) {
    if (want.has(new Date(ms).getUTCDay())) out.push(toISODateUTC(ms));
  }
  return out;
}

/**
 * Union of several date lists, deduped and sorted ascending. Use to combine the
 * sub-rules of a compound schedule, e.g. North Grove walks run weekends from
 * May 23, *then* daily June 15 - August 16.
 */
export function mergeDates(...lists: readonly string[][]): string[] {
  return [...new Set(lists.flat())].sort();
}

/** `base` minus any date in `remove`. For "Saturday campfires skip Night Skies nights." */
export function excludeDates(base: readonly string[], remove: readonly string[]): string[] {
  const drop = new Set(remove);
  return base.filter((d) => !drop.has(d));
}

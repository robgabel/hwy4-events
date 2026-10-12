/**
 * Bounds for a hand-expanded weekly series.
 *
 * Big Trees (#383) was the first: each program has a season end, and a re-seed
 * drops any date whose dedup_key is already cancelled so upsertEvents cannot
 * insert it again as confirmed. Every weekly generator uses this module.
 * expandWeekly still does the date math. expandWeeklyThrough is the call that
 * refuses a series with no end date.
 *
 * A cancelled row stays in hwy4_events (status = 'cancelled'). The skip is
 * what keeps a later seed from publishing that date again.
 */

import { generateDedupKey } from "../../lib/event-identity.js";
import { expandWeekly, type Weekday } from "./recurrence.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireSeasonEnd(seasonEnd: string): string {
  const end = seasonEnd.trim();
  if (!ISO_DATE.test(end)) {
    throw new Error(
      `weekly series requires a season end date (YYYY-MM-DD), got "${seasonEnd}"`
    );
  }
  return end;
}

/**
 * expandWeekly with a required season end. An empty or non-date end throws.
 * The end is inclusive, same as expandWeekly.
 */
export function expandWeeklyThrough(
  days: readonly Weekday[],
  startDate: string,
  seasonEnd: string
): string[] {
  return expandWeekly(days, startDate, requireSeasonEnd(seasonEnd));
}

/**
 * Drop occurrences whose dedup_key is already cancelled. upsertEvents writes
 * status only on INSERT, but a cancelled row the key lookup misses would be
 * inserted again as confirmed. The seed passes the cancelled keys it loaded
 * and never hands those dates to the writer.
 */
export function omitCancelledOccurrences<T extends { name: string; date: string; town: string }>(
  events: readonly T[],
  cancelledDedupKeys: ReadonlySet<string>
): T[] {
  if (cancelledDedupKeys.size === 0) return [...events];
  return events.filter((e) => !cancelledDedupKeys.has(generateDedupKey(e.name, e.date, e.town)));
}

/**
 * Keep dates on or before seasonEnd, then drop cancelled dedup_keys.
 * A date that is not YYYY-MM-DD is dropped: a weekly series does not emit it.
 */
export function boundWeeklySeries<T extends { name: string; date: string; town: string }>(
  events: readonly T[],
  opts: { seasonEnd: string; cancelledDedupKeys?: ReadonlySet<string> }
): T[] {
  const seasonEnd = requireSeasonEnd(opts.seasonEnd);
  const inSeason = events.filter((e) => ISO_DATE.test(e.date) && e.date <= seasonEnd);
  return omitCancelledOccurrences(inSeason, opts.cancelledDedupKeys ?? new Set());
}

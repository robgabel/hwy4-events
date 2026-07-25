/**
 * Ingest horizon for recurring series.
 *
 * The problem (measured 2026-07-25): Visit Murphys runs The Events Calendar,
 * which materializes a recurring event as a real post per occurrence — so its
 * feed offers weekly instances **two years out**. We ingested all of them: 104
 * rows of "Live Music Upstairs" at Boyle MacDonald, every one asserting a 6:00
 * PM start, running to 2028-07-21. Across the catalog that was 82 upcoming rows
 * past 12 months from just 4 recurring series.
 *
 * Two reasons that is wrong, not merely untidy:
 *  1. **Accuracy.** Nobody has confirmed that a given bar's trivia night starts
 *     at 6 PM on a Thursday in July 2028. The site states it as fact anyway.
 *     That is the same "asserted a time we don't actually know" failure as the
 *     stale sunset-hike times, just arriving from the other direction.
 *  2. **Crawl budget.** `PRD-search-indexing.md` blames exactly this population
 *     ("~70% near-duplicate recurring instances stretching to 2028") for the
 *     site-wide "Discovered – currently not indexed". The sitemap was trimmed
 *     then; the rows were never capped. This is the upstream fix.
 *
 * The rule is deliberately narrow, so it can only ever drop the low-information
 * tail of a *series*: an event is dropped only when it is BOTH beyond the
 * horizon AND one of many instances sharing a name + venue in the same batch. A
 * genuinely far-future one-off — next year's festival announced early — has a
 * tiny group and always survives.
 *
 * Pure + dependency-free so `scripts/test/ingest-horizon.test.ts` can lock it
 * without the Supabase env dance `dedup.ts` requires.
 */

/** Recurring instances further out than this are dropped at ingest. */
export const SERIES_HORIZON_DAYS = 365;

/**
 * How many same-name/same-venue instances in one batch make it a "series".
 * Below this, every instance is kept regardless of date — that's what protects
 * a far-future one-off from the cap.
 */
export const MIN_SERIES_SIZE = 6;

export interface HorizonEvent {
  name: string;
  date: string; // YYYY-MM-DD
  venue_name?: string | null;
}

export interface HorizonOptions {
  horizonDays?: number;
  minSeriesSize?: number;
  /** Today as YYYY-MM-DD. Injected so the test isn't clock-dependent. */
  today?: string;
}

export interface HorizonResult<T> {
  kept: T[];
  dropped: T[];
}

function seriesKey(e: HorizonEvent): string {
  const name = e.name.toLowerCase().replace(/\s+/g, " ").trim();
  const venue = (e.venue_name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return `${name}|${venue}`;
}

/** Add `days` to a YYYY-MM-DD date, returning YYYY-MM-DD. UTC math — these are
 *  plain calendar dates, so no timezone is involved. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Split a batch into the events to write and the far-future series instances to
 * drop. Never drops anything inside the horizon, and never drops a one-off.
 */
export function capSeriesHorizon<T extends HorizonEvent>(
  events: T[],
  opts: HorizonOptions = {}
): HorizonResult<T> {
  const horizonDays = opts.horizonDays ?? SERIES_HORIZON_DAYS;
  const minSeriesSize = opts.minSeriesSize ?? MIN_SERIES_SIZE;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const cutoff = addDays(today, horizonDays);

  const counts = new Map<string, number>();
  for (const e of events) {
    const k = seriesKey(e);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const kept: T[] = [];
  const dropped: T[] = [];
  for (const e of events) {
    const isSeries = (counts.get(seriesKey(e)) ?? 0) >= minSeriesSize;
    if (isSeries && e.date > cutoff) dropped.push(e);
    else kept.push(e);
  }
  return { kept, dropped };
}

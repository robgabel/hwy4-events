// Feed collapse: one card per real-world happening, not one per DB row.
//
// Two shapes of repetition clutter the homepage feed:
//   1. Multi-day runs — a festival or camp listed as N consecutive daily rows.
//   2. Recurring series — weekly classes and programs (storytime, guided walks,
//      trivia) that repeat for months, wallpapering the same card onto every
//      day-group. In a 60-day window the top ~30 series alone are ~2/3 of rows.
//
// Runs (span within a week, or a near-daily cadence over a longer span)
// collapse to a single DATE-RANGE card ("Jul 17 — Aug 2 · 13d"). Spaced series
// (weekly-ish cadence) collapse to their NEXT UPCOMING occurrence with a
// "Weekly"/"Repeats" chip — nothing is hidden, it's just said once, the way a
// neighbor would ("storytime is Wednesdays at 10:30"), and the cadence label is
// derived from the actual dated rows, never guessed.
//
// Pure module (no React) so scripts/test/collapse-events.test.ts can lock it.

import type { EventListItem, CollapsedEvent } from "./types";
import { parseDate, differenceInCalendarDays } from "./date-utils";
import { hasEventEnded } from "./event-time";

/** Consecutive-run suffixes some sources append per day of a multi-day event. */
export function getBaseName(name: string): string {
  return name
    .replace(/\s*-\s*Day\s*\d+$/i, "")
    .replace(/\s*\(through[^)]*\)$/i, "")
    .replace(/\s*\(Opening Day\)$/i, "")
    .trim();
}

// A group whose whole span fits in a week is a single happening (weekend
// festival, 3-day fair) regardless of cadence.
const MULTI_DAY_MAX_SPAN = 7;
// Longer-span groups need at least this many instances before we'll call them
// a series — two dates a month apart are just two events.
const SERIES_MIN_INSTANCES = 3;
// Median gap at or under this reads as a daily run (weekday camps skip
// weekends, so "daily" tolerates a gap of 2) → date-range card.
const DAILY_RUN_MAX_GAP = 2;
// Median gap in this band reads as a weekly cadence → "Weekly" chip.
const WEEKLY_GAP_MIN = 5;
const WEEKLY_GAP_MAX = 9;

function medianGapDays(sortedDates: string[]): number {
  const uniq = [...new Set(sortedDates)];
  if (uniq.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < uniq.length; i++) {
    gaps.push(
      differenceInCalendarDays(parseDate(uniq[i]), parseDate(uniq[i - 1]))
    );
  }
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

type GroupPlan = {
  // The instance whose position in the feed the collapsed card takes.
  anchorId: string;
  card: CollapsedEvent;
};

function rangeCard(baseName: string, sorted: EventListItem[]): CollapsedEvent {
  const allArtists = [...new Set(sorted.flatMap((e) => e.artists || []))];
  return {
    ...sorted[0],
    name: baseName,
    endDate: sorted[sorted.length - 1].date,
    dayCount: sorted.length,
    isCollapsed: true,
    artists: allArtists.length > 0 ? allArtists : sorted[0].artists,
  };
}

/**
 * Collapse a date-sorted upcoming-event list into feed cards. `nowMinutes` is
 * the Pacific clock from `nowPacificMinutes()` (null on the server / first
 * paint): a series card anchors to its first instance that hasn't ended, so at
 * 4 PM a 10:30 AM class shows next week's date, not a stale "today".
 * Supersedes EventList's old collapseMultiDayEvents (multi-day behavior kept:
 * runs of ≤7 days anchor to their first day and carry endDate/dayCount).
 */
export function collapseEventList(
  events: EventListItem[],
  nowMinutes: number | null
): CollapsedEvent[] {
  // Group by base name + town: recurring series repeat the same name, and the
  // town guard keeps a same-named event in two towns (e.g. two farmers
  // markets) from merging.
  const groups = new Map<string, { baseName: string; events: EventListItem[] }>();
  for (const event of events) {
    const baseName = getBaseName(event.name);
    const key = `${baseName}|${event.town}`;
    const group = groups.get(key);
    if (group) group.events.push(event);
    else groups.set(key, { baseName, events: [event] });
  }

  const plans = new Map<string, GroupPlan>();
  const collapsedKeys = new Set<string>();

  for (const [key, { baseName, events: group }] of groups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0
    );
    const span = differenceInCalendarDays(
      parseDate(sorted[sorted.length - 1].date),
      parseDate(sorted[0].date)
    );

    if (span <= MULTI_DAY_MAX_SPAN) {
      plans.set(key, { anchorId: sorted[0].id, card: rangeCard(baseName, sorted) });
      collapsedKeys.add(key);
      continue;
    }

    if (sorted.length < SERIES_MIN_INSTANCES) continue;

    const gap = medianGapDays(sorted.map((e) => e.date));
    if (gap <= DAILY_RUN_MAX_GAP) {
      // A weeks-long near-daily run (festival nightly rows, a weekday summer
      // camp) is one happening with a date range, same as the short runs.
      plans.set(key, { anchorId: sorted[0].id, card: rangeCard(baseName, sorted) });
      collapsedKeys.add(key);
      continue;
    }

    // Spaced series: show the next occurrence that hasn't ended. If every
    // instance has ended (or the clock isn't known yet), anchor to the first —
    // the caller's ended-events filter handles the rest.
    let anchorIdx = 0;
    if (nowMinutes !== null) {
      const idx = sorted.findIndex(
        (e) => !hasEventEnded(e.date, e.start_time, e.end_time, nowMinutes)
      );
      if (idx > 0) anchorIdx = idx;
    }
    const anchor = sorted[anchorIdx];
    plans.set(key, {
      anchorId: anchor.id,
      card: {
        ...anchor,
        seriesCount: sorted.length - anchorIdx,
        seriesCadence:
          gap >= WEEKLY_GAP_MIN && gap <= WEEKLY_GAP_MAX ? "weekly" : "recurring",
      },
    });
    collapsedKeys.add(key);
  }

  // Emit in input (chronological) order: the collapsed card takes its anchor
  // instance's slot; every other member row disappears.
  const result: CollapsedEvent[] = [];
  for (const event of events) {
    const key = `${getBaseName(event.name)}|${event.town}`;
    if (!collapsedKeys.has(key)) {
      result.push(event);
      continue;
    }
    const plan = plans.get(key)!;
    if (event.id === plan.anchorId) result.push(plan.card);
  }
  return result;
}

/**
 * The "Highlights" lens for the homepage view toggle — deterministic and
 * explainable, no scores: it removes the recurring regulars (weekly classes,
 * standing trivia/bingo nights) and keeps every distinct happening. A curated
 * pick or a festival always stays, and a recurring live-music night with a
 * named act stays too (a real band this week is a real event this week).
 * Runs on the COLLAPSED cards, after collapseEventList.
 */
export function isHighlightEvent(event: CollapsedEvent): boolean {
  if (event.robs_pick) return true;
  if (event.category === "festival") return true;
  const recurring = event.is_weekly || event.seriesCadence !== undefined;
  if (!recurring) return true;
  return (
    event.category === "live_music" && (event.artists?.length ?? 0) > 0
  );
}

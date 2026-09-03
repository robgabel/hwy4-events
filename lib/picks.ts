/**
 * Selection logic for the homepage curation modules: the "If you do one thing
 * this week" spotlight and the Rob's Picks row. Pure so the ritual's rules are
 * testable: the spotlight only claims "this week" when a pick actually falls
 * inside the next SPOTLIGHT_WINDOW_DAYS (Pacific), the row never exceeds
 * MAX_PICK_CARDS (curation is editing, not a second feed), and two rules added
 * 2026-07-05:
 *
 * 1. Time-aware: a pick that has already ENDED (per the shared hasEventEnded,
 *    the same predicate the "Up Next" badge uses) drops out, so a 10 AM–4 PM
 *    festival stops being "the one thing this week" at 4 PM, not at midnight.
 *
 * 2. Guide-aware: a live festival guide (lib/event-guides.ts) is itself a pick
 *    entry covering the festival's whole run [startDate, hideAfter]. It renders
 *    as a date range, links to the guide page, stays highlighted while the
 *    festival is in progress (the umbrella event row falls out of the upcoming
 *    feed after opening day, so it cannot carry this), and ABSORBS any
 *    robs_pick event row it matches (umbrella or nightly), so the highlight is
 *    always the festival page, never one night of it.
 *
 * Locked by scripts/test/picks.test.ts.
 */

import { hasEventEnded } from "./event-time";
import type { FestivalGuide } from "./event-guides";

export const SPOTLIGHT_WINDOW_DAYS = 7;
export const MAX_PICK_CARDS = 4;

export type PickCandidate = {
  name: string;
  date: string; // YYYY-MM-DD
  start_time?: string | null;
  end_time?: string | null;
  robs_pick?: boolean | null;
  sold_out?: boolean | null;
  visibility?: string | null;
  venue_key?: string | null;
};

/** A selected highlight: either a curated event row or a live festival guide.
 *  `date` is the entry's sort/window anchor (an in-progress guide anchors to
 *  today, so it sorts as "now" and always qualifies for the spotlight). */
export type PickEntry<T extends PickCandidate> =
  | { kind: "event"; event: T; date: string }
  | { kind: "guide"; guide: FestivalGuide; date: string; inProgress: boolean };

/** Add days to a YYYY-MM-DD string without timezone drift (noon-UTC anchor). */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function selectPicks<T extends PickCandidate>(
  events: T[],
  todayIso: string,
  nowMinutes: number,
  guides: FestivalGuide[] = []
): { spotlight: PickEntry<T> | null; picks: PickEntry<T>[] } {
  const liveGuides = guides.filter((g) => todayIso <= g.hideAfter);

  const eventEntries: PickEntry<T>[] = events
    .filter(
      (e) =>
        e.robs_pick === true &&
        // A sold-out event is not a recommendation. Belt-and-braces next to
        // clearing robs_pick by hand: whichever one is done, it drops out.
        e.sold_out !== true &&
        e.visibility === "public" &&
        e.date >= todayIso &&
        // Ended picks are not recommendations. hasEventEnded: known end → over
        // at the end time; no end → assumed 4h from start; timeless all-day →
        // runs to end of day; malformed times → never hidden.
        !hasEventEnded(
          e.date,
          e.start_time ?? null,
          e.end_time ?? null,
          nowMinutes
        ) &&
        // Absorbed by a live guide: the guide card represents the festival, so
        // neither the umbrella row nor a picked nightly show renders alongside.
        !liveGuides.some((g) =>
          g.matchEvent({ venue_key: e.venue_key ?? null, name: e.name })
        )
    )
    .map((e) => ({ kind: "event" as const, event: e, date: e.date }));

  const guideEntries: PickEntry<T>[] = liveGuides.map((g) => {
    const inProgress = g.startDate <= todayIso;
    return {
      kind: "guide" as const,
      guide: g,
      inProgress,
      date: inProgress ? todayIso : g.startDate,
    };
  });

  // Guides listed first so an in-progress festival outranks a same-date event
  // pick (the sort is stable, so ties keep this order). The shared feed arrives
  // date-sorted; sort defensively anyway.
  const sorted = [...guideEntries, ...eventEntries].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );

  const horizon = addDaysIso(todayIso, SPOTLIGHT_WINDOW_DAYS);
  const spotlight =
    sorted.length > 0 && sorted[0].date <= horizon ? sorted[0] : null;
  const rest = spotlight ? sorted.slice(1) : sorted;
  return { spotlight, picks: rest.slice(0, MAX_PICK_CARDS) };
}

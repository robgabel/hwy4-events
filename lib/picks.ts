/**
 * Selection logic for the homepage curation modules: the "If you do one thing
 * this week" spotlight and the Rob's Picks row. Pure so the ritual's rules are
 * testable: the spotlight only claims "this week" when a pick actually falls
 * inside the next SPOTLIGHT_WINDOW_DAYS (Pacific), and the row never exceeds
 * MAX_PICK_CARDS — curation is editing, not a second feed.
 * Locked by scripts/test/picks.test.ts.
 */

export const SPOTLIGHT_WINDOW_DAYS = 7;
export const MAX_PICK_CARDS = 4;

export type PickCandidate = {
  date: string; // YYYY-MM-DD
  robs_pick?: boolean | null;
  visibility?: string | null;
};

/** Add days to a YYYY-MM-DD string without timezone drift (noon-UTC anchor). */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function selectPicks<T extends PickCandidate>(
  events: T[],
  todayIso: string
): { spotlight: T | null; picks: T[] } {
  const upcoming = events.filter(
    (e) =>
      e.robs_pick === true && e.visibility === "public" && e.date >= todayIso
  );
  // The shared feed arrives date-sorted; sort defensively anyway (stable, so
  // same-date picks keep the feed's start-time order).
  const sorted = [...upcoming].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );

  const horizon = addDaysIso(todayIso, SPOTLIGHT_WINDOW_DAYS);
  const spotlight =
    sorted.length > 0 && sorted[0].date <= horizon ? sorted[0] : null;
  const rest = spotlight ? sorted.slice(1) : sorted;
  return { spotlight, picks: rest.slice(0, MAX_PICK_CARDS) };
}

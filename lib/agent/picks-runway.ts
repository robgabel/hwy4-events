// Rob's Picks runway signal for the chief-of-staff digest.
//
// robs_pick is 100% hand-curated (no agent or cron ever sets it), so nothing
// stops the homepage picks module from quietly going empty when the last
// flagged event passes. This computes how many days of curated runway remain
// (counting a live festival guide, which keeps the section filled through its
// run) and provides the deterministic digest item the daily chief-of-staff
// appends when the runway is short or already gone. Deterministic on purpose:
// the reasoner is also told about the signal, but the nudge must not depend on
// the model choosing to mention it.
//
// Pure and relative-imported so scripts/test/picks-runway.test.ts can lock it.

import type { FestivalGuide } from "../event-guides";
import type { Digest, DigestItem } from "./types";

/** Warn when the picks section will be empty within this many days. */
export const PICKS_RUNWAY_WARN_DAYS = 7;

export type PicksRunway = {
  /** Public robs_pick rows dated today or later. */
  upcoming_picks: number;
  /** Date of the furthest-out upcoming pick (null when none). */
  last_pick_date: string | null;
  /** Closing day of the furthest live festival guide (null when none live). */
  live_guide_until: string | null;
  /**
   * Days until the homepage picks section goes empty: 0 = today is the last
   * day with content, null = it is empty right now.
   */
  runway_days: number | null;
};

function daysBetween(fromIso: string, toIso: string): number {
  const ms =
    Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function computePicksRunway(
  todayIso: string,
  upcomingPicks: number,
  lastPickDate: string | null,
  guides: FestivalGuide[]
): PicksRunway {
  const liveEnds = guides
    .filter((g) => todayIso <= g.hideAfter)
    .map((g) => g.hideAfter)
    .sort()
    .pop() ?? null;

  const candidates = [lastPickDate, liveEnds].filter(
    (d): d is string => d !== null && d >= todayIso
  );
  const lastContentDate = candidates.sort().pop() ?? null;

  return {
    upcoming_picks: upcomingPicks,
    last_pick_date: lastPickDate,
    live_guide_until: liveEnds,
    runway_days: lastContentDate ? daysBetween(todayIso, lastContentDate) : null,
  };
}

/** The needs_you item a short/empty runway earns, or null when healthy. */
export function picksRunwayItem(runway: PicksRunway): DigestItem | null {
  if (runway.runway_days === null) {
    return {
      title: "Homepage Rob's Picks is empty",
      detail:
        "No upcoming event is flagged robs_pick and no festival guide is live, so the homepage spotlight and picks row are not rendering. Flag an upcoming event (robs_pick=true) to bring the section back.",
      why: "The picks module is the homepage's curation layer. Empty means returning locals get no spotlight.",
    };
  }
  if (runway.runway_days > PICKS_RUNWAY_WARN_DAYS) return null;
  const when =
    runway.runway_days === 0
      ? "today"
      : runway.runway_days === 1
        ? "in 1 day"
        : `in ${runway.runway_days} days`;
  const last =
    [runway.last_pick_date, runway.live_guide_until]
      .filter((d): d is string => d !== null)
      .sort()
      .pop() ?? "";
  return {
    title: `Rob's Picks runs dry ${when}`,
    detail: `The last scheduled highlight is ${last}. After that the homepage picks section disappears until a new robs_pick is flagged (or a festival guide goes live).`,
    why: "The picks module is the homepage's curation layer. Flagging one event now keeps the weekly ritual unbroken.",
  };
}

/**
 * Deterministic backstop: make sure a digest carries the runway nudge when one
 * is warranted. Skips if any bucket already mentions the picks module (the
 * reasoner may have covered it from the same signal). Mutates in place, same
 * pattern as the route's link-strip guard.
 */
export function ensurePicksRunwayItem(digest: Digest, runway: PicksRunway): void {
  const item = picksRunwayItem(runway);
  if (!item) return;
  const mentioned = [digest.needs_you, digest.fyi, digest.watching].some(
    (bucket) =>
      bucket.some((i) => /rob'?s picks|robs_pick/i.test(`${i.title} ${i.detail}`))
  );
  if (!mentioned) digest.needs_you.push(item);
}

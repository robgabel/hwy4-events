// Which status='cancelled' rows the weekend briefing may call cancelled.
//
// Since dedup v2 Phase 0 (docs/subsystems/dedup.md), `status='cancelled'` is
// also the merge tombstone: a duplicate loser is cancelled, not deleted, so
// the next scrape updates it instead of re-inserting it. A reader that
// surfaces cancellations therefore has to tell a tombstone from an organizer
// cancellation, or it tells readers a live event is off (issue #405: the
// weekend briefing called the Murphys Gathering, a Rob's Pick, cancelled).
//
// Two tests, either one drops the row:
//   1. the merge log names it (`event_merge_log.merged_from_id`), the exact
//      signal every automated and Phase 0 merge leaves behind;
//   2. a non-cancelled row on the same date and town carries a similar name,
//      so a hand tombstone made without a log row cannot leak either.
// A real cancellation dropped by test 2 costs one sentence of briefing; a
// tombstone that leaks costs a reader a Saturday. Blank beats wrong.

import { normalizeTown, textSimilarity } from "./event-identity";

export type CancelledRow = {
  id: string;
  name: string;
  date: string;
  venue_name: string | null;
  town: string | null;
};

export type LiveRow = {
  name: string;
  date: string;
  town: string | null;
};

/** `textSimilarity` floor for "the same title, written twice". */
export const TOMBSTONE_NAME_SIMILARITY = 0.6;
/** Or this many distinctive title tokens in common (town and filler removed). */
export const TOMBSTONE_SHARED_TOKENS = 2;

const FILLER_TOKENS = new Set([
  "a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to",
  "with", "live", "music", "event", "events", "night", "day", "california",
  "ca", "county", "calaveras",
]);

function distinctiveTokens(name: string, town: string | null): Set<string> {
  const townTokens = new Set(
    (town ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  );
  return new Set(
    name
      .toLowerCase()
      .replace(/[‘’ʼ′']/g, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !FILLER_TOKENS.has(t) && !townTokens.has(t))
  );
}

/** Token match as in lib/events.ts: equal, or a ≥4-char prefix of the other. */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

/** Pure: does a live row read as the same event under a different title? */
export function looksLikeSurvivor(cancelled: CancelledRow, live: LiveRow): boolean {
  if (cancelled.date !== live.date) return false;
  if (normalizeTown(cancelled.town) !== normalizeTown(live.town)) return false;
  if (textSimilarity(cancelled.name, live.name) >= TOMBSTONE_NAME_SIMILARITY) {
    return true;
  }
  const a = distinctiveTokens(cancelled.name, cancelled.town);
  const b = [...distinctiveTokens(live.name, live.town)];
  let shared = 0;
  for (const t of a) if (b.some((u) => tokensMatch(t, u))) shared++;
  return shared >= TOMBSTONE_SHARED_TOKENS;
}

/**
 * Pure: the cancelled rows that are organizer cancellations, not merge
 * tombstones. `tombstoneIds` is every `event_merge_log.merged_from_id` among
 * the candidates; `live` is the window's non-cancelled rows.
 */
export function realCancellations<T extends CancelledRow>(
  cancelled: T[],
  tombstoneIds: Iterable<string>,
  live: LiveRow[]
): T[] {
  const logged = new Set(tombstoneIds);
  return cancelled.filter(
    (c) => !logged.has(c.id) && !live.some((l) => looksLikeSurvivor(c, l))
  );
}

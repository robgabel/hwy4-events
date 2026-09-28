/**
 * Time comparison for `/api/verify-events` — the generic drift detector.
 *
 * Why (2026-07-25): the Arnold Rim Trail sunset hike showed 5:45 PM on the day
 * the organizer was running it at 6:15. Our row came from an aggregator that
 * snapshots a listing once; ART had moved the time five days earlier. Nothing in
 * the system compared our stored time against the organizer's page — the daily
 * verifier checked only that the DATE appeared. This is the missing half.
 *
 * The governing rule is the codebase's never-guess policy, same as
 * `/api/extract-prices`: **a page that does not state a time flags nothing.**
 * Only a stated, differing time is evidence. Silence is not a mismatch, because
 * a false flag costs a human a trip through the queue and teaches them to
 * ignore it.
 *
 * Pure + dependency-free so `scripts/test/verify-times.test.ts` can lock it.
 */

export type TimeVerdict =
  /** Page states a time and it agrees with ours. */
  | "match"
  /** Page states a time and it differs from ours — the actionable case. */
  | "mismatch"
  /** Page states no time (or ours is absent). Never actionable. */
  | "unknown";

const NOON_MIDNIGHT: Record<string, string> = {
  noon: "12:00",
  midday: "12:00",
  midnight: "00:00",
};

/**
 * Parse a human- or model-emitted time into canonical "HH:MM" (24h).
 *
 * Deliberately liberal about input, because it reads both our own DB values
 * ("18:15:00") and whatever the model lifted off an organizer's page
 * ("6:15 PM", "6pm", "6:15pm - 9:30pm", "Noon"). Returns null when there is no
 * unambiguous clock time — which routes to the "unknown" verdict, not a flag.
 *
 * For a range ("6-8pm", "11:00 am - 5:00 pm") it returns the START, which is
 * the field we compare.
 */
export function parseStatedTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s || s === "(unknown)" || s === "null" || s === "none" || s === "n/a") return null;

  if (NOON_MIDNIGHT[s]) return NOON_MIDNIGHT[s];

  // Range where only the END carries a meridiem ("6-8pm"): the start inherits
  // it, but ONLY when the reading is unambiguous. "6-8pm" is plainly 6 PM,
  // whereas "11-1pm" means 11 AM — so when the start hour is not below the end
  // hour we return null (unknown → no flag) rather than guess wrong.
  const range =
    /^(\d{1,2})(?::(\d{2}))?\s*[-–—to]+\s*(\d{1,2})(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)/.exec(s);
  if (range && !/^\d{1,2}(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)/.test(s)) {
    const startHour = Number(range[1]);
    const endHour = Number(range[3]);
    if (startHour >= endHour) return null;
    return parseStatedTime(
      `${range[1]}:${range[2] ?? "00"} ${range[4].replace(/\./g, "")}`
    );
  }

  // First clock-ish token: 18:15, 6:15pm, 6 pm, 6pm.
  const m = /(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?/.exec(s);
  if (!m) return null;

  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3]?.replace(/\./g, "");

  if (minute > 59) return null;

  if (meridiem === "pm") {
    if (hour < 1 || hour > 12) return null;
    if (hour !== 12) hour += 12;
  } else if (meridiem === "am") {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
  } else {
    // No meridiem: only trust it if it's already unambiguous 24h ("18:15").
    // A bare "6" could be 6 AM or 6 PM — never guess which.
    if (!m[2]) return null;
    if (hour > 23) return null;
  }

  if (hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Render "18:15" as "6:15 PM" for a human-facing reason string. */
export function formatTimeForHuman(hhmm: string | null | undefined): string {
  const t = parseStatedTime(hhmm);
  if (!t) return "unknown";
  const [h, m] = t.split(":").map(Number);
  const meridiem = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${meridiem}`;
}

/**
 * Compare our stored start against the time the organizer's page states.
 * Either side being unparseable yields "unknown" — we never flag on silence.
 */
export function compareEventTime(
  storedStart: string | null | undefined,
  pageStatedStart: string | null | undefined
): TimeVerdict {
  const ours = parseStatedTime(storedStart);
  const theirs = parseStatedTime(pageStatedStart);
  if (!ours || !theirs) return "unknown";
  return ours === theirs ? "match" : "mismatch";
}

/** The operator-facing sentence for a flagged time mismatch. */
export function describeTimeMismatch(
  storedStart: string | null | undefined,
  pageStatedStart: string | null | undefined
): string {
  return (
    `Time mismatch: we show ${formatTimeForHuman(storedStart)}, ` +
    `the organizer's page states ${formatTimeForHuman(pageStatedStart)}.`
  );
}

// ---------------------------------------------------------------------------
// Clock conflicts between two listings (dedup v2 Phase 1, review finding #5).
//
// The cross-source rule merges two feeds' listings of one event even when they
// disagree on the start by up to three hours (Murphys Gathering: GoCalaveras
// 11:00, the organizer's own listing 12:00). A merge keeps ONE clock: the write
// path keeps the resident's, reconcile keeps the richest row's. Discarding the
// other silently meant an organizer's corrected time could never land. So the
// kept row joins the /admin/verification queue with the other listing's time
// staged in `verification_suggested_*`, where the existing one-click
// "Use H:MM (locks it)" applies it. Nothing here writes `start_time`: a machine
// stages, a human applies, the same contract as the organizer check above.
// ---------------------------------------------------------------------------

/** The fixed opening of the reason a clock-conflict flag writes, so the
 *  verification page can label the staged time as another listing's rather
 *  than the organizer's page. */
export const CLOCK_CONFLICT_REASON_PREFIX = "Two listings disagree on the start time.";

export function isClockConflictReason(reason: string | null | undefined): boolean {
  return !!reason && reason.startsWith(CLOCK_CONFLICT_REASON_PREFIX);
}

export interface ClockListing {
  start_time?: string | null;
  end_time?: string | null;
  source_name?: string | null;
  event_url?: string | null;
}

export interface KeptClockRow extends ClockListing {
  times_locked?: boolean | null;
  verification_status?: string | null;
  community_sourced?: boolean | null;
  status?: string | null;
}

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * The verification patch for a kept row whose start differs from another
 * listing's, or null (write nothing) when:
 *  - either start is unstated or unparseable, or the two agree (never flag on
 *    silence, the rule `compareEventTime` follows);
 *  - the kept row's times are locked, so they are already authoritative;
 *  - the row already carries a verdict (verified, dismissed, or queued for
 *    another reason). A human's call or the organizer check outranks a feed's
 *    disagreement, and re-flagging a dismissed row on every nightly run is how
 *    a queue stops being read;
 *  - the row is community sourced. A flag there would hide its public "call
 *    ahead" note (`eventConfidence` reads needs_verification as stale_source),
 *    and a person already reviewed its time at publish;
 *  - the row is cancelled (a Phase 0 tombstone absorbing its old listing):
 *    nobody should be asked to fix the time of an event that is not listed.
 *
 * When the other listing states no end, the staged end is the kept row's own
 * end if it still follows the staged start (an end past midnight counts as
 * the next day), so applying the suggestion moves the start without erasing a
 * known end.
 */
export function clockConflictPatch(
  kept: KeptClockRow,
  other: ClockListing,
  now: string
): Record<string, unknown> | null {
  if (kept.times_locked || kept.community_sourced || kept.status === "cancelled") return null;
  if ((kept.verification_status ?? "unchecked") !== "unchecked") return null;
  const ours = parseStatedTime(kept.start_time);
  const theirs = parseStatedTime(other.start_time);
  if (!ours || !theirs || ours === theirs) return null;
  const ourEnd = parseStatedTime(kept.end_time);
  let ourEndMin = ourEnd ? minutesOf(ourEnd) : null;
  if (ourEndMin !== null && ourEndMin < minutesOf(ours)) ourEndMin += 24 * 60;
  const theirEnd =
    parseStatedTime(other.end_time) ??
    (ourEnd && ourEndMin !== null && ourEndMin > minutesOf(theirs) ? ourEnd : null);
  const who = other.source_name?.trim() || "Another listing";
  const ourFeed = kept.source_name?.trim();
  return {
    verification_status: "needs_verification",
    verification_reason:
      `${CLOCK_CONFLICT_REASON_PREFIX} ${who} says ${formatTimeForHuman(theirs)}; ` +
      `we show ${formatTimeForHuman(ours)}${ourFeed ? ` from ${ourFeed}` : ""}.` +
      (other.event_url ? ` Their listing: ${other.event_url}` : ""),
    verification_suggested_start: theirs,
    verification_suggested_end: theirEnd,
    verification_checked_at: now,
  };
}

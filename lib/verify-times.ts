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

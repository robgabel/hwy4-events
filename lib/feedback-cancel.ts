// Visitor feedback that an event did not happen.
//
// The Suggest-a-fix form still saves the note on event_feedback. When the
// note says the listing did not happen, the route also inserts a proposed
// agent_actions row. Approving it sets hwy4_events.status to 'cancelled'.
// Nothing is cancelled at submit time.
//
// No agent_policy row (that would be a migration). The auto-runner only
// selects types whose policy has auto_execute, and cancelEventAutoReady is
// false anyway. blast_radius med + outward_facing also fail canAutoExecute,
// so a later policy row cannot cancel a listing on its own.
//
// Other upcoming dates of the same name and town are listed on the payload
// so the reviewer can see the series. Approval cancels the reported
// occurrence only. The slug is a function of name, date, and town, and this
// write does not touch those columns.

import { normalizeName, normalizeTown } from "./event-identity";

export const CANCEL_EVENT_ACTION_TYPE = "cancel_event";

export const CANCEL_EVENT_AUTONOMY = {
  blast_radius: "med" as const,
  reversible: true as const,
  outward_facing: true as const,
};

const DID_NOT_HAPPEN: readonly RegExp[] = [
  /\bdid(?:n'?t| not) happen\b/,
  /\bnever happened\b/,
  /\b(?:was(?:n'?t| not)|is(?:n'?t| not)|no longer)\s+happening\b/,
  /\bdid(?:n'?t| not) take place\b/,
  /\bdid(?:n'?t| not) (?:go on|occur)\b/,
  /\b(?:was(?:n'?t| not)|is(?:n'?t| not))\s+held\b/,
  /\bno(?:body| one) (?:was there|showed)\b/,
  /\bnothing (?:was|is) happening\b/,
];

const CALLED_OFF = /\b(?:cancelled|canceled|called off)\b/;
const WAS_CLOSED = /\b(?:is|was|were|got)\s+closed\b/;

function normalizeNote(note: string): string {
  return note
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** "don't cancel", "was not cancelled", "wasn't closed". */
function negated(text: string, word: string): boolean {
  const re = new RegExp(
    `\\b(?:not|never|don'?t|do not|isn'?t|is not|wasn'?t|was not|hasn'?t|has not|weren'?t|were not|hadn'?t|had not)\\s+(?:\\w+\\s+){0,4}?${word}\\b`
  );
  return re.test(text);
}

/**
 * True when the note reports that this occurrence did not happen.
 * A time correction, a lineup change, or "please don't cancel" is not a match.
 */
export function reportsEventDidNotHappen(note: string): boolean {
  const text = normalizeNote(note);
  if (!text) return false;
  if (DID_NOT_HAPPEN.some((re) => re.test(text))) return true;
  if (CALLED_OFF.test(text) && !negated(text, "(?:cancelled|canceled|called off)")) return true;
  if (WAS_CLOSED.test(text) && !negated(text, "closed")) return true;
  return false;
}

export type CancelSeriesCandidate = {
  id: string;
  name: string;
  date: string;
  town: string;
  status?: string | null;
};

/**
 * Other upcoming rows of the same listing. Same normalized name and town,
 * a different id, not cancelled, on or after today. The reported occurrence
 * is not included. Capped so the proposal payload stays small.
 */
export function seriesSiblingsToFlag(
  reported: { id: string; name: string; town: string },
  candidates: readonly CancelSeriesCandidate[],
  today: string
): string[] {
  const name = normalizeName(reported.name);
  const town = normalizeTown(reported.town);
  const ids: string[] = [];
  for (const c of candidates) {
    if (ids.length >= 40) break;
    if (c.id === reported.id) continue;
    if (c.status === "cancelled") continue;
    if (c.date < today) continue;
    if (normalizeName(c.name) !== name) continue;
    if (normalizeTown(c.town) !== town) continue;
    ids.push(c.id);
  }
  return ids;
}

export type CancelEventPayload = {
  event_id: string | null;
  event_slug: string;
  event_name: string | null;
  event_date: string | null;
  town: string | null;
  note: string;
  feedback_id: string | null;
  submitter_role: string | null;
  /** Flagged for the reviewer. Approval does not cancel these. */
  series_event_ids: string[];
};

export type CancelEventProposal = {
  type: typeof CANCEL_EVENT_ACTION_TYPE;
  title: string;
  rationale: string;
  payload: CancelEventPayload;
  blast_radius: "med";
  reversible: true;
  outward_facing: true;
  status: "proposed";
};

export type CancelEventInput = {
  eventId: string | null;
  eventSlug: string;
  eventName: string | null;
  eventDate: string | null;
  town: string | null;
  note: string;
  feedbackId: string | null;
  submitterRole: string | null;
  seriesEventIds?: readonly string[];
};

/** Null when the note is not a "didn't happen" report. */
export function buildCancelEventProposal(input: CancelEventInput): CancelEventProposal | null {
  const note = input.note.trim();
  if (!reportsEventDidNotHappen(note)) return null;
  const name = input.eventName?.trim() || input.eventSlug.trim();
  const when = input.eventDate?.trim();
  const seriesEventIds = [...(input.seriesEventIds ?? [])];
  const seriesLine =
    seriesEventIds.length === 0
      ? "No other upcoming date of this listing was found."
      : `${seriesEventIds.length} other upcoming date(s) of this listing are in series_event_ids. They are not cancelled.`;
  return {
    type: CANCEL_EVENT_ACTION_TYPE,
    title: when ? `Cancel: ${name} (${when})` : `Cancel: ${name}`,
    rationale:
      "A visitor reported this listing did not happen. Approving sets status to cancelled on this occurrence only. The URL stays the same. Locked fields are left as they are. " +
      seriesLine +
      " Rejecting leaves the listing up.",
    payload: {
      event_id: input.eventId,
      event_slug: input.eventSlug.trim(),
      event_name: input.eventName?.trim() || null,
      event_date: when || null,
      town: input.town?.trim() || null,
      note: note.slice(0, 1000),
      feedback_id: input.feedbackId,
      submitter_role: input.submitterRole,
      series_event_ids: seriesEventIds,
    },
    ...CANCEL_EVENT_AUTONOMY,
    status: "proposed",
  };
}

export function isOpenCancelForEvent(
  open: readonly { payload?: Partial<CancelEventPayload> | null }[],
  event: { eventId: string | null; eventSlug: string }
): boolean {
  const slug = event.eventSlug.trim();
  return open.some((row) => {
    const payload = row.payload;
    if (!payload) return false;
    if (event.eventId && payload.event_id === event.eventId) return true;
    return Boolean(slug) && payload.event_slug === slug;
  });
}

/** The only hwy4_events write an approval may make. */
export function cancelEventWritePayload(): { status: "cancelled" } {
  return { status: "cancelled" };
}

const EVENT_STATUS = new Set(["confirmed", "tentative", "cancelled"]);

/**
 * Restore the previous status and nothing else. Extra snapshot keys
 * (lock flags, series ids) are ignored so a revert cannot clear a lock
 * or rewrite the slug.
 */
export function cancelRevertPayload(
  snap: Record<string, unknown> | null | undefined
): { status: "confirmed" | "tentative" | "cancelled" } | null {
  const status = snap?.status;
  if (typeof status !== "string" || !EVENT_STATUS.has(status)) return null;
  return { status: status as "confirmed" | "tentative" | "cancelled" };
}

/** The auto-runner must not treat this type as ready. */
export function cancelEventAutoReady(): false {
  return false;
}

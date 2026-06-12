// Event confidence (WS-8): the site's honest-uncertainty signal, the strongest
// anti-AI-content-farm trust marker we have (the "Miss Debbie pattern"). Derived
// from the structured fields we already store — `community_sourced` +
// `verification_status` — rather than a redundant enum column, so it can't drift
// out of sync with how a row was actually created/verified.
//
// The disclosure renders from THIS, not from hand-written text buried in the
// description (components/ConfidenceNote.tsx).

export type ConfidenceLevel =
  | "verified"
  | "community_sourced_unverified"
  | "stale_source";

export interface ConfidenceEvent {
  community_sourced?: boolean | null;
  verification_status?: string | null;
}

export interface EventConfidence {
  level: ConfidenceLevel;
  /**
   * Whether to render the "I couldn't confirm this, call ahead" note. Only the
   * community-submitted-unverified case gets the note; `stale_source` already has
   * its own "Date unconfirmed" badge from the /api/verify-events flow, and
   * `verified` (or a normal trusted-source row) shows nothing.
   */
  showDisclosure: boolean;
}

export function eventConfidence(e: ConfidenceEvent): EventConfidence {
  if (e.verification_status === "verified") {
    return { level: "verified", showDisclosure: false };
  }
  if (e.verification_status === "needs_verification") {
    return { level: "stale_source", showDisclosure: false };
  }
  if (e.community_sourced) {
    return { level: "community_sourced_unverified", showDisclosure: true };
  }
  return { level: "verified", showDisclosure: false };
}

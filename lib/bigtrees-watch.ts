// Weekly watcher for the Calaveras Big Trees interpretive-program page.
//
// The park publishes the season as prose on one server-rendered page. The
// seed in scripts/lib/bigtrees-schedule.ts is the copy we list. This module
// decides when that copy is stale. It is pure: the route fetches, then
// inserts the alert row and stores the fingerprint.
//
// The June 2026 baseline hashed the page intro ("all programs are free"
// through the first "Related Pages"). The program list sits outside that
// window, so a schedule edit and a removed list both left the hash alone.
// readBigTreesProgram starts at the program list itself. A page that still
// has the intro and has no list is "missing", not a fresh baseline.
//
// Alert row (no new table). The route inserts this into agent_actions.
// The cockpit bot already reads status = 'proposed'. Reject dismisses it.
// There is no executor handler and reversible is false, so canAutoExecute
// cannot run it.
//
//   type:            'schedule_watch_alert'
//   status:          'proposed'
//   title:           one line, kind-specific
//   rationale:       what to edit (scripts/lib/bigtrees-schedule.ts + the seed)
//   blast_radius:    'low'
//   reversible:      false
//   outward_facing:  false
//   payload: {
//     source: 'calaveras-big-trees',
//     page_url: 'https://www.parks.ca.gov/?page_id=25994',
//     kind: 'changed' | 'missing' | 'unreadable',
//     fingerprint: string | null,          // sha256 hex, or 'missing'; null if unreadable
//     previous_fingerprint: string | null, // site_config value before this run
//     text_length: number,                 // normalized program text, 0 when there is none
//     config_key: 'bigtrees_schedule_fingerprint',
//     program_text: string | null,         // the new list, when kind is 'changed'
//     program_text_truncated: boolean
//   }
//
// site_config key stays `bigtrees_schedule_fingerprint`. A missing list stores
// the sentinel 'missing' so the next quiet week does not file again.

import { createHash } from "node:crypto";
import { canAutoExecute } from "./agent/policy";

export const BIGTREES_PROGRAMS_PAGE = "https://www.parks.ca.gov/?page_id=25994";
export const BIGTREES_FINGERPRINT_KEY = "bigtrees_schedule_fingerprint";
export const SCHEDULE_WATCH_ACTION_TYPE = "schedule_watch_alert";
export const MISSING_FINGERPRINT = "missing";

const PROGRAM_TEXT_CAP = 12_000;

// A heading or a named program. The intro's "guided hikes" sentence does not match.
const PROGRAM_LIST = /guided hikes and walks|south grove|north grove/i;
const SCHEDULE_WORDS =
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i;
const PAGE_MARKER = /all programs are free|park programs/i;

export type ScheduleWatchKind = "changed" | "missing" | "unreadable";

export type ScheduleWatchPayload = {
  source: "calaveras-big-trees";
  page_url: string;
  kind: ScheduleWatchKind;
  fingerprint: string | null;
  previous_fingerprint: string | null;
  text_length: number;
  config_key: typeof BIGTREES_FINGERPRINT_KEY;
  program_text: string | null;
  program_text_truncated: boolean;
};

export type ScheduleWatchAlert = {
  type: typeof SCHEDULE_WATCH_ACTION_TYPE;
  title: string;
  rationale: string;
  payload: ScheduleWatchPayload;
  blast_radius: "low";
  reversible: false;
  outward_facing: false;
  status: "proposed";
};

export type BigTreesRead =
  | { state: "program"; text: string }
  | { state: "missing" }
  | { state: "unreadable" };

export type BigTreesWatchDecision = {
  read: BigTreesRead["state"];
  /** Value this reading represents. Null when the page could not be read. */
  fingerprint: string | null;
  /** Write this over site_config, or null to leave the stored baseline. */
  storeFingerprint: string | null;
  alert: ScheduleWatchAlert | null;
  textLength: number;
};

function stripRegions(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|header|footer|aside|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
}

function pageLines(html: string): string[] {
  const stripped = stripRegions(html)
    .replace(/<\/(p|div|li|tr|h[1-6]|ul|ol|table|section|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&amp;/gi, "&");
  return stripped
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Program-list text, or a structured miss. Chrome (nav, sidebar, footer) is dropped first. */
export function readBigTreesProgram(html: string): BigTreesRead {
  if (!html || !html.trim()) return { state: "unreadable" };
  const lines = pageLines(html);
  if (lines.length === 0) return { state: "unreadable" };
  const looksLikePage = lines.some((l) => PAGE_MARKER.test(l));
  const start = lines.findIndex((l) => PROGRAM_LIST.test(l));
  if (start === -1) return { state: looksLikePage ? "missing" : "unreadable" };
  const programLines = lines.slice(start);
  if (!programLines.some((l) => SCHEDULE_WORDS.test(l))) {
    return { state: looksLikePage ? "missing" : "unreadable" };
  }
  return { state: "program", text: programLines.join("\n") };
}

export function fingerprintProgramText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function programTextFields(text: string | null): Pick<
  ScheduleWatchPayload,
  "program_text" | "program_text_truncated" | "text_length"
> {
  if (!text) {
    return { program_text: null, program_text_truncated: false, text_length: 0 };
  }
  const truncated = text.length > PROGRAM_TEXT_CAP;
  return {
    program_text: truncated ? text.slice(0, PROGRAM_TEXT_CAP) : text,
    program_text_truncated: truncated,
    text_length: text.length,
  };
}

function alertRow(
  kind: ScheduleWatchKind,
  fingerprint: string | null,
  previousFingerprint: string | null,
  text: string | null
): ScheduleWatchAlert {
  const textFields = programTextFields(text);
  const payload: ScheduleWatchPayload = {
    source: "calaveras-big-trees",
    page_url: BIGTREES_PROGRAMS_PAGE,
    kind,
    fingerprint,
    previous_fingerprint: previousFingerprint,
    text_length: textFields.text_length,
    config_key: BIGTREES_FINGERPRINT_KEY,
    program_text: textFields.program_text,
    program_text_truncated: textFields.program_text_truncated,
  };
  if (kind === "changed") {
    return {
      type: SCHEDULE_WATCH_ACTION_TYPE,
      title: "Calaveras Big Trees program schedule changed",
      rationale:
        "The program list on the parks.ca.gov programs page differs from the last fingerprint. Re-transcribe scripts/lib/bigtrees-schedule.ts and re-run scripts/seed-bigtrees-programs-2026.ts. The venue is blocklisted, so nothing else updates these events. The seed skips a date that is already cancelled. Reject this row after the schedule is updated. Approving it does not change events.",
      payload,
      blast_radius: "low",
      reversible: false,
      outward_facing: false,
      status: "proposed",
    };
  }
  if (kind === "missing") {
    return {
      type: SCHEDULE_WATCH_ACTION_TYPE,
      title: "Calaveras Big Trees program list is missing",
      rationale:
        "The parks.ca.gov programs page loaded, and the program list is gone. The intro alone is not a schedule. Check the page, then edit scripts/lib/bigtrees-schedule.ts and re-run the seed. The seed skips a date that is already cancelled. Reject this row after the schedule is updated. Approving it does not change events.",
      payload,
      blast_radius: "low",
      reversible: false,
      outward_facing: false,
      status: "proposed",
    };
  }
  return {
    type: SCHEDULE_WATCH_ACTION_TYPE,
    title: "Calaveras Big Trees schedule page could not be read",
    rationale:
      "The fetch returned a page that does not look like the programs page. The stored fingerprint was left unchanged. Check the page before editing scripts/lib/bigtrees-schedule.ts. Reject this row once the page reads again. Approving it does not change events.",
    payload,
    blast_radius: "low",
    reversible: false,
    outward_facing: false,
    status: "proposed",
  };
}

/**
 * Compare one fetch to the stored fingerprint. A first run (no baseline)
 * stores and does not alert. An unreadable page alerts when a baseline
 * exists and does not replace that baseline.
 */
export function decideBigTreesWatch(args: {
  html: string;
  previousFingerprint: string | null;
}): BigTreesWatchDecision {
  const read = readBigTreesProgram(args.html);
  const previous = args.previousFingerprint;

  if (read.state === "unreadable") {
    return {
      read: "unreadable",
      fingerprint: null,
      storeFingerprint: null,
      alert: previous ? alertRow("unreadable", null, previous, null) : null,
      textLength: 0,
    };
  }

  if (read.state === "missing") {
    const changed = previous !== MISSING_FINGERPRINT;
    const first = !previous;
    return {
      read: "missing",
      fingerprint: MISSING_FINGERPRINT,
      storeFingerprint: changed ? MISSING_FINGERPRINT : null,
      alert: !first && changed ? alertRow("missing", MISSING_FINGERPRINT, previous, null) : null,
      textLength: 0,
    };
  }

  const fingerprint = fingerprintProgramText(read.text);
  const first = !previous;
  const changed = !first && previous !== fingerprint;
  return {
    read: "program",
    fingerprint,
    storeFingerprint: first || changed ? fingerprint : null,
    alert: changed ? alertRow("changed", fingerprint, previous, read.text) : null,
    textLength: read.text.length,
  };
}

/** An open proposed row for the same kind and fingerprint is enough. */
export function isDuplicateWatchAlert(
  existing: ReadonlyArray<{ payload?: Partial<ScheduleWatchPayload> | null }>,
  alert: ScheduleWatchAlert
): boolean {
  return existing.some(
    (row) =>
      row.payload?.kind === alert.payload.kind &&
      (row.payload?.fingerprint ?? null) === alert.payload.fingerprint
  );
}

/** The alert is a notice. A policy row must not be able to execute it. */
export function watchAlertCanAutoExecute(alert: ScheduleWatchAlert): boolean {
  return canAutoExecute(alert, { auto_execute: true });
}

// Rob's Picks for the three LLM-written surfaces: the daily briefing, the
// weekend briefing and the weekly newsletter (issue #356).
//
// The homepage decides what a pick is with eligiblePickEntries (lib/picks.ts):
// public, not sold out, not ended, and absorbed into a live festival guide when
// one matches. The generators used to read the raw robs_pick column instead, so
// a sold-out pick could be pushed, a festival pick linked to one night, and the
// weekend briefing and newsletter dropped pick_reason entirely. This module
// windows the homepage's own rule for each surface and formats it identically
// for all three prompts, so the site and its emails cannot disagree about what
// Rob picked.
//
// Pure: callers fetch rows and pass the clock in. Locked by
// scripts/test/briefing-picks.test.ts. Relative imports so the scripts/ test
// runner can load it.

import { eligiblePickEntries, addDaysIso, type PickCandidate } from "./picks";
import type { FestivalGuide } from "./event-guides";
import { generateEventSlug } from "./slugs";
import { SITE_URL } from "./constants";

export type BriefingPickRow = PickCandidate & {
  town: string;
  venue_name?: string | null;
  pick_reason?: string | null;
};

export type BriefingPick = {
  kind: "event" | "guide";
  title: string;
  town: string;
  venue: string | null;
  /** Event date, or a festival's opening day. */
  startDate: string;
  /** A festival's last day; null for a single event. */
  endDate: string | null;
  reason: string | null;
  /** Absolute URL handed to the model. */
  url: string;
  /** Site path the output must link to for the pick to count as mentioned. */
  path: string;
  /** name|date|town for an event pick, so its row in the day lists can be tagged. */
  key: string | null;
};

export type BriefingPickWindow = {
  todayIso: string;
  nowMinutes: number;
  /** First and last day (inclusive, YYYY-MM-DD) the surface covers. */
  windowStart: string;
  windowEnd: string;
  guides: FestivalGuide[];
  /** Days after windowEnd to look for "mark your calendar" picks. 0 = none. */
  lookaheadDays?: number;
  /** Cap on lookahead picks. */
  maxLookahead?: number;
};

/** The identity a row is tagged by. Name + date + town is what the slug uses. */
export function pickKey(e: { name: string; date: string; town: string }): string {
  return `${e.name}|${e.date}|${e.town}`;
}

function cleanReason(reason: string | null | undefined): string | null {
  const r = reason?.trim();
  return r ? r : null;
}

export function selectBriefingPicks<T extends BriefingPickRow>(
  rows: T[],
  w: BriefingPickWindow
): { inWindow: BriefingPick[]; lookahead: BriefingPick[] } {
  const lookaheadDays = w.lookaheadDays ?? 0;
  const lookaheadEnd = addDaysIso(w.windowEnd, lookaheadDays);
  // Only a guide this surface can show may absorb its nightly picks. A guide
  // that is live today but ends before the window would otherwise swallow a
  // later pick at the same venue with nothing left to represent it.
  const guides = w.guides.filter(
    (g) => g.startDate <= lookaheadEnd && g.hideAfter >= w.windowStart
  );
  // Callers concatenate window rows with lookahead rows, and their reads can
  // overlap by a day across the UTC/Pacific boundary. One row per pick.
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const k = pickKey(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const entries = eligiblePickEntries(unique, w.todayIso, w.nowMinutes, guides);

  const inWindow: BriefingPick[] = [];
  const lookahead: BriefingPick[] = [];

  for (const entry of entries) {
    if (entry.kind === "guide") {
      const g = entry.guide;
      const pick: BriefingPick = {
        kind: "guide",
        title: g.title,
        town: g.town,
        venue: null,
        startDate: g.startDate,
        endDate: g.hideAfter,
        reason: null,
        url: `${SITE_URL}${g.path}`,
        path: g.path,
        key: null,
      };
      // A festival is in window when any day of its run overlaps it.
      if (g.startDate <= w.windowEnd && g.hideAfter >= w.windowStart) {
        inWindow.push(pick);
      } else if (
        lookaheadDays > 0 &&
        g.startDate > w.windowEnd &&
        g.startDate <= lookaheadEnd
      ) {
        lookahead.push(pick);
      }
      continue;
    }

    const e = entry.event;
    const path = `/events/${generateEventSlug(e.name, e.date, e.town)}`;
    const pick: BriefingPick = {
      kind: "event",
      title: e.name,
      town: e.town,
      venue: e.venue_name ?? null,
      startDate: e.date,
      endDate: null,
      reason: cleanReason(e.pick_reason),
      url: `${SITE_URL}${path}`,
      path,
      key: pickKey(e),
    };
    if (e.date >= w.windowStart && e.date <= w.windowEnd) {
      inWindow.push(pick);
    } else if (lookaheadDays > 0 && e.date > w.windowEnd && e.date <= lookaheadEnd) {
      lookahead.push(pick);
    }
  }

  return { inWindow, lookahead: lookahead.slice(0, w.maxLookahead ?? 2) };
}

/**
 * The daily briefing's picks: today's and tomorrow's, the same set the homepage
 * would show for those two days, including a festival that is running (its
 * nightly picks are absorbed into it, so dropping it would drop them too).
 * `mustLink` is what the backstop checks: a running festival is listed every
 * day but only required on its opening day or the day before.
 */
export function dailyBriefingPicks<T extends BriefingPickRow>(
  rows: T[],
  todayIso: string,
  nowMinutes: number,
  guides: FestivalGuide[]
): { picks: BriefingPick[]; mustLink: BriefingPick[] } {
  const { inWindow } = selectBriefingPicks(rows, {
    todayIso,
    nowMinutes,
    windowStart: todayIso,
    windowEnd: addDaysIso(todayIso, 1),
    guides,
  });
  return {
    picks: inWindow,
    mustLink: inWindow.filter((p) => p.kind === "event" || p.startDate >= todayIso),
  };
}

/** The tag a row in the day lists carries: only rows that are in-window picks
 *  under the shared rule. A sold-out, ended, members-only or festival-absorbed
 *  robs_pick row gets no tag. */
export function pickTag(
  e: { name: string; date: string; town: string },
  inWindow: BriefingPick[]
): string {
  const key = pickKey(e);
  const pick = inWindow.find((p) => p.key === key);
  if (!pick) return "";
  return pick.reason ? `[ROB'S PICK: ${pick.reason}]` : "[ROB'S PICK]";
}

function describe(p: BriefingPick): string {
  const where = p.venue ? `at ${p.venue} (${p.town})` : `(${p.town})`;
  const when =
    p.kind === "guide"
      ? `festival runs ${p.startDate} to ${p.endDate}`
      : `on ${p.startDate}`;
  const parts = [
    `${p.title} ${where}`,
    when,
    p.reason ? `Reason: ${p.reason}` : "No reason given",
    `URL: ${p.url}`,
  ];
  return `- ${parts.join(" | ")}`;
}

/** The prompt block listing the picks. Empty string when there are none, so a
 *  week without picks reads exactly as before. */
export function formatPicksSection(
  inWindow: BriefingPick[],
  lookahead: BriefingPick[] = []
): string {
  let out = "";
  if (inWindow.length > 0) {
    out += `\n\nROB'S PICKS (hand-picked by Rob, see the ROB'S PICKS rule):\n${inWindow
      .map(describe)
      .join("\n")}`;
  }
  if (lookahead.length > 0) {
    out += `\n\nUPCOMING ROB'S PICKS (after this window, optional):\n${lookahead
      .map(describe)
      .join("\n")}`;
  }
  return out;
}

/** One rule, shared by all three system prompts. */
export const ROB_PICKS_RULE = `- ROB'S PICKS: the ROB'S PICKS list is Rob's hand-picked highlights, and rows tagged [ROB'S PICK] in the day lists are the same picks. When a pick falls on a day you cover, mention it and lead that beat with it. A pick with a reason leads with that reason, in your own words. A pick with no reason gets a plain mention, no invented enthusiasm. A festival pick links to its festival page URL, never to one night. Never call anything else a Rob's Pick. UPCOMING ROB'S PICKS, when listed, are optional: at most one short mark-your-calendar line.`;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Picks the generated text never links to. Run after link repair. */
export function missingPicks(text: string, picks: BriefingPick[]): BriefingPick[] {
  return picks.filter((p) => {
    const re = new RegExp(
      `\\]\\((?:https?://[^/)\\s]+)?${escapeRe(p.path)}/?(?:[?#][^)]*)?\\)`,
      "i"
    );
    return !re.test(text);
  });
}

/** Log-only backstop: greppable, same idiom as BRIEFING_LINK_REPAIR. */
export function logMissingPicks(where: string, missing: BriefingPick[]): void {
  for (const p of missing) {
    console.warn(`BRIEFING_PICK_MISSING [${where}] "${p.title}": ${p.url}`);
  }
}

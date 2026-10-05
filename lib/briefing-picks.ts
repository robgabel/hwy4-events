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
  /** pickKey of an event pick, so its row in the day lists can be tagged. */
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

type KeyedRow = {
  name: string;
  date: string;
  town: string;
  start_time?: string | null;
  robs_pick?: boolean | null;
  visibility?: string | null;
  sold_out?: boolean | null;
};

/** The identity a row is tagged and deduped by: name + date + town (what the
 *  slug uses) plus the start time, so a matinee and an evening performance of
 *  one production stay two picks and a sold-out one can't stand in for the
 *  other. */
export function pickKey(e: KeyedRow): string {
  return `${e.name}|${e.date}|${e.town}|${e.start_time ?? ""}`;
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
  // A guide absorbs only the picks dated inside its own run. Matching is by
  // venue, so without this a festival opening after the window (or one that
  // already ended) would swallow an unrelated pick at the same venue, and the
  // lookahead cap could then drop the guide that was meant to represent it.
  const outsideRun = (r: T) => {
    const e = { venue_key: r.venue_key ?? null, name: r.name };
    const matching = guides.filter((g) => g.matchEvent(e));
    return (
      matching.length > 0 &&
      !matching.some((g) => r.date >= g.startDate && r.date <= g.hideAfter)
    );
  };
  // Callers concatenate window rows with lookahead rows, and their reads can
  // overlap by a day across the UTC/Pacific boundary. Dedupe AFTER the shared
  // rule, so a non-pick, members-only or sold-out twin that sorts first can
  // never stand in for the real pick.
  const seen = new Set<string>();
  const entries = [
    ...eligiblePickEntries(
      rows.filter((r) => !outsideRun(r)),
      w.todayIso,
      w.nowMinutes,
      guides
    ),
    ...eligiblePickEntries(rows.filter(outsideRun), w.todayIso, w.nowMinutes, []),
  ]
    .filter((entry) => {
      if (entry.kind === "guide") return true;
      const k = pickKey(entry.event);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort(byPickOrder);

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

/** Matches the daily route's own query (today through +7). */
export const DAILY_WINDOW_DAYS = 7;

/**
 * The daily briefing's picks: the same set the homepage would show for the
 * daily's 7-day window, including a festival that is running (its nightly
 * picks are absorbed into it, so dropping it would drop them too).
 * `mustLink` is what the backstop checks: only today's and tomorrow's picks
 * (midweek is an optional P3), and a festival only on its opening day or the
 * day before, not on every day of its run.
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
    windowEnd: addDaysIso(todayIso, DAILY_WINDOW_DAYS),
    guides,
  });
  const tomorrowIso = addDaysIso(todayIso, 1);
  return {
    picks: inWindow,
    mustLink: inWindow.filter(
      (p) =>
        p.startDate <= tomorrowIso && (p.kind === "event" || p.startDate >= todayIso)
    ),
  };
}

/** Date first; on a tie a festival, then a pick with a reason, then start time
 *  and name, so which picks win a capped lookahead slot never depends on the
 *  order the database returned the rows in. */
function byPickOrder<T extends BriefingPickRow>(
  a: ReturnType<typeof eligiblePickEntries<T>>[number],
  b: ReturnType<typeof eligiblePickEntries<T>>[number]
): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === "guide" ? -1 : 1;
  if (a.kind === "guide" || b.kind === "guide") return 0;
  const ra = cleanReason(a.event.pick_reason) ? 0 : 1;
  const rb = cleanReason(b.event.pick_reason) ? 0 : 1;
  if (ra !== rb) return ra - rb;
  const ta = a.event.start_time ?? "99:99";
  const tb = b.event.start_time ?? "99:99";
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.event.name < b.event.name ? -1 : a.event.name > b.event.name ? 1 : 0;
}

/** The tag a row in the day lists carries: only rows that are in-window picks
 *  under the shared rule. A sold-out, ended, members-only or festival-absorbed
 *  robs_pick row gets no tag. */
export function pickTag(
  e: KeyedRow,
  inWindow: BriefingPick[]
): string {
  // The row itself must be a pick too: a members-only, sold-out or non-pick
  // twin sharing the key never borrows the real pick's tag.
  if (e.robs_pick !== true || e.visibility !== "public" || e.sold_out === true) {
    return "";
  }
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

/** The daily's addendum to ROB_PICKS_RULE. Its pick list spans the homepage's
 *  7-day window, but the daily only leads today and tomorrow and must leave
 *  next weekend to the weekend briefing, so it says which days it covers. */
export const DAILY_PICKS_NOTE = `- ROB'S PICKS IN THE DAILY: the days you cover are today and tomorrow. Mention and lead with a pick on either day. A midweek pick may go in P3 if it fits. A pick on next weekend is not yours, leave it to the weekend briefing. A festival already underway (opened before today) gets at most a short nod, not the lead, so the daily doesn't open with it every day of its run; on its opening day or the day before, it leads.`;

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

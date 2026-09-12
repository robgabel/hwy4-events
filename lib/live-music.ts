// Live-music hub: /live-music (HWY-37).
//
// Mia's job is "what's fun this weekend / live music tonight." This page is
// that list: public category==='live_music' rows from the shared
// getUpcomingEvents feed, with three lenses (tonight / this weekend /
// upcoming). Copy is fixed and human-written (never LLM-generated); the
// no-em-dash / first-sentence-resolves voice rules are locked by
// scripts/test/live-music.test.ts.
//
// Relative (not "@/") imports so the scripts/ test runner can import this.

import type { Hwy4Event } from "./types";
import { hasEventEnded } from "./event-time";
import {
  addDays,
  pacificToday,
  thisWeekendRange,
  type DateWindow,
} from "./date-windows";

export type LiveMusicLens = "upcoming" | "tonight" | "weekend";

/** Upcoming window. Same length as date-night; tune here only. */
export const LIVE_MUSIC_HORIZON_DAYS = 30;

export const LIVE_MUSIC_PATH = "/live-music";

export function isLiveMusicEvent(
  e: Pick<Hwy4Event, "category" | "visibility">
): boolean {
  return e.visibility === "public" && e.category === "live_music";
}

export function parseLiveMusicLens(
  raw: string | null | undefined
): LiveMusicLens {
  if (raw === "tonight" || raw === "weekend") return raw;
  return "upcoming";
}

export function liveMusicHref(lens: LiveMusicLens): string {
  if (lens === "upcoming") return LIVE_MUSIC_PATH;
  return `${LIVE_MUSIC_PATH}?when=${lens}`;
}

export function liveMusicWindow(
  lens: LiveMusicLens,
  today = pacificToday()
): DateWindow {
  if (lens === "tonight") return { start: today.iso, end: today.iso };
  if (lens === "weekend") return thisWeekendRange(today);
  return { start: today.iso, end: addDays(today.iso, LIVE_MUSIC_HORIZON_DAYS) };
}

export type LiveMusicSelectOpts = {
  todayIso: string;
  nowMinutes: number;
  weekend: DateWindow;
  horizonEnd: string;
};

/**
 * Lens filter over a feed already bounded by getUpcomingEvents.
 * Tonight: same Pacific calendar day, not yet ended (hasEventEnded).
 * Weekend: Friday–Sunday window (thisWeekendRange), including already-played
 *   nights — matches /this-weekend, which is a weekend lineup, not a clock.
 * Upcoming: today through the horizon; today's ended shows drop so the list
 *   starts with something still useful.
 */
export function selectLiveMusic<
  T extends Pick<
    Hwy4Event,
    "category" | "visibility" | "date" | "start_time" | "end_time"
  >,
>(events: T[], lens: LiveMusicLens, opts: LiveMusicSelectOpts): T[] {
  const music = events.filter(isLiveMusicEvent);
  if (lens === "tonight") {
    return music.filter(
      (e) =>
        e.date === opts.todayIso &&
        !hasEventEnded(e.date, e.start_time, e.end_time, opts.nowMinutes)
    );
  }
  if (lens === "weekend") {
    return music.filter(
      (e) => e.date >= opts.weekend.start && e.date <= opts.weekend.end
    );
  }
  return music.filter((e) => {
    if (e.date < opts.todayIso || e.date > opts.horizonEnd) return false;
    if (
      e.date === opts.todayIso &&
      hasEventEnded(e.date, e.start_time, e.end_time, opts.nowMinutes)
    ) {
      return false;
    }
    return true;
  });
}

export type LiveMusicLensConfig = {
  key: LiveMusicLens;
  label: string;
  h1: string;
  lead: string;
  metaTitle: string;
  metaDescription: string;
  empty: string;
};

export const LIVE_MUSIC_LENSES: Record<LiveMusicLens, LiveMusicLensConfig> = {
  upcoming: {
    key: "upcoming",
    label: "Upcoming",
    h1: "Live music on the 4",
    lead: "Tonight, this weekend, and what's coming: every public live show from Angels Camp up to Bear Valley.",
    metaTitle: "Live Music Along Highway 4 (Tonight and This Weekend)",
    metaDescription:
      "Live music tonight and this weekend on the Hwy 4 corridor: Murphys, Arnold, Angels Camp, and Bear Valley. Updated daily.",
    empty: "No live music on the calendar right now.",
  },
  tonight: {
    key: "tonight",
    label: "Tonight",
    h1: "Live music tonight on the 4",
    lead: "Every public show still happening today, Angels Camp to Bear Valley.",
    metaTitle: "Live Music Tonight Along Highway 4",
    metaDescription:
      "What's playing tonight on the Hwy 4 corridor: live music in Murphys, Arnold, Angels Camp, and Bear Valley. Updated daily.",
    empty: "Nothing left tonight.",
  },
  weekend: {
    key: "weekend",
    label: "This Weekend",
    h1: "Live music this weekend on the 4",
    lead: "Every public show Friday through Sunday, Angels Camp to Bear Valley.",
    metaTitle: "Live Music This Weekend Along Highway 4",
    metaDescription:
      "Live music this weekend on the Hwy 4 corridor: Murphys, Arnold, Angels Camp, and Bear Valley. Updated daily.",
    empty: "No live music on the calendar this weekend yet.",
  },
};

export const LIVE_MUSIC_LENS_ORDER: LiveMusicLens[] = [
  "tonight",
  "weekend",
  "upcoming",
];

export type LiveMusicPageConfig = {
  path: string;
  label: string;
  windowDays: number;
  editorial: string[];
  qa: { q: string; a: string }[];
};

export const LIVE_MUSIC_PAGE: LiveMusicPageConfig = {
  path: LIVE_MUSIC_PATH,
  label: "Live Music",
  windowDays: LIVE_MUSIC_HORIZON_DAYS,
  editorial: [
    "If you're asking what's playing tonight or this weekend, this is the list. Every public live-music listing on the corridor, pulled daily from venues and organizers.",
    "Murphys and Arnold carry most of the weeknight rooms. Bigger bills show up at Ironstone and, in summer, up at Bear Valley. Check the card for time and weather before you commit to the drive.",
  ],
  qa: [
    {
      q: "Where can I find live music tonight near Murphys?",
      a: "The Tonight lens on this page lists every corridor show still happening today, Murphys included. Most weeknights that is one or two rooms; Friday and Saturday fill in.",
    },
    {
      q: "What's the live music this weekend on Highway 4?",
      a: "The This Weekend lens lists every public show Friday through Sunday, Angels Camp to Bear Valley. Wineries and Main Street rooms carry most of it; Ironstone and Bear Valley show up when they have a date.",
    },
  ],
};

// Intent landing pages: /things-to-do, /free, /date-night.
//
// These exist for the visitor golden channel (BUSINESS-PLAN §8): Miguel's
// literal query is "things to do near Arnold CA" and until now no page on the
// site was shaped like it. Editorial, not programmatic — three pages that
// match real search intent, each carrying the live corridor calendar filtered
// to that intent. Copy is fixed and human-written here (never LLM-generated),
// and the no-em-dash / plain-string voice rules are locked by
// scripts/test/intent-pages.test.ts.
//
// Relative (not "@/") imports so the scripts/ test runner can import this.

import type { Hwy4Event } from "./types";

export type IntentKey = "things-to-do" | "free" | "date-night";

export const DATE_NIGHT_CATEGORIES: ReadonlySet<string> = new Set([
  "live_music",
  "wine",
  "fine_arts",
  "festival",
]);

/** Earliest start that still reads as an evening plan. */
export const DATE_NIGHT_EARLIEST = "16:30";

export function isFreeEvent(
  e: Pick<Hwy4Event, "cost_tier" | "visibility">
): boolean {
  // cost_tier 'free' is only ever set from an explicitly-stated fee
  // (/api/extract-prices never guesses), so this page inherits that honesty.
  return e.visibility === "public" && e.cost_tier === "free";
}

export function isDateNightEvent(
  e: Pick<Hwy4Event, "category" | "start_time" | "visibility">
): boolean {
  if (e.visibility !== "public") return false;
  if (!DATE_NIGHT_CATEGORIES.has(e.category)) return false;
  // No start time = can't claim it's an evening plan. Strict on purpose.
  return !!e.start_time && e.start_time >= DATE_NIGHT_EARLIEST;
}

export type IntentConfig = {
  key: IntentKey;
  path: string;
  label: string;
  h1: string;
  lead: string;
  metaTitle: string;
  metaDescription: string;
  windowDays: number;
  editorial: string[];
  qa: { q: string; a: string }[];
  filter: (e: Hwy4Event) => boolean;
};

export const INTENT_CONFIG: Record<IntentKey, IntentConfig> = {
  "things-to-do": {
    key: "things-to-do",
    path: "/things-to-do",
    label: "Things To Do",
    h1: "Things to do along Highway 4",
    lead: "Everything happening from Angels Camp up to Bear Valley over the next two weeks, pulled daily from local venues and organizers.",
    metaTitle: "Things to Do Along Highway 4 (Angels Camp to Bear Valley, CA)",
    metaDescription:
      "What's happening on the Hwy 4 corridor: live music, festivals, markets, and community events in Angels Camp, Murphys, Arnold, and Bear Valley. Updated daily.",
    windowDays: 14,
    editorial: [
      "If you're driving up without a plan, the reliable moves: walk Murphys Main Street and its tasting rooms, give the giant sequoias at Calaveras Big Trees State Park a couple of hours, and check what's playing at Ironstone or up at Bear Valley before you commit to the drive.",
      "The list below is the live calendar for the whole corridor. It updates every day, and every event links back to its source so you can double-check the details.",
    ],
    qa: [
      {
        q: "What is there to do near Arnold, CA this weekend?",
        a: "The This Weekend page has the live answer for every town on the corridor, Angels Camp to Bear Valley. Most weekends up here include live music in Murphys or Arnold, something at the parks, and at least one community event. Elevation is the trick to enjoying it: Arnold sits near 4,000 feet, so summer evenings run cooler than the valley.",
      },
      {
        q: "How far apart are the Highway 4 towns?",
        a: "Angels Camp to Murphys is about 10 minutes, Murphys to Arnold roughly 20, and Arnold up to Bear Valley another 40 or so on mountain road. Most visitors base in Murphys or Arnold and day-trip the rest.",
      },
    ],
    filter: (e) => e.visibility === "public",
  },
  free: {
    key: "free",
    path: "/free",
    label: "Free",
    h1: "Free events on the 4",
    lead: "No ticket, no cover. Every event here is one the organizer lists as free.",
    metaTitle: "Free Events Along Highway 4 (Calaveras County, CA)",
    metaDescription:
      "Free things to do on the Hwy 4 corridor: parades, markets, live music, trail days, and community events in Angels Camp, Murphys, Arnold, and Bear Valley.",
    windowDays: 30,
    editorial: [
      "A lot of the best stuff up here doesn't cost a dime: parades, farmers markets, gallery nights, trail workdays, and plenty of patio music where the band plays and the hat maybe gets passed.",
      "One honest note on how this list works: an event only shows up here when the organizer states it's free. If a listing shows no price at all, that means unconfirmed, not free, so check the event page before you drive.",
    ],
    qa: [
      {
        q: "Are there free things to do in Calaveras County?",
        a: "Yes, most weeks have several. This page lists every upcoming corridor event with stated free admission, updated daily. Community events and markets are usually free; concerts at wineries and theaters usually are not.",
      },
      {
        q: "How do you know an event is free?",
        a: "We only mark an event free when the organizer or source states it outright. Nothing on this page is guessed, and anything unclear stays off it.",
      },
    ],
    filter: isFreeEvent,
  },
  "date-night": {
    key: "date-night",
    path: "/date-night",
    label: "Date Night",
    h1: "Date night on the 4",
    lead: "Evening plans that don't require driving down the hill: live music, wine, and a show.",
    metaTitle: "Date Night Ideas Along Highway 4 (Murphys, Arnold, Bear Valley)",
    metaDescription:
      "Evening events on the Hwy 4 corridor: live music, winery evenings, theater, and shows in Murphys, Angels Camp, Arnold, and Bear Valley. Updated daily.",
    windowDays: 30,
    editorial: [
      "The usual recipe works: dinner in Murphys, then whatever's on that night. Some evenings that's a band at the Lube Room in Arnold, some it's music at a winery, and in summer it's often a show up at Bear Valley.",
      "Everything below is an upcoming evening event in the live music, wine, fine arts, or festival lanes. Start times run mostly 5 to 7 up here; check the event page for details and the weather chip before you pick a patio.",
    ],
    qa: [
      {
        q: "Where should we go for date night near Murphys?",
        a: "Start with dinner on Murphys Main Street, then pick from the evening list on this page. The short version: live music somewhere in walking distance most weekends, tasting rooms into the early evening, and bigger shows at Ironstone or Bear Valley in season.",
      },
      {
        q: "What counts as a date night event here?",
        a: "Evening events starting 4:30 or later in the live music, wine, fine arts, and festival categories. Kids' events and daytime meetings don't make the cut.",
      },
    ],
    filter: isDateNightEvent,
  },
};

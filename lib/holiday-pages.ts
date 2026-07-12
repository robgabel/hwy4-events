// Evergreen Fourth of July guide pages: /arnold-4th-of-july, /murphys-4th-of-july.
//
// Why these exist (PRD-july4-evergreen.md, roadmap ticket HWY-6): the 2026
// July 4th event pages were the site's biggest search wins (~900 clicks in a
// month, positions 3-5), but event URLs embed the date, so that equity dies
// with the slug every year. These year-less pages are the durable landing spot:
// the expired event URLs 301 into them (lib/seasonal-redirects.ts), and each
// spring the live July-window event list fills itself in from the DB with no
// code change. Copy is fixed and human-written here (never LLM-generated);
// the no-em-dash / Q&A voice rules are locked by
// scripts/test/holiday-pages.test.ts.
//
// Relative (not "@/") imports so the scripts/ test runner can import this.

import type { Hwy4Event } from "./types";

export type HolidayGuide = {
  key: string;
  /** Year-less on purpose: the URL must be reusable every year. */
  path: string;
  /** Display town; must match hwy4_events.town for the event-window filter. */
  town: string;
  townSlug: string;
  /** Chip text on an event detail page (BrowseSimilar). */
  label: string;
  /** Town-page callout heading. */
  heading: string;
  /** Town-page callout sub-line. */
  blurb: string;
  h1: string;
  lead: string;
  metaTitle: string;
  metaDescription: string;
  editorial: string[];
  /** The "placeholder for next year" block, shown year-round. */
  nextYear: string;
  qa: { q: string; a: string }[];
};

/** The days a Fourth of July guide treats as "the holiday window" (inclusive,
 *  month-day). Jul 1-6 catches the 3rd-of-July eve traditions and the
 *  festival weekend spillover on the 5th. */
export const JULY_WINDOW_START_MD = "07-01";
export const JULY_WINDOW_END_MD = "07-06";

/** The current-or-next July holiday window for a given Pacific civil date:
 *  this year's window until it has fully passed, then next year's. */
export function julyWindow(todayIso: string): { start: string; end: string } {
  const year = Number(todayIso.slice(0, 4));
  const y = todayIso <= `${year}-${JULY_WINDOW_END_MD}` ? year : year + 1;
  return { start: `${y}-${JULY_WINDOW_START_MD}`, end: `${y}-${JULY_WINDOW_END_MD}` };
}

export const HOLIDAY_GUIDES: HolidayGuide[] = [
  {
    key: "arnold-4th-of-july",
    path: "/arnold-4th-of-july",
    town: "Arnold",
    townSlug: "arnold",
    label: "Arnold 4th of July",
    heading: "Planning for the 4th of July in Arnold?",
    blurb: "The parade, the route, road closures, and everything else that day.",
    h1: "4th of July in Arnold, CA",
    lead: "The Independence Day Parade down Highway 4 is Arnold's biggest morning of the year. Here's how the day works, what happened this year, and what to expect next year.",
    metaTitle: "Arnold 4th of July Parade & Events (Arnold, CA)",
    metaDescription:
      "The Arnold Independence Day Parade: start time, the one-mile route from the Byway to Cedar Center, road closures, and the rest of the day's events in Arnold, CA.",
    editorial: [
      "The parade is the anchor. In 2026 it stepped off at 10:00 AM sharp and rolled one mile, all downhill, from the upper Byway through town to Cedar Center, with the theme Stars, Stripes and 250 Years. Highway 4 closed to cars at 9:30 AM, so the move is to get up the hill early, grab a curb, and bring a chair. It's free to watch, and about as Arnold as it gets.",
      "The parade morning is just the start. In 2026 the Arnold Visitor Center ran a family celebration at 1 PM, Cedar Center hosted an Independence Day BBQ in the late afternoon, the Sierra Nevada Arts and Crafts Festival filled the lot at Bristol's over the whole weekend, and there was live music into the evening at Cameo Plaza and Sequoia Woods. Most years follow a similar shape, and the confirmed lineup lands on this page as organizers announce it.",
    ],
    nextYear:
      "July 4, 2027 falls on a Sunday. Organizers usually confirm the parade details by late spring; the parade's own site is arnoldparade.org, and we'll list the full day here as soon as it firms up. Check back, or grab the Thursday newsletter below and we'll tell you when it lands.",
    qa: [
      {
        q: "What time does the Arnold 4th of July parade start?",
        a: "In 2026 the parade stepped off at 10:00 AM, and Highway 4 closed to cars at 9:30 AM, so plan to be parked and curbside before 9:30. The confirmed 2027 start time will be posted here once organizers announce it, usually by late spring.",
      },
      {
        q: "What is the Arnold parade route?",
        a: "One mile, all downhill: from the upper Arnold Byway through town to Cedar Center. Anywhere along the Byway or the highway frontage works for watching; locals stake out curb spots early with chairs and flags.",
      },
      {
        q: "Is the Arnold 4th of July parade free?",
        a: "Yes, it's free to watch. Bring a chair, water, and sun cover; Arnold sits near 4,000 feet, so the morning starts cool and warms up fast.",
      },
      {
        q: "When is the Arnold 4th of July parade in 2027?",
        a: "July 4, 2027, which falls on a Sunday. Details like the start time and theme usually get confirmed by late spring at arnoldparade.org, and this page will carry the full day's lineup as it firms up.",
      },
    ],
  },
  {
    key: "murphys-4th-of-july",
    path: "/murphys-4th-of-july",
    town: "Murphys",
    townSlug: "murphys",
    label: "Murphys 4th of July",
    heading: "Planning for the 4th of July in Murphys?",
    blurb: "The parade, the car cruise the night before, and the whole weekend.",
    h1: "4th of July in Murphys, CA",
    lead: "Murphys does the Fourth as a two-day affair: the Patriotic Car Cruise down Main Street on the evening of the 3rd, then the parade and a full day of music and celebration on the 4th.",
    metaTitle: "Murphys 4th of July Parade & Events (Murphys, CA)",
    metaDescription:
      "The Murphys 4th of July: the Main Street parade, the July 3rd Patriotic Car Cruise, the Murphys Historic Hotel celebration, and live music across town in Murphys, CA.",
    editorial: [
      "In 2026 the parade rolled down Main Street at noon, and the Murphys Historic Hotel made an afternoon of it with its own celebration out front. The night before, the Patriotic Car Cruise (its third year in 2026) sent classic cars down Main Street at 6:30 PM, which has quickly become the way locals open the weekend.",
      "The rest of the day fills in around the parade: in 2026 there was live music at Jazz Cellars, the Murphys Wine and Beer Garden, the Irish Pub, and an evening show at Brice Station. Main Street stays walkable all day, so the usual play is parade at noon, a slow lap of the tasting rooms, and music until dark. The confirmed lineup for next year lands on this page as organizers announce it.",
    ],
    nextYear:
      "July 4, 2027 falls on a Sunday, which would put the car cruise on Saturday evening, July 3. Organizers usually confirm details in late spring, and the full weekend's lineup will be listed here as it firms up. Check back, or grab the Thursday newsletter below and we'll tell you when it lands.",
    qa: [
      {
        q: "What time is the Murphys 4th of July parade?",
        a: "In 2026 it went down Main Street at noon. The confirmed 2027 time will be posted here once organizers announce it, usually by late spring.",
      },
      {
        q: "What is the Murphys Patriotic Car Cruise?",
        a: "An evening cruise of classic and patriotic cars down Main Street on July 3rd, the night before the Fourth. In 2026, its third year, it rolled at 6:30 PM. Free to watch from anywhere on Main Street.",
      },
      {
        q: "Where should I park for the Murphys parade?",
        a: "Main Street closes for the parade, so park in the neighborhoods or lots a block or two off Main and walk in. Murphys is compact; nothing in town is more than about a ten-minute walk from the parade route. Come early, because the Fourth is one of the busiest days of the year.",
      },
      {
        q: "When is the Murphys 4th of July in 2027?",
        a: "July 4, 2027, which falls on a Sunday. The parade, the hotel celebration, and the car cruise details usually get confirmed in late spring, and this page will carry the full lineup as it firms up.",
      },
    ],
  },
];

/** The guide a town page should feature, or null. Year-round on purpose:
 *  unlike festival guides there is no hideAfter, because the page is the
 *  durable landing spot for next year's searches too. */
export function holidayGuideForTown(townSlug: string): HolidayGuide | null {
  return HOLIDAY_GUIDES.find((g) => g.townSlug === townSlug) ?? null;
}

/** The guide an event belongs to (for the detail page's BrowseSimilar chip),
 *  or null: same town, dated inside the July holiday window of any year. */
export function holidayGuideForEvent(
  e: Pick<Hwy4Event, "town" | "date">
): HolidayGuide | null {
  const md = e.date?.slice(5, 10);
  if (!md || md < JULY_WINDOW_START_MD || md > JULY_WINDOW_END_MD) return null;
  const town = e.town?.trim().toLowerCase();
  return HOLIDAY_GUIDES.find((g) => g.town.toLowerCase() === town) ?? null;
}

// Evergreen Meet Me in Murphys guide: /meet-me-in-murphys.
//
// Why this exists (roadmap ticket HWY-38, growth-memo move of the week
// 2026-09-11). GSC striking-distance:
//   "meet me in murphys"      ~176 impressions, 0 clicks, position ~5.9
//   "meet me in murphys 2026" ~151 impressions, 1 click,  position ~4.3
// What was ranking for both was a dated event-instance page that then
// cancelled (status='cancelled' on 2026-09-05), so the query has no durable
// landing spot. Same failure the July 4th guides (HWY-6) and the farmers-
// market guides (HWY-31) were built to fix: a URL with a date in it cannot
// accumulate, and a cancelled row 404s.
//
// Copy here is fixed and human-written, never LLM-generated. Every dated
// fact is read off the one hwy4_events row we have (name "Meet Me in
// Murphys Summer Concert", date 2026-09-05, start 14:00, address 236
// Crestview Dr, status cancelled, artists The Wailers / Somer Moon /
// Ryan Woodard, ticket URL meetmeinmurphys.com). Price is unknown. There
// is no confirmed later date. Blank beats wrong: this page will not invent
// a 2027 date, a price, or a future lineup. The live-dates list is empty
// until a public, non-cancelled upcoming row matches. Locked by
// scripts/test/meet-me-pages.test.ts.
//
// Relative (not "@/") imports so the scripts/ test runner can import this.

import type { Hwy4Event } from "./types";

export type MeetMeGuide = {
  key: string;
  /** Year-less on purpose: the URL must survive each year's listing. */
  path: string;
  town: string;
  townSlug: string;
  /** Substring that identifies this concert's rows by name (lowercased). */
  nameMatch: string;
  label: string;
  heading: string;
  blurb: string;
  h1: string;
  lead: string;
  metaTitle: string;
  metaDescription: string;
  /** Street address from the 2026 listing. Not a standing public venue. */
  listedAddress: string;
  /** The one dated listing we have, stated as a listing (not a promise). */
  listedDate: string;
  listedTime: string;
  listedStatus: "cancelled";
  officialUrl: string;
  editorial: string[];
  qa: { q: string; a: string }[];
};

export const MEET_ME_GUIDES: MeetMeGuide[] = [
  {
    key: "meet-me-in-murphys",
    path: "/meet-me-in-murphys",
    town: "Murphys",
    townSlug: "murphys",
    nameMatch: "meet me in murphys",
    label: "Meet Me in Murphys",
    heading: "Looking for Meet Me in Murphys?",
    blurb: "What it is, the 2026 date, and whether a next concert is confirmed.",
    h1: "Meet Me in Murphys",
    lead: "Meet Me in Murphys is a summer concert in Murphys, CA. The 2026 listing was Saturday, September 5 at 2:00 PM at 236 Crestview Drive. That show was cancelled, and no later date is confirmed on our calendar yet.",
    metaTitle: "Meet Me in Murphys 2026 | Concert Date & Location",
    metaDescription:
      "Meet Me in Murphys is a summer concert in Murphys, CA. The 2026 listing was September 5 at 236 Crestview Drive and was cancelled. Confirmed future dates show here.",
    listedAddress: "236 Crestview Drive, Murphys, CA 95247",
    listedDate: "Saturday, September 5, 2026",
    listedTime: "2:00 PM",
    listedStatus: "cancelled",
    officialUrl: "https://meetmeinmurphys.com",
    editorial: [
      "Meet Me in Murphys is the name on a summer concert listing in Murphys, not a Main Street venue. The only row we have carried is the 2026 summer concert, listed for Saturday, September 5 at 2:00 PM at 236 Crestview Drive. That listing was later cancelled.",
      "If the organizers announce another date, it will show in the list below as soon as it hits our calendar. We do not have a ticket price on file, and we will not guess one. The 2026 listing pointed people to meetmeinmurphys.com for tickets and details.",
    ],
    qa: [
      {
        q: "What is Meet Me in Murphys?",
        a: "A summer concert in Murphys, CA. The only dated listing we have is Saturday, September 5, 2026 at 2:00 PM, and that show was cancelled.",
      },
      {
        q: "When is Meet Me in Murphys 2026?",
        a: "Saturday, September 5, 2026, at 2:00 PM, per the listing. That concert was cancelled. We do not have a confirmed replacement date.",
      },
      {
        q: "Where is Meet Me in Murphys held?",
        a: "The 2026 listing put it at 236 Crestview Drive, Murphys, CA 95247. We do not have a different venue on file for any later date.",
      },
      {
        q: "Was Meet Me in Murphys 2026 cancelled?",
        a: "Yes. The September 5, 2026 concert listing was cancelled. If a new date is confirmed, it will appear on this page.",
      },
      {
        q: "Who was playing Meet Me in Murphys 2026?",
        a: "The cancelled September 5 listing named The Wailers, Somer Moon, and Ryan Woodard. We do not have a lineup for any later date.",
      },
      {
        q: "How do I get tickets to Meet Me in Murphys?",
        a: "There is no confirmed upcoming show on our calendar, so there is nothing to buy here. The cancelled 2026 listing pointed ticket buyers to meetmeinmurphys.com.",
      },
      {
        q: "When is the next Meet Me in Murphys concert?",
        a: "Unknown. We do not have a confirmed date after the cancelled September 5, 2026 listing. New dates show in the list on this page once they are on the calendar.",
      },
    ],
  },
];

/** True when this event row is a Meet Me in Murphys listing. Name substring
 *  plus town, so a similarly named show in another town never lands here. */
export function isMeetMeEvent(
  guide: MeetMeGuide,
  e: Pick<Hwy4Event, "name" | "town">
): boolean {
  const name = (e.name ?? "").toLowerCase();
  const town = (e.town ?? "").trim().toLowerCase();
  return name.includes(guide.nameMatch) && town === guide.town.toLowerCase();
}

/** The guide a town page should feature, or null. Year-round on purpose:
 *  the page is the durable answer even when the next date is unknown. */
export function meetMeGuideForTown(townSlug: string): MeetMeGuide | null {
  return MEET_ME_GUIDES.find((g) => g.townSlug === townSlug) ?? null;
}

/** The guide an event belongs to, for the detail page's BrowseSimilar chip. */
export function meetMeGuideForEvent(
  e: Pick<Hwy4Event, "name" | "town">
): MeetMeGuide | null {
  return MEET_ME_GUIDES.find((g) => isMeetMeEvent(g, e)) ?? null;
}

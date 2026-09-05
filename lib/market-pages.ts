// Evergreen farmers-market guide pages: /murphys-farmers-market,
// /angels-camp-farmers-market.
//
// Why these exist (roadmap ticket HWY-31). "murphys farmers market" is the
// largest un-captured audience the site has: 148 impressions at position 8.6,
// with "murphys farmers market 2026" (69 impressions, position 5.2) and a tail
// of "murphys ca farmers market" / "farmers market murphys ca" behind it.
// Angels Camp runs the same shape at 102 impressions.
//
// What was ranking for all of it was a DATED event-instance page,
// /events/murphys-park-farmers-market-2026-09-06-murphys, and the equity was
// split across seven live instances of the same weekly market. That is the
// exact failure the venue hubs (HWY-9) and the July 4th guides (HWY-6) were
// built to fix: a URL with a date in it cannot accumulate, because it expires
// every week and takes its ranking with it. A weekly market is an annual event
// that happens to repeat, so it gets the same treatment: one year-less URL that
// every season's rows feed, and that no single Sunday can take down with it.
//
// Copy here is fixed and human-written, never LLM-generated, and every fact in
// it is read off the live listings (day, hours, park, street address, season
// bounds). The no-em-dash and voice rules are locked by
// scripts/test/market-pages.test.ts.
//
// Relative (not "@/") imports so the scripts/ test runner can import this.

import type { Hwy4Event } from "./types";

export type MarketGuide = {
  key: string;
  /** Year-less on purpose: the URL must be reusable every season. */
  path: string;
  /** Display town; must match hwy4_events.town for the event filter. */
  town: string;
  townSlug: string;
  /** Substring that identifies this market's rows by name (lowercased). */
  nameMatch: string;
  /** Chip text on an event detail page (BrowseSimilar). */
  label: string;
  /** Town-page callout heading. */
  heading: string;
  /** Town-page callout sub-line. */
  blurb: string;
  h1: string;
  /** The plain "day, time, place" sentence. First thing a searcher needs, and
   *  the sentence an answer engine can lift whole. */
  lead: string;
  metaTitle: string;
  metaDescription: string;
  venue: string;
  address: string;
  /** Weekday the market runs, e.g. "Sunday". */
  day: string;
  /** Human hours, e.g. "9:00 AM to 1:00 PM". */
  hours: string;
  /** Typical season in words. Deliberately hedged: organizers shift the end
   *  date year to year, and a stale hard date is worse than an honest range. */
  season: string;
  editorial: string[];
  qa: { q: string; a: string }[];
};

export const MARKET_GUIDES: MarketGuide[] = [
  {
    key: "murphys-farmers-market",
    path: "/murphys-farmers-market",
    town: "Murphys",
    townSlug: "murphys",
    nameMatch: "farmers market",
    label: "Murphys Farmers Market",
    heading: "Looking for the Murphys Farmers Market?",
    blurb: "Sunday mornings at Murphys Community Park, with the dates for this season.",
    h1: "Murphys Farmers Market",
    lead: "The Murphys Park Farmers Market runs Sunday mornings from 9:00 AM to 1:00 PM at Murphys Community Park, 505 Algiers Street in Murphys, CA. It runs through the warm months, usually from late May into late October.",
    metaTitle: "Murphys Farmers Market: Days, Hours & Location (Murphys, CA)",
    metaDescription:
      "The Murphys Park Farmers Market runs Sunday mornings, 9 AM to 1 PM, at Murphys Community Park on Algiers Street. Season dates, parking, and what to expect.",
    venue: "Murphys Community Park",
    address: "505 Algiers Street, Murphys, CA 95247",
    day: "Sunday",
    hours: "9:00 AM to 1:00 PM",
    season: "late May into late October",
    editorial: [
      "It sits in the park along Murphys Creek, which is most of the appeal. There is shade, there is running water, and there is usually live music going while you shop, so it reads more like a Sunday morning in the park than an errand. Kids and dogs are a normal part of the scene.",
      "Go early if you want the good produce and a parking spot near the entrance. By late morning the lot fills and people start parking along the residential streets and walking in. If you are coming from out of town, the market pairs well with the rest of Main Street, which is a five-minute drive and open by the time the market winds down.",
      "Dates below come straight from this season's listings, so they stay current on their own. When the season ends, this page keeps the details and fills back in next spring.",
    ],
    qa: [
      {
        q: "What day is the Murphys Farmers Market?",
        a: "Sunday. The Murphys Park Farmers Market runs Sunday mornings from 9:00 AM to 1:00 PM at Murphys Community Park.",
      },
      {
        q: "Where is the Murphys Farmers Market held?",
        a: "Murphys Community Park, 505 Algiers Street, Murphys, CA 95247. It is set up in the park along Murphys Creek, a short drive from Main Street.",
      },
      {
        q: "What time does the Murphys Farmers Market open and close?",
        a: "It opens at 9:00 AM and closes at 1:00 PM. Produce vendors tend to sell out of the popular items well before closing, so earlier is better.",
      },
      {
        q: "Is there a cost to get into the Murphys Farmers Market?",
        a: "No. There is no admission charge to walk the market. Bring cash or a card for the vendors themselves, since not every booth takes cards.",
      },
      {
        q: "When does the Murphys Farmers Market season start and end?",
        a: "It runs through the warm months, typically from late May into late October. The exact opening and closing Sundays shift year to year, and the confirmed dates for this season are listed on this page.",
      },
      {
        q: "Is there live music at the Murphys Farmers Market?",
        a: "Usually, yes. The market regularly has live music playing by the creek while it is open, which is part of why people linger rather than just shop and leave.",
      },
    ],
  },
  {
    key: "angels-camp-farmers-market",
    path: "/angels-camp-farmers-market",
    town: "Angels Camp",
    townSlug: "angels-camp",
    nameMatch: "farmers market",
    label: "Angels Camp Farmers Market",
    heading: "Looking for the Angels Camp Farmers Market?",
    blurb: "Friday evenings at Utica Park, with the dates for this season.",
    h1: "Angels Camp Farmers Market",
    lead: "The Angels Camp Farmers Market runs Friday evenings from 4:30 PM to 7:30 PM at Utica Park, 1075 Utica Lane in Angels Camp, CA. It runs through the summer, usually from June into late September.",
    metaTitle: "Angels Camp Farmers Market: Days, Hours & Location (Angels Camp, CA)",
    metaDescription:
      "The Angels Camp Farmers Market runs Friday evenings, 4:30 to 7:30 PM, at Utica Park on Utica Lane. Season dates, parking, and what to expect.",
    venue: "Utica Park",
    address: "1075 Utica Lane, Angels Camp, CA 95222",
    day: "Friday",
    hours: "4:30 PM to 7:30 PM",
    season: "June into late September",
    editorial: [
      "This one is an evening market, which makes it a different animal from the Sunday morning market up the hill in Murphys. It is sponsored by the Angels Camp Business Association, it has been running for over twenty seasons, and it lands at the end of the work week, so it functions as much as a place to run into people as a place to buy tomatoes.",
      "Utica Park has real shade and room for kids to run, and there is normally music going. Come hungry, because a good share of the booths are prepared food rather than produce.",
      "Dates below come straight from this season's listings, so they stay current on their own. When the season ends, this page keeps the details and fills back in next summer.",
    ],
    qa: [
      {
        q: "What day is the Angels Camp Farmers Market?",
        a: "Friday. The Angels Camp Farmers Market runs Friday evenings from 4:30 PM to 7:30 PM at Utica Park.",
      },
      {
        q: "Where is the Angels Camp Farmers Market held?",
        a: "Utica Park, 1075 Utica Lane, Angels Camp, CA 95222.",
      },
      {
        q: "What time does the Angels Camp Farmers Market start?",
        a: "It opens at 4:30 PM and runs until 7:30 PM, so it is an after-work market rather than a morning one.",
      },
      {
        q: "Is there a cost to get into the Angels Camp Farmers Market?",
        a: "No. There is no admission charge to walk the market. Bring cash or a card for the vendors, since not every booth takes cards.",
      },
      {
        q: "When does the Angels Camp Farmers Market season start and end?",
        a: "It runs through the summer, typically from June into late September. The exact opening and closing Fridays shift year to year, and the confirmed dates for this season are listed on this page.",
      },
    ],
  },
];

/** True when this event row is an instance of the given market. Name substring
 *  plus town, because both markets share the generic "farmers market" phrase
 *  and only the town separates them. */
export function isMarketEvent(
  guide: MarketGuide,
  e: Pick<Hwy4Event, "name" | "town">
): boolean {
  const name = (e.name ?? "").toLowerCase();
  const town = (e.town ?? "").trim().toLowerCase();
  return name.includes(guide.nameMatch) && town === guide.town.toLowerCase();
}

/** The guide a town page should feature, or null. Year-round on purpose: like
 *  the holiday guides, the page is the durable landing spot off-season too. */
export function marketGuideForTown(townSlug: string): MarketGuide | null {
  return MARKET_GUIDES.find((g) => g.townSlug === townSlug) ?? null;
}

/** The guide an event belongs to, for the detail page's BrowseSimilar chip. */
export function marketGuideForEvent(
  e: Pick<Hwy4Event, "name" | "town">
): MarketGuide | null {
  return MARKET_GUIDES.find((g) => isMarketEvent(g, e)) ?? null;
}

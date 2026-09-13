// Evergreen persona SEO hubs (roadmap ticket HWY-39): year-less URLs for
// the GSC-winning query clusters that still land on dated event-instance
// pages. Same spine as the Meet Me in Murphys guide (HWY-38): search-shaped
// title/H1, facts from real listings only, visible Q&A, and a self-filling
// upcoming list from the shared cached feed. Blank beats wrong.
//
// Shipped here:
//   /arnold-car-show          "arnold car show" / "arnold car show 2026"
//   /hermitfest               "hermitfest 2026" / "hermit fest 2026"
//   /brice-station-concerts   "brice station concerts 2026"
// Farmers-market guides already shipped as HWY-31
// (/murphys-farmers-market, /angels-camp-farmers-market) and are not
// duplicated here.
//
// Copy is fixed and human-written, never LLM-generated. Locked by
// scripts/test/persona-hubs.test.ts.
//
// Relative (not "@/") imports so the scripts/ test runner can import this.

import type { Hwy4Event } from "./types";

export type PersonaHubKey =
  | "arnold-car-show"
  | "hermitfest"
  | "brice-station-concerts";

export type PersonaHubFact = {
  label: string;
  value: string;
  /** Span both columns of the facts box. */
  wide?: boolean;
};

export type PersonaHubChip = {
  href: string;
  label: string;
  external?: boolean;
};

export type PersonaHub = {
  key: PersonaHubKey;
  /** Year-less on purpose: the URL must survive each year's listing. */
  path: string;
  town: string;
  townSlug: string;
  /** Venue hubs that should call this page out (inbound, not the matcher). */
  venueKeys: string[];
  label: string;
  heading: string;
  blurb: string;
  h1: string;
  lead: string;
  metaTitle: string;
  metaDescription: string;
  facts: PersonaHubFact[];
  related: PersonaHubChip[];
  officialUrl?: string;
  officialLabel?: string;
  upcomingHeading: string;
  emptyUpcoming: string;
  newsletterHeading: string;
  editorial: string[];
  qa: { q: string; a: string }[];
};

export type PersonaHubEvent = Pick<
  Hwy4Event,
  "name" | "town" | "venue_key" | "category"
>;

export const PERSONA_HUBS: PersonaHub[] = [
  {
    key: "arnold-car-show",
    path: "/arnold-car-show",
    town: "Arnold",
    townSlug: "arnold",
    venueKeys: ["white-pines-lake-park"],
    label: "Arnold Car Show",
    heading: "Looking for the Arnold car show?",
    blurb: "The September Classic Car Show at White Pines Lake, with the confirmed 2026 date.",
    h1: "Arnold Car Show",
    lead: "The 21st Arnold Classic Car Show is Saturday, September 19, 2026, from 10:00 AM to 4:00 PM at White Pines Lake Park, 1965 Blagen Road in Arnold, CA. Confirmed dates show below.",
    metaTitle: "Arnold Car Show 2026 | Date, Time & Location",
    metaDescription:
      "The 21st Arnold Classic Car Show is Saturday, September 19, 2026, 10 AM to 4 PM at White Pines Lake Park in Arnold, CA. Hours, location, and confirmed dates.",
    facts: [
      { label: "2026 date", value: "Saturday, September 19" },
      { label: "Hours", value: "10:00 AM to 4:00 PM" },
      {
        label: "Where",
        value: "White Pines Lake Park, 1965 Blagen Road, Arnold, CA 95223",
        wide: true,
      },
      { label: "Admission", value: "Unknown. The listing does not state a price." },
    ],
    related: [
      { href: "/venues/white-pines-lake-park", label: "White Pines Lake" },
      { href: "/arnold-4th-of-july", label: "Arnold 4th of July" },
    ],
    upcomingHeading: "Upcoming Arnold car show dates",
    emptyUpcoming:
      "No upcoming Arnold car show dates are on the calendar. The 2026 Classic Car Show listing was September 19. If organizers announce another date, it will show here.",
    newsletterHeading: "Want a heads-up when next year's show is listed?",
    editorial: [
      "The Arnold Classic Car Show is the September show at White Pines Lake Park. The 2026 listing is the 21st year: Saturday, September 19, from 10:00 AM to 4:00 PM at 1965 Blagen Road. The listing names classic cars, hot rods, customs, motorcycles, and 4x4s, and says proceeds support White Pines Park maintenance.",
      "The listing does not state an admission price, and we will not guess one. It notes that food vendors and live music have been staples of past events. Confirmed dates land in the list below as soon as they hit the calendar.",
    ],
    qa: [
      {
        q: "When is the Arnold car show 2026?",
        a: "Saturday, September 19, 2026, from 10:00 AM to 4:00 PM, per the 21st Arnold Classic Car Show listing.",
      },
      {
        q: "Where is the Arnold car show held?",
        a: "White Pines Lake Park, 1965 Blagen Road, Arnold, CA 95223.",
      },
      {
        q: "What time does the Arnold car show start?",
        a: "10:00 AM. The 2026 listing runs until 4:00 PM.",
      },
      {
        q: "How much does the Arnold car show cost?",
        a: "Unknown. The listing we have does not state an admission price.",
      },
      {
        q: "What is the Arnold Classic Car Show?",
        a: "An annual show at White Pines Lake Park. The 2026 listing is the 21st year and names classic cars, hot rods, customs, motorcycles, and 4x4s. Proceeds support White Pines Park maintenance.",
      },
      {
        q: "Was there another Arnold car show in 2026?",
        a: "Yes. The Ebbetts Pass Women of the Moose also ran a car show and chili cook-off on August 15, 2026, at the lodge by White Pines Lake. That listing is past.",
      },
    ],
  },
  {
    key: "hermitfest",
    path: "/hermitfest",
    town: "Bear Valley",
    townSlug: "bear-valley",
    venueKeys: ["bear-valley-meadow", "bear-valley-resort"],
    label: "Hermitfest",
    heading: "Looking for Hermitfest?",
    blurb: "Hermitfest West in Bear Valley: the 2026 dates, hours, and official schedule.",
    h1: "Hermitfest",
    lead: "Hermitfest West is a family-friendly music festival at Grizzly Ballfield in Bear Valley, CA. For 2026 it runs September 12 and 13. Admission is free. Saturday music starts noonish; Sunday yoga is at 9 AM, with music to 2 PM.",
    metaTitle: "Hermitfest 2026 | Dates & Location (Bear Valley, CA)",
    metaDescription:
      "Hermitfest West is free at Grizzly Ballfield in Bear Valley, CA on September 12 and 13, 2026. Saturday from noonish; Sunday yoga 9 AM, music to 2 PM.",
    facts: [
      { label: "2026 dates", value: "September 12 and 13" },
      { label: "Hours", value: "Sat from noonish; Sun yoga 9 AM, music to 2 PM" },
      {
        label: "Where",
        value: "Grizzly Ballfield (Bear Valley Ballfield), Bear Valley, Alpine County, CA",
        wide: true,
      },
      { label: "Admission", value: "Free" },
    ],
    related: [
      { href: "/live-music", label: "Live music" },
      { href: "/venues/bear-valley-meadow", label: "Bear Valley Meadow" },
    ],
    officialUrl: "https://scenic4.org/events/hermitfest-west/",
    officialLabel: "Official Hermitfest page",
    upcomingHeading: "Upcoming Hermitfest dates",
    emptyUpcoming:
      "No upcoming Hermitfest dates are on the calendar. The 2026 festival was September 12 and 13 in Bear Valley. If next year's dates are confirmed, they will show here.",
    newsletterHeading: "Want a heads-up when next year's Hermitfest lands?",
    editorial: [
      "Hermitfest West is the Bear Valley edition of Hermitfest, put on by the Ebbetts Pass National Scenic Byway Association. The official page puts the 2026 festival at Grizzly Ballfield (also called Bear Valley Ballfield) in Bear Valley, Alpine County, CA, on Saturday, September 12 and Sunday, September 13. Admission is free.",
      "Saturday on the official schedule starts noonish with Deep Thicket Dwellers, then Grover Anderson & The Lampoliers at 1:30, The HighLife Band at 3:30, a dinner break at 5:30, Greg Sutton & Friends at 6:30, and The Hermitfest All Stars at 7:30. Sunday lists yoga with Alex Mannos at 9:00, guided bike rides with Bear Valley Adventure Company at 10:00, then music from about 10:10 to 2:00: Kiana at 10:10, Lainy McGreen at 10:45, West Muir at 11:25, Dominick Restivo at 12:05, Desiree & Cyrus at 12:45, and Ty & Connor at 1:25. The official page does not publish a Saturday end time.",
    ],
    qa: [
      {
        q: "When is Hermitfest 2026?",
        a: "Saturday, September 12 and Sunday, September 13, 2026, at Grizzly Ballfield in Bear Valley, CA.",
      },
      {
        q: "Where is Hermitfest held?",
        a: "Grizzly Ballfield (also called Bear Valley Ballfield) in Bear Valley, Alpine County, CA.",
      },
      {
        q: "What time does Hermitfest start?",
        a: "Saturday music starts noonish. Sunday yoga is at 9:00 AM, with music from about 10:10 AM to 2:00 PM.",
      },
      {
        q: "Is Hermitfest free?",
        a: "Yes, admission is free. The official 2026 page lists it as free.",
      },
      {
        q: "What is the 2026 Hermitfest schedule?",
        a: "Saturday starts noonish with Deep Thicket Dwellers, then Grover Anderson & The Lampoliers at 1:30, The HighLife Band at 3:30, a dinner break at 5:30, Greg Sutton & Friends at 6:30, and The Hermitfest All Stars at 7:30. Sunday lists yoga with Alex Mannos at 9:00, guided bike rides with Bear Valley Adventure Company at 10:00, and music from about 10:10 AM to 2:00 PM (Kiana, Lainy McGreen, West Muir, Dominick Restivo, Desiree & Cyrus, and Ty & Connor). The official page does not publish a Saturday end time.",
      },
      {
        q: "What is Hermitfest West?",
        a: "The Bear Valley edition of Hermitfest, an annual outdoor music festival by the Ebbetts Pass National Scenic Byway Association. The official 2026 page lists it as free and family-friendly.",
      },
      {
        q: "Is Hermitfest the same as the Bear Valley Music Festival?",
        a: "No. The Bear Valley Music Festival is a separate multi-week series under the Big White Tent.",
      },
    ],
  },
  {
    key: "brice-station-concerts",
    path: "/brice-station-concerts",
    town: "Murphys",
    townSlug: "murphys",
    venueKeys: ["brice-station"],
    label: "Brice Station Concerts",
    heading: "Looking for Brice Station concerts?",
    blurb: "The current concert schedule at Brice Station Vineyards, plus the address and ticket link.",
    h1: "Brice Station Concerts",
    lead: "Brice Station Vineyards is a tasting room and outdoor concert venue at 3353 East Highway 4, Murphys, CA, on Highway 4 between Murphys and Avery. Upcoming concert dates are listed below.",
    metaTitle: "Brice Station Concerts 2026 | Schedule (Murphys, CA)",
    metaDescription:
      "Brice Station Vineyards concerts in Murphys, CA: the current schedule, ticket link, and address at 3353 East Highway 4. Updated from the live calendar.",
    facts: [
      { label: "Venue", value: "Brice Station Vineyards" },
      { label: "Tickets", value: "bricestation.com" },
      {
        label: "Address",
        value: "3353 East Highway 4, Murphys, CA 95247",
        wide: true,
      },
    ],
    related: [
      { href: "/venues/brice-station", label: "Brice Station venue" },
      { href: "/live-music", label: "Live music" },
      { href: "/murphys-farmers-market", label: "Murphys Farmers Market" },
    ],
    officialUrl: "https://www.bricestation.com/",
    officialLabel: "Venue site",
    upcomingHeading: "Upcoming concerts at Brice Station",
    emptyUpcoming:
      "No upcoming concerts at Brice Station are on the calendar right now. New dates show here as the venue lists them.",
    newsletterHeading: "Want Thursday's Brice and corridor lineup?",
    editorial: [
      "Brice Station Vineyards sits on Highway 4 between Murphys and Avery, at 3353 East Highway 4, Murphys, CA 95247. It is a tasting room with an outdoor concert venue on the property. Several listings use the name Hilltop Concert Series.",
      "Concert dates and ticket prices vary by show. We only print a price when a listing states one. Tickets are sold on the venue's own site, bricestation.com. The list below is every upcoming public concert on our calendar at this venue.",
    ],
    qa: [
      {
        q: "What concerts are coming up at Brice Station?",
        a: "The confirmed public concert dates are in the list on this page. They change as the venue adds shows.",
      },
      {
        q: "Where is Brice Station?",
        a: "3353 East Highway 4, Murphys, CA 95247, on Highway 4 between Murphys and Avery.",
      },
      {
        q: "How do I get tickets to Brice Station concerts?",
        a: "The venue sells tickets at bricestation.com. Prices vary by show; we list a price only when a listing states one.",
      },
      {
        q: "What time do Brice Station concerts start?",
        a: "Start times vary by show. Several 2026 Hilltop Concert Series listings started at 7:00 PM. Other dates on this page start at different times, so check the listing.",
      },
      {
        q: "Is Brice Station in Murphys?",
        a: "Yes. The tasting room and concert venue sit at 3353 East Highway 4, Murphys, CA 95247.",
      },
      {
        q: "What is the Hilltop Concert Series?",
        a: "That is the name on several of Brice Station's concert listings. It is an outdoor series at the vineyard. We do not have a published season end date.",
      },
    ],
  },
];

export function isArnoldCarShowEvent(
  e: Pick<Hwy4Event, "name" | "town">
): boolean {
  const name = (e.name ?? "").toLowerCase();
  const town = (e.town ?? "").trim().toLowerCase();
  if (town !== "arnold") return false;
  if (!name.includes("car show")) return false;
  // Volunteer setup is not the show.
  if (name.includes("setup")) return false;
  return true;
}

export function isHermitfestEvent(e: Pick<Hwy4Event, "name" | "town">): boolean {
  const name = (e.name ?? "").toLowerCase().replace(/\s+/g, " ");
  const town = (e.town ?? "").trim().toLowerCase();
  if (town !== "bear valley") return false;
  return name.includes("hermitfest") || name.includes("hermit fest");
}

export function isBriceConcertEvent(
  e: Pick<Hwy4Event, "name" | "town" | "venue_key" | "category">
): boolean {
  if (e.category !== "live_music") return false;
  if (e.venue_key === "brice-station") return true;
  const name = (e.name ?? "").toLowerCase();
  const town = (e.town ?? "").trim().toLowerCase();
  return name.includes("brice station") && town === "murphys";
}

export function isPersonaHubEvent(
  guide: PersonaHub,
  e: PersonaHubEvent
): boolean {
  switch (guide.key) {
    case "arnold-car-show":
      return isArnoldCarShowEvent(e);
    case "hermitfest":
      return isHermitfestEvent(e);
    case "brice-station-concerts":
      return isBriceConcertEvent(e);
  }
}

/** Town-page callouts. Year-round: the page is the durable query target
 *  even when the upcoming list is empty. A town can have more than one. */
export function personaHubsForTown(townSlug: string): PersonaHub[] {
  return PERSONA_HUBS.filter((g) => g.townSlug === townSlug);
}

/** The hub an event belongs to, for the detail page's BrowseSimilar chip. */
export function personaHubForEvent(e: PersonaHubEvent): PersonaHub | null {
  return PERSONA_HUBS.find((g) => isPersonaHubEvent(g, e)) ?? null;
}

/** The hub a venue page should call out, or null. */
export function personaHubForVenueKey(venueKey: string): PersonaHub | null {
  return PERSONA_HUBS.find((g) => g.venueKeys.includes(venueKey)) ?? null;
}

export function personaHubByKey(key: PersonaHubKey): PersonaHub {
  const hit = PERSONA_HUBS.find((g) => g.key === key);
  if (!hit) throw new Error(`unknown persona hub: ${key}`);
  return hit;
}

// Calaveras / Highway 4 corridor — region instance #1 (the original).
//
// INSTANCE FILE: forks and sibling regions ship their own copy of this
// directory; it never flows upstream. Every value here was moved VERBATIM
// from the engine file that used to hardcode it (noted per block) — if you
// change one, you are changing the live site's rendered bytes on purpose.

import type { RegionCore, TownInfo } from "../types";

// Moved verbatim from lib/towns.ts (ordered west to east, ascending elevation).
const CORRIDOR_TOWNS: TownInfo[] = [
  {
    name: "Copperopolis",
    elevation: 850,
    tagline: "Copper country at the base",
    lat: 37.9810,
    lng: -120.6380,
  },
  {
    name: "Angels Camp",
    elevation: 1300,
    tagline: "Gold Rush gateway town",
    lat: 38.0685,
    lng: -120.5396,
  },
  {
    name: "Murphys",
    elevation: 2100,
    tagline: "Wine country in the pines",
    lat: 38.1372,
    lng: -120.4610,
  },
  {
    name: "Avery",
    elevation: 2800,
    tagline: "Quiet stop on the way up",
    lat: 38.1860,
    lng: -120.3870,
    mapZoom: 13,
  },
  {
    name: "White Pines",
    elevation: 3500,
    tagline: "Just below Arnold",
    lat: 38.1970,
    lng: -120.3590,
  },
  {
    name: "Arnold",
    elevation: 4000,
    tagline: "Heart of the corridor",
    lat: 38.2144,
    lng: -120.3510,
    defaultAddress: "961 Highway 4, Arnold CA",
    mapZoom: 13,
  },
  {
    name: "Dorrington",
    elevation: 4800,
    tagline: "Quiet mountain hamlet",
    lat: 38.2280,
    lng: -120.2960,
    mapZoom: 13,
  },
  {
    name: "Camp Connell",
    elevation: 5000,
    tagline: "Deep in the pines",
    lat: 38.2340,
    lng: -120.2750,
    mapZoom: 13,
  },
  {
    name: "Bear Valley",
    elevation: 7000,
    tagline: "Alpine resort at the summit",
    lat: 38.4646,
    lng: -120.0399,
    mapZoom: 14,
  },
];

export const CALAVERAS_CORE: RegionCore = {
  slug: "calaveras",

  // ----- identity / brand (moved from lib/constants.ts + app/layout.tsx +
  // components/Header.tsx + app/manifest.ts + components/WeeklyBriefing.tsx +
  // components/RobsPicks.tsx) -----
  siteName: "Hwy 4 Events",
  siteRef: "Hwy4Events.com",
  domain: "hwy4events.com",
  defaultSiteUrl: "https://hwy4events.com",
  botName: "Hwy4EventsBot",
  titleSuffix: "Sierra Nevada Foothills",
  siteDescription:
    "Today's events and this week's lineup along the Highway 4 corridor — live music, festivals, and community happenings from Angels Camp to Bear Valley, updated daily with an opinionated briefing.",
  siteOgDescription:
    "What's happening today on the 4? Daily briefing + event listings from Angels Camp to Bear Valley.",
  ogImageAlt:
    "Hwy 4 Events — Today's events and this week along the Highway 4 corridor",
  manifestDescription:
    "Live music, festivals, and community events along the Highway 4 corridor in Calaveras County.",
  headerTagline: "From the Frog Jump to the Grizzly Chair",
  footerLede: [
    "Events along the Highway 4 corridor",
    "from Angels Camp to Bear Valley.",
  ],
  briefingTitle: "Today on the 4",
  picksLabel: "Rob's Pick",
  picksLabelPlural: "Rob's Picks",
  theme: { backgroundColor: "#faf8f5", themeColor: "#1a3a2a" },
  mascot: {
    name: "Millie",
    imgAlt: "Millie the sheepadoodle",
    headerAsset: "/millie-happy.svg",
  },
  // Moved from app/og/route.tsx (the default social card).
  og: {
    kicker: "Highway 4 Corridor",
    townsLine: "Angels Camp · Murphys · Arnold · Bear Valley",
    subline: "Live music, festivals & community events in the Sierra foothills",
  },

  // ----- media / link trust (moved from lib/image-hosts.ts,
  // lib/event-link.ts, components/EventCard.tsx) -----
  imageHosts: [
    "hwy4events.com",
    "blsha.com",
    "www.gocalaveras.com",
    "www.thebistroespresso.com",
    "visitmurphys.com",
  ],
  unstableSourceHosts: ["gocalaveras.com"],
  sourceHostLabels: { "gocalaveras.com": "GoCalaveras" },
  sourceSlugLabels: {
    "moose-lodge": "Moose Lodge",
    "sequoia-woods": "Sequoia Woods",
    "bear-valley": "Bear Valley",
    "blue-lake-springs": "Blue Lake Springs",
    "watering-hole": "The Watering Hole",
    "gocalaveras": "GoCalaveras",
    "visit-murphys": "Visit Murphys",
  },

  // ----- geography / time -----
  stateCode: "CA",
  stateName: "California",
  countryCode: "US",
  timezone: "America/Los_Angeles",
  geo: {
    towns: CORRIDOR_TOWNS,
    // Moved from lib/towns.ts.
    townAddressAliases: ["Hathaway Pines"],
    // Moved from lib/geo.ts — generous box around the Hwy 4 / Calaveras corridor.
    visitorBox: { latMin: 37.9, latMax: 38.6, lngMin: -120.75, lngMax: -119.95 },
    // Moved from lib/geo.ts — corridor + immediate Calaveras towns (lowercased).
    // Widened 2026-09-04 to the rest of Calaveras County: Valley Springs alone
    // had 299 sessions since June labeled "visitor" (it sits just west of the
    // box), against 329 sessions labeled "local" in total.
    localIpCities: [
      "arnold",
      "murphys",
      "angels camp",
      "angels",
      "city of angels",
      "avery",
      "copperopolis",
      "dorrington",
      "white pines",
      "camp connell",
      "vallecito",
      "douglas flat",
      "hathaway pines",
      "bear valley",
      "mountain ranch",
      "san andreas",
      "altaville",
      "valley springs",
      "mokelumne hill",
      "wallace",
      "burson",
      "jenny lind",
      "milton",
      "campo seco",
      "paloma",
      "rail road flat",
      "glencoe",
      "west point",
      "wilseyville",
      "sheep ranch",
    ],
    // Regional ISP hubs (lowercased). Verified 2026-09-04: a Comcast connection
    // in Arnold geolocates to Lodi. Each of these mixes hub-routed corridor
    // residents with genuine Central Valley visitors, so lib/geo.ts counts them
    // as "hub", apart from both. Session counts since 2026-06-08 (view, non-bot):
    // Sacramento 1,365 · Stockton 1,054 · Modesto 109 · Lodi 108 · Sonora 29
    // (Sonora read "local" via the box until this list took precedence).
    // Deliberately NOT listed, pending evidence: Tracy (230) and Elk Grove (193)
    // run high per capita but have no verified hub-routing story; adding one is
    // a one-line change here. San Jose (791) is real visitor traffic.
    hubIpCities: ["sacramento", "stockton", "lodi", "modesto", "sonora"],
    // Moved from app/api/sync-venue-facts/route.ts — corridor center
    // (Arnold-ish) + radius to bias Places Text Search.
    placesBias: { lat: 38.1846, lng: -120.3517, radiusMeters: 45000.0 },
  },
};

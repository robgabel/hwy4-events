/**
 * Known venue registry for the Highway 4 corridor.
 *
 * When scrapers produce generic venue names (e.g. "Downtown Murphys"),
 * the venue matcher checks event titles and descriptions against these
 * aliases to resolve the actual venue.
 */

export interface KnownVenue {
  /** Canonical display name */
  canonical: string;
  /** Lowercase aliases to match against (event title, description, venue_name) */
  aliases: string[];
  /** Default town for this venue */
  town: string;
  /** Street address, if known */
  address?: string;
}

/**
 * Master list of known venues along the Highway 4 corridor.
 *
 * To add a venue: add an entry with a unique key, canonical name,
 * lowercase aliases (include common misspellings and abbreviations),
 * and the town. The matcher will scan event text for any alias match.
 */
export const KNOWN_VENUES: Record<string, KnownVenue> = {
  "murphys-irish-pub": {
    canonical: "Murphys Irish Pub",
    aliases: [
      "murphys irish pub",
      "murphy's irish pub",
      "murphys irish",
      "irish pub murphys",
    ],
    town: "Murphys",
    address: "464 Main St, Murphys, CA 95247",
  },
  "poor-house": {
    canonical: "The Poor House",
    aliases: [
      "the poor house",
      "poor house",
      "murphys poor house",
      "murphy's poor house",
    ],
    town: "Murphys",
    address: "467 Main St, Murphys, CA 95247",
  },
  "wine-beer-garden": {
    canonical: "Murphys Wine & Beer Garden",
    aliases: [
      "wine & beer garden",
      "wine and beer garden",
      "murphys wine & beer garden",
      "murphy's wine & beer garden",
      "murphys wine and beer garden",
      "murphy's wine and beer garden",
      "beer garden murphys",
    ],
    town: "Murphys",
  },
  "ironstone": {
    canonical: "Ironstone Vineyards",
    aliases: [
      "ironstone",
      "ironstone vineyards",
      "ironstone amphitheatre",
      "ironstone amphitheater",
      "ironstone winery",
    ],
    town: "Murphys",
    address: "1894 Six Mile Rd, Murphys, CA 95247",
  },
  "watering-hole": {
    canonical: "The Watering Hole",
    aliases: [
      "the watering hole",
      "watering hole",
      "watering hole murphys",
    ],
    town: "Murphys",
    address: "151 Main St, Murphys, CA 95247",
  },
  "branding-iron": {
    canonical: "Branding Iron Saloon",
    aliases: [
      "branding iron",
      "branding iron saloon",
      "the branding iron",
    ],
    town: "Murphys",
    address: "458 Main St, Murphys, CA 95247",
  },
  "lube-room": {
    canonical: "The Lube Room Saloon",
    aliases: [
      "lube room",
      "the lube room",
      "lube room saloon",
    ],
    town: "Dorrington",
    address: "3497 CA-4, Dorrington, CA 95223",
  },
  "mystic-saloon": {
    canonical: "Howard's Mystic Saloon",
    aliases: [
      "mystic saloon",
      "howard's mystic",
      "howards mystic",
      "mystic saloon avery",
    ],
    town: "Avery",
  },
  "camp-connell-general-store": {
    canonical: "Camp Connell General Store",
    aliases: [
      "camp connell general store",
      "general store camp connell",
    ],
    town: "Camp Connell",
    address: "3190 CA-4, Camp Connell, CA 95223",
  },
  "bear-valley-resort": {
    canonical: "Bear Valley Mountain Resort",
    aliases: [
      "bear valley mountain resort",
      "bear valley resort",
      "bear valley ski",
    ],
    town: "Bear Valley",
  },
  "bear-valley-lodge": {
    canonical: "Bear Valley Lodge",
    aliases: [
      "bear valley lodge",
    ],
    town: "Bear Valley",
  },
  "sequoia-woods": {
    canonical: "Sequoia Woods Country Club",
    aliases: [
      "sequoia woods",
      "sequoia woods country club",
    ],
    town: "Arnold",
  },
  "moose-lodge": {
    canonical: "Moose Lodge",
    aliases: [
      "moose lodge",
      "loyal order of moose",
    ],
    town: "Angels Camp",
  },
  "fairgrounds": {
    canonical: "Calaveras County Fairgrounds",
    aliases: [
      "calaveras county fairgrounds",
      "calaveras fairgrounds",
      "county fairgrounds",
      "fairgrounds angels camp",
      "the fairgrounds",
    ],
    town: "Angels Camp",
    address: "101 Frogtown Rd, Angels Camp, CA 95222",
  },
  "brice-station": {
    canonical: "Brice Station Vineyards",
    aliases: [
      "brice station",
      "brice station vineyards",
    ],
    town: "Murphys",
  },
  "murphys-hotel": {
    canonical: "Murphys Historic Hotel",
    aliases: [
      "murphys hotel",
      "murphy's hotel",
      "murphys historic hotel",
      "historic hotel murphys",
    ],
    town: "Murphys",
    address: "457 Main St, Murphys, CA 95247",
  },
  "alchemy": {
    canonical: "Alchemy Murphys",
    aliases: [
      "alchemy murphys",
      "alchemy market",
    ],
    town: "Murphys",
  },
  "newsome-harlow": {
    canonical: "Newsome Harlow Winery",
    aliases: [
      "newsome harlow",
      "newsome-harlow",
    ],
    town: "Murphys",
  },
  "twisted-oak": {
    canonical: "Twisted Oak Winery",
    aliases: [
      "twisted oak",
      "twisted oak winery",
    ],
    town: "Murphys",
  },
  "murphys-community-park": {
    canonical: "Murphys Community Park",
    aliases: [
      "murphys community park",
      "murphys park",
      "community park murphys",
    ],
    town: "Murphys",
  },
  "utica-park": {
    canonical: "Utica Park",
    aliases: [
      "utica park",
    ],
    town: "Angels Camp",
  },
  "angels-camp-museum": {
    canonical: "Angels Camp Museum",
    aliases: [
      "angels camp museum",
    ],
    town: "Angels Camp",
  },
  "greenhorn-creek": {
    canonical: "Greenhorn Creek Resort",
    aliases: [
      "greenhorn creek",
      "greenhorn creek resort",
    ],
    town: "Angels Camp",
  },
  "copperopolis-town-square": {
    canonical: "Copperopolis Town Square",
    aliases: [
      "copperopolis town square",
      "town square copperopolis",
    ],
    town: "Copperopolis",
  },
};

/**
 * Venue names that indicate the scraper couldn't determine the real venue.
 * When we see one of these AND find a known venue in the event text, we override.
 */
export const GENERIC_VENUE_NAMES = new Set([
  "downtown murphys",
  "unknown venue",
  "unknown",
  "tbd",
  "angels camp",
  "murphys",
  "arnold",
  "copperopolis",
  "avery",
  "dorrington",
  "camp connell",
  "bear valley",
  "white pines",
]);

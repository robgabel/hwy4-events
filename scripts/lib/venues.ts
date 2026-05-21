/**
 * Known venue registry for the Highway 4 corridor.
 *
 * When scrapers produce generic venue names (e.g. "Downtown Murphys"),
 * the venue matcher checks event titles and descriptions against these
 * aliases to resolve the actual venue. Addresses populate the map pin
 * and the directions URL on event detail pages.
 *
 * To add a venue:
 *   1. Pick a unique key (kebab-case).
 *   2. Set the canonical display name.
 *   3. List lowercase aliases (the matcher normalizes apostrophes and
 *      whitespace; include common misspellings and variant punctuation).
 *   4. Set town (one of the HWY4_TOWN_LIST values) and address when known.
 *
 * Addresses are populated from authoritative sources via
 * `scripts/enrich-venue-addresses.ts` and reviewed before merging.
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
      "murphys wine bar & beer garden",
      "murphys wine bar and beer garden",
      "beer garden murphys",
    ],
    town: "Murphys",
    address: "472 Main Street, Murphys, CA 95247",
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
      "howard's mystic saloon",
      "mystic saloon avery",
    ],
    town: "Avery",
    address: "4529 Highway 4, Avery, CA 95224",
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
    address: "2280 State Route 207, Bear Valley, CA 95223",
  },
  "bear-valley-lodge": {
    canonical: "Bear Valley Lodge",
    aliases: [
      "bear valley lodge",
    ],
    town: "Bear Valley",
    address: "265 Bear Valley Rd, Bear Valley, CA 95223",
  },
  "sequoia-woods": {
    canonical: "Sequoia Woods Country Club",
    aliases: [
      "sequoia woods",
      "sequoia woods country club",
    ],
    town: "Arnold",
    address: "1000 Cypress Point Drive, Arnold, CA 95223",
  },
  "bistro-espresso": {
    canonical: "Bistro Espresso",
    aliases: [
      "bistro espresso",
      "the bistro espresso",
      "bistro",
    ],
    town: "Arnold",
    address: "1218 CA-4, Arnold, CA 95223",
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
    address: "3353 East Highway 4, Murphys, CA 95247",
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
    address: "191 Main Street, Murphys, CA 95247",
  },
  "newsome-harlow": {
    canonical: "Newsome Harlow Winery",
    aliases: [
      "newsome harlow",
      "newsome-harlow",
    ],
    town: "Murphys",
    address: "403 Main Street, Murphys, CA 95247",
  },
  "twisted-oak": {
    canonical: "Twisted Oak Winery",
    aliases: [
      "twisted oak",
      "twisted oak winery",
    ],
    town: "Murphys",
    // Located at 4280 Red Hill Rd, Vallecito — Vallecito sits just outside
    // the canonical corridor town list, so we leave address unset rather
    // than tag it with a Vallecito ZIP that fails the corridor check.
  },
  "murphys-community-park": {
    canonical: "Murphys Community Park",
    aliases: [
      "murphys community park",
      "murphys park",
      "community park murphys",
    ],
    town: "Murphys",
    address: "505 Algiers Street, Murphys, CA 95247",
  },
  "utica-park": {
    canonical: "Utica Park",
    aliases: [
      "utica park",
      "utica park, angels camp",
    ],
    town: "Angels Camp",
    address: "1075 Utica Lane, Angels Camp, CA 95222",
  },
  "angels-camp-museum": {
    canonical: "Angels Camp Museum",
    aliases: [
      "angels camp museum",
    ],
    town: "Angels Camp",
    address: "753 S Main St, Angels Camp, CA 95222",
  },
  "greenhorn-creek": {
    canonical: "Greenhorn Creek Resort",
    aliases: [
      "greenhorn creek",
      "greenhorn creek resort",
    ],
    town: "Angels Camp",
    address: "711 McCauley Ranch Rd, Angels Camp, CA 95222",
  },
  "copperopolis-town-square": {
    canonical: "Copperopolis Town Square",
    aliases: [
      "copperopolis town square",
      "town square copperopolis",
      "the town square at copper valley",
      "copper valley town square",
    ],
    town: "Copperopolis",
    address: "100 Town Square Rd, Copperopolis, CA 95228",
  },
  "miners-lounge": {
    canonical: "The Miners Lounge",
    aliases: [
      "miners lounge",
      "miner's lounge",
      "the miners lounge",
      "the miner's lounge",
    ],
    town: "Angels Camp",
    address: "1276 S. Main St, Angels Camp, CA 95222",
  },
  "the-pour-house": {
    canonical: "The Pour House",
    aliases: [
      // NOTE: "murphys pourhouse" is a DIFFERENT venue in Murphys —
      // do not alias it here. See "murphys-pourhouse" below.
      "the pour house",
      "pour house copperopolis",
      "the pourhouse copperopolis",
    ],
    town: "Copperopolis",
    address: "48B Copper Cove Dr, Copperopolis, CA 95228",
  },
  "murphys-pourhouse": {
    canonical: "Murphys Pourhouse",
    aliases: [
      "murphys pourhouse",
      "murphy's pourhouse",
      "the pourhouse murphys",
    ],
    town: "Murphys",
    // TODO: address pending — flagged for next enrichment run.
  },
  "big-trees-state-park": {
    canonical: "Calaveras Big Trees State Park",
    aliases: [
      "big trees state park",
      "calaveras big trees state park",
      "calaveras big trees",
      "big trees",
    ],
    town: "Arnold",
    address: "1170 CA-4, Arnold, CA 95223",
  },
  "ebbetts-pass-moose-lodge": {
    canonical: "Ebbetts Pass Moose Lodge",
    aliases: [
      "ebbetts pass moose lodge",
      "ebbetts moose lodge",
    ],
    town: "Arnold",
    address: "1965 Blagen Rd, Arnold, CA 95223",
  },
  "bls-beach": {
    canonical: "Blue Lake Springs Beach",
    aliases: [
      "bls beach",
      "blue lake springs beach",
    ],
    town: "Arnold",
    address: "335 Blue Lake Springs Dr, Arnold, CA 95223",
  },
  "bls-amphitheater": {
    canonical: "Blue Lake Springs Amphitheater",
    aliases: [
      "bls amphitheater",
      "blue lake springs amphitheater",
    ],
    town: "Arnold",
    address: "335 Blue Lake Springs Dr, Arnold, CA 95223",
  },
  "bls-pool": {
    canonical: "Blue Lake Springs Pool",
    aliases: [
      "bls pool",
      "blue lake springs pool",
    ],
    town: "Arnold",
    address: "335 Blue Lake Springs Dr, Arnold, CA 95223",
  },
  "snowflake-lodge": {
    canonical: "Snowflake Lodge",
    aliases: [
      "snowflake lodge",
      "bls snowflake lodge",
    ],
    town: "Arnold",
    address: "335 Blue Lake Springs Dr, Arnold, CA 95223",
  },
  "sierra-nevada-logging-museum": {
    canonical: "Sierra Nevada Logging Museum",
    aliases: [
      "sierra nevada logging museum",
      "logging museum",
    ],
    town: "Arnold",
    address: "2148 Dunbar Road, Arnold, CA 95223",
  },
  "cameo-plaza": {
    canonical: "Cameo Plaza",
    aliases: [
      "cameo plaza",
      "cameo plaza merchants",
    ],
    town: "Arnold",
    address: "1004 Highway 4, Arnold, CA 95223",
  },
  "meadowmont-lodge": {
    canonical: "Meadowmont Lodge",
    aliases: [
      "meadowmont lodge",
      "meadowmont lodge, arnold",
    ],
    town: "Arnold",
    address: "2011 Highway 4, Arnold, CA 95223",
  },
  "smalltown-collectables": {
    canonical: "SmallTown Collectables",
    aliases: [
      "smalltowncollectables",
      "smalltown collectables",
    ],
    town: "Arnold",
    address: "2182 California Highway 4, Arnold, CA 95223",
  },
  "arnold-shotokan": {
    canonical: "Arnold Shotokan",
    aliases: [
      "arnold shotokan",
    ],
    town: "Arnold",
    address: "2704 Highway 4, Suite 2-D, Arnold, CA 95223",
  },
  "my-bar": {
    canonical: "My Bar",
    aliases: [
      "my bar",
      "my bar angels camp",
    ],
    town: "Angels Camp",
    address: "1208 S Main St, Angels Camp, CA 95222",
  },
  "marisolio": {
    canonical: "Marisolio Tasting Bar",
    aliases: [
      "marisolio",
      "marisolio tasting bar",
      "marisolio tasting bar, murphys",
    ],
    town: "Murphys",
    address: "488 Main St, Suite 101, Murphys, CA 95247",
  },
  "murphys-creek-theatre": {
    canonical: "Murphys Creek Theatre",
    aliases: [
      "murphys creek theatre",
      "murphys creek theater",
      "black bart playhouse",
      "black bart playhouse (aka murphys creek theater)",
    ],
    town: "Murphys",
    address: "580 S. Algiers Street, Murphys, CA 95247",
  },
  "big-white-tent": {
    canonical: "Big White Tent",
    aliases: [
      "big white tent",
      "big white tent, bear valley",
      "bear valley big white tent",
    ],
    town: "Bear Valley",
    address: "39 No Name Rd #34, Bear Valley, CA 95223",
  },
  "perry-walther": {
    canonical: "Perry Walther Community Center",
    aliases: [
      "perry walther community center",
      "perry walther",
    ],
    town: "Bear Valley",
    // address pending — Alpine County records didn't surface a street number
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

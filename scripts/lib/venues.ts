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
    address: "415 Main St, Murphys, CA 95247",
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
  "murphys-senior-center": {
    canonical: "Murphys Senior Center",
    aliases: [
      "murphys senior center",
      "murphy's senior center",
      "murphys sr center",
      "murphys sr. center",
      "senior center murphys",
    ],
    town: "Murphys",
    address: "65 Mitchler St, Murphys, CA 95247",
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
  "boyle-macdonald": {
    canonical: "Boyle MacDonald Wines",
    aliases: [
      "boyle macdonald wines",
      "boyle macdonald",
      "boyle mcdonald wines",
      "boyle mcdonald",
      // Formerly Ariel Vineyards — older listings may still use that name.
      "ariel vineyards",
    ],
    town: "Murphys",
    address: "448B Main St, Murphys, CA 95247",
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
  "arnold-library": {
    canonical: "Arnold Library",
    aliases: [
      "arnold library",
      "arnold branch library",
      "calaveras county library arnold",
      "calaveras county library, arnold branch",
      "arnold branch, calaveras county library",
    ],
    town: "Arnold",
    address: "1065 Blagen Rd, Arnold, CA 95223",
  },
  "camp-connell-general-store": {
    canonical: "Camp Connell General Store",
    aliases: [
      "camp connell general store",
      "general store camp connell",
      // The store's summer concerts are billed under its "Beer Garden".
      "camp connell beer garden",
      "beer garden camp connell",
    ],
    town: "Camp Connell",
    // The store's own site, Yelp, and Facebook all list 4036 Old Highway 4 — the
    // Google Places listing's "3190 CA-4" was wrong. (sync-venue-facts pins by
    // place_id and never writes address, so this stays put.)
    address: "4036 Old Highway 4, Camp Connell, CA 95223",
  },
  "bear-valley-resort": {
    canonical: "Bear Valley Mountain Resort",
    aliases: [
      "bear valley mountain resort",
      "bear valley resort",
      "bear valley ski",
      // NOTE: "bear valley music festival" is NOT aliased here — the festival
      // is held in the Big White Tent in Bear Valley Village, not at the ski
      // resort. See "big-white-tent" below.
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
  // Key matches the pre-existing hwy4_venues row (created 2026-06-29 via the
  // create_venue_row flow, blurb human-approved 2026-07-04) — NOT the shorter
  // "bear-valley-adventure-co", which briefly existed as a duplicate row and
  // was deleted 2026-07-08 when this registry entry converged on the old key.
  "bear-valley-adventure-company": {
    canonical: "Bear Valley Adventure Company",
    aliases: [
      "bear valley adventure company",
      "bear valley adventure co",
      "bear valley adventure co.",
      "bear valley adventures",
      "bvac",
    ],
    town: "Bear Valley",
    // The village outfitter (XC ski center, boat/bike rentals, Reba's cafe) at
    // the Hwy 4 / Bear Valley Rd corner; address per bvadventures.com/directions.
    // Shares "1 Bear Valley Rd" with bear-valley-meadow next door — the matcher
    // auto-excludes ambiguous addresses, so resolution rides the aliases.
    address: "1 Bear Valley Rd, Bear Valley, CA 95223",
  },
  "lake-alpine-lodge": {
    canonical: "Lake Alpine Lodge",
    aliases: [
      "lake alpine lodge",
      "lake alpine resort",
      "lake alpine",
    ],
    // ~4 miles east of Bear Valley Village on Hwy 4, across from Lake Alpine
    // (~7,300 ft). Nearest corridor town is Bear Valley. Casual bar/restaurant
    // with deck seating; runs an image-only summer live-music schedule that the
    // scrapers can't read (seed-lake-alpine-lodge-2026.ts; blocklisted in
    // manual-sources.ts).
    town: "Bear Valley",
    address: "4000 Highway 4, Bear Valley, CA 95223",
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
      // The park club's public bocce courts (murphyspark.com/bocce-ball-courts,
      // physically across Algiers St behind the Murphys Historic Hotel). The
      // Visit Murphys "Bocce fun!" listing carries only the generic venue
      // "Downtown Murphys" and says "the Murphys public courts" in its
      // description, so this alias lets the Layer-2 text scan resolve it.
      "murphys public courts",
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
  "new-melones-lake-marina": {
    canonical: "New Melones Lake Marina",
    aliases: [
      "new melones lake marina",
      "new melones marina",
      "new melones lake",
    ],
    town: "Angels Camp",
    address: "6503 Glory Hole Rd, Angels Camp, CA 95222",
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
      "the pour house copperopolis",
      "the pourhouse copperopolis",
      "pour house @ copperopolis",
    ],
    town: "Copperopolis",
    address: "48B Copper Cove Dr, Copperopolis, CA 95228",
  },
  "murphys-pourhouse": {
    canonical: "Murphys Pourhouse",
    aliases: [
      "murphys pourhouse",
      "murphys pour house",
      "murphy's pourhouse",
      "murphy's pour house",
      "the murphys pourhouse",
      "the pourhouse murphys",
      // "The Poor House" isn't a real Murphys venue — sources that list it
      // mean the Pourhouse, so resolve those here (the old "poor-house" entry
      // was removed). 467 Main vs 350 Main is the same misattribution.
      "the poor house",
      "poor house",
      "murphys poor house",
      "murphy's poor house",
    ],
    town: "Murphys",
    address: "350 Main St, Murphys, CA 95247",
  },
  "stevenot": {
    canonical: "Stevenot Winery",
    aliases: [
      "stevenot",
      "stevenot winery",
      "stevenot winery tasting room",
      "stevenot tasting room",
    ],
    town: "Murphys",
    address: "2849 Batten Rd, Vallecito, CA 95251",
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
      // The corridor has one Moose Lodge (#1123, on Blagen Rd in Arnold). The
      // generic "Moose Lodge" / "Loyal Order of Moose" names were once a
      // separate "moose-lodge" registry entry mistakenly placed in Angels Camp;
      // merged here so a bare "Moose Lodge" resolves to the real venue.
      // (NOTE: "moose-lodge" still exists as an ORG slug for member-event
      // gating — that's a different namespace and is unaffected.)
      "moose lodge",
      "loyal order of moose",
    ],
    town: "Arnold",
    address: "1965 Blagen Rd, Arnold, CA 95223",
  },
  "lodge-lake": {
    canonical: "Lodge Lake",
    aliases: [
      "lodge lake",
      "bls beach",
      "blue lake springs beach",
      "blue lake springs lake",
      "bls lake",
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
  "blue-lake-bistro": {
    // The members' restaurant in the Snowflake Lodge complex, and the fourth
    // name /api/scrape-bls can emit. Registered 2026-09-05 (HWY-25) so every
    // venue that raw-insert writer produces resolves to the registry; without
    // an entry the rows carried a name nothing could key on. Shares the complex
    // address with the lodge / lake / pool / amphitheater entries, and like
    // them it has no distinct Google Places listing of its own.
    canonical: "Blue Lake Bistro",
    aliases: [
      "blue lake bistro",
      "bls bistro",
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
  // Sierra Nevada Adventure Company (SNAC) — the corridor outdoor outfitter,
  // stores in Arnold and Murphys (plus Sonora, out of corridor). Two stores
  // share the company name, and the matcher overwrites an event's town on an
  // alias hit, so the bare "snac" / "sierra nevada adventure company" aliases
  // are deliberately NOT listed on either entry (they can't disambiguate the
  // store). Each entry carries only town-qualified aliases; a bare-name event
  // still links via the unique street address (address index).
  "snac-arnold": {
    canonical: "Sierra Nevada Adventure Company (Arnold)",
    aliases: [
      "sierra nevada adventure company arnold",
      "sierra nevada adventure co arnold",
      "snac arnold",
    ],
    town: "Arnold",
    address: "2293 Highway 4, Arnold, CA 95223",
  },
  "snac-murphys": {
    canonical: "Sierra Nevada Adventure Company (Murphys)",
    aliases: [
      "sierra nevada adventure company murphys",
      "sierra nevada adventure co murphys",
      "snac murphys",
    ],
    town: "Murphys",
    address: "448 Main Street, Murphys, CA 95247",
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
      // The Bear Valley Music Festival is held in the Big White Tent.
      "bear valley music festival tent",
      "bear valley music festival",
      "music festival tent",
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
    address: "325 Creekside Drive, Bear Valley, CA 95223",
  },
  "hovey-winery": {
    canonical: "Hovey Winery",
    aliases: [
      "hovey winery",
      "hovey tasting room",
      "hovey wine",
      "hovey",
    ],
    town: "Murphys",
    // Suite A, same 1850 Albert Michelson house building as Murphys Pourhouse
    // (350 Main St). Distinct suite keeps the normalized address from
    // colliding with the Pourhouse in the address index.
    address: "350-A Main Street, Murphys, CA 95247",
  },
  "new-melones-lake": {
    canonical: "New Melones Lake",
    aliases: [
      "new melones lake",
      "new melones reservoir",
      "new melones",
      "glory hole recreation area",
      "glory hole",
    ],
    town: "Angels Camp",
    // Glory Hole Recreation Area — the main boat ramp / day-use access.
    address: "6503 Glory Hole Rd, Angels Camp, CA 95222",
  },
  "white-pines-lake-park": {
    canonical: "White Pines Lake Park",
    aliases: [
      "white pines lake park",
      "white pines lake",
      // Common scraper typo seen on a GoCalaveras music listing.
      "white pines lake part",
      "white pines park",
      // The Arnold Rim Trail's "Run the Rim" races start/finish here, and it
      // is the trail's main day-use trailhead hub, so a bare "Arnold Rim Trail"
      // venue defaults here. (NOT "art trailhead" — that would clobber specific
      // named trailheads like "ART Trailhead – Valley View Dr.")
      "arnold rim trail",
      "run the rim",
    ],
    town: "Arnold",
    // Shares 1965 Blagen Rd with Ebbetts Pass Moose Lodge (co-located at the
    // park entrance). The matcher treats that address as ambiguous and resolves
    // these two by venue/title text instead — see venue-matcher.ts.
    address: "1965 Blagen Rd, Arnold, CA 95223",
  },
  "bear-valley-meadow": {
    canonical: "Bear Valley Meadow",
    aliases: [
      "bear valley meadow",
      "grizzly ballfield",
      "bear valley ballfield",
      "hermitfest west",
      "hermitfest",
    ],
    town: "Bear Valley",
    // Grizzly Ballfield / meadow at the village entrance.
    address: "1 Bear Valley Road, Bear Valley, CA 95223",
  },
  "val-du-vino": {
    canonical: "Val Du Vino Winery",
    aliases: [
      "val du vino",
      "val du vino winery",
      "val du vino tasting room",
      "valduvino",
    ],
    town: "Murphys",
    address: "634 French Gulch Rd, Murphys, CA 95247",
  },
  "indian-rock": {
    canonical: "Indian Rock Vineyards",
    aliases: [
      "indian rock vineyards",
      "indian rock vineyard",
      "indian rock",
    ],
    town: "Murphys",
    address: "1154 Pennsylvania Gulch Rd, Murphys, CA 95247",
  },
  "prospect-772": {
    canonical: "Prospect 772 Winery",
    aliases: [
      "prospect 772",
      "prospect 772 winery",
      "prospect 772 winery and tasting room",
      "prospect 772 wine company",
      "prospect 772 tasting room",
    ],
    town: "Angels Camp",
    address: "772 Appaloosa Rd, Angels Camp, CA 95222",
  },
  "copper-valley-golf": {
    canonical: "The Golf Club at Copper Valley",
    aliases: [
      "the golf club at copper valley",
      "golf club at copper valley",
      "copper valley golf club",
      "copper valley golf",
    ],
    town: "Copperopolis",
    address: "1001 Saddle Creek Dr, Copperopolis, CA 95228",
  },
  "stitch-lounge": {
    canonical: "The Stitch Lounge",
    aliases: [
      "the stitch lounge",
      "stitch lounge",
    ],
    town: "Arnold",
    address: "2704 CA-4 #1C, Arnold, CA 95223",
  },
  "native-sons-hall": {
    canonical: "Native Sons Hall",
    aliases: [
      "native sons hall",
      "native sons hall murphys",
      "native sons of the golden west",
      "native sons parlor",
      "native sons building",
    ],
    town: "Murphys",
    address: "389 Main St, Murphys, CA 95247",
  },
  // Craft distillery + tasting room in Arnold, in the 925 Highway 4 complex it
  // shares with El Vaquero. "Hinterhaus" is a distinctive enough word that the
  // bare alias is safe; the misspelling variants are the ones people type.
  "hinterhaus-distilling": {
    canonical: "Hinterhaus Distilling",
    aliases: [
      "hinterhaus distilling",
      "hinterhaus distillery",
      "hinterhaus",
      "hinterhouse distilling",
      "hinterhaus tasting room",
    ],
    town: "Arnold",
    address: "925 Highway 4, Ste 2, Arnold, CA 95223",
  },
  // Maker/pottery studio in Arnold (Cameo Plaza). It already has a live
  // hwy4_venues row + 40+ keyed events but had fallen out of this registry, so
  // a venue-key backfill would have stripped those links — re-registered here
  // so seed + backfill keep it intact.
  "make-and-partake": {
    canonical: "Make and parTake",
    aliases: [
      "make and partake",
      "make & partake",
      "make and partake arnold",
      "makeandpartake",
    ],
    town: "Arnold",
    address: "2182 Highway 4, Suite 600, Arnold, CA 95223",
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

/**
 * Config-driven Firecrawl source registry.
 *
 * Each entry below is a venue/site whose events page Firecrawl can fetch as
 * markdown and that the LLM extractor can then turn into structured events.
 * Adding a new source = one entry here; no new file, no new dispatch wire-up.
 *
 * For venues whose page lives at multiple URLs (Shopify mirror, Square site,
 * etc.) supply `urls` instead of `url` — the runner tries them in order until
 * one returns usable content.
 *
 * For genuinely non-Firecrawl sources (Facebook posts, EventON AJAX, bundled
 * JS arrays, etc.) keep a hand-written scraper file — those don't fit this
 * shape and shouldn't be force-fit into it.
 */

export interface FirecrawlSource {
  /** Used for ORG_SLUG and as the --source CLI argument. */
  slug: string;
  /** Display name written into source_name. */
  name: string;
  /** Page title hint passed to the LLM extractor. */
  pageTitle: string;
  /** Single URL OR ordered fallback list. */
  url?: string;
  urls?: string[];
  /** Default venue/town/address used when the LLM can't infer them. */
  defaultVenue: string;
  defaultTown: string;
  defaultAddress?: string;
  /**
   * Optional override of the default Firecrawl scrapeUrl options. Useful for
   * pages that need longer JS-render wait, full-page content, etc.
   */
  firecrawl?: {
    waitFor?: number;
    onlyMainContent?: boolean;
    timeout?: number;
  };
  /**
   * If true, when the LLM returns 0 events the runner dumps a markdown
   * preview to console.warn so the failure is debuggable. Useful for sources
   * whose pages are quiet off-season (Brice Station Hilltop Concert Series).
   */
  dumpOnEmpty?: boolean;
  /**
   * Optional source-specific instruction appended to the extraction prompt's
   * Rules block. Use for per-source quirks the generic prompt can't know —
   * e.g. BVAC mixes retail promos (season-pass sales) into its events page
   * and hosts events at many venues besides its own store.
   */
  extractHint?: string;
}

export const FIRECRAWL_SOURCES: FirecrawlSource[] = [
  {
    slug: "bear-valley",
    name: "Bear Valley Mountain Resort",
    pageTitle: "Bear Valley Events & Activities",
    url: "https://www.bearvalley.com/events-activities",
    defaultVenue: "Bear Valley Mountain Resort",
    defaultTown: "Bear Valley",
  },
  {
    // Bear Valley Adventure Co. — the village outfitter (XC ski center, boat/
    // bike rentals, Reba's cafe). Squarespace events collection: each event
    // block carries a real date, times, venue + map address, description, and
    // a durable per-event permalink. The page lists PAST events too (the
    // extractor prompt + runner both filter those) and mixes in retail promos
    // (season-pass sales) that the extractHint tells the LLM to skip. Direct
    // HTTP is blocked; Firecrawl reads it fine. The org row (hwy4_orgs 'bvac')
    // deliberately has no canonical_url so the per-event Squarespace permalink
    // surfaces as the durable link (same reasoning as red-cross).
    slug: "bvac",
    name: "Bear Valley Adventure Co.",
    pageTitle: "Bear Valley Adventure Co. Events",
    url: "https://www.bvadventures.com/events",
    defaultVenue: "Bear Valley Adventure Company",
    defaultTown: "Bear Valley",
    defaultAddress: "1 Bear Valley Rd, Bear Valley, CA 95223",
    dumpOnEmpty: true,
    extractHint:
      "Skip retail promotions and pass sales (e.g. Season Pass Sale, " +
      "3rd Grader Season Pass, Trail Pass Tuesdays, store sales); they are " +
      "commerce announcements, not events. Many events on this page are NOT " +
      "at the store: lift each event's own venue name and street address " +
      "from its location/map text (Lake Alpine, Bear Valley Meadow, the Big " +
      "White Tent, etc.). Include each event's own bvadventures.com/events/ " +
      "permalink as event_url. The Bear Valley Music Festival is held in the " +
      "Big White Tent at 39 No Name Rd; use venue name 'Big White Tent' for " +
      "festival rows, never the store. When a listing names its session dates " +
      "in the body (e.g. lesson series 'Dates: July 15 & 16, 22 & 23'), emit " +
      "rows only for those stated dates.",
  },
  {
    slug: "branding-iron",
    name: "Branding Iron Saloon",
    pageTitle: "Branding Iron Saloon Events",
    url: "https://murphysbrandingironsaloon.com/",
    defaultVenue: "Branding Iron Saloon",
    defaultTown: "Murphys",
    defaultAddress: "75 Big Trees Rd, Murphys, CA 95247",
  },
  {
    slug: "camp-connell-general-store",
    name: "Camp Connell General Store",
    pageTitle: "Camp Connell General Store Events",
    url: "https://www.campconnellgeneralstore.com/new-page-2",
    defaultVenue: "Camp Connell General Store",
    defaultTown: "Camp Connell",
    defaultAddress: "4036 Old Highway 4, Camp Connell, CA 95223",
  },
  {
    slug: "lube-room",
    name: "The Lube Room Saloon",
    pageTitle: "The Lube Room Saloon Events",
    url: "https://www.theluberoom.com/new-events",
    defaultVenue: "The Lube Room Saloon",
    defaultTown: "Dorrington",
    defaultAddress: "3431 Highway 4, Dorrington, CA 95223",
  },
  {
    // The lodge's monthly PDF calendar (mostly member events, some public) is
    // scraped separately by /api/scrape-moose-lodge. THIS source is the public
    // "Upcoming events" page, where the lodge posts its marquee public events
    // (concerts, the car show, etc.) as flyer images with a heading per event.
    // Firecrawl reads the headings + image alt-text; the extractor turns them
    // into public events. Reuses the existing "moose-lodge" org slug (FK).
    slug: "moose-lodge",
    name: "Ebbetts Pass Moose Lodge",
    pageTitle: "Ebbetts Pass Moose Lodge Public Events",
    url: "https://ebbettspassmoose.com/events",
    defaultVenue: "Ebbetts Pass Moose Lodge",
    defaultTown: "Arnold",
    defaultAddress: "1965 Blagen Rd, Arnold, CA 95223",
    dumpOnEmpty: true,
  },
  // murphys-irish-pub left this list 2026-08-09 for its own special scraper
  // (scripts/scrapers/murphys-irish-pub.ts): the homepage widget exposes no
  // absolute dates to a text scrape, so the LLM extractor here INVENTED them —
  // a fresh phantom lineup every few days. See that file's header.
  {
    slug: "watering-hole",
    name: "The Watering Hole",
    pageTitle: "The Watering Hole Events",
    url: "https://murphyswateringhole.com/",
    defaultVenue: "The Watering Hole",
    defaultTown: "Murphys",
    defaultAddress: "223 Big Trees Rd, Murphys, CA 95247",
  },
];

/** Lookup by slug for the CLI dispatcher. */
export const FIRECRAWL_SOURCE_MAP: Record<string, FirecrawlSource> =
  Object.fromEntries(FIRECRAWL_SOURCES.map((s) => [s.slug, s]));

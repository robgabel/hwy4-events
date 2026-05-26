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
    slug: "branding-iron",
    name: "Branding Iron Saloon",
    pageTitle: "Branding Iron Saloon Events",
    url: "https://murphysbrandingironsaloon.com/",
    defaultVenue: "Branding Iron Saloon",
    defaultTown: "Murphys",
    defaultAddress: "75 Big Trees Rd, Murphys, CA 95247",
  },
  {
    slug: "brice-station",
    name: "Brice Station",
    pageTitle: "Brice Station Events",
    // Shopify site works; Square ticketing as fallback.
    urls: [
      "https://www.bricestation.com/collections/events",
      "https://bricestation-582296.square.site/",
    ],
    defaultVenue: "Brice Station Vineyards",
    defaultTown: "Murphys",
    firecrawl: { waitFor: 8000, onlyMainContent: false },
    dumpOnEmpty: true,
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
    slug: "murphys-irish-pub",
    name: "Murphys Irish Pub",
    pageTitle: "Murphys Irish Pub Events",
    url: "https://www.murphysirishpubca.com/",
    defaultVenue: "Murphys Irish Pub",
    defaultTown: "Murphys",
    defaultAddress: "415 Main St, Murphys, CA 95247",
  },
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

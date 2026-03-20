import FirecrawlApp from "@mendable/firecrawl-js";
import { extractEvents } from "../lib/extract.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";
import { fetchFacebookEvents } from "../lib/facebook.js";

const FACEBOOK_PAGE_URL = "https://www.facebook.com/bricestation/";
// Shopify site works; Square ticketing as fallback
const EVENTS_URLS = [
  "https://www.bricestation.com/collections/events",
  "https://bricestation-582296.square.site/",
];
const SOURCE_NAME = "Brice Station";
const ORG_SLUG = "brice-station";

async function fetchMarkdown(
  firecrawl: FirecrawlApp,
  url: string
): Promise<string | null> {
  console.log(`  Trying: ${url}`);
  try {
    const result = await firecrawl.scrapeUrl(url, {
      formats: ["markdown"],
      waitFor: 8000,
      onlyMainContent: false,
      timeout: 30000,
    });

    if (!result.success) {
      console.warn(`  Firecrawl failed for ${url}:`, JSON.stringify(result, null, 2));
      return null;
    }

    const markdown = result.markdown || "";
    console.log(`  Markdown length: ${markdown.length} chars`);

    if (markdown.length < 100) {
      console.warn(`  Content too short for ${url} (${markdown.length} chars)`);
      return null;
    }

    const lower = markdown.toLowerCase();
    if (lower.includes("page not found") || lower.includes("404 not found")) {
      console.warn(`  Got a 404 page for ${url}`);
      return null;
    }

    return markdown;
  } catch (err) {
    console.warn(`  Error fetching ${url}:`, err);
    return null;
  }
}

const VENUE_CONTEXT = {
  defaultVenue: "Brice Station Vineyards",
  defaultTown: "Murphys",
};

export async function scrapeBriceStation(): Promise<void> {
  console.log("=== Brice Station Scraper ===");

  const currentYear = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  let allEvents: import("../lib/extract.js").ExtractedEvent[] = [];
  let sourceUrl = FACEBOOK_PAGE_URL;

  // 1. Try Facebook first
  console.log("Phase 1: Facebook events");
  const fbEvents = await fetchFacebookEvents(FACEBOOK_PAGE_URL, VENUE_CONTEXT);
  allEvents.push(...fbEvents);

  // 2. Fall back to website if Facebook returned nothing
  if (allEvents.length === 0) {
    console.log("Phase 2: Website fallback (Facebook returned 0 events)");

    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      throw new Error("Missing FIRECRAWL_API_KEY environment variable");
    }

    const firecrawl = new FirecrawlApp({ apiKey });

    let markdown: string | null = null;
    for (const url of EVENTS_URLS) {
      markdown = await fetchMarkdown(firecrawl, url);
      if (markdown) {
        sourceUrl = url;
        break;
      }
    }

    if (!markdown) {
      console.warn(
        "No usable content from any Brice Station URL. " +
        "Note: Hilltop Concert Series runs May–September; page may be empty off-season."
      );
      return;
    }

    console.log(`Using content from: ${sourceUrl}`);
    console.log(`\nMarkdown preview (first 1000 chars):\n${markdown.slice(0, 1000)}`);

    const events = await extractEvents(
      "Brice Station Events",
      sourceUrl,
      markdown,
      currentYear,
      VENUE_CONTEXT
    );

    if (events.length === 0) {
      console.warn("0 events extracted. Full markdown dump for debugging:");
      console.warn(markdown.slice(0, 3000));
    }

    allEvents.push(...events);
  }

  const futureEvents = allEvents.filter((e) => e.date >= today);
  console.log(`Extracted ${allEvents.length} events, ${futureEvents.length} future`);

  for (const e of allEvents) {
    console.log(`  - ${e.name} | ${e.date} | ${e.category}`);
  }

  let totalResult: UpsertResult = { inserted: 0, updated: 0, unchanged: 0 };

  if (futureEvents.length > 0) {
    totalResult = await upsertEvents(futureEvents, SOURCE_NAME, ORG_SLUG, sourceUrl);
  }

  console.log("\n=== Brice Station Summary ===");
  console.log(`Events inserted: ${totalResult.inserted}`);
  console.log(`Events updated: ${totalResult.updated}`);
  console.log(`Events unchanged: ${totalResult.unchanged}`);
}

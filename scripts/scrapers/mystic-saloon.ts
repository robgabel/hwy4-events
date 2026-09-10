import FirecrawlApp from "@mendable/firecrawl-js";
import { extractEvents } from "../lib/extract.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";
import { fetchFacebookPageEvents } from "../lib/facebook-events.js";
import type { FacebookPageConfig } from "../lib/fb-page-config.js";

/**
 * The saloon's own Facebook /events tab, read as structured Facebook event
 * objects (apify~facebook-events-scraper).
 *
 * This replaced lib/facebook.ts (apify~facebook-posts-scraper), which pulled
 * the page's POSTS, concatenated all of them into a single 15,000-char blob and
 * made ONE LLM call over the merged text. Nothing could attribute a returned
 * event back to the post it came from, so nothing could inherit that post's
 * permalink — the unverifiable / uncorrectable / unretractable shape the HWY-17
 * guard exists to flag, and the same shape the group ingest avoids by making
 * one model call per post. It had also produced zero rows: this org_slug owned
 * no events at all when the swap was made, while the /events tab was carrying
 * two upcoming shows, one of which ("California Country Music with Geoffrey
 * Miller") the catalog held only as GoCalaveras's generic "Live Music @
 * Howard's Mystic Saloon".
 *
 * The events tab needs no LLM and every row arrives pinned to a real Facebook
 * event id and permalink.
 */
const FACEBOOK_PAGE: FacebookPageConfig = {
  orgSlug: "mystic-saloon",
  label: "Howard's Mystic Saloon",
  defaultTown: "Avery",
  pageUrl: "https://www.facebook.com/mysticsaloon",
  defaultVenue: "Howard's Mystic Saloon",
};
const FACEBOOK_PAGE_URL = "https://www.facebook.com/mysticsaloon/events";
// Try dedicated event pages first, then fall back to homepage
const EVENTS_URLS = [
  "https://www.mysticsaloon.com/events",
  "https://www.mysticsaloon.com/calendar",
  "https://www.mysticsaloon.com/shows",
  "https://www.mysticsaloon.com/music",
  "https://www.mysticsaloon.com/",
];
const SOURCE_NAME = "Howard's Mystic Saloon";
const ORG_SLUG = "mystic-saloon";

async function fetchMarkdown(
  firecrawl: FirecrawlApp,
  url: string
): Promise<string | null> {
  console.log(`  Trying: ${url}`);
  try {
    const result = await firecrawl.scrapeUrl(url, {
      formats: ["markdown"],
      waitFor: 10000,
      onlyMainContent: false,
      timeout: 30000,
    });

    if (!result.success) {
      console.warn(`  Firecrawl failed for ${url}:`, JSON.stringify(result, null, 2));
      return null;
    }

    const markdown = result.markdown || "";

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
  defaultVenue: "Howard's Mystic Saloon",
  defaultTown: "Avery",
  defaultAddress: "4529 Hwy 4, Avery, CA 95224",
};

export async function scrapeMysticSaloon(): Promise<void> {
  console.log("=== Howard's Mystic Saloon Scraper ===");

  const currentYear = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  let allEvents: import("../lib/extract.js").ExtractedEvent[] = [];
  let sourceUrl = FACEBOOK_PAGE_URL;

  // 1. Try Facebook first
  console.log("Phase 1: Facebook events tab");
  const fbEvents = await fetchFacebookPageEvents(FACEBOOK_PAGE);
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
      console.warn("No usable content from any Mystic Saloon URL or Facebook.");
      return;
    }

    console.log(`Using content from: ${sourceUrl}`);

    const events = await extractEvents(
      "Howard's Mystic Saloon Events",
      sourceUrl,
      markdown,
      currentYear,
      VENUE_CONTEXT
    );

    if (events.length === 0) {
      console.warn("0 events extracted from website. Full markdown dump for debugging:");
      console.warn(markdown.slice(0, 3000));
    }

    allEvents.push(...events);
  }

  const futureEvents = allEvents.filter((e) => e.date >= today);
  console.log(`Extracted ${allEvents.length} events, ${futureEvents.length} future`);

  for (const e of allEvents) {
    console.log(`  - ${e.name} | ${e.date} | ${e.category}`);
  }

  let totalResult: UpsertResult = { inserted: 0, updated: 0, unchanged: 0, skippedFuzzy: 0, unpinned: 0 };

  if (futureEvents.length > 0) {
    totalResult = await upsertEvents(futureEvents, SOURCE_NAME, ORG_SLUG, sourceUrl);
  }

  console.log("\n=== Howard's Mystic Saloon Summary ===");
  console.log(`Events inserted: ${totalResult.inserted}`);
  console.log(`Events updated: ${totalResult.updated}`);
  console.log(`Events unchanged: ${totalResult.unchanged}`);
}

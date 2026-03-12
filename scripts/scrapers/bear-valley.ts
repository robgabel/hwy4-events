import FirecrawlApp from "@mendable/firecrawl-js";
import { extractEvents } from "../lib/extract.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";

const EVENTS_URL = "https://www.bearvalley.com/events-activities";
const SOURCE_NAME = "Bear Valley Mountain Resort";
const ORG_SLUG = "bear-valley";

export async function scrapeBearValley(): Promise<void> {
  console.log("=== Bear Valley Scraper ===");
  console.log(`Fetching: ${EVENTS_URL}`);

  const firecrawl = new FirecrawlApp({
    apiKey: process.env.FIRECRAWL_API_KEY || "",
  });

  // Use Firecrawl to render the JS-heavy Wix page and get clean markdown
  const result = await firecrawl.scrapeUrl(EVENTS_URL, {
    formats: ["markdown"],
    waitFor: 5000, // Wait 5s for Wix dynamic content to render
  });

  if (!result.success) {
    console.error("Firecrawl scrape failed:", result.error);
    return;
  }

  const markdown = result.markdown || "";
  console.log(`Got ${markdown.length} chars of markdown`);
  console.log(`Preview (first 500 chars):\n${markdown.slice(0, 500)}`);

  if (markdown.length < 100) {
    console.warn("Page content too short — site may be blocking or empty");
    return;
  }

  // Extract events via LLM
  const currentYear = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);

  const events = await extractEvents(
    "Bear Valley Events & Activities",
    EVENTS_URL,
    markdown,
    currentYear
  );

  const futureEvents = events.filter((e) => e.date >= today);
  console.log(`Extracted ${events.length} events, ${futureEvents.length} future`);

  let totalResult: UpsertResult = { inserted: 0, updated: 0, unchanged: 0 };

  if (futureEvents.length > 0) {
    totalResult = await upsertEvents(futureEvents, SOURCE_NAME, ORG_SLUG, EVENTS_URL);
  }

  console.log("\n=== Bear Valley Summary ===");
  console.log(`Events inserted: ${totalResult.inserted}`);
  console.log(`Events updated: ${totalResult.updated}`);
  console.log(`Events unchanged: ${totalResult.unchanged}`);
}

import FirecrawlApp from "@mendable/firecrawl-js";
import { extractEvents } from "../lib/extract.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";

const EVENTS_URL = "https://www.bearvalley.com/events-activities";
const SOURCE_NAME = "Bear Valley Mountain Resort";
const ORG_SLUG = "bear-valley";

export async function scrapeBearValley(): Promise<void> {
  console.log("=== Bear Valley Scraper ===");
  console.log(`Fetching: ${EVENTS_URL}`);

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("Missing FIRECRAWL_API_KEY environment variable");
  }
  console.log(`Firecrawl API key: ${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`);

  const firecrawl = new FirecrawlApp({ apiKey });

  // Use Firecrawl to render the JS-heavy Wix page and get clean markdown
  const result = await firecrawl.scrapeUrl(EVENTS_URL, {
    formats: ["markdown"],
    waitFor: 5000,
    onlyMainContent: true,
    timeout: 30000,
  });

  // Log full result structure for debugging
  console.log(`Firecrawl success: ${result.success}`);
  if (!result.success) {
    console.error("Firecrawl error:", JSON.stringify(result, null, 2));
    return;
  }

  const markdown = result.markdown || "";
  console.log(`Markdown length: ${markdown.length} chars`);
  console.log(`Metadata:`, JSON.stringify(result.metadata || {}, null, 2));
  console.log(`\nMarkdown preview (first 1000 chars):\n${markdown.slice(0, 1000)}`);

  if (markdown.length < 100) {
    console.warn("Page content too short — site may be blocking or empty");
    return;
  }

  // Check if content looks like actual event content vs error page
  const lowerContent = markdown.toLowerCase();
  if (lowerContent.includes("404") || lowerContent.includes("page not found")) {
    console.warn("Got a 404 page — URL may be wrong or site is blocking");
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

  for (const e of events) {
    console.log(`  - ${e.name} | ${e.date} | ${e.category}`);
  }

  let totalResult: UpsertResult = { inserted: 0, updated: 0, unchanged: 0 };

  if (futureEvents.length > 0) {
    totalResult = await upsertEvents(futureEvents, SOURCE_NAME, ORG_SLUG, EVENTS_URL);
  }

  console.log("\n=== Bear Valley Summary ===");
  console.log(`Events inserted: ${totalResult.inserted}`);
  console.log(`Events updated: ${totalResult.updated}`);
  console.log(`Events unchanged: ${totalResult.unchanged}`);
}

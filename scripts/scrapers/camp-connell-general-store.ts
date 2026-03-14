import FirecrawlApp from "@mendable/firecrawl-js";
import { extractEvents } from "../lib/extract.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";

const EVENTS_URL = "https://www.campconnellgeneralstore.com/new-page-2";
const SOURCE_NAME = "Camp Connell General Store";
const ORG_SLUG = "camp-connell-general-store";

export async function scrapeCampConnellGeneralStore(): Promise<void> {
  console.log("=== Camp Connell General Store Scraper ===");
  console.log(`Fetching: ${EVENTS_URL}`);

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("Missing FIRECRAWL_API_KEY environment variable");
  }

  const firecrawl = new FirecrawlApp({ apiKey });

  const result = await firecrawl.scrapeUrl(EVENTS_URL, {
    formats: ["markdown"],
    waitFor: 5000,
    onlyMainContent: true,
    timeout: 30000,
  });

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

  const lowerContent = markdown.toLowerCase();
  if (lowerContent.includes("404") || lowerContent.includes("page not found")) {
    console.warn("Got a 404 page — URL may be wrong or site is blocking");
    return;
  }

  const currentYear = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);

  const events = await extractEvents(
    "Camp Connell General Store Events",
    EVENTS_URL,
    markdown,
    currentYear,
    {
      defaultVenue: "Camp Connell General Store",
      defaultTown: "Camp Connell",
      defaultAddress: "4036 Old Highway 4, Camp Connell, CA 95223",
    }
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

  console.log("\n=== Camp Connell General Store Summary ===");
  console.log(`Events inserted: ${totalResult.inserted}`);
  console.log(`Events updated: ${totalResult.updated}`);
  console.log(`Events unchanged: ${totalResult.unchanged}`);
}

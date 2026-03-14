import FirecrawlApp from "@mendable/firecrawl-js";
import { extractEvents } from "../lib/extract.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";

const EVENTS_URL = "https://www.gocalaveras.com/calaveras-events-calendar/";
const SOURCE_NAME = "GoCalaveras";
const ORG_SLUG = "gocalaveras";

// GoCalaveras covers the entire county — events may be in any Hwy 4 town
// The LLM will extract the town from each event's listing
const HWY4_TOWNS = [
  "angels camp",
  "murphys",
  "arnold",
  "avery",
  "camp connell",
  "dorrington",
  "white pines",
  "bear valley",
  "copperopolis",
  "san andreas",
  "valley springs",
  "west point",
  "mokelumne hill",
];

export async function scrapeGoCalaveras(): Promise<void> {
  console.log("=== GoCalaveras Events Calendar Scraper ===");
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
    "Calaveras County Events Calendar",
    EVENTS_URL,
    markdown,
    currentYear,
    {
      defaultVenue: "Calaveras County",
      defaultTown: "Angels Camp",
    }
  );

  // Filter to events along or near the Hwy 4 corridor
  const corridorEvents = events.filter((e) => {
    const town = e.town.toLowerCase().trim();
    return HWY4_TOWNS.some(
      (t) => town.includes(t) || t.includes(town)
    );
  });

  const futureEvents = corridorEvents.filter((e) => e.date >= today);
  console.log(
    `Extracted ${events.length} events total, ${corridorEvents.length} on Hwy 4 corridor, ${futureEvents.length} future`
  );

  for (const e of corridorEvents) {
    console.log(`  - ${e.name} | ${e.date} | ${e.town} | ${e.category}`);
  }

  let totalResult: UpsertResult = { inserted: 0, updated: 0, unchanged: 0 };

  if (futureEvents.length > 0) {
    totalResult = await upsertEvents(futureEvents, SOURCE_NAME, ORG_SLUG, EVENTS_URL);
  }

  console.log("\n=== GoCalaveras Summary ===");
  console.log(`Events inserted: ${totalResult.inserted}`);
  console.log(`Events updated: ${totalResult.updated}`);
  console.log(`Events unchanged: ${totalResult.unchanged}`);
}

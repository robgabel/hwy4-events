import { scrapeBearValley } from "./scrapers/bear-valley.js";
import { generateWeekNarrative } from "./lib/narrative.js";

const SCRAPERS: Record<string, () => Promise<void>> = {
  "bear-valley": scrapeBearValley,
};

async function main() {
  const args = process.argv.slice(2);
  const sourceFlag = args.indexOf("--source");
  const selectedSource =
    sourceFlag !== -1 ? args[sourceFlag + 1] : undefined;
  const narrativeOnly = args.includes("--narrative-only");

  if (narrativeOnly) {
    console.log("Generating weekly narrative only...");
    await generateWeekNarrative();
    console.log("Done.");
    return;
  }

  const sources = selectedSource
    ? [selectedSource]
    : Object.keys(SCRAPERS);

  console.log(
    `Starting scrape at ${new Date().toISOString()}`,
    selectedSource ? `(source: ${selectedSource})` : "(all sources)"
  );

  for (const source of sources) {
    const scraper = SCRAPERS[source];
    if (!scraper) {
      console.error(`Unknown source: ${source}`);
      console.error(`Available sources: ${Object.keys(SCRAPERS).join(", ")}`);
      process.exit(1);
    }

    try {
      await scraper();
    } catch (err) {
      console.error(`\nError scraping ${source}:`, err);
      // Continue with other sources
    }
  }

  // Generate the weekly narrative after scraping
  console.log("\nGenerating weekly narrative...");
  try {
    await generateWeekNarrative();
  } catch (err) {
    console.error("Error generating narrative:", err);
  }

  console.log(`\nScrape completed at ${new Date().toISOString()}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

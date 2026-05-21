import { scrapeBearValley } from "./scrapers/bear-valley.js";
import { scrapeBistroEspresso } from "./scrapers/bistro-espresso.js";
import { scrapeBriceStation } from "./scrapers/brice-station.js";
import { scrapeBrandingIron } from "./scrapers/branding-iron.js";
import { scrapeCampConnellGeneralStore } from "./scrapers/camp-connell-general-store.js";
import { scrapeGoCalaveras } from "./scrapers/gocalaveras.js";
import { scrapeLubeRoom } from "./scrapers/lube-room.js";
import { scrapeMurphysIrishPub } from "./scrapers/murphys-irish-pub.js";
import { scrapeMysticSaloon } from "./scrapers/mystic-saloon.js";
import { scrapeVisitMurphys } from "./scrapers/visit-murphys.js";
import { scrapeWateringHole } from "./scrapers/watering-hole.js";
import { scrapeHwy4FbDiscover } from "./scrapers/hwy4-fb-discover.js";
import { validateEventUrls } from "./lib/validate-urls.js";
import { runHealthCheck } from "./lib/health.js";

const SCRAPERS: Record<string, () => Promise<void>> = {
  "bear-valley": scrapeBearValley,
  "bistro-espresso": scrapeBistroEspresso,
  "brice-station": scrapeBriceStation,
  "branding-iron": scrapeBrandingIron,
  "camp-connell-general-store": scrapeCampConnellGeneralStore,
  "gocalaveras": scrapeGoCalaveras,
  "lube-room": scrapeLubeRoom,
  "murphys-irish-pub": scrapeMurphysIrishPub,
  "mystic-saloon": scrapeMysticSaloon,
  "visit-murphys": scrapeVisitMurphys,
  "watering-hole": scrapeWateringHole,
  "hwy4-fb-discover": scrapeHwy4FbDiscover,
};

async function main() {
  const args = process.argv.slice(2);
  const sourceFlag = args.indexOf("--source");
  const selectedSource =
    sourceFlag !== -1 ? args[sourceFlag + 1] : undefined;

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

  // Validate all event URLs after scraping
  const skipValidation = args.includes("--skip-url-check");
  if (!skipValidation) {
    try {
      await validateEventUrls();
    } catch (err) {
      console.error("URL validation failed:", err);
    }
  }

  // Post-scrape health report
  const skipHealth = args.includes("--skip-health");
  if (!skipHealth) {
    try {
      await runHealthCheck(sources);
    } catch (err) {
      console.error("Health check failed:", err);
    }
  }

  console.log(`\nScrape completed at ${new Date().toISOString()}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

import { scrapeBistroEspresso } from "./scrapers/bistro-espresso.js";
import { scrapeGoCalaveras } from "./scrapers/gocalaveras.js";
import { scrapeMysticSaloon } from "./scrapers/mystic-saloon.js";
import { scrapeHwy4FbDiscover } from "./scrapers/hwy4-fb-discover.js";
import { scrapeFirecrawlSource } from "./scrapers/firecrawl-generic.js";
import { FIRECRAWL_SOURCES } from "./scrapers/firecrawl-sources.js";
import { validateEventUrls } from "./lib/validate-urls.js";
import { runHealthCheck } from "./lib/health.js";

/**
 * Sources whose scraping shape is unique enough to keep their own file:
 *   - bistro-espresso: parses an embedded JS bundle array
 *   - gocalaveras: EventON AJAX with nonce extraction
 *   - mystic-saloon: Facebook primary + multi-URL website fallback
 *   - hwy4-fb-discover: Apify Facebook events scraper
 *
 * Everything else goes through the config-driven generic Firecrawl runner.
 */
const SPECIAL_SCRAPERS: Record<string, () => Promise<void>> = {
  "bistro-espresso": scrapeBistroEspresso,
  "gocalaveras": scrapeGoCalaveras,
  "mystic-saloon": scrapeMysticSaloon,
  "hwy4-fb-discover": scrapeHwy4FbDiscover,
};

const SCRAPERS: Record<string, () => Promise<void>> = {
  ...SPECIAL_SCRAPERS,
  ...Object.fromEntries(
    FIRECRAWL_SOURCES.map((s) => [s.slug, () => scrapeFirecrawlSource(s)])
  ),
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

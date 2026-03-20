import Anthropic from "@anthropic-ai/sdk";
import { scrapeBearValley } from "./scrapers/bear-valley.js";
import { scrapeBriceStation } from "./scrapers/brice-station.js";
import { scrapeBrandingIron } from "./scrapers/branding-iron.js";
import { scrapeCampConnellGeneralStore } from "./scrapers/camp-connell-general-store.js";
import { scrapeGoCalaveras } from "./scrapers/gocalaveras.js";
import { scrapeLubeRoom } from "./scrapers/lube-room.js";
import { scrapeMurphysIrishPub } from "./scrapers/murphys-irish-pub.js";
import { scrapeMysticSaloon } from "./scrapers/mystic-saloon.js";
import { scrapeVisitMurphys } from "./scrapers/visit-murphys.js";
import { scrapeWateringHole } from "./scrapers/watering-hole.js";
import { validateEventUrls } from "./lib/validate-urls.js";

async function checkAnthropicCredits(): Promise<void> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1,
    messages: [{ role: "user", content: "hi" }],
  });
  if (!res.id) throw new Error("Unexpected response from Anthropic API");
}

const SCRAPERS: Record<string, () => Promise<void>> = {
  "bear-valley": scrapeBearValley,
  "brice-station": scrapeBriceStation,
  "branding-iron": scrapeBrandingIron,
  "camp-connell-general-store": scrapeCampConnellGeneralStore,
  "gocalaveras": scrapeGoCalaveras,
  "lube-room": scrapeLubeRoom,
  "murphys-irish-pub": scrapeMurphysIrishPub,
  "mystic-saloon": scrapeMysticSaloon,
  "visit-murphys": scrapeVisitMurphys,
  "watering-hole": scrapeWateringHole,
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

  // Pre-flight check: verify Anthropic API credits before burning Firecrawl calls
  try {
    await checkAnthropicCredits();
    console.log("Anthropic API credit check: OK\n");
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes("credit balance is too low")) {
      console.error(
        "FATAL: Anthropic API credits exhausted. Aborting scrape to avoid wasting Firecrawl calls.\n" +
        "Add credits at https://console.anthropic.com/settings/billing"
      );
      process.exit(1);
    }
    // Other errors (network blip, etc.) — warn but continue
    console.warn("Anthropic API pre-flight check failed (non-fatal):", msg);
  }

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

  console.log(`\nScrape completed at ${new Date().toISOString()}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

import { scrapeBistroEspresso } from "./scrapers/bistro-espresso.js";
import { scrapeGoCalaveras } from "./scrapers/gocalaveras.js";
import { scrapeMysticSaloon } from "./scrapers/mystic-saloon.js";
import { scrapeHwy4FbDiscover } from "./scrapers/hwy4-fb-discover.js";
import { scrapeVisitMurphys } from "./scrapers/visit-murphys.js";
import { scrapeRedCross } from "./scrapers/red-cross.js";
import { scrapeFirecrawlSource } from "./scrapers/firecrawl-generic.js";
import { FIRECRAWL_SOURCES } from "./scrapers/firecrawl-sources.js";
import { validateEventUrls } from "./lib/validate-urls.js";
import { runHealthCheck } from "./lib/health.js";
import { supabaseAdmin } from "./lib/supabase-admin.js";
import { recordScrapeRun } from "../lib/scrape-health.js";
import { randomUUID } from "node:crypto";

// Most SCRAPERS keys equal the org_slug written into hwy4_events, so scrape_runs
// telemetry joins to the liveness signal in lib/scrape-health.ts on the same key.
// These few differ (the dispatch key isn't the org_slug); map them so the health
// report's telemetry lines up with the right source.
const SOURCE_TO_ORG_SLUG: Record<string, string> = {
  "hwy4-fb-discover": "fb-discover-arnold",
};

/**
 * Sources whose scraping shape is unique enough to keep their own file:
 *   - bistro-espresso: parses an embedded JS bundle array
 *   - gocalaveras: EventON AJAX with nonce extraction
 *   - mystic-saloon: Facebook primary + multi-URL website fallback
 *   - hwy4-fb-discover: Apify Facebook events scraper
 *   - visit-murphys: Tribe (The Events Calendar) WordPress REST API
 *   - red-cross: Firecrawl JSON extraction of the Red Cross drive-results SPA,
 *     many hosts per search across multiple corridor ZIP anchors
 *
 * Everything else goes through the config-driven generic Firecrawl runner.
 */
const SPECIAL_SCRAPERS: Record<string, () => Promise<void>> = {
  "bistro-espresso": scrapeBistroEspresso,
  "gocalaveras": scrapeGoCalaveras,
  "mystic-saloon": scrapeMysticSaloon,
  "hwy4-fb-discover": scrapeHwy4FbDiscover,
  "visit-murphys": scrapeVisitMurphys,
  "red-cross": scrapeRedCross,
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

  const runId = randomUUID();

  for (const source of sources) {
    const scraper = SCRAPERS[source];
    if (!scraper) {
      console.error(`Unknown source: ${source}`);
      console.error(`Available sources: ${Object.keys(SCRAPERS).join(", ")}`);
      process.exit(1);
    }

    // Per-source telemetry, written as each source finishes (not batched at the
    // end), so a later job timeout still leaves a breadcrumb trail of what ran.
    // NOTE: this records whether the orchestrator step threw. A scraper that
    // swallows its own upstream error and returns normally (the Facebook scrapers
    // do this on an Apify 401) records as 'ok' here; the liveness signal in
    // lib/scrape-health.ts is the authority on "produced nothing" and flags it
    // stale. A hard throw (e.g. Visit Murphys' Tribe 403) records as 'failed'.
    const orgSlug = SOURCE_TO_ORG_SLUG[source] ?? source;
    const startedAt = new Date().toISOString();
    try {
      await scraper();
      await recordScrapeRun(supabaseAdmin, {
        source: orgSlug,
        status: "ok",
        trigger: "github",
        run_id: runId,
        started_at: startedAt,
      });
    } catch (err) {
      console.error(`\nError scraping ${source}:`, err);
      await recordScrapeRun(supabaseAdmin, {
        source: orgSlug,
        status: "failed",
        trigger: "github",
        run_id: runId,
        started_at: startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
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

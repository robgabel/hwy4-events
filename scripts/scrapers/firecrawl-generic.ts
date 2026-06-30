import FirecrawlApp from "@mendable/firecrawl-js";
import { extractEvents } from "../lib/extract.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";
import type { FirecrawlSource } from "./firecrawl-sources.js";

interface FirecrawlOpts {
  waitFor: number;
  onlyMainContent: boolean;
  timeout: number;
}

const DEFAULT_FIRECRAWL_OPTS: FirecrawlOpts = {
  waitFor: 5000,
  onlyMainContent: true,
  timeout: 30000,
};

/**
 * Generic Firecrawl-driven scraper. Replaces seven near-identical
 * per-venue files. The per-source quirks live in `FIRECRAWL_SOURCES`
 * configuration (URL, default venue/town/address, optional retry URLs,
 * Firecrawl options); the orchestration is identical.
 */
async function fetchMarkdown(
  firecrawl: FirecrawlApp,
  url: string,
  opts: FirecrawlOpts
): Promise<string | null> {
  console.log(`  Trying: ${url}`);
  try {
    const result = await firecrawl.scrapeUrl(url, {
      formats: ["markdown"],
      ...opts,
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
    return markdown;
  } catch (err) {
    console.warn(`  Error fetching ${url}:`, err);
    return null;
  }
}

export async function scrapeFirecrawlSource(source: FirecrawlSource): Promise<void> {
  console.log(`=== ${source.name} Scraper ===`);

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("Missing FIRECRAWL_API_KEY environment variable");
  }

  const firecrawl = new FirecrawlApp({ apiKey });
  const opts = { ...DEFAULT_FIRECRAWL_OPTS, ...(source.firecrawl ?? {}) };

  // Resolve URL list: single URL or ordered fallback.
  const urls = source.urls ?? (source.url ? [source.url] : []);
  if (urls.length === 0) {
    console.error(`No URLs configured for ${source.slug}`);
    return;
  }

  let markdown: string | null = null;
  let sourceUrl = urls[0];
  for (const url of urls) {
    markdown = await fetchMarkdown(firecrawl, url, opts);
    if (markdown) {
      sourceUrl = url;
      break;
    }
  }

  if (!markdown) {
    console.warn(`No usable content from any ${source.name} URL.`);
    return;
  }

  if (urls.length > 1) {
    console.log(`Using content from: ${sourceUrl}`);
  }

  const currentYear = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);

  const events = await extractEvents(
    source.pageTitle,
    sourceUrl,
    markdown,
    currentYear,
    {
      defaultVenue: source.defaultVenue,
      defaultTown: source.defaultTown,
      defaultAddress: source.defaultAddress,
    }
  );

  if (events.length === 0 && source.dumpOnEmpty) {
    console.warn("0 events extracted. Full markdown dump for debugging:");
    console.warn(markdown.slice(0, 3000));
  }

  const futureEvents = events.filter((e) => e.date >= today);
  console.log(`Extracted ${events.length} events, ${futureEvents.length} future`);

  for (const e of events) {
    console.log(`  - ${e.name} | ${e.date} | ${e.category}`);
  }

  let totalResult: UpsertResult = { inserted: 0, updated: 0, unchanged: 0, skippedFuzzy: 0 };
  if (futureEvents.length > 0) {
    totalResult = await upsertEvents(
      futureEvents,
      source.name,
      source.slug,
      sourceUrl,
      source.defaultVisibility ?? "public"
    );
  }

  console.log(`\n=== ${source.name} Summary ===`);
  console.log(`Events inserted: ${totalResult.inserted}`);
  console.log(`Events updated: ${totalResult.updated}`);
  console.log(`Events unchanged: ${totalResult.unchanged}`);
}

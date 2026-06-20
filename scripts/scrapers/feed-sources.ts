import type { FeedSource } from "../lib/feed-ingest.js";

/**
 * Structured Hwy4-corridor feeds (iCal / RSS / Localist / The Events Calendar).
 *
 * These are preferred over Firecrawl/LLM extraction: official APIs, RSS, and
 * iCalendar feeds whose event fields normalize deterministically into
 * `ExtractedEvent` rows via `scripts/lib/feed-ingest.ts`.
 *
 * EMPTY ON PURPOSE. This framework was harvested from the Eugene fork
 * (PeterHollens/this-week-in-eugene); the Eugene source list was intentionally
 * left behind. Populate this with real corridor endpoints, then wire
 * `runFeedSources()` into `scripts/scrape.ts` (the orchestrator integration is
 * a deliberate follow-up — see the import notes in docs).
 *
 * Shape reference (delete the comment once the first real source is added):
 *
 *   export const FEED_SOURCES: FeedSource[] = [
 *     {
 *       slug: "calaveras-county-library-arnold",
 *       name: "Calaveras County Library — Arnold",
 *       format: "ical",                       // "ical" | "rss" | "localist" | "tribe"
 *       endpoint: "https://REAL-LIBCAL-OR-ICAL-ENDPOINT/events.ics",
 *       sourceUrl: "https://the-public-events-page-for-attribution/",
 *       defaultVenue: "Arnold Library",
 *       defaultTown: "Arnold",
 *       defaultCategory: "kids",              // optional category floor
 *     },
 *   ];
 *
 * Verify every endpoint returns events server-side before adding it — a broken
 * feed is worse than no feed. Out-of-corridor rows are dropped at write time by
 * `scripts/lib/corridor.ts`, so over-broad feeds (e.g. county-wide) are safe.
 */
export const FEED_SOURCES: FeedSource[] = [];

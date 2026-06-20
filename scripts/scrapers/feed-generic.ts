import { fetchFeedEvents, type FeedSource } from "../lib/feed-ingest.js";
import type { UpsertResult } from "../lib/dedup.js";
import { applyVenueDetection } from "../lib/venue-matcher.js";

export interface ScrapeFeedOptions {
  dryRun?: boolean;
}

export async function scrapeFeedSource(
  source: FeedSource,
  opts: ScrapeFeedOptions = {}
): Promise<void> {
  console.log(`=== ${source.name} (${source.format}) ===`);

  const today = new Date().toISOString().slice(0, 10);
  const events = await fetchFeedEvents(source, { today });
  const futureEvents = events.filter((e) => e.date >= today);

  let venueFixed = 0;
  for (const event of futureEvents) {
    if (applyVenueDetection(event)) venueFixed++;
  }

  console.log(
    `Fetched ${events.length} event occurrence(s), ${futureEvents.length} future`
  );
  if (venueFixed > 0) {
    console.log(`Venue detection resolved ${venueFixed}/${futureEvents.length}`);
  }

  for (const e of futureEvents.slice(0, 25)) {
    console.log(
      `  - ${e.name} | ${e.date} | ${e.start_time ?? "all-day"} | ${e.town} | ${e.venue_name} | ${e.category}`
    );
  }
  if (futureEvents.length > 25) {
    console.log(`  ... ${futureEvents.length - 25} more`);
  }

  if (opts.dryRun) {
    console.log("Dry run: skipped Supabase upsert.");
    return;
  }

  if (futureEvents.length === 0) {
    console.log("No future events to upsert.");
    return;
  }

  const { upsertEvents } = await import("../lib/dedup.js");
  const result: UpsertResult = await upsertEvents(
    futureEvents,
    source.name,
    source.slug,
    source.sourceUrl
  );

  console.log(`\n=== ${source.name} Summary ===`);
  console.log(`Inserted: ${result.inserted}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Unchanged: ${result.unchanged}`);
  console.log(`Merged duplicates: ${result.skippedFuzzy}`);
}

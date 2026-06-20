import {
  dedupeEvents,
  clusterEvents,
  mergeCluster,
  type DedupableEvent,
} from "../lib/dedupe-events.js";
import { fetchFeedEvents } from "./lib/feed-ingest.js";
import { applyVenueDetection } from "./lib/venue-matcher.js";
import { FEED_SOURCES } from "./scrapers/feed-sources.js";
import { fetchHultEvents } from "./scrapers/hult.js";

type SourceDedupRow = DedupableEvent & {
  source_slug: string;
  source_name: string;
};

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const all: SourceDedupRow[] = [];

  for (const source of FEED_SOURCES) {
    const events = (await fetchFeedEvents(source, { today }))
      .filter((e) => e.date >= today);
    for (const event of events) {
      applyVenueDetection(event);
      all.push({
        ...event,
        visibility: "public",
        source_slug: source.slug,
        source_name: source.name,
      });
    }
    console.log(`${source.slug.padEnd(24)} ${String(events.length).padStart(4)} future events`);
  }

  const hult = await fetchHultEvents();
  const hultEvents = hult.events.filter((e) => e.date >= today);
  for (const event of hultEvents) {
    applyVenueDetection(event);
    all.push({
      ...event,
      visibility: "public",
      source_slug: "hult-center",
      source_name: "Hult Center",
    });
  }
  console.log(`${"hult-center".padEnd(24)} ${String(hultEvents.length).padStart(4)} future events`);

  const clusters = clusterEvents(all);
  const duplicates = clusters.filter((c) => c.length > 1);
  const deduped = dedupeEvents(all);

  console.log("\n=== Eugene Source Dedup Report ===");
  console.log(`Raw source rows: ${all.length}`);
  console.log(`Duplicate clusters: ${duplicates.length}`);
  console.log(`Rows after read-time dedupe: ${deduped.length}`);
  console.log(`Rows collapsed: ${all.length - deduped.length}`);

  for (const cluster of duplicates.slice(0, 25)) {
    console.log("\n--- duplicate cluster ---");
    const winner = mergeCluster(cluster);
    console.log(
      `winner: ${winner.date} ${winner.start_time ?? "all-day"} | ${winner.venue_name ?? "Unknown"} | ${winner.name} | ${winner.source_slug}`
    );
    for (const event of cluster) {
      console.log(
        `${event.date} ${event.start_time ?? "all-day"} | ${event.venue_name ?? "Unknown"} | ${event.name} | ${event.source_slug}`
      );
    }
  }
  if (duplicates.length > 25) {
    console.log(`\n... ${duplicates.length - 25} more duplicate clusters`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

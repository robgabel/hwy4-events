import {
  fetchFacebookDiscoverEvents,
  type TownLocationConfig,
} from "../lib/facebook-events.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";
import { isManuallyManagedEvent } from "../lib/manual-sources.js";

/**
 * Hwy 4 Facebook Events Discover scraper.
 *
 * Uses Apify's facebook-events-scraper actor to pull events tagged at each
 * corridor town's Facebook place ID, regardless of which Page hosts them.
 * Catches long-tail community events not covered by per-venue scrapers.
 *
 * To add a town: load https://www.facebook.com/events/ in a logged-in browser,
 * type the town name in the location filter, and copy the `location_id` from
 * the resulting URL. Add an entry below.
 */
const TOWN_CONFIGS: TownLocationConfig[] = [
  {
    orgSlug: "fb-discover-arnold",
    label: "Arnold",
    defaultTown: "Arnold",
    exploreSlug: "arnold-ca",
    locationId: "105475469485316",
  },
  // To enable more towns, look up the FB location_id and explore slug:
  // 1. Open https://www.facebook.com/events/ in a browser
  // 2. Search for the town name and click the location filter
  // 3. Copy the URL — slug is the "/explore/<slug>/" segment, ID is the numeric tail
  // 4. Insert the matching org row so events FK-resolve:
  //    INSERT INTO hwy4_orgs (slug, display_name) VALUES ('fb-discover-<town>', 'Facebook Events (<Town>)');
  // 5. Verify before committing: cd scripts && npm run scrape -- --source hwy4-fb-discover
  // { orgSlug: "fb-discover-murphys",     label: "Murphys",     defaultTown: "Murphys",     exploreSlug: "murphys-ca",     locationId: "..." },
  // { orgSlug: "fb-discover-angels-camp", label: "Angels Camp", defaultTown: "Angels Camp", exploreSlug: "angels-camp-ca", locationId: "..." },
  // { orgSlug: "fb-discover-bear-valley", label: "Bear Valley", defaultTown: "Bear Valley", exploreSlug: "bear-valley-ca", locationId: "..." },
  // { orgSlug: "fb-discover-copperopolis",label: "Copperopolis",defaultTown: "Copperopolis",exploreSlug: "copperopolis-ca",locationId: "..." },
];

const SOURCE_NAME_PREFIX = "Facebook Events Discover";

export async function scrapeHwy4FbDiscover(): Promise<void> {
  console.log("=== Hwy 4 Facebook Events Discover ===");

  if (!process.env.APIFY_API_TOKEN) {
    console.log("Skipping FB Discover (no APIFY_API_TOKEN set)");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const totals: UpsertResult = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skippedFuzzy: 0,
  };

  for (const config of TOWN_CONFIGS) {
    console.log(`\n--- ${config.label} ---`);

    let events;
    try {
      events = await fetchFacebookDiscoverEvents(config);
    } catch (err) {
      console.error(`  Unexpected error scraping ${config.label}:`, err);
      continue;
    }

    const manualSkipped = events.filter(isManuallyManagedEvent);
    const scrapable = events.filter((e) => !isManuallyManagedEvent(e));
    if (manualSkipped.length > 0) {
      console.log(
        `  Skipping ${manualSkipped.length} manually-managed event(s): ${manualSkipped
          .map((e) => `${e.name} @ ${e.venue_name}`)
          .join("; ")}`
      );
    }
    const futureEvents = scrapable.filter((e) => e.date >= today);
    console.log(
      `  Extracted ${events.length} events, ${futureEvents.length} future`
    );

    for (const e of futureEvents) {
      console.log(`    - ${e.name} | ${e.date} | ${e.town} | ${e.category}`);
    }

    if (futureEvents.length === 0) continue;

    // source_url points to the explore URL; event_url on each row points to
    // the canonical fb.com/events/<id>/ link captured during mapping.
    const sourceUrl = `https://www.facebook.com/events/explore/${config.exploreSlug}/${config.locationId}`;
    const sourceName = `${SOURCE_NAME_PREFIX} (${config.label})`;

    const result = await upsertEvents(
      futureEvents,
      sourceName,
      config.orgSlug,
      sourceUrl
    );

    console.log(
      `  ${config.label}: inserted=${result.inserted} updated=${result.updated} unchanged=${result.unchanged} fuzzy=${result.skippedFuzzy}`
    );

    totals.inserted += result.inserted;
    totals.updated += result.updated;
    totals.unchanged += result.unchanged;
    totals.skippedFuzzy += result.skippedFuzzy;
  }

  console.log("\n=== Hwy 4 FB Discover Summary ===");
  console.log(`Events inserted: ${totals.inserted}`);
  console.log(`Events updated:  ${totals.updated}`);
  console.log(`Events unchanged: ${totals.unchanged}`);
  console.log(`Fuzzy-deduped:    ${totals.skippedFuzzy}`);
}

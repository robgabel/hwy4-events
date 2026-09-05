import {
  fetchFacebookDiscoverEvents,
  type TownLocationConfig,
} from "../lib/facebook-events.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";
import { isManuallyManagedEvent } from "../lib/manual-sources.js";
import { isConfiguredTown } from "../lib/fb-town-config.js";

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
  // ── Filled 2026-09-05 ─────────────────────────────────────────────────────
  // Each place ID was read off Facebook's public, LOGGED-OUT place page
  // (facebook.com/places/x/<id>/), whose title and venue list are rendered from
  // the ID alone — a deliberately mismatched name slug still titled the page
  // "Arnold", so the ID is what identifies the place and the slug is decorative
  // there. Every ID below was confirmed by corridor landmarks on its own page:
  // Murphys (Firewood, Murphys Pride on Main St), Angels Camp (Crusco's,
  // Greenhorn Creek), Bear Valley (Creekside Bistro, Sourgrass — the Alpine
  // County one on Hwy 4, NOT Mariposa's or Bear Valley Springs), Copperopolis
  // (Music In The Square, 100 Town Square), Avery (4529 Hwy 4).
  //
  // `exploreSlug` follows the one convention Arnold proves (<town>-ca) and was
  // NOT independently verified: /events/explore/ needs a logged-in session.
  // If a town's first live run returns events from somewhere else, the slug is
  // the suspect — blank its locationId and it goes dormant again.
  {
    orgSlug: "fb-discover-murphys",
    label: "Murphys",
    defaultTown: "Murphys",
    exploreSlug: "murphys-ca",
    locationId: "109648499061365",
  },
  {
    orgSlug: "fb-discover-angels-camp",
    label: "Angels Camp",
    defaultTown: "Angels Camp",
    exploreSlug: "angels-camp-ca",
    locationId: "112419192105459",
  },
  {
    orgSlug: "fb-discover-bear-valley",
    label: "Bear Valley",
    defaultTown: "Bear Valley",
    exploreSlug: "bear-valley-ca",
    locationId: "104088062962459",
  },
  {
    orgSlug: "fb-discover-copperopolis",
    label: "Copperopolis",
    defaultTown: "Copperopolis",
    exploreSlug: "copperopolis-ca",
    locationId: "106218426077047",
  },
  {
    orgSlug: "fb-discover-avery",
    label: "Avery",
    defaultTown: "Avery",
    exploreSlug: "avery-ca",
    locationId: "107705869252736",
  },
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
    unpinned: 0,
  };

  const active = TOWN_CONFIGS.filter(isConfiguredTown);
  const pending = TOWN_CONFIGS.filter((c) => !isConfiguredTown(c));
  if (pending.length > 0) {
    console.log(
      `  ${pending.length} town(s) awaiting a location ID, skipped: ${pending.map((c) => c.label).join(", ")}`
    );
  }

  for (const config of active) {
    console.log(`\n--- ${config.label} ---`);

    let events;
    try {
      events = await fetchFacebookDiscoverEvents(config);
    } catch (err) {
      console.error(`  Unexpected error scraping ${config.label}:`, err);
      continue;
    }

    const manualSkipped = events.filter((e) => isManuallyManagedEvent(e));
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
    totals.unpinned += result.unpinned;
  }

  console.log("\n=== Hwy 4 FB Discover Summary ===");
  console.log(`Events inserted: ${totals.inserted}`);
  console.log(`Events updated:  ${totals.updated}`);
  console.log(`Events unchanged: ${totals.unchanged}`);
  console.log(`Fuzzy-deduped:    ${totals.skippedFuzzy}`);
}

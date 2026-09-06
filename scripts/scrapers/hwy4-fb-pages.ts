import { fetchFacebookPageEvents } from "../lib/facebook-events.js";
import {
  isConfiguredPage,
  eventsTabUrl,
  type FacebookPageConfig,
} from "../lib/fb-page-config.js";
import { isManuallyManagedEvent } from "../lib/manual-sources.js";
import { upsertEvents } from "../lib/dedup.js";

/**
 * Facebook PAGE events — a venue's own /events tab, read with the same Apify
 * actor hwy4-fb-discover points at a town.
 *
 * ── Why this exists, and why the registry is this short ────────────────────
 *
 * The obvious version of this scraper wires up every corridor venue with a
 * Facebook page. That version would be mostly dead weight, which is exactly the
 * failure HWY-20 deleted four config entries for. So every candidate below was
 * probed against the live actor on 2026-09-05 before it earned a line, and most
 * candidates did not:
 *
 *   TheTownSquareAtCV      5 upcoming, 3 of them naming the act   → KEPT
 *   mysticsaloon           2 upcoming                             → KEPT (in its own scraper)
 *   BearValleyResort       1 upcoming + a season-pass promo       → rejected
 *   groups/uh4ccc/events   3 events, ALL past                     → rejected
 *   Ironstone (388331564555121)   0                               → rejected
 *   boylemacdonaldwines    0                                      → rejected
 *   Prospect772            0                                      → rejected
 *   indianrockvineyards    3 events, all past (oldest 2018)       → rejected
 *
 * The wineries are the instructive ones: Boyle MacDonald alone has 52 upcoming
 * generic-titled rows in the catalog, so it looks like the biggest prize here,
 * and its page publishes no Facebook events at all. Corridor venues mostly post
 * to a feed rather than create event objects. Re-probe before adding any page;
 * do not add one on the assumption that a busy venue must have events.
 *
 * ── What a page adds that the town feed does not ───────────────────────────
 *
 * Copperopolis Town Square, same probe:
 *
 *   explore/copperopolis-ca   09-13  id 769764202448727   "Copperopolis Summer Concert series"
 *   TheTownSquareAtCV/events  09-13  id 1801994517316530  "Music In The Square- The Yacht Rockers"
 *
 * Two distinct Facebook event objects for one night. The venue creates a
 * generic series listing and a named-act listing, and explore surfaces only the
 * generic one; 09-06's "Hired Gunn" is on the tab and not in explore at all.
 *
 * The pair needs no new dedup: isGenericTitle already reads "... Concert
 * series" as a placeholder, so isSameEvent merges them once the venues agree,
 * and placeholderNameSteal keeps the specific title. That is the whole point —
 * the act name reaches the card, the artists chip and the artist-blurb queue
 * through machinery that already exists.
 *
 * Registered LAST in SPECIAL_SCRAPERS for the brice-station reason: these pages
 * are organizer-owned but deliberately NOT blocklisted in manual-sources (the
 * aggregators legitimately carry events these venues never posted), so both
 * writers coexist and the organizer should write last.
 */
const PAGE_CONFIGS: FacebookPageConfig[] = [
  {
    orgSlug: "fb-page-copperopolis-town-square",
    label: "Copperopolis Town Square",
    defaultTown: "Copperopolis",
    pageUrl: "https://www.facebook.com/TheTownSquareAtCV",
    // The Town Square is multi-tenant in the isMultiTenantVenue sense (no single
    // canonical events page for a durable CTA), but it is one physical place, so
    // it IS the right venue for an event its own page created with no location.
    defaultVenue: "Copperopolis Town Square",
  },
];

const SOURCE_NAME_PREFIX = "Facebook Page";

export async function scrapeHwy4FbPages(): Promise<void> {
  console.log("=== Hwy 4 Facebook Pages ===");

  const active = PAGE_CONFIGS.filter((c) => isConfiguredPage(c));
  const skipped = PAGE_CONFIGS.length - active.length;
  if (skipped > 0) {
    console.log(`  Skipping ${skipped} unconfigured page(s)`);
  }
  if (active.length === 0) {
    console.log("  No configured pages — nothing to do.");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const totals = { inserted: 0, updated: 0, unchanged: 0, skippedFuzzy: 0, unpinned: 0 };

  for (const config of active) {
    console.log(`\n--- ${config.label} ---`);

    let events;
    try {
      events = await fetchFacebookPageEvents(config);
    } catch (err) {
      console.error(`  Unexpected error scraping ${config.label}:`, err);
      continue;
    }

    // Arrow form, never the bare reference: .filter(isManuallyManagedEvent)
    // passes the array index as askingOrgSlug (documented gotcha).
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
    console.log(`  Extracted ${events.length} events, ${futureEvents.length} future`);
    for (const e of futureEvents) {
      console.log(`    - ${e.name} | ${e.date} | ${e.town} | ${e.category}`);
    }

    if (futureEvents.length === 0) continue;

    const result = await upsertEvents(
      futureEvents,
      `${SOURCE_NAME_PREFIX} (${config.label})`,
      config.orgSlug,
      eventsTabUrl(config)
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

  console.log("\n=== Hwy 4 FB Pages Summary ===");
  console.log(`Events inserted:  ${totals.inserted}`);
  console.log(`Events updated:   ${totals.updated}`);
  console.log(`Events unchanged: ${totals.unchanged}`);
  console.log(`Fuzzy-deduped:    ${totals.skippedFuzzy}`);
}

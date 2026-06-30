import { fetchFacebookEvents, getFacebookStatus } from "../lib/facebook.js";
import type { VenueContext } from "../lib/extract.js";
import { upsertEvents, type UpsertResult } from "../lib/dedup.js";
import { isManuallyManagedEvent } from "../lib/manual-sources.js";
import { recordScrapeRun } from "../../lib/scrape-health.js";
import { supabaseAdmin } from "../lib/supabase-admin.js";

/**
 * Hwy 4 community Facebook Groups scraper.
 *
 * Pulls recent posts from corridor community groups via Apify's
 * facebook-groups-scraper, then LLM-extracts events the same way the per-venue
 * Facebook page scraper does. Groups are corridor-WIDE (a post can be about any
 * town), so unlike a single-venue page the extractor INFERS the town per post
 * and drops anything outside the corridor (see EXTRACT_OPTS). The shared dedup
 * layers then collapse the heavy overlap with GoCalaveras / venue feeds.
 *
 * Each group is its own org_slug (fb-group-*) so scrape-health / /admin/sources
 * can tell which group is actually productive. The org rows are seeded by
 * migration 20260629b_fb_groups_orgs.sql (fk_hwy4_events_org).
 *
 * To add a group: add a row below (+ an hwy4_orgs row for its org_slug) and add
 * the org_slug to EXPECTED_SOURCES in lib/scrape-health.ts.
 */
interface GroupConfig {
  orgSlug: string;
  url: string;
  sourceName: string;
}

const GROUP_CONFIGS: GroupConfig[] = [
  { orgSlug: "fb-group-uh4ccc", url: "https://www.facebook.com/groups/uh4ccc", sourceName: "Facebook Group (uh4ccc)" },
  { orgSlug: "fb-group-upperhwy4", url: "https://www.facebook.com/groups/UpperHwy4", sourceName: "Facebook Group (Upper Hwy 4)" },
  { orgSlug: "fb-group-388511408445423", url: "https://www.facebook.com/groups/388511408445423", sourceName: "Facebook Group (Hwy 4)" },
];

const GROUPS_ACTOR = "apify~facebook-groups-scraper";

// Groups have no single venue/town; let the extractor infer both per post and
// drop out-of-corridor events at the source (the upsert corridor filter is a
// second backstop).
const GROUP_VENUE_CTX: VenueContext = { defaultVenue: "Unknown Venue", defaultTown: "Unknown" };
const EXTRACT_OPTS = {
  townDirective:
    'the specific Highway 4 corridor town where the event takes place, chosen from EXACTLY this list: Angels Camp, Copperopolis, Murphys, Avery, Arnold, Camp Connell, Dorrington, White Pines, Bear Valley. If a post is about an event clearly OUTSIDE this corridor (e.g. Stockton, Sonora, Modesto, Sacramento), do NOT include it at all.',
  venueDirective:
    'the specific venue or business named in the post, or "Unknown Venue" if the post names no venue',
};

export async function scrapeHwy4FbGroups(): Promise<void> {
  console.log("=== Hwy 4 Facebook Groups ===");

  if (!process.env.APIFY_API_TOKEN) {
    console.log("Skipping FB Groups (no APIFY_API_TOKEN set)");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const totals: UpsertResult = { inserted: 0, updated: 0, unchanged: 0, skippedFuzzy: 0 };

  for (const cfg of GROUP_CONFIGS) {
    console.log(`\n--- ${cfg.orgSlug} ---`);
    const startedAt = new Date().toISOString();

    let events;
    try {
      events = await fetchFacebookEvents(cfg.url, GROUP_VENUE_CTX, cfg.orgSlug, {
        actor: GROUPS_ACTOR,
        sourceLabel: "Facebook Group Events",
        extractOpts: EXTRACT_OPTS,
      });
    } catch (err) {
      console.error(`  Unexpected error scraping ${cfg.orgSlug}:`, err);
      await recordScrapeRun(supabaseAdmin, {
        source: cfg.orgSlug,
        status: "failed",
        trigger: "github",
        started_at: startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // fetchFacebookEvents swallows an Apify failure (returns []), so a token-scope
    // 403 would otherwise look like a quiet group. Read the per-page status and
    // record it as a real failure so the health panel flags it immediately.
    const fb = getFacebookStatus()[cfg.url];
    if (fb?.failed) {
      console.warn(`  Apify failed for ${cfg.orgSlug}: ${fb.error}`);
      await recordScrapeRun(supabaseAdmin, {
        source: cfg.orgSlug,
        status: "failed",
        trigger: "github",
        started_at: startedAt,
        error: fb.error ?? "Apify failed",
      });
      continue;
    }

    const scrapable = events.filter((e) => !isManuallyManagedEvent(e));
    const future = scrapable.filter((e) => e.date >= today);
    console.log(`  Extracted ${events.length} events, ${future.length} future`);
    for (const e of future) {
      console.log(`    - ${e.name} | ${e.date} | ${e.town} | ${e.category}`);
    }

    if (future.length === 0) {
      await recordScrapeRun(supabaseAdmin, {
        source: cfg.orgSlug,
        status: "empty",
        trigger: "github",
        started_at: startedAt,
      });
      continue;
    }

    const result = await upsertEvents(future, cfg.sourceName, cfg.orgSlug, cfg.url);
    console.log(
      `  ${cfg.orgSlug}: inserted=${result.inserted} updated=${result.updated} unchanged=${result.unchanged} fuzzy=${result.skippedFuzzy}`
    );

    await recordScrapeRun(supabaseAdmin, {
      source: cfg.orgSlug,
      status: "ok",
      trigger: "github",
      started_at: startedAt,
      inserted: result.inserted,
      updated: result.updated,
      unchanged: result.unchanged,
    });

    totals.inserted += result.inserted;
    totals.updated += result.updated;
    totals.unchanged += result.unchanged;
    totals.skippedFuzzy += result.skippedFuzzy;
  }

  console.log("\n=== Hwy 4 FB Groups Summary ===");
  console.log(`Events inserted:  ${totals.inserted}`);
  console.log(`Events updated:   ${totals.updated}`);
  console.log(`Events unchanged: ${totals.unchanged}`);
  console.log(`Fuzzy-deduped:    ${totals.skippedFuzzy}`);
}

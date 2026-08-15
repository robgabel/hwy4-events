// Seeder for the Hinterhaus Distilling "Distiller-Led Tour" Saturdays.
//
// Transcribed from the distillery's own Facebook announcement (posted
// 2026-08-13) after Rob flagged it. Hinterhaus publishes tour dates on its
// Facebook page and on the VISIT page of hinterhausdistilling.com; neither is
// something the corridor scrapers read today, and no aggregator has ever
// listed this venue (zero hwy4_events rows before this script), so the dates
// are hand-entered here.
//
// This script is the SINGLE SOURCE OF TRUTH for these rows. To add the next
// batch of tour Saturdays, append to TOURS and re-run.
//
// DELIBERATELY NOT blocklisted in scripts/lib/manual-sources.ts, unlike the
// Lube Room / Camp Connell / Big Trees seeds. Those venues are blocklisted
// because an aggregator was actively re-listing their events with flattened
// dates over the curated rows. Nothing has ever listed Hinterhaus, so a
// blocklist entry would buy no protection today and would silently drop a real
// listing the day GoCalaveras or Visit Murphys picks the distillery up. The
// hand-entered specifics are protected per row instead (description_locked +
// times_locked). If a scraper ever starts overwriting these, blocklist then.
//
// Idempotent: upserts on the unique dedup_key (= hash(name|date|town)), so a
// re-run updates rows in place instead of duplicating.
//
// Post facts baked in below: Saturdays 12:30 p.m. to approximately 1:45 p.m.,
// distiller-led tasting + Q&A + a take-home Glencairn glass + 10% off bottles
// and merch after the tour, 15% off the booking for Alpine Club members, spots
// limited (reserve on the VISIT page; walk-ins only as space allows), 21+,
// service animals only. The post states no ticket price; $45 per person comes
// from Rob (2026-08-14) and is therefore price_locked, so no automated writer
// can overwrite or drop it.
//
// Run (real write, needs Supabase service-role env):
//   env $(grep -E '^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' ../.env.local | xargs) \
//     npx tsx scripts/seed-hinterhaus-tours-2026.ts
// Preview only (no DB, no env):
//   npx tsx scripts/seed-hinterhaus-tours-2026.ts --dry-run

import { generateDedupKey } from "../lib/event-identity.js";

const NAME = "Distiller-Led Tour & Tasting";
const VENUE = "Hinterhaus Distilling";
const VENUE_KEY = "hinterhaus-distilling";
const TOWN = "Arnold";
const ADDRESS = "925 Highway 4, Ste 2, Arnold, CA 95223";
const ORG_SLUG = "hinterhaus-distilling";
const SOURCE_NAME = "Hinterhaus Distilling";
const VISIT_URL = "https://www.hinterhausdistilling.com/visit";

const START_TIME = "12:30:00";
const END_TIME = "13:45:00";

// Saturdays announced in the 2026-08-13 post. Append new dates as they post them.
const TOURS: string[] = ["2026-08-15", "2026-08-29"];

const DESCRIPTION = [
  "An hour and change behind the bottle with the father and son who make the spirits.",
  "It runs 12:30 to about 1:45 and costs $45 per person, which covers a distiller-led",
  "tasting, time to ask whatever you want about the process, a Hinterhaus Glencairn glass",
  "to take home, and 10% off bottles and merch afterward. Alpine Club members get 15% off",
  "the booking.",
  "Spots are limited, so reserve on the VISIT page of hinterhausdistilling.com; walk-ins",
  "get in only as space allows. Everyone has to be 21 or over, and service animals only.",
].join(" ");

function toRow(date: string) {
  return {
    name: NAME,
    description: DESCRIPTION,
    date,
    start_time: START_TIME,
    end_time: END_TIME,
    venue_name: VENUE,
    venue_key: VENUE_KEY,
    town: TOWN,
    address: ADDRESS,
    // "tasting" is the tasting-room bucket the keyword classifier lands on
    // (lib/categorize.ts), so a future scrape of the same event self-heals to
    // the same category instead of fighting this row.
    category: "wine",
    status: "confirmed",
    is_past: false,
    price: "$45" as string | null,
    // $45 per person, from Rob (2026-08-14). The Facebook post states no price,
    // so this is the human-supplied figure: locked so /api/extract-prices and
    // any future scrape of the same event can't overwrite or drop it.
    cost_tier: "paid",
    price_locked: true,
    description_locked: true, // hand-written from the organizer's post
    times_locked: true, // organizer-stated 12:30 to ~1:45
    event_url: VISIT_URL,
    source_url: VISIT_URL,
    source_name: SOURCE_NAME,
    visibility: "public",
    org_slug: ORG_SLUG,
    is_weekly: false,
    robs_pick: false,
    community_sourced: false,
    dedup_key: generateDedupKey(NAME, date, TOWN),
    last_scraped_at: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const rows = TOURS.map(toRow);

  console.log(`=== Hinterhaus Distilling tours — ${rows.length} dates ===`);
  for (const r of rows) {
    console.log(`  ${r.date} ${r.start_time}  ${r.name}`);
  }

  if (dryRun) {
    console.log("\n--- DRY RUN: full payloads, nothing written ---");
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const { supabaseAdmin } = await import("./lib/supabase-admin.js");
  const { data, error } = await supabaseAdmin
    .from("hwy4_events")
    .upsert(rows, { onConflict: "dedup_key" })
    .select("id, name, date");

  if (error) {
    console.error("Upsert failed:", error.message);
    process.exit(1);
  }
  console.log(`\n=== Upserted ${data?.length ?? 0} rows ===`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

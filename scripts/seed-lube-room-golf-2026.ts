// Seeder for The Lube Room Saloon's annual Horse Pasture Golf Tournament,
// Saturday September 12, 2026.
//
// Transcribed from the saloon's own Facebook announcement (posted 2026-08-25)
// after Rob flagged it. The Lube Room publishes this tournament only on
// Facebook and on an image flyer, neither of which the corridor scrapers read,
// and no aggregator has ever listed it, so the details are hand-entered here.
//
// This script is the SINGLE SOURCE OF TRUTH for this row. To correct a detail
// or add next year's date, edit below and re-run.
//
// Already protected from the auto-scrapers: the event NAME contains "Lube
// Room", which scripts/lib/manual-sources.ts blocklists, so every aggregator
// skips it before upserting. The hand-entered specifics are additionally
// pinned per row (description_locked + times_locked + price_locked).
//
// Deliberately kept OUT of scripts/seed-lube-room-summer-2026.ts: that script
// owns the "Live at The Lube" music series and writes through upsertEvents,
// which does not set the *_locked columns this row needs. Note the two events
// coexist on 2026-09-12 by design (the tournament runs 10 AM to 6 PM at the
// pasture; Hit Eject plays the saloon 6 to 9 PM). They are not duplicates.
//
// LOCATION: the venue is the saloon (Rob's call, 2026-08-26). The flyer names
// no street address for the pasture itself, and play is on Wayne and Marilyn
// Renaud's and Travis and Debbie Loughran's property, which is private and not
// a registry venue. The saloon is where the tournament is organized and where
// the flyer sends people, so the row carries the registry venue_key and address
// and the description credits the property owners.
//
// Idempotent: upserts on the unique dedup_key (= hash(name|date|town)), so a
// re-run updates the row in place instead of duplicating it.
//
// Run (real write, needs Supabase service-role env):
//   env $(grep -E '^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' ../.env.local | xargs) \
//     npx tsx scripts/seed-lube-room-golf-2026.ts
// Preview only (no DB, no env):
//   npx tsx scripts/seed-lube-room-golf-2026.ts --dry-run

import { generateDedupKey } from "../lib/event-identity.js";

const NAME = "Annual Lube Room Horse Pasture Golf Tournament";
const DATE = "2026-09-12"; // Saturday
const VENUE = "The Lube Room Saloon";
const VENUE_KEY = "lube-room";
// From the venue registry (scripts/lib/venues.ts), the source of truth for addresses.
const ADDRESS = "3497 CA-4, Dorrington, CA 95223";
const TOWN = "Dorrington";
const ORG_SLUG = "lube-room";
const SOURCE_NAME = "The Lube Room Saloon";
const SOURCE_URL = "https://www.theluberoom.com/pages/events";

// Registration 10:00 AM, tee off 11:00 AM, awards 6:00 PM (organizer-stated).
const START_TIME = "10:00:00";
const END_TIME = "18:00:00";

// "civic" (Community) rather than the keyword classifier's "other": this is a
// school fundraiser first and a golf scramble second. Nothing auto-writes this
// row (see the blocklist note above), and the shared category self-heal is
// upgrade-only, so a specific category can never be knocked back to "other".
const CATEGORY = "civic";

// Rob's Pick (Rob's call, 2026-08-26): pasture golf that rolls straight into
// the night's band at the same place. Lives here rather than only in the DB
// because this script writes every column on a re-run, so a flag set by hand
// at the database would be silently reverted the next time someone edits it.
const ROBS_PICK = true;
const PICK_REASON = [
  "Golf played across a horse pasture, and when the awards wrap at 6 the band starts at the same place.",
  "Registration is at 10, tee off at 11, $25 a player or $85 for a foursome,",
  "with proceeds going to Hazel Fischer Elementary in Arnold.",
  "Hit Eject plays the saloon 6 to 9 that night.",
].join(" ");

const DESCRIPTION = [
  "The Lube Room's annual golf tournament, played across a horse pasture instead of a course.",
  "Registration opens at 10 AM, tee off is at 11, and awards are at 6 PM.",
  "It costs $25 per player or $85 for a foursome, and extra donations are welcome;",
  "proceeds go to Hazel Fischer Elementary School in Arnold.",
  "Wayne and Marilyn Renaud and Travis and Debbie Loughran are lending their property for the day.",
  "Event director Paul Cardinalli is taking questions at paulcardinalli@comcast.net.",
].join(" ");

function toRow() {
  return {
    name: NAME,
    description: DESCRIPTION,
    date: DATE,
    start_time: START_TIME,
    end_time: END_TIME,
    venue_name: VENUE,
    venue_key: VENUE_KEY,
    town: TOWN,
    address: ADDRESS,
    category: CATEGORY,
    status: "confirmed",
    is_past: false,
    price: "$25 per player, $85 per foursome" as string | null,
    cost_tier: "paid",
    // Every figure below is organizer-stated on the flyer, so lock them: no
    // future writer, including /api/extract-prices, may overwrite or drop them.
    price_locked: true,
    description_locked: true,
    times_locked: true,
    event_url: null as string | null,
    source_url: SOURCE_URL,
    source_name: SOURCE_NAME,
    visibility: "public",
    org_slug: ORG_SLUG,
    is_weekly: false,
    robs_pick: ROBS_PICK,
    pick_reason: PICK_REASON as string | null,
    community_sourced: false,
    dedup_key: generateDedupKey(NAME, DATE, TOWN),
    last_scraped_at: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const row = toRow();

  console.log("=== Lube Room Horse Pasture Golf Tournament ===");
  console.log(`  ${row.date} ${row.start_time}-${row.end_time}  ${row.name}`);

  if (dryRun) {
    console.log("\n--- DRY RUN: full payload, nothing written ---");
    console.log(JSON.stringify(row, null, 2));
    return;
  }

  const { supabaseAdmin } = await import("./lib/supabase-admin.js");
  const { data, error } = await supabaseAdmin
    .from("hwy4_events")
    .upsert([row], { onConflict: "dedup_key" })
    .select("id, name, date");

  if (error) {
    console.error("Upsert failed:", error.message);
    process.exit(1);
  }
  console.log(`\n=== Upserted ${data?.length ?? 0} row(s) ===`);
  for (const r of data ?? []) console.log(`  ${r.date}  ${r.name}  (${r.id})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * One-time backfill script: scan existing events with generic venue names
 * and resolve them using the venue matcher.
 *
 * Usage:
 *   npx tsx scripts/backfill-venues.ts          # dry run (default)
 *   npx tsx scripts/backfill-venues.ts --apply   # apply changes
 */

import { supabaseAdmin } from "./lib/supabase-admin.js";
import { matchVenue, isGenericVenue } from "./lib/venue-matcher.js";

const dryRun = !process.argv.includes("--apply");

async function backfillVenues() {
  console.log(`=== Venue Backfill ${dryRun ? "(DRY RUN)" : "(APPLYING)"} ===\n`);

  // Fetch all future events (no point fixing past ones)
  const today = new Date().toISOString().slice(0, 10);
  const { data: events, error } = await supabaseAdmin
    .from("hwy4_events")
    .select("id, name, description, venue_name, town, address, date, event_url")
    .gte("date", today)
    .order("date", { ascending: true });

  if (error) {
    console.error("Failed to fetch events:", error.message);
    process.exit(1);
  }

  if (!events || events.length === 0) {
    console.log("No future events found.");
    return;
  }

  console.log(`Scanning ${events.length} future events...\n`);

  let fixed = 0;
  let alreadyGood = 0;
  let unfixable = 0;

  for (const event of events) {
    const match = matchVenue(
      event.name,
      event.description,
      event.venue_name,
      event.address ?? null,
      event.event_url ?? null
    );

    if (!match) {
      if (isGenericVenue(event.venue_name)) {
        unfixable++;
        console.log(
          `  [SKIP] "${event.name}" (${event.date}, ${event.town}) — no registry match; address=${event.address ?? "—"}`
        );
      } else {
        alreadyGood++;
      }
      continue;
    }

    fixed++;
    console.log(
      `  [FIX] "${event.name}" (${event.date})\n` +
      `         ${event.venue_name} → ${match.venue_name} (matched: "${match.matched_alias}")`
    );

    if (!dryRun) {
      const updates: Record<string, string> = {
        venue_name: match.venue_name,
        town: match.town,
      };
      if (match.address && !event.address) {
        updates.address = match.address;
      }

      const { error: updateError } = await supabaseAdmin
        .from("hwy4_events")
        .update(updates)
        .eq("id", event.id);

      if (updateError) {
        console.error(`    ✗ Update failed: ${updateError.message}`);
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total future events: ${events.length}`);
  console.log(`Already correct:     ${alreadyGood}`);
  console.log(`Fixed:               ${fixed}`);
  console.log(`Still generic:       ${unfixable} (no match in registry — consider adding venues)`);

  if (dryRun && fixed > 0) {
    console.log(`\nRun with --apply to update the database.`);
  }
}

backfillVenues().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});

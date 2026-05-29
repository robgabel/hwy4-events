/**
 * Unified, re-runnable venue/address backfill.
 *
 * Replays the EXACT normalization the live scrape pipeline applies to a fresh
 * event over rows already in hwy4_events, so existing data converges to what a
 * re-scrape would produce:
 *
 *   1. applyVenueDetection() — resolve generic / messy venue names to a known
 *      venue via address + alias + title/description/URL text scan, and set the
 *      registry town when matched.
 *   2. normalizeEventLocation() — recover address-in-venue-name swaps and fill
 *      a registry street address when the current address is missing or
 *      town-only.
 *
 * When the town changes, the dedup_key is recomputed so future scrapes still
 * find the row. Out-of-corridor rows are reported (not mutated) so a human can
 * decide whether to delete them.
 *
 * Supersedes the old future-only, exact-match-only version.
 *
 * Usage:
 *   npx tsx backfill-venues.ts                 # dry run (default), ALL rows
 *   npx tsx backfill-venues.ts --apply         # write changes
 *   npx tsx backfill-venues.ts --future-only   # limit to date >= today
 */
import { supabaseAdmin } from "./lib/supabase-admin.js";
import { applyVenueDetection } from "./lib/venue-matcher.js";
import { normalizeEventLocation, generateDedupKey } from "./lib/dedup.js";
import { isOutOfCorridor } from "./lib/corridor.js";
import type { ExtractedEvent } from "./lib/extract.js";

interface Row {
  id: string;
  name: string;
  description: string | null;
  date: string;
  town: string;
  venue_name: string | null;
  address: string | null;
  event_url: string | null;
  dedup_key: string | null;
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  const futureOnly = process.argv.includes("--future-only");
  console.log(
    `=== backfill-venues ${dryRun ? "(DRY RUN)" : "(APPLYING)"}` +
      `${futureOnly ? " future-only" : " all rows"} ===`
  );

  // Page through the table — it can exceed the default 1000-row cap.
  const PAGE = 1000;
  let from = 0;
  const rows: Row[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (;;) {
    let q = supabaseAdmin
      .from("hwy4_events")
      .select("id, name, description, date, town, venue_name, address, event_url, dedup_key")
      .order("date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (futureOnly) q = q.gte("date", today);
    const { data, error } = await q;
    if (error) {
      console.error("Query failed:", error.message);
      process.exit(1);
    }
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Loaded ${rows.length} rows\n`);

  let venueChanged = 0;
  let townChanged = 0;
  let addressFilled = 0;
  let rekeyed = 0;
  let conflicts = 0;
  const outOfCorridor: Row[] = [];

  for (const row of rows) {
    if (isOutOfCorridor(row.address, row.venue_name)) {
      outOfCorridor.push(row);
    }

    // Build a mutable event mirror and replay the pipeline normalization.
    const ev: ExtractedEvent = {
      name: row.name,
      description: row.description,
      date: row.date,
      start_time: null,
      end_time: null,
      venue_name: row.venue_name ?? "Unknown Venue",
      town: row.town,
      address: row.address,
      category: "other",
      price: null,
      artists: null,
      event_url: row.event_url,
    };

    applyVenueDetection(ev);
    normalizeEventLocation(ev);

    const updates: Record<string, unknown> = {};
    const newVenue = ev.venue_name;
    const newTown = ev.town;
    const newAddress = ev.address;

    if (newVenue !== (row.venue_name ?? "Unknown Venue")) {
      updates.venue_name = newVenue;
      venueChanged++;
    }
    if (newTown !== row.town) {
      updates.town = newTown;
      townChanged++;
    }
    if (newAddress !== row.address) {
      updates.address = newAddress;
      if (!row.address) addressFilled++;
    }

    if (Object.keys(updates).length === 0) continue;

    // Keep dedup_key consistent with the (possibly new) town so re-scrapes
    // still match this row instead of inserting a duplicate.
    if ("town" in updates) {
      updates.dedup_key = generateDedupKey(row.name, row.date, newTown);
      rekeyed++;
    }

    console.log(
      `  ${row.id.slice(0, 8)} | ${row.date} | "${row.name.slice(0, 40)}"\n` +
        `      venue:   ${JSON.stringify(row.venue_name)} -> ${JSON.stringify(newVenue)}\n` +
        `      town:    ${JSON.stringify(row.town)} -> ${JSON.stringify(newTown)}\n` +
        `      address: ${JSON.stringify(row.address)} -> ${JSON.stringify(newAddress)}`
    );

    if (dryRun) continue;

    const { error } = await supabaseAdmin
      .from("hwy4_events")
      .update(updates)
      .eq("id", row.id);
    if (error) {
      // 23505 = unique violation on dedup_key → a real duplicate already holds
      // that key. Leave this row for the dedup/audit pass rather than forcing.
      if (error.code === "23505") {
        conflicts++;
        console.warn(`      ! dedup_key conflict — skipped (true duplicate exists)`);
      } else {
        console.error(`      ! update failed: ${error.message}`);
      }
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Rows scanned:        ${rows.length}`);
  console.log(`Venue name changes:  ${venueChanged}`);
  console.log(`Town changes:        ${townChanged}`);
  console.log(`Addresses filled:    ${addressFilled}`);
  console.log(`Rows re-keyed:       ${rekeyed}`);
  console.log(`dedup_key conflicts: ${conflicts}`);
  if (outOfCorridor.length > 0) {
    console.log(`\nOut-of-corridor rows (NOT modified — review/delete manually): ${outOfCorridor.length}`);
    for (const r of outOfCorridor) {
      console.log(`  - ${r.id.slice(0, 8)} | ${r.date} | "${r.name}" @ "${r.venue_name}" (${r.town})`);
    }
  }
  if (dryRun) console.log("\nRun with --apply to write changes.");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});

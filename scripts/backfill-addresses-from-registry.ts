/**
 * One-shot backfill: fill in event.address values from the venue registry
 * for rows that have a recognized venue but a null address, and recover
 * rows where the scraper put the address into venue_name.
 *
 * Pairs with PR #2 — once normalizeEventLocation() runs on every new
 * scrape, this only matters for existing rows.
 *
 * Usage:
 *   npx tsx backfill-addresses-from-registry.ts            # apply
 *   npx tsx backfill-addresses-from-registry.ts --dry-run  # log only
 */
import { supabaseAdmin } from "./lib/supabase-admin.js";
import { KNOWN_VENUES } from "./lib/venues.js";

function looksLikeStreetAddress(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^\d+[A-Z]?\s+[A-Za-z]/.test(s.trim());
}

function findRegisteredAddress(venueName: string | null): string | null {
  if (!venueName) return null;
  const target = venueName.toLowerCase().trim();
  for (const v of Object.values(KNOWN_VENUES)) {
    if (v.canonical.toLowerCase() === target) return v.address ?? null;
    for (const a of v.aliases) {
      if (a === target) return v.address ?? null;
    }
  }
  return null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`=== backfill-addresses-from-registry ${dryRun ? "(DRY RUN)" : ""} ===`);

  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("hwy4_events")
    .select("id, name, date, town, venue_name, address")
    .gte("date", today);
  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  let swapped = 0;
  let filled = 0;
  for (const row of (data ?? []) as Array<{
    id: string;
    name: string;
    date: string;
    town: string;
    venue_name: string | null;
    address: string | null;
  }>) {
    const updates: Record<string, unknown> = {};
    let venueName = row.venue_name;
    let address = row.address;

    // 1. Address-in-venue-name recovery
    if (!address && looksLikeStreetAddress(venueName)) {
      updates.address = venueName;
      updates.venue_name = "Unknown Venue";
      address = venueName;
      venueName = "Unknown Venue";
      swapped++;
      console.log(`  SWAP   ${row.id}  ${row.name} | ${row.date} | "${row.venue_name}" → address`);
    }

    // 2. Registry fill-in
    if (!address) {
      const registered = findRegisteredAddress(venueName);
      if (registered) {
        updates.address = registered;
        filled++;
        console.log(`  FILL   ${row.id}  ${row.name} | ${row.date} | venue="${venueName}" → ${registered}`);
      }
    }

    if (Object.keys(updates).length === 0 || dryRun) continue;

    const { error: updErr } = await supabaseAdmin
      .from("hwy4_events")
      .update(updates)
      .eq("id", row.id);
    if (updErr) console.error(`    update failed: ${updErr.message}`);
  }

  console.log("\n=== Summary ===");
  console.log(`Address/venue-name swaps:  ${swapped}`);
  console.log(`Registry address fill-ins: ${filled}`);
  if (dryRun) console.log("(dry run — no DB writes)");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});

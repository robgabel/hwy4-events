/**
 * One-shot backfill: fix rows where the `town` field disagrees with what the
 * `address` clearly says, and re-key affected rows so future scrapes can
 * upsert correctly.
 *
 * Background — see CLAUDE.md, "PR #1 — Scraper bleeding fix":
 *   GoCalaveras's AJAX feed sometimes omits evcal_location_address. The
 *   scraper's classifyEvents LLM step then hallucinated a town (usually
 *   Murphys or Copperopolis) for rows with no address. Detail-page
 *   enrichment populated the address afterward, but the legacy parseAddress
 *   was too strict ("street, city, ST zip") to extract a town from formats
 *   like "1276 S. Main St Angels Camp, 95222" — so the wrong town stuck.
 *
 *   The scraper is now fixed. This script repairs the rows already written.
 *
 * What it does:
 *   1. Updates `town` whenever the address contains a corridor town that
 *      disagrees with the current town (e.g. Murphys → Angels Camp for
 *      Miners Lounge events).
 *   2. Deletes rows whose address mentions a non-corridor city
 *      (e.g. Renegade Winery in Mokelumne Hill).
 *   3. Resets junk venue_name values ("Featuring …", "Hosted by …") to
 *      "Unknown Venue" so the next scrape's venue-matcher pass can resolve
 *      them.
 *   4. Recomputes `dedup_key` for every row whose town changed so the next
 *      scrape can upsert by key instead of inserting a duplicate.
 *
 * Usage:
 *   npx tsx backfill-fix-town-from-address.ts            # apply
 *   npx tsx backfill-fix-town-from-address.ts --dry-run  # log only
 */
import { supabaseAdmin } from "./lib/supabase-admin.js";
import { generateDedupKey } from "./lib/dedup.js";

const HWY4_TOWN_LIST = [
  "Copperopolis",
  "Angels Camp",
  "Murphys",
  "Avery",
  "White Pines",
  "Arnold",
  "Dorrington",
  "Camp Connell",
  "Bear Valley",
];

const NON_CORRIDOR_CITIES = [
  "mokelumne hill",
  "san andreas",
  "valley springs",
  "wallace",
  "rail road flat",
  "railroad flat",
  "west point",
  "mountain ranch",
  "burson",
  "campo seco",
  "glencoe",
  "jackson",
  "sutter creek",
  "pioneer",
  "stockton",
  "lodi",
  "sonora",
  "columbia",
  "jamestown",
];

const POISONED_VENUE = /^(featuring|hosted by|with|feat\.?|w\/)\b/i;

function findCorridorTown(s: string | null): string | null {
  if (!s) return null;
  const lower = s.toLowerCase();
  for (const t of HWY4_TOWN_LIST) {
    if (lower.includes(t.toLowerCase())) return t;
  }
  return null;
}

function isNonCorridorAddress(addr: string | null): boolean {
  if (!addr) return false;
  const lower = addr.toLowerCase();
  return NON_CORRIDOR_CITIES.some((c) => lower.includes(c));
}

interface Row {
  id: string;
  name: string;
  date: string;
  town: string;
  address: string | null;
  venue_name: string | null;
  dedup_key: string | null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`=== backfill-fix-town-from-address ${dryRun ? "(DRY RUN)" : ""} ===`);

  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from("hwy4_events")
    .select("id, name, date, town, address, venue_name, dedup_key")
    .gte("date", today);
  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as Row[];
  console.log(`Inspecting ${rows.length} future events`);

  let toFix = 0;
  let toDrop = 0;
  let toReset = 0;

  for (const row of rows) {
    // 1. Non-corridor → delete
    if (isNonCorridorAddress(row.address)) {
      toDrop++;
      console.log(`  DROP   ${row.id}  ${row.name} | ${row.date} | ${row.address}`);
      if (!dryRun) {
        const { error } = await supabaseAdmin
          .from("hwy4_events")
          .delete()
          .eq("id", row.id);
        if (error) console.error(`    delete failed: ${error.message}`);
      }
      continue;
    }

    const updates: Record<string, unknown> = {};

    // 2. Town vs address mismatch → fix town
    const addrTown = findCorridorTown(row.address);
    let newTown = row.town;
    if (addrTown && addrTown !== row.town) {
      newTown = addrTown;
      updates.town = addrTown;
      // Recompute dedup_key when town changes
      updates.dedup_key = generateDedupKey(row.name, row.date, addrTown);
    }

    // 3. Junk venue_name → reset
    if (row.venue_name && POISONED_VENUE.test(row.venue_name.trim())) {
      updates.venue_name = "Unknown Venue";
      toReset++;
    }

    if (Object.keys(updates).length === 0) continue;

    toFix++;
    console.log(
      `  FIX    ${row.id}  ${row.name} | ${row.date}` +
        (updates.town ? ` | town ${row.town} → ${newTown}` : "") +
        (updates.venue_name ? ` | venue_name "${row.venue_name}" → "Unknown Venue"` : "")
    );

    if (!dryRun) {
      const { error } = await supabaseAdmin
        .from("hwy4_events")
        .update(updates)
        .eq("id", row.id);
      if (error) console.error(`    update failed: ${error.message}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Rows updated:           ${toFix}`);
  console.log(`  ...venue_name reset:  ${toReset}`);
  console.log(`Rows deleted (non-corr):${toDrop}`);
  if (dryRun) console.log("(dry run — no DB writes)");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});

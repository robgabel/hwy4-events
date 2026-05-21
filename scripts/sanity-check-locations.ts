/**
 * Location sanity check.
 *
 * Asserts that every future event in the DB:
 *   - Has an `address` whose city is NOT in conflict with `town`
 *     (e.g. address says "Angels Camp" but town says "Murphys").
 *   - Doesn't have a `venue_name` that obviously isn't a venue
 *     (poisoned by "Featuring …", "Hosted by …", etc.).
 *   - Doesn't have an address in a non-corridor city (Mokelumne Hill,
 *     San Andreas, Valley Springs, …) — those events shouldn't be
 *     reaching the corridor table at all.
 *
 * Runs as a post-scrape gate in CI so the bug family that PR #1
 * addressed can't silently regress.
 *
 * Exits non-zero on any violation. Always prints a summary.
 *
 * Usage:
 *   npx tsx sanity-check-locations.ts                # full check
 *   npx tsx sanity-check-locations.ts --warn-only    # exit 0 even on issues
 */
import { supabaseAdmin } from "./lib/supabase-admin.js";

const HWY4_TOWN_LIST = [
  "Copperopolis", "Angels Camp", "Murphys", "Avery", "White Pines",
  "Arnold", "Dorrington", "Camp Connell", "Bear Valley",
];

const NON_CORRIDOR_CITIES = [
  "mokelumne hill", "san andreas", "valley springs", "wallace",
  "rail road flat", "railroad flat", "west point", "mountain ranch",
  "burson", "campo seco", "glencoe", "jackson", "sutter creek",
  "pioneer", "stockton", "lodi", "sonora", "columbia", "jamestown",
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

function findNonCorridorCity(s: string | null): string | null {
  if (!s) return null;
  const lower = s.toLowerCase();
  for (const c of NON_CORRIDOR_CITIES) {
    if (lower.includes(c)) return c;
  }
  return null;
}

interface Row {
  id: string;
  name: string;
  date: string;
  town: string;
  venue_name: string | null;
  address: string | null;
  source_name: string | null;
}

async function main() {
  const warnOnly = process.argv.includes("--warn-only");
  console.log("=== sanity-check-locations ===");

  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("hwy4_events")
    .select("id, name, date, town, venue_name, address, source_name")
    .gte("date", today);
  if (error) {
    console.error(`DB query failed: ${error.message}`);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];
  console.log(`Checking ${rows.length} future events`);

  const townConflicts: Row[] = [];
  const poisoned: Row[] = [];
  const nonCorridor: Row[] = [];

  for (const row of rows) {
    const addrTown = findCorridorTown(row.address);
    if (addrTown && addrTown !== row.town) townConflicts.push(row);
    if (row.venue_name && POISONED_VENUE.test(row.venue_name.trim())) poisoned.push(row);
    const offBrand = findNonCorridorCity(row.address);
    if (offBrand) nonCorridor.push(row);
  }

  console.log("\n=== Results ===");
  console.log(`Town vs address conflicts:    ${townConflicts.length}`);
  console.log(`Poisoned venue_name strings:  ${poisoned.length}`);
  console.log(`Non-corridor addresses:       ${nonCorridor.length}`);

  const sections: [string, Row[]][] = [
    ["TOWN_CONFLICT", townConflicts],
    ["POISONED_VENUE", poisoned],
    ["NON_CORRIDOR_ADDRESS", nonCorridor],
  ];
  for (const [label, list] of sections) {
    if (list.length === 0) continue;
    console.log(`\n--- ${label} (${list.length}) ---`);
    for (const r of list.slice(0, 20)) {
      console.log(
        `  ${r.id} | ${r.date} | ${r.name} | town=${r.town} | venue="${r.venue_name ?? ""}" | addr="${r.address ?? ""}"`
      );
    }
    if (list.length > 20) console.log(`  … and ${list.length - 20} more`);
  }

  const total = townConflicts.length + poisoned.length + nonCorridor.length;
  if (total === 0) {
    console.log("\n✓ All future events have consistent location data.");
    process.exit(0);
  }

  console.log(`\n✕ Found ${total} location issue(s).`);
  if (warnOnly) {
    console.log("(--warn-only: exiting 0 anyway)");
    process.exit(0);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});

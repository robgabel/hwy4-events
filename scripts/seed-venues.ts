/**
 * Seed / refresh the hwy4_venues table from the code registry
 * (scripts/lib/venues.ts). Idempotent: upserts key, canonical, town, address
 * for every KNOWN_VENUES entry without touching the enrichment columns
 * (blurb, Google Places facts) on existing rows.
 *
 * Run after adding or editing a venue in the registry:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... tsx seed-venues.ts
 *
 * Then enrich:  tsx draft-venue-blurbs.ts --apply   (blurbs)
 *               curl .../api/sync-venue-facts        (Google Places)
 */
import { supabaseAdmin } from "./lib/supabase-admin.js";
import { KNOWN_VENUES } from "./lib/venues.js";

async function main() {
  const rows = Object.entries(KNOWN_VENUES).map(([venue_key, v]) => ({
    venue_key,
    canonical: v.canonical,
    town: v.town,
    address: v.address ?? null,
    updated_at: new Date().toISOString(),
  }));

  // Only the registry-owned columns are upserted, so re-seeding never clobbers
  // an existing row's blurb or synced Places facts.
  const { error } = await supabaseAdmin
    .from("hwy4_venues")
    .upsert(rows, { onConflict: "venue_key" });

  if (error) {
    console.error("Seed failed:", error.message);
    process.exit(1);
  }

  const { count } = await supabaseAdmin
    .from("hwy4_venues")
    .select("venue_key", { count: "exact", head: true });

  console.log(`Seeded ${rows.length} registry venues. hwy4_venues now has ${count ?? "?"} rows.`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

// One-shot seeder for the Arnold Independence Day Parade (July 4, 2026).
// Transcribed from the official parade flyer on 2026-05-29. The parade has no
// machine-readable source the scraper can reach (it lives on a flyer + a static
// arnoldparade.org page), so it's hand-seeded like the Lube Room summer series.
//
// This is a marquee community event: it gets robs_pick=true and a dedicated
// red/white/blue card + custom detail page in the app, keyed off
// org_slug='arnold-parade' (see lib/featured-events.ts). The org row must exist
// first because hwy4_events.org_slug is FK'd to hwy4_orgs.
//
// Idempotent: keyed on the same dedup_key the app computes (name|date|town).
// Re-runnable next year by bumping DATE (and re-deriving the dedup_key).
//
// Run: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/seed-arnold-parade-2026.ts

import { supabaseAdmin } from "./lib/supabase-admin.js";
import { generateDedupKey } from "./lib/dedup.js";

const ORG_SLUG = "arnold-parade";
const TOWN = "Arnold";
const DATE = "2026-07-04";
const SOURCE_URL = "https://www.arnoldparade.org";

const DESCRIPTION =
  "Arnold's biggest morning of the year. The Independence Day Parade steps off " +
  "at 10:00 AM sharp and rolls one mile, all downhill, from the upper Byway " +
  "through town to Cedar Center. This year's theme is Stars, Stripes and 250 " +
  "Years. Get there early, because Highway 4 closes to cars at 9:30 AM, then " +
  "grab a curb, bring a chair, and wave a flag. Free to watch, and about as " +
  "Arnold as it gets.";

async function main(): Promise<void> {
  // 1. Ensure the org exists (FK target for hwy4_events.org_slug).
  const { error: orgErr } = await supabaseAdmin.from("hwy4_orgs").upsert(
    {
      slug: ORG_SLUG,
      display_name: "Arnold Independence Day Parade",
      town: TOWN,
      canonical_url: SOURCE_URL,
      notes:
        "Annual July 4th parade. Hand-curated marquee community event; gets a " +
        "special red/white/blue card + custom detail page in the app (keyed off " +
        "org_slug). Contact: Linda Baker 209-795-5600, lindabaker@arnoldparade.org.",
    },
    { onConflict: "slug", ignoreDuplicates: true }
  );
  if (orgErr) throw orgErr;

  // 2. Insert the event if it isn't already present (idempotent on dedup_key).
  const name = "Arnold Independence Day Parade";
  const dedupKey = generateDedupKey(name, DATE, TOWN);

  const { data: existing } = await supabaseAdmin
    .from("hwy4_events")
    .select("id")
    .eq("dedup_key", dedupKey)
    .maybeSingle();

  if (existing) {
    console.log(`Already present (dedup_key=${dedupKey}, id=${existing.id}). Nothing to do.`);
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("hwy4_events")
    .insert({
      name,
      description: DESCRIPTION,
      date: DATE,
      start_time: "10:00:00",
      end_time: null,
      venue_name: "Arnold Byway",
      town: TOWN,
      address: "Arnold Byway, Arnold, CA 95223",
      category: "festival",
      status: "confirmed",
      price: null,
      cost_tier: "free",
      event_url: SOURCE_URL,
      source_url: SOURCE_URL,
      source_name: "Arnold Independence Day Parade",
      visibility: "public",
      org_slug: ORG_SLUG,
      robs_pick: true,
      is_weekly: false,
      is_past: false,
      verification_status: "verified",
      dedup_key: dedupKey,
    })
    .select("id, name, date")
    .single();

  if (error) throw error;
  console.log(`Inserted: ${data.name} on ${data.date} (id=${data.id}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

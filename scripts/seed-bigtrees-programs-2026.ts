// Seeder for Calaveras Big Trees State Park's 2026 interpretive program season,
// transcribed from the official State Parks page:
//   https://www.parks.ca.gov/?page_id=25994
//
// This script is the SINGLE SOURCE OF TRUTH for the venue. The schedule rules
// live in scripts/lib/bigtrees-schedule.ts and expand to dated rows via the
// tested expander in scripts/lib/recurrence.ts. The venue is blocklisted in
// scripts/lib/manual-sources.ts ("big trees state park" / "calaveras big trees"),
// so the auto-scrapers (GoCalaveras et al.) skip it and can't overwrite these
// rows with their wrong date ranges. A weekly watcher (/api/check-bigtrees-schedule)
// pings Slack when the source page changes so we re-transcribe and re-run.
//
// To change the schedule: edit PROGRAMS in lib/bigtrees-schedule.ts and re-run.
// Re-runnable: upsertEvents dedups by hash(name|date|town). After upserting, this
// finalizes the venue's rows that upsertEvents doesn't manage:
//   - cost_tier 'free' + price_locked: every program is free with park entrance,
//     so price extraction must never relabel them.
//   - is_weekly: set per program so the recurring ones collapse behind the
//     "show weekly" toggle instead of flooding the default list. (Mirrors what
//     tag-weekly.ts would infer; done here so a fresh re-seed is self-correcting.)
//
// Run: npx tsx scripts/seed-bigtrees-programs-2026.ts
//   needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY

import { supabaseAdmin } from "./lib/supabase-admin.js";
import { upsertEvents, type UpsertResult } from "./lib/dedup.js";
import type { ExtractedEvent } from "./lib/extract.js";
import {
  buildOccurrences,
  SOURCE_NAME,
  ORG_SLUG,
  SOURCE_URL,
} from "./lib/bigtrees-schedule.js";

async function main(): Promise<void> {
  const seeded = buildOccurrences();
  // Drop the is_weekly hint — upsertEvents takes plain ExtractedEvents; we apply
  // is_weekly in the finalize step below.
  const events: ExtractedEvent[] = seeded.map(({ is_weekly: _is_weekly, ...e }) => e);

  console.log(`=== Seeding ${events.length} Big Trees 2026 program occurrences ===`);
  const byProgram = new Map<string, number>();
  for (const e of seeded) byProgram.set(e.name, (byProgram.get(e.name) ?? 0) + 1);
  for (const [name, n] of byProgram) console.log(`  ${String(n).padStart(3)}  ${name}`);

  const result: UpsertResult = await upsertEvents(events, SOURCE_NAME, ORG_SLUG, SOURCE_URL);
  console.log("\n=== Upsert result ===");
  console.log(`Inserted:        ${result.inserted}`);
  console.log(`Updated:         ${result.updated}`);
  console.log(`Unchanged:       ${result.unchanged}`);
  console.log(`Skipped (fuzzy): ${result.skippedFuzzy}`);

  // --- Finalize fields upsertEvents doesn't manage --------------------------
  // Every program is free with the $10/vehicle park entrance.
  const { error: priceErr } = await supabaseAdmin
    .from("hwy4_events")
    .update({ cost_tier: "free", price_locked: true })
    .eq("source_name", SOURCE_NAME);
  if (priceErr) console.error("finalize cost_tier failed:", priceErr);

  // is_weekly per program: recurring programs collapse behind the weekly toggle.
  const weeklyNames = [...new Set(seeded.filter((e) => e.is_weekly).map((e) => e.name))];
  const { error: weeklyOffErr } = await supabaseAdmin
    .from("hwy4_events")
    .update({ is_weekly: false })
    .eq("source_name", SOURCE_NAME);
  if (weeklyOffErr) console.error("finalize is_weekly reset failed:", weeklyOffErr);
  const { error: weeklyOnErr } = await supabaseAdmin
    .from("hwy4_events")
    .update({ is_weekly: true })
    .eq("source_name", SOURCE_NAME)
    .in("name", weeklyNames);
  if (weeklyOnErr) console.error("finalize is_weekly set failed:", weeklyOnErr);

  console.log(
    `\nFinalized: cost_tier=free + price_locked on all rows; is_weekly=true on ${weeklyNames.length} recurring programs.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

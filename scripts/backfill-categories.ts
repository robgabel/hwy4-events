/**
 * Reclassify event categories using the shared keyword classifier
 * (lib/categorize.ts — the single source of truth). Built to clean up the
 * large backlog of rows stuck in "other": before the category self-heal landed
 * in scripts/lib/dedup.ts, category was written only on insert, so any row that
 * once landed in "other" (a failed/whiffed classify run) was stuck there
 * forever even when a later scrape classified it correctly.
 *
 * By default it touches only rows currently in "other" (the backlog) and never
 * writes "other" over a specific category. Pass `--all-categories` to re-run
 * over every row — needed after a classifier *retype* (e.g. HWY-47 amenity
 * live_music → civic/festival), since those rows are not in "other".
 *
 * Dry-run by default; apply with --apply. Future-only by default; --all for past.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... tsx backfill-categories.ts
 *   ...                                            tsx backfill-categories.ts --apply
 *   # HWY-47 amenity-stolen live_music rows (after deploy):
 *   ...  tsx backfill-categories.ts --all-categories
 *   ...  tsx backfill-categories.ts --all-categories --apply
 */
import { supabaseAdmin } from "./lib/supabase-admin.js";
import { classifyEventCategory } from "../lib/categorize.js";

const APPLY = process.argv.includes("--apply");
const ALL_DATES = process.argv.includes("--all");
const ALL_CATEGORIES = process.argv.includes("--all-categories");

interface Row {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
}

async function main() {
  let query = supabaseAdmin
    .from("hwy4_events")
    .select("id, name, description, category");
  if (!ALL_CATEGORIES) query = query.eq("category", "other");
  if (!ALL_DATES) query = query.gte("date", new Date().toISOString().split("T")[0]);

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as Row[];

  let changed = 0;
  let errors = 0;
  const tally: Record<string, number> = {};

  for (const row of rows) {
    // Name + description separately so live_music_strong stays title-scoped
    // (HWY-47). With --all-categories this also rewrites amenity-stolen
    // live_music rows onto civic/festival.
    const next = classifyEventCategory(row.name, row.description);
    // Never write "other" over an existing specific category (upgrade-or-retype
    // only). Retype is intentional: live_music → civic for a market blurb is a
    // fix, not a downgrade.
    if (next === (row.category ?? "other")) continue;
    if (next === "other") continue;

    changed++;
    tally[next] = (tally[next] ?? 0) + 1;

    if (APPLY) {
      const { error: upErr } = await supabaseAdmin
        .from("hwy4_events")
        .update({ category: next })
        .eq("id", row.id);
      if (upErr) {
        errors++;
        console.error(`  ✗ ${row.name}: ${upErr.message}`);
      }
    } else {
      console.log(`  ${row.category ?? "∅"} → ${next}  "${row.name}"`);
    }
  }

  const summary = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  console.log(
    `\n${APPLY ? "APPLIED" : "DRY RUN"} — ${rows.length} rows scanned, ${changed} reclassified` +
      `${summary ? ` (${summary})` : ""}${errors ? `, ${errors} errors` : ""}.`
  );
  if (!APPLY && changed > 0) console.log("Re-run with --apply to write.");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});

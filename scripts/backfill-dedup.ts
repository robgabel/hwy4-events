/**
 * One-time (re-runnable) repair: collapse existing duplicate rows in
 * hwy4_events that the title-based dedup_key let through.
 *
 * Thin CLI wrapper over the shared reconcile engine (lib/reconcile.ts), which
 * is also run automatically by the daily /api/reconcile-dupes cron. Both use the
 * exact same "same event" definition as the live site (lib/dedupe-events →
 * lib/event-identity), so what this merges is precisely what the read-time layer
 * would have collapsed. For each duplicate cluster it keeps the richest row,
 * back-fills the survivor's missing fields from the losers (description, image,
 * url, address, price, source_event_id, union of artists), writes a reversible
 * snapshot of each loser to event_merge_log, then deletes the losers.
 *
 * Dry-run by default. Apply with:  tsx backfill-dedup.ts --execute
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
 */
import { supabaseAdmin } from "./lib/supabase-admin.js";
import { reconcileDuplicates } from "../lib/reconcile.js";

const EXECUTE = process.argv.includes("--execute");

async function main() {
  const { deleted, merged } = await reconcileDuplicates(supabaseAdmin, {
    dryRun: !EXECUTE,
    log: (line) => console.log(line),
  });

  if (!EXECUTE && merged.length > 0) {
    console.log("Re-run with --execute to apply.");
  }
  // Surface a non-zero-ish summary for scripting; reconcileDuplicates already
  // printed the per-cluster detail via the log callback.
  void deleted;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

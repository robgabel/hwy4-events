/**
 * Backfill hwy4_events.venue_key for existing rows using the same resolver the
 * scraper write path uses (resolveVenueKey). Links each event to its
 * hwy4_venues row so the detail page can show the venue blurb + live facts.
 *
 * Dry-run by default; apply with --apply. By default only future events are
 * touched (the detail pages that matter); pass --all to include past rows.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... tsx backfill-venue-keys.ts
 *   ...                                            tsx backfill-venue-keys.ts --apply
 */
import { supabaseAdmin } from "./lib/supabase-admin.js";
import { resolveVenueKey } from "./lib/venue-matcher.js";

const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");

interface Row {
  id: string;
  name: string;
  description: string | null;
  venue_name: string;
  address: string | null;
  event_url: string | null;
  venue_key: string | null;
}

async function main() {
  let query = supabaseAdmin
    .from("hwy4_events")
    .select("id, name, description, venue_name, address, event_url, venue_key");
  if (!ALL) query = query.gte("date", new Date().toISOString().split("T")[0]);

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as Row[];

  let resolved = 0;
  let changed = 0;
  let cleared = 0;
  let errors = 0;

  for (const row of rows) {
    const key = resolveVenueKey(row);
    if (key) resolved++;
    if ((key ?? null) === (row.venue_key ?? null)) continue;
    if (key === null) cleared++;
    changed++;

    if (APPLY) {
      const { error: upErr } = await supabaseAdmin
        .from("hwy4_events")
        .update({ venue_key: key })
        .eq("id", row.id);
      if (upErr) {
        errors++;
        console.error(`  ✗ ${row.name}: ${upErr.message}`);
      }
    } else {
      console.log(`  ${row.venue_key ?? "∅"} → ${key ?? "∅"}  "${row.name}" @ ${row.venue_name}`);
    }
  }

  console.log(
    `\n${APPLY ? "APPLIED" : "DRY RUN"} — ${rows.length} events scanned, ${resolved} resolve to a known venue, ` +
      `${changed} would change (${cleared} cleared to null)${errors ? `, ${errors} errors` : ""}.`
  );
  if (!APPLY && changed > 0) console.log("Re-run with --apply to write.");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});

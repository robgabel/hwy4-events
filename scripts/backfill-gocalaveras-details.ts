/**
 * One-shot backfill: re-fetch GoCalaveras event detail pages for existing rows
 * that are missing fields the new enrichment step now captures (full description,
 * full address with city, town when "Unknown", image_url).
 *
 * Usage:
 *   npx tsx backfill-gocalaveras-details.ts            # future events only (default)
 *   npx tsx backfill-gocalaveras-details.ts --all      # past + future
 *   npx tsx backfill-gocalaveras-details.ts --dry-run  # log only, no writes
 *   npx tsx backfill-gocalaveras-details.ts --limit 10 # cap the batch
 */
import { supabaseAdmin } from "./lib/supabase-admin.js";
import { fetchEventDetails } from "./scrapers/gocalaveras.js";
import { generateDedupKey } from "./lib/dedup.js";

interface BackfillRow {
  id: string;
  name: string;
  date: string;
  town: string;
  venue_name: string;
  description: string | null;
  address: string | null;
  image_url: string | null;
  event_url: string | null;
}

function looksIncomplete(row: BackfillRow): boolean {
  if (!row.event_url) return false;
  if (row.image_url == null) return true;
  if (row.town === "Unknown") return true;
  if (row.venue_name === "Unknown Venue") return true;
  // Address missing city (no comma) is incomplete
  if (!row.address || !row.address.includes(",")) return true;
  if (!row.description || row.description.length < 200) return true;
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const includePast = args.includes("--all");
  const limitFlag = args.indexOf("--limit");
  const limit = limitFlag !== -1 ? parseInt(args[limitFlag + 1], 10) : null;

  console.log(
    `=== GoCalaveras backfill ===\n` +
      `Mode: ${dryRun ? "DRY RUN" : "WRITE"}\n` +
      `Scope: ${includePast ? "all dates" : "future only"}\n` +
      `Limit: ${limit ?? "none"}\n`
  );

  let query = supabaseAdmin
    .from("hwy4_events")
    .select("id, name, date, town, venue_name, description, address, image_url, event_url")
    .eq("source_name", "GoCalaveras.com")
    .not("event_url", "is", null)
    .order("date", { ascending: true });

  if (!includePast) {
    const today = new Date().toISOString().slice(0, 10);
    query = query.gte("date", today);
  }

  const { data: rows, error } = await query;
  if (error) {
    console.error("Failed to query rows:", error.message);
    process.exit(1);
  }

  const candidates = (rows as BackfillRow[]).filter(looksIncomplete);
  const work = limit ? candidates.slice(0, limit) : candidates;

  console.log(`${rows?.length ?? 0} GoCalaveras rows; ${candidates.length} look incomplete; processing ${work.length}\n`);

  let touched = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of work) {
    process.stdout.write(`  ${row.date} ${row.name.slice(0, 50)}… `);
    const details = await fetchEventDetails(row.event_url!);
    if (!details) {
      console.log("FETCH FAILED");
      failed++;
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }

    const patch: Record<string, unknown> = {};
    if (
      details.description &&
      details.description.length > (row.description?.length || 0)
    ) {
      patch.description = details.description;
    }
    if (details.locationName && row.venue_name === "Unknown Venue") {
      patch.venue_name = details.locationName;
    }
    if (details.mergedAddress && details.mergedAddress !== row.address) {
      patch.address = details.mergedAddress;
    }
    // mergedTown is high-confidence (parsed from full "street, city, ST zip"),
    // so override even when current town is set — the original scraper's
    // fallback sometimes mis-assigned town from a comma split.
    if (details.mergedTown && details.mergedTown !== row.town) {
      patch.town = details.mergedTown;
      // Re-key so next scrape can match on dedup_key instead of falling through to fuzzy.
      patch.dedup_key = generateDedupKey(row.name, row.date, details.mergedTown);
    }
    if (details.imageUrl && !row.image_url) {
      patch.image_url = details.imageUrl;
    }

    if (Object.keys(patch).length === 0) {
      console.log("nothing to patch");
      skipped++;
    } else {
      const fields = Object.keys(patch).join(",");
      if (dryRun) {
        console.log(`[dry] would patch: ${fields}`);
      } else {
        patch.last_scraped_at = new Date().toISOString();
        const { error: updErr } = await supabaseAdmin
          .from("hwy4_events")
          .update(patch)
          .eq("id", row.id);
        if (updErr) {
          console.log(`UPDATE FAILED: ${updErr.message}`);
          failed++;
        } else {
          console.log(`patched: ${fields}`);
          touched++;
        }
      }
    }

    await new Promise((r) => setTimeout(r, 350));
  }

  console.log(
    `\n=== Done ===\nTouched: ${touched}\nSkipped (no changes needed): ${skipped}\nFailed: ${failed}`
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

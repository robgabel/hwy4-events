/**
 * One-time (re-runnable) repair: collapse existing duplicate rows in
 * hwy4_events that the title-based dedup_key let through.
 *
 * Uses the exact same "same event" definition as the live site
 * (lib/dedupe-events) so what this merges is precisely what the read-time
 * layer would have collapsed. For each duplicate cluster it keeps the richest
 * row (pickSurvivor), back-fills any fields the survivor is missing from the
 * losers (description, image, url, address, price, source_event_id, and the
 * union of artists), then deletes the losers.
 *
 * Dry-run by default. Apply with:  tsx backfill-dedup.ts --execute
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
 */
import { supabaseAdmin } from "./lib/supabase-admin.js";
import { clusterEvents, pickSurvivor } from "../lib/dedupe-events.js";

const EXECUTE = process.argv.includes("--execute");

interface Row {
  id: string;
  name: string;
  date: string;
  town: string;
  venue_name: string | null;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  artists: string[] | null;
  visibility: string | null;
  source_event_id: string | null;
  image_url: string | null;
  event_url: string | null;
  address: string | null;
  price: string | null;
  robs_pick: boolean;
}

async function main() {
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabaseAdmin
    .from("hwy4_events")
    .select(
      "id, name, date, town, venue_name, start_time, end_time, description, artists, visibility, source_event_id, image_url, event_url, address, price, robs_pick, status"
    )
    .gte("date", today)
    .neq("status", "cancelled");
  if (error) throw error;

  const rows = (data ?? []) as Row[];
  const clusters = clusterEvents(rows).filter((c) => c.length > 1);

  console.log(
    `${EXECUTE ? "EXECUTE" : "DRY RUN"} — ${clusters.length} duplicate cluster(s) among ${rows.length} future events.\n`
  );

  let merged = 0;
  let deleted = 0;
  let wouldDelete = 0;

  for (const cluster of clusters) {
    const survivor = pickSurvivor(cluster);
    const losers = cluster.filter((r) => r !== survivor);
    wouldDelete += losers.length;

    // Fill only the fields the survivor lacks; union artists.
    const fill: Partial<Row> = {};
    const artistSet = new Set<string>(
      (survivor.artists ?? []).map((a) => a?.trim()).filter((a): a is string => !!a)
    );
    for (const l of losers) {
      for (const a of l.artists ?? []) {
        const t = a?.trim();
        if (t) artistSet.add(t);
      }
      if (!survivor.description && l.description && !fill.description) fill.description = l.description;
      if (!survivor.image_url && l.image_url && !fill.image_url) fill.image_url = l.image_url;
      if (!survivor.event_url && l.event_url && !fill.event_url) fill.event_url = l.event_url;
      if (!survivor.address && l.address && !fill.address) fill.address = l.address;
      if (!survivor.price && l.price && !fill.price) fill.price = l.price;
      if (!survivor.source_event_id && l.source_event_id && !fill.source_event_id)
        fill.source_event_id = l.source_event_id;
    }
    const mergedArtists = [...artistSet];
    if (
      mergedArtists.length > 0 &&
      JSON.stringify(mergedArtists) !== JSON.stringify(survivor.artists ?? [])
    ) {
      fill.artists = mergedArtists;
    }

    console.log(`• ${survivor.date} ${survivor.start_time ?? "?"} — ${survivor.town}`);
    console.log(`    KEEP  "${survivor.name}"  venue="${survivor.venue_name}"  [${survivor.id}]`);
    for (const l of losers) {
      console.log(`    DROP  "${l.name}"  venue="${l.venue_name}"  [${l.id}]`);
    }
    if (Object.keys(fill).length > 0) {
      console.log(`    fill survivor: ${Object.keys(fill).join(", ")}`);
    }
    console.log("");

    if (EXECUTE) {
      if (Object.keys(fill).length > 0) {
        const { error: ue } = await supabaseAdmin
          .from("hwy4_events")
          .update(fill)
          .eq("id", survivor.id);
        if (ue) console.error(`    update failed: ${ue.message}`);
        else merged++;
      }
      const { error: de } = await supabaseAdmin
        .from("hwy4_events")
        .delete()
        .in(
          "id",
          losers.map((l) => l.id)
        );
      if (de) console.error(`    delete failed: ${de.message}`);
      else deleted += losers.length;
    }
  }

  if (EXECUTE) {
    console.log(`Done. ${merged} survivor merge(s), ${deleted} row(s) deleted.`);
  } else {
    console.log(`Dry run complete. Would delete ${wouldDelete} row(s). Re-run with --execute to apply.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

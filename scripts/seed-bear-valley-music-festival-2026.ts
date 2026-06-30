// Curated "umbrella" row for the Bear Valley Music Festival, plus band-name
// backfill for the nightly shows. Built 2026-06-28.
//
// THE PROBLEM: GoCalaveras scrapes each festival night as its own row, all
// titled identically "Bear Valley Music Festival" at the "Big White Tent". So
// the site shows ~13 look-alike cards and nothing that says "this is a
// three-week festival, July 17 - Aug 2". And 7 of those nights had no act in
// the `artists` field, so their cards were indistinguishable from each other.
//
// THE FIX (two parts, both idempotent):
//   1. One curated UMBRELLA row — "Bear Valley Music Festival 2026", dated the
//      opening day (July 17) with a NULL start_time. The null start parks it in
//      its own read-time dedup bucket (bucketKey = town|date|start|visibility in
//      lib/dedupe-events.ts), so it can never collapse into the 7pm opening-night
//      show. Its title also differs from the nightly "Bear Valley Music Festival"
//      rows, so the write-time matcher won't merge it either (title similarity
//      alone is never a merge trigger — scripts/lib/dedup.ts). This is the
//      "purposefully duplicative" attention-drawer: it rides the upcoming feed
//      from now through opening day and carries a Rob's Pick badge.
//   2. Backfill the 7 nightly shows that were missing their act into `artists`
//      (EventCard renders artists as chips, so this is what makes each night's
//      card show its band/program name). Guarded on `artists IS NULL` so a re-run
//      is a no-op and the 6 nights that already had an act are left untouched.
//      The scraper unions artists on re-scrape (dedup.ts), so these survive.
//
// We deliberately do NOT rename the nightly rows or blocklist the festival from
// the scrapers: their dedup_key is title-based, so renaming would make the next
// GoCalaveras scrape re-insert duplicates, and blocklisting would freeze out the
// real updates the aggregator still provides (newly announced acts, time fixes).
// Showing the act via the `artists` chip gets band names on every card without
// fighting the scraper.
//
// Lineup + festival facts transcribed from bearvalleymusicfestival.org/2026-festival
// and /faq on 2026-06-28 (box office opens 90 min before each show, free parking,
// pre-concert meals, the tent sits in Bear Valley village at ~7,000 ft).
//
// Run (real write, needs Supabase service-role env):
//   env $(grep -E '^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' ../../../../.env.local | xargs) \
//     npx tsx scripts/seed-bear-valley-music-festival-2026.ts
// Preview only (no DB, no env):
//   npx tsx scripts/seed-bear-valley-music-festival-2026.ts --dry-run

import { createHash } from "node:crypto";
import { normalizeName, normalizeTown } from "../lib/event-identity.js";

const TOWN = "Bear Valley";
const VENUE = "Big White Tent";
const VENUE_KEY = "big-white-tent";
const ADDRESS = "39 No Name Rd #34, Bear Valley, CA 95223";
const FESTIVAL_URL = "https://www.bearvalleymusicfestival.org/2026-festival";

// The umbrella row. Title intentionally carries the year so it never collides
// (dedup_key) or text-matches (>=0.85) the nightly "Bear Valley Music Festival"
// rows. NULL start_time keeps it in its own dedup bucket.
const UMBRELLA_NAME = "Bear Valley Music Festival 2026";
const UMBRELLA_DATE = "2026-07-17";
const UMBRELLA_DESCRIPTION =
  "July 17 through August 2, 2026. For nearly three weeks, the Big White Tent up in " +
  "Bear Valley village turns into a concert hall at 7,000 feet. The lineup runs the " +
  "gamut: Tchaikovsky's Fourth and Respighi's Pines of Rome one night, tribute shows " +
  "for David Bowie, Tom Petty, and ELO the next, plus a Chris Cain blues set and an " +
  "afternoon of Broadway. The box office opens 90 minutes before each show, parking is " +
  "free, and you can grab a pre-concert meal under the pines. See the full nightly " +
  "lineup and grab tickets at bearvalleymusicfestival.org.";

// The 7 nightly shows that came in with no act. (The other 6 already carry their
// performer from GoCalaveras and are left alone.) Matched by name+date+venue,
// only filled where `artists` is still NULL.
const ARTIST_BACKFILL: { date: string; act: string }[] = [
  { date: "2026-07-17", act: "Space Oddity: The David Bowie Tribute Experience" },
  { date: "2026-07-24", act: "Copland, Williams and Bernstein: An America250 Celebration" },
  { date: "2026-07-25", act: "Tchaikovsky Symphony No. 4" },
  { date: "2026-07-26", act: "An Afternoon of Broadway With Norm" },
  { date: "2026-07-31", act: "Mozart and Brahms" },
  { date: "2026-08-01", act: "GALA: Hollywood's Golden Age" },
  { date: "2026-08-02", act: "Pines of Rome" },
];

// A prior session left an end-of-run capstone ("Bear Valley Music Festival
// (through Aug 2)") dated Aug 2. The new umbrella replaces its purpose, so that
// row is now a redundant card at the festival's finish. Deleting a row this
// script didn't create is opt-in: pass --cleanup-capstone to remove it. Default
// runs leave it untouched.
const STALE_CAPSTONE_NAME = "Bear Valley Music Festival (through Aug 2)";

function dedupKey(name: string, date: string, town: string): string {
  return createHash("sha256")
    .update(`${normalizeName(name)}|${date}|${normalizeTown(town)}`)
    .digest("hex")
    .slice(0, 32);
}

function umbrellaRow() {
  return {
    name: UMBRELLA_NAME,
    description: UMBRELLA_DESCRIPTION,
    date: UMBRELLA_DATE,
    start_time: null as string | null,
    end_time: null as string | null,
    venue_name: VENUE,
    venue_key: VENUE_KEY,
    town: TOWN,
    address: ADDRESS,
    category: "festival",
    artists: null as string[] | null,
    status: "confirmed",
    is_past: false,
    price: null as string | null,
    cost_tier: "varies", // many ticketed shows at different prices; card reads "Ticketed"
    price_locked: true,
    description_locked: true,
    poster_locked: true,
    image_url: "/images/bear_valley.jpg",
    event_url: FESTIVAL_URL,
    source_url: FESTIVAL_URL,
    source_name: "Bear Valley Music Festival",
    visibility: "public",
    org_slug: null as string | null,
    robs_pick: true,
    is_weekly: false,
    community_sourced: false,
    dedup_key: dedupKey(UMBRELLA_NAME, UMBRELLA_DATE, TOWN),
    last_scraped_at: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const cleanupCapstone = process.argv.includes("--cleanup-capstone");
  const row = umbrellaRow();

  console.log("=== Bear Valley Music Festival 2026 — umbrella + backfill ===");
  console.log(`Umbrella: ${row.date}  ${row.name}  (Rob's Pick, ${row.cost_tier})`);
  console.log(`Backfill ${ARTIST_BACKFILL.length} nightly acts (only where artists IS NULL):`);
  for (const b of ARTIST_BACKFILL) console.log(`  ${b.date}  ${b.act}`);
  console.log(
    cleanupCapstone
      ? `Delete stale capstone: "${STALE_CAPSTONE_NAME}"`
      : `Leaving stale capstone in place (pass --cleanup-capstone to remove): "${STALE_CAPSTONE_NAME}"`
  );

  if (dryRun) {
    console.log("\n--- DRY RUN: full umbrella payload, nothing written ---");
    console.log(JSON.stringify(row, null, 2));
    return;
  }

  const { supabaseAdmin } = await import("./lib/supabase-admin.js");

  // 1. Optionally remove the prior end-of-run capstone (opt-in; no-op if gone).
  if (cleanupCapstone) {
    const del = await supabaseAdmin
      .from("hwy4_events")
      .delete()
      .eq("name", STALE_CAPSTONE_NAME)
      .eq("town", TOWN)
      .select("id");
    if (del.error) {
      console.error("Capstone delete failed:", del.error.message);
      process.exit(1);
    }
    console.log(`\nDeleted ${del.data?.length ?? 0} stale capstone row(s).`);
  }

  // 2. Upsert the umbrella on its dedup_key (idempotent).
  const up = await supabaseAdmin
    .from("hwy4_events")
    .upsert([row], { onConflict: "dedup_key" })
    .select("id, name, date");
  if (up.error) {
    console.error("Umbrella upsert failed:", up.error.message);
    process.exit(1);
  }
  console.log(`Upserted umbrella: ${up.data?.[0]?.id ?? "(none)"}`);

  // 3. Backfill nightly acts, only where the row still has no artists.
  let filled = 0;
  for (const b of ARTIST_BACKFILL) {
    const res = await supabaseAdmin
      .from("hwy4_events")
      .update({ artists: [b.act] })
      .eq("name", "Bear Valley Music Festival")
      .eq("date", b.date)
      .eq("venue_name", VENUE)
      .is("artists", null)
      .select("id");
    if (res.error) {
      console.error(`Backfill ${b.date} failed:`, res.error.message);
      process.exit(1);
    }
    const n = res.data?.length ?? 0;
    filled += n;
    console.log(`  ${b.date}  ${n === 0 ? "(already set / no match)" : "filled"}  ${b.act}`);
  }
  console.log(`\n=== Done. Umbrella upserted, ${filled} nightly act(s) backfilled. ===`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

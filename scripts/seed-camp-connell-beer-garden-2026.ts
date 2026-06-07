// One-shot seeder for the Camp Connell General Store "Beer Garden" 2026 summer
// concert series. Transcribed from the venue's season flyer (an image: "GOOD
// BEER. LIVE MUSIC. GOOD TIMES.") on 2026-06-01. The store publishes the lineup
// only as that graphic, so the live scrapers can't read it.
//
// This script is the SINGLE SOURCE OF TRUTH for the series. The venue is also
// blocklisted in scripts/lib/manual-sources.ts ("camp connell general store" /
// "camp connell beer garden"), so the auto-scrapers (GoCalaveras et al.) skip it
// and can no longer overwrite these hand-entered rows. To change the schedule,
// edit SHOWS below and re-run — nothing else writes these events.
//
// Idempotent: upserts on the unique dedup_key (= hash(name|date|town)), so a
// re-run updates rows in place instead of duplicating. The 2026-06-27 show was
// originally a community submission; it is KEPT as community-sourced (its dedup
// key matches the existing row, so it updates in place) while the rest are
// attributed to the venue.
//
// Flyer facts baked in below: doors 5pm / music 6pm (Sun 7/5 is a 4pm show),
// Sat & Fri cover $5, Sun cover $10, kids 12 & under free, Sierra Nevada beers +
// wine + wood-fired pizza + s'mores bar for purchase.
//
// Run (real write, needs Supabase service-role env):
//   env $(grep -E '^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' ../../../../.env.local | xargs) \
//     npx tsx scripts/seed-camp-connell-beer-garden-2026.ts
// Preview only (no DB, no env):
//   npx tsx scripts/seed-camp-connell-beer-garden-2026.ts --dry-run

import { createHash } from "node:crypto";
import { normalizeName, normalizeTown } from "../lib/event-identity.js";

const VENUE = "Camp Connell General Store";
const VENUE_KEY = "camp-connell-general-store";
const TOWN = "Camp Connell";
const ADDRESS = "4036 Old Highway 4, Camp Connell, CA 95223";
const ORG_SLUG = "camp-connell-general-store";
const VENUE_SOURCE_NAME = "Camp Connell General Store";
const SOURCE_URL = "https://www.campconnellgeneralstore.com/events";

type Show = {
  date: string; // YYYY-MM-DD
  start: string; // "HH:MM" — 6pm shows are 18:00; the Sun 7/5 show is 16:00
  /** The act. null = announced date but act still TBA (placeholder row). */
  act: string | null;
  /** Title override — only used for the TBA placeholder (no act name to use). */
  name?: string;
  cover: string; // "$5" | "$10"
  // 2026-06-27 was a community submission we honor as community-sourced.
  community?: boolean;
  sourceName?: string;
  eventUrl?: string | null;
};

// Saturday & Friday shows = $5; Sunday (7/5) = $10. Kids 12 & under free.
const SHOWS: Show[] = [
  { date: "2026-06-20", start: "18:00", act: "StarDogs", cover: "$5" },
  {
    date: "2026-06-27",
    start: "18:00",
    act: "Grover Anderson & the Lampoliers",
    cover: "$5",
    community: true,
    sourceName: "Community Submission",
    eventUrl: "https://groveranderson.com",
  },
  { date: "2026-07-03", start: "18:00", act: "Jill Warren", cover: "$5" }, // Fri (holiday wknd) — $5 per Rob
  { date: "2026-07-04", start: "18:00", act: "Mountain Crew", cover: "$5" },
  { date: "2026-07-05", start: "16:00", act: "Jimbo Scott & Yesterdays Biscuits", cover: "$10" }, // Sun 4pm
  { date: "2026-07-11", start: "18:00", act: "Hired Gunn", cover: "$5" },
  { date: "2026-07-18", start: "18:00", act: "Brian Jirka Project", cover: "$5" },
  { date: "2026-07-24", start: "18:00", act: "Hwy 4 Blues Band", cover: "$5" }, // Fri — added on the updated 2026 poster
  { date: "2026-07-25", start: "18:00", act: "Blowbacks", cover: "$5" },
  { date: "2026-08-01", start: "18:00", act: null, name: "Live Music at the Beer Garden (Act TBA)", cover: "$5" },
  { date: "2026-08-08", start: "18:00", act: "Flashback", cover: "$5" },
  { date: "2026-08-15", start: "18:00", act: "Gregory Sutton and Luna Fish", cover: "$5" },
];

function dedupKey(name: string, date: string, town: string): string {
  return createHash("sha256")
    .update(`${normalizeName(name)}|${date}|${normalizeTown(town)}`)
    .digest("hex")
    .slice(0, 32);
}

function describe(show: Show): string {
  const head =
    show.act === null
      ? "The act for this beer garden night at the Camp Connell General Store is still to be announced."
      : `${show.act} plays the beer garden at the Camp Connell General Store, part of the 2026 summer concert series.`;
  const timing =
    show.start === "16:00"
      ? "Music starts at 4 p.m. this Sunday, earlier than the usual 6 p.m. shows."
      : "Doors open at 5 p.m. and the music starts at 6 p.m.";
  const cover = `Cover is ${show.cover}, and kids 12 and under get in free.`;
  const food =
    "They're pouring Sierra Nevada beers, with wine, wood-fired pizza, and a s'mores bar available for purchase.";
  const tip = "Bring your own chairs and get there early. Seating fills up fast.";
  const tail = show.act === null ? " Check back for the lineup." : "";
  return `${head} ${timing} ${cover} ${food} ${tip}${tail}`;
}

function toRow(show: Show) {
  const name = show.name ?? show.act!;
  return {
    name,
    description: describe(show),
    date: show.date,
    start_time: show.start,
    end_time: null as string | null,
    venue_name: VENUE,
    venue_key: VENUE_KEY,
    town: TOWN,
    address: ADDRESS,
    category: "live_music",
    artists: show.act ? [show.act] : null,
    status: "confirmed",
    is_past: false,
    price: show.cover,
    cost_tier: "paid",
    price_locked: true,
    description_locked: true,
    event_url: show.eventUrl ?? null,
    source_url: SOURCE_URL,
    source_name: show.sourceName ?? VENUE_SOURCE_NAME,
    visibility: "public",
    org_slug: ORG_SLUG,
    community_sourced: show.community ?? false,
    dedup_key: dedupKey(name, show.date, TOWN),
    last_scraped_at: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const rows = SHOWS.map(toRow);

  console.log(`=== Camp Connell Beer Garden 2026 — ${rows.length} shows ===`);
  for (const r of rows) {
    const badge = r.community_sourced ? " [community]" : "";
    console.log(`  ${r.date} ${r.start_time}  ${r.price.padEnd(3)}  ${r.name}${badge}`);
  }

  if (dryRun) {
    console.log("\n--- DRY RUN: full payloads, nothing written ---");
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const { supabaseAdmin } = await import("./lib/supabase-admin.js");
  const { data, error } = await supabaseAdmin
    .from("hwy4_events")
    .upsert(rows, { onConflict: "dedup_key" })
    .select("id, name, date");

  if (error) {
    console.error("Upsert failed:", error.message);
    process.exit(1);
  }
  console.log(`\n=== Upserted ${data?.length ?? 0} rows ===`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// One-shot seeder for the Lake Alpine Lodge 2026 summer "Music Schedule".
// Transcribed from the venue's season graphic (an image posted to the lodge's
// Facebook page on 2026-06-28: "Lake Alpine Lodge Music Schedule ... just above
// the middle of nowhere"). The lodge is off-grid up Highway 4 and publishes the
// lineup only as that flyer, so the live scrapers can't read it.
//
// This script is the SINGLE SOURCE OF TRUTH for the series. The venue is also
// blocklisted in scripts/lib/manual-sources.ts ("lake alpine"), so the
// auto-scrapers (GoCalaveras et al.) skip it and can't overwrite these
// hand-entered rows. To change the schedule, edit SHOWS below and re-run —
// nothing else writes these events.
//
// Idempotent: upserts on the unique dedup_key (= hash(name|date|town)), so a
// re-run updates rows in place instead of duplicating.
//
// Flyer facts baked in below: music starts 6 p.m. on Thursdays, 1 p.m. on
// Saturdays/Sundays. No cover (free). Multi-day acts (Fri 7/3 & Sat 7/4, Sat
// 8/8 & Sun 8/9, Sat 9/5 & Sun 9/6) are expanded to one row per day. The flyer
// gives no time for Friday 7/3 (it only states Thu / Sat-Sun rules), so per Rob
// that row is set tentatively to 1 p.m. with a call-to-confirm note.
//
// Run (real write, needs Supabase service-role env):
//   env $(grep -E '^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' ../../../../.env.local | xargs) \
//     npx tsx scripts/seed-lake-alpine-lodge-2026.ts
// Preview only (no DB, no env):
//   npx tsx scripts/seed-lake-alpine-lodge-2026.ts --dry-run

import { createHash } from "node:crypto";
import { normalizeName, normalizeTown } from "../lib/event-identity.js";

const VENUE = "Lake Alpine Lodge";
const VENUE_KEY = "lake-alpine-lodge";
const TOWN = "Bear Valley";
const ADDRESS = "4000 Highway 4, Bear Valley, CA 95223";
const ORG_SLUG = "lake-alpine-lodge";
const VENUE_SOURCE_NAME = "Lake Alpine Lodge";
const SOURCE_URL = "https://www.facebook.com/lakealpine/";
const PHONE = "(209) 753-6350";

type Show = {
  date: string; // YYYY-MM-DD
  start: string; // "HH:MM" — Thursdays 18:00, Sat/Sun 13:00
  act: string; // the band/performer
  /** Title + artists override (e.g. a DJ dance party whose title isn't the artist). */
  name?: string;
  artists?: string[];
  /** Flyer gave no start time for this date; the row is a best guess. */
  tentativeTime?: boolean;
};

// Music starts 6 p.m. Thursdays, 1 p.m. Saturdays/Sundays. No cover.
const SHOWS: Show[] = [
  { date: "2026-07-02", start: "18:00", act: "Nathan Ignacio" },
  { date: "2026-07-03", start: "13:00", act: "Craig Fletcher Band", tentativeTime: true }, // Fri — no time on flyer
  { date: "2026-07-04", start: "13:00", act: "Craig Fletcher Band" },
  { date: "2026-07-09", start: "18:00", act: "Randy Mandy and the Frequency Experience" },
  { date: "2026-07-11", start: "13:00", act: "Beans" },
  { date: "2026-07-16", start: "18:00", act: "Randy Mandy and the Frequency Experience" },
  { date: "2026-07-18", start: "13:00", act: "Tom V" },
  {
    date: "2026-07-25",
    start: "13:00",
    act: "DJ Stritch",
    name: "Christmas in July Dance Party with DJ Stritch",
    artists: ["DJ Stritch"],
  },
  { date: "2026-07-30", start: "18:00", act: "Tom V and the Western Kingbirds" },
  { date: "2026-08-06", start: "18:00", act: "Tarantula Hawk" },
  { date: "2026-08-08", start: "13:00", act: "Randy Mandy and the Frequency Experience" },
  { date: "2026-08-09", start: "13:00", act: "Randy Mandy and the Frequency Experience" },
  { date: "2026-08-13", start: "18:00", act: "Home Tonight" },
  { date: "2026-09-03", start: "18:00", act: "Tarantula Hawk" },
  { date: "2026-09-05", start: "13:00", act: "Craig Fletcher Band" },
  { date: "2026-09-06", start: "13:00", act: "Craig Fletcher Band" },
  { date: "2026-09-13", start: "13:00", act: "Andy & Tarantula Hawk" },
];

function dedupKey(name: string, date: string, town: string): string {
  return createHash("sha256")
    .update(`${normalizeName(name)}|${date}|${normalizeTown(town)}`)
    .digest("hex")
    .slice(0, 32);
}

function describe(show: Show): string {
  const head = `${show.act} plays live at Lake Alpine Lodge, right across the road from the water up at 7,000 feet.`;
  const timing = show.tentativeTime
    ? `The schedule lists this Friday show but not a start time, so we have it down for 1 p.m. for now. Call the lodge at ${PHONE} to confirm before you make the drive up.`
    : show.start === "18:00"
      ? "Music starts at 6 p.m."
      : "Music starts at 1 p.m.";
  const tail =
    "The deck bar and restaurant are open, so settle in with a drink and a bite. No cover, and it's a gorgeous spot to catch a set.";
  return `${head} ${timing} ${tail}`;
}

function toRow(show: Show) {
  const name = show.name ?? show.act;
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
    artists: show.artists ?? [show.act],
    status: "confirmed",
    is_past: false,
    price: null as string | null,
    cost_tier: "free",
    price_locked: true,
    description_locked: true,
    event_url: null as string | null,
    source_url: SOURCE_URL,
    source_name: VENUE_SOURCE_NAME,
    visibility: "public",
    org_slug: ORG_SLUG,
    community_sourced: false,
    dedup_key: dedupKey(name, show.date, TOWN),
    last_scraped_at: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const rows = SHOWS.map(toRow);

  console.log(`=== Lake Alpine Lodge 2026 — ${rows.length} shows ===`);
  for (const r of rows) {
    console.log(`  ${r.date} ${r.start_time}  ${r.name}`);
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

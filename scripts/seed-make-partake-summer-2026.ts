// Seeder for Make and parTake's weekly "Summer Maker Sessions" (Arnold).
//
// Make and parTake is a maker/craft studio in Arnold's Meadowmont plaza (2182
// Hwy 4, Suite 600). It publishes its session schedule only as a printed flyer
// ("MAKERS gotta Make — Summer Maker Sessions"), so the live scrapers can't read
// it. Like the Lube Room / Camp Connell / Arnold Library series, the rows are
// hand-curated here and the venue is blocklisted in scripts/lib/manual-sources.ts
// ("make and partake" / "make & partake"), so the auto-scrapers skip it and can't
// overwrite these rows.
//
// This script is the SINGLE SOURCE OF TRUTH for the series. The schedule is a set
// of weekly recurrence *rules* (one per weekday); the dated rows are pure
// arithmetic via the tested scripts/lib/recurrence.ts. Edit a rule (day / times /
// price) or move the window (START / END) and re-run.
//
// Idempotent: upserts on the unique dedup_key (= hash(name|date|town)), so a
// re-run updates rows in place instead of duplicating.
//
// Run (real write, needs Supabase service-role env):
//   env $(grep -E '^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' .env.local | xargs) \
//     npx tsx scripts/seed-make-partake-summer-2026.ts
// Preview only (no DB, no env):
//   npx tsx scripts/seed-make-partake-summer-2026.ts --dry-run
//
// Caveats (transcribed from the flyer, not a published calendar):
//  - The flyer gives no explicit summer start/end. The window below is an
//    assumption; descriptions tell readers to call (209) 916-5675 to confirm and
//    register, and the rows carry the venue site. Re-seed (bump END) to extend.
//  - Holiday/closure weeks are NOT pruned — sanity-check and delete any week the
//    studio is closed.
//  - Wednesday runs a morning and an afternoon session; it's listed as one
//    "All Day" row spanning both (the description breaks out the two times).

import { createHash } from "node:crypto";
import { normalizeName, normalizeTown } from "../lib/event-identity.js";
import { expandWeekly, WED, FRI, SAT, SUN, type Weekday } from "./lib/recurrence.js";

const VENUE = "Make and parTake";
const VENUE_KEY = "make-and-partake";
const TOWN = "Arnold";
const ADDRESS = "2182 Highway 4, Suite 600, Arnold, CA 95223";
const SOURCE_NAME = "Make and parTake";
const SOURCE_URL = "https://makepartake.com/";
const REGISTER = "Register or confirm dates by calling (209) 916-5675. All projects suit ages 7 to 107.";

// Summer window. The flyer gives no explicit dates — see caveat above.
const START = "2026-06-12";
const END = "2026-08-31";

type Series = {
  day: Weekday;
  name: string;
  start: string; // "HH:MM:SS"
  end: string | null; // "HH:MM:SS"
  price: string | null; // human-readable amount, null when the flyer omits it
  description: string;
};

const SERIES: Series[] = [
  {
    day: WED,
    name: "Maker Session: All Day with JJ",
    start: "09:00:00",
    end: "14:30:00",
    price: "$25",
    description:
      "Spend the day making with JJ at Make and parTake in Arnold. Wood crafts, " +
      "polymer clay, water coloring, lettering, and more. The morning session runs " +
      "9:00 to 11:30 and the afternoon session (1:00 to 2:30) features more advanced " +
      "projects. Sessions are $25 each, with lunch available for $5. " +
      REGISTER,
  },
  {
    day: FRI,
    name: "Friday FunDay Maker Session",
    start: "09:00:00",
    end: "15:00:00",
    price: "$30",
    description:
      "Friday FunDay at Make and parTake in Arnold, 9 a.m. to 3 p.m. Paint ceramics, " +
      "flat paint, decoupage, beaded accessories, model magic, and more. Sessions are " +
      "$30 each, with lunch available for $5. " +
      REGISTER,
  },
  {
    day: SAT,
    name: "Saturday Maker Session",
    start: "14:30:00",
    end: "16:00:00",
    price: null,
    description:
      "An afternoon maker session at Make and parTake in Arnold, 2:30 to 4:00. Pick a " +
      "project and make something. See the studio's project schedules for the details. " +
      "Me & Wee sessions are available for younger children. " +
      REGISTER,
  },
  {
    day: SUN,
    name: "Sunday Maker Session",
    start: "14:00:00",
    end: "15:30:00",
    price: null,
    description:
      "A Sunday-afternoon maker session at Make and parTake in Arnold, 2:00 to 3:30. " +
      "Pick a project and make something. See the studio's project schedules for the " +
      "details. Me & Wee sessions are available for younger children. " +
      REGISTER,
  },
];

function dedupKey(name: string, date: string, town: string): string {
  return createHash("sha256")
    .update(`${normalizeName(name)}|${date}|${normalizeTown(town)}`)
    .digest("hex")
    .slice(0, 32);
}

function buildRows() {
  return SERIES.flatMap((s) =>
    expandWeekly([s.day], START, END).map((date) => ({
      name: s.name,
      description: s.description,
      date,
      start_time: s.start,
      end_time: s.end,
      venue_name: VENUE,
      venue_key: VENUE_KEY,
      town: TOWN,
      address: ADDRESS,
      category: "fine_arts",
      artists: null as string[] | null,
      status: "confirmed",
      is_past: false,
      price: s.price,
      cost_tier: "paid",
      price_locked: true, // hand-set fee — keep extract-prices off it
      description_locked: true, // hand-written "call to confirm" caveat — keep it
      event_url: SOURCE_URL,
      source_url: SOURCE_URL,
      source_name: SOURCE_NAME,
      visibility: "public",
      org_slug: null as string | null,
      is_weekly: true,
      robs_pick: false,
      community_sourced: false,
      dedup_key: dedupKey(s.name, date, TOWN),
      last_scraped_at: new Date().toISOString(),
    }))
  );
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const rows = buildRows();

  console.log(`=== Make and parTake Summer Maker Sessions — ${rows.length} rows (${START} … ${END}) ===`);
  for (const r of rows) {
    console.log(`  ${r.date} ${r.start_time}  ${(r.price ?? "—").padEnd(4)}  ${r.name}`);
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

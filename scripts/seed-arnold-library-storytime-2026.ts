// Seeder for the Arnold Library weekly "Storytime with Miss Debbie".
//
// Came in as a community submission (no machine-readable source — the county
// library doesn't publish a calendar the scrapers can read), and it's a weekly
// recurring program, so it's hand-curated like the Lube Room / Camp Connell
// series: a seed script owns the rows, and the venue is blocklisted from the
// auto-scrapers (scripts/lib/manual-sources.ts) so a re-scrape can't overwrite
// or duplicate them.
//
// The schedule is a recurrence *rule* (every Wednesday, 10:30 AM); the dated
// rows are pure arithmetic via the tested scripts/lib/recurrence.ts. Edit the
// rule (DAY / TIME) or extend the horizon (END) and re-run to change it.
//
// Idempotent: keyed on the same dedup_key the app computes (name|date|town), so
// re-running only inserts dates that aren't already present.
//
// Run: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/seed-arnold-library-storytime-2026.ts
//
// Caveats (inferred from the submission, not a published calendar):
//  - Day-of-week (Wednesday) is taken from the submitted date (2026-06-03).
//  - Holiday/closure weeks are NOT pruned — sanity-check around Thanksgiving and
//    the winter holidays, and delete any week the library is closed.
//  - Re-seed (bump END) to extend past 2026-12-30.

import { supabaseAdmin } from "./lib/supabase-admin.js";
import { generateDedupKey } from "./lib/dedup.js";
import { expandWeekly, WED } from "./lib/recurrence.js";

const NAME = "Storytime with Miss Debbie";
const TOWN = "Arnold";
const VENUE_NAME = "Arnold Library";
const VENUE_KEY = "arnold-library";
const ADDRESS = "1065 Blagen Rd, Arnold, CA 95223";
const DESCRIPTION =
  "Come sing songs, dance and listen to stories every week with Miss Debbie! " +
  "This was a community sourced weekly event added June 3, 2026. I couldn't find " +
  "a website to confirm it is still happening. Please call ahead to confirm it's " +
  "on (209) 795-1009 before you head down there.";

const START = "2026-06-03"; // first Wednesday (the submitted date)
const END = "2026-12-30"; // bump + re-run to extend
const TIME = "10:30:00";

async function main(): Promise<void> {
  const dates = expandWeekly([WED], START, END);

  // Skip dates already present (idempotent on the app's dedup_key).
  const keyed = dates.map((date) => ({
    date,
    dedupKey: generateDedupKey(NAME, date, TOWN),
  }));

  const { data: existing } = await supabaseAdmin
    .from("hwy4_events")
    .select("dedup_key")
    .in(
      "dedup_key",
      keyed.map((k) => k.dedupKey)
    );
  const have = new Set((existing ?? []).map((r) => r.dedup_key as string));
  const toInsert = keyed.filter((k) => !have.has(k.dedupKey));

  if (toInsert.length === 0) {
    console.log(`All ${dates.length} Storytime dates already present. Nothing to do.`);
    return;
  }

  const rows = toInsert.map(({ date, dedupKey }) => ({
    name: NAME,
    description: DESCRIPTION,
    date,
    start_time: TIME,
    end_time: null,
    venue_name: VENUE_NAME,
    venue_key: VENUE_KEY,
    town: TOWN,
    address: ADDRESS,
    category: "kids",
    status: "confirmed",
    is_past: false,
    price: null,
    cost_tier: "free", // free library program — locked so extract-prices won't downgrade it
    price_locked: true,
    description_locked: true, // hand-written "call ahead to confirm" caveat — keep it
    event_url: null,
    source_url: "https://hwy4events.com/submit",
    source_name: "Community Submission",
    visibility: "public",
    org_slug: null,
    is_weekly: true,
    robs_pick: false,
    community_sourced: true,
    dedup_key: dedupKey,
    last_scraped_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin.from("hwy4_events").insert(rows);
  if (error) throw error;
  console.log(
    `Inserted ${rows.length} Storytime dates (${toInsert[0].date} … ${
      toInsert[toInsert.length - 1].date
    }). ${have.size} already present.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

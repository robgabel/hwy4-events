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
// rows are pure arithmetic via expandWeeklyThrough. END is the season end:
// a re-run does not emit a Wednesday after it. Dates already cancelled are
// dropped before insert (scripts/lib/series-bounds.ts), same as Big Trees.
//
// Idempotent: keyed on the same dedup_key the app computes (name|date|town), so
// re-running only inserts dates that aren't already present.
//
// Run: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/seed-arnold-library-storytime-2026.ts
//
// Caveats (inferred from the submission, not a published calendar):
//  - Day-of-week (Wednesday) is taken from the submitted date (2026-06-03).
//  - Holiday weeks are not pruned here. A date that is already cancelled is
//    skipped, so deleting a closure week by setting status = 'cancelled' sticks
//    across a re-seed.
//  - Re-seed (bump END) to extend past 2026-12-30. END is required.

import { supabaseAdmin } from "./lib/supabase-admin.js";
import { generateDedupKey } from "./lib/dedup.js";
import { WED } from "./lib/recurrence.js";
import { boundWeeklySeries, expandWeeklyThrough } from "./lib/series-bounds.js";

const NAME = "Storytime with Miss Debbie";
const TOWN = "Arnold";
const VENUE_NAME = "Arnold Library";
const VENUE_KEY = "arnold-library";
const ADDRESS = "1065 Blagen Rd, Arnold, CA 95223";
// Just the organizer's blurb. The "community-submitted, unconfirmed, call ahead"
// disclosure is NOT inline here anymore — it renders from structured confidence
// fields (community_sourced + verification_status) via components/ConfidenceNote
// on the event page. See lib/confidence.ts (WS-8).
const DESCRIPTION =
  "Come sing songs, dance and listen to stories every week with Miss Debbie!";

const START = "2026-06-03"; // first Wednesday (the submitted date)
const END = "2026-12-30"; // bump + re-run to extend
const TIME = "10:30:00";

async function main(): Promise<void> {
  const dates = expandWeeklyThrough([WED], START, END);
  const occurrences = dates.map((date) => ({ name: NAME, date, town: TOWN }));

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("hwy4_events")
    .select("dedup_key, status")
    .in(
      "dedup_key",
      occurrences.map((o) => generateDedupKey(o.name, o.date, o.town))
    );
  if (existingErr) throw new Error(`existing-row lookup failed: ${existingErr.message}`);
  const existingRows = (existing ?? []) as { dedup_key: string | null; status: string | null }[];
  const cancelled = new Set(
    existingRows.filter((r) => r.status === "cancelled" && r.dedup_key).map((r) => r.dedup_key as string)
  );
  const bounded = boundWeeklySeries(occurrences, { seasonEnd: END, cancelledDedupKeys: cancelled });
  const skipped = occurrences.length - bounded.length;
  if (skipped > 0) {
    console.log(
      `Skipping ${skipped} Storytime date(s) past ${END} or already cancelled. A re-seed will not republish them.`
    );
  }

  // Skip dates already present (idempotent on the app's dedup_key).
  const keyed = bounded.map((o) => ({
    date: o.date,
    dedupKey: generateDedupKey(o.name, o.date, o.town),
  }));
  const have = new Set(existingRows.map((r) => r.dedup_key as string));
  const toInsert = keyed.filter((k) => !have.has(k.dedupKey));

  if (toInsert.length === 0) {
    console.log(`All ${bounded.length} in-season Storytime dates already present. Nothing to do.`);
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

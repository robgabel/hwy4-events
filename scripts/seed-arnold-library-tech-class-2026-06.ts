// Seeder for the Arnold Library's "Tech Class for Seniors" June 2026 workshop.
//
// Came in off a printed flyer (no machine-readable source — the county library
// and Calaveras HHSA don't publish a calendar the scrapers can read), and the
// Arnold Library venue is blocklisted from the auto-scrapers
// (scripts/lib/manual-sources.ts), so a seed script owns the row like the rest
// of the hand-curated library programming.
//
// Unlike the weekly Storytime seeder, this is a single dated workshop (the
// monthly Senior Planet / HHSA series rotates topics), so it's one row, no
// recurrence expansion. Re-run for the next month's workshop by editing the
// constants below.
//
// Idempotent: keyed on the same dedup_key the app computes (name|date|town), so
// re-running is a no-op once the row exists.
//
// Run: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/seed-arnold-library-tech-class-2026-06.ts

import { supabaseAdmin } from "./lib/supabase-admin.js";
import { generateDedupKey } from "./lib/dedup.js";

const NAME = "Tech Class for Seniors: Smartphone Photography";
const TOWN = "Arnold";
const VENUE_NAME = "Arnold Library";
const VENUE_KEY = "arnold-library";
const ADDRESS = "1065 Blagen Rd, Arnold, CA 95223";
const DATE = "2026-06-18"; // Thursday
const START_TIME = "13:30:00";
const END_TIME = "14:30:00";
// Organizer flyer (HHSA/Senior Planet), committed to public/event-posters/ and
// shown untouched as the poster (PRD-event-poster-loop.md §9 — we don't brand
// organizer-supplied art). poster_locked so nothing overwrites it.
const IMAGE_URL =
  "https://hwy4events.com/event-posters/arnold-tech-class-2026-06-18.jpg";
const DESCRIPTION =
  "A free one-hour workshop on useful, everyday technology, part of Calaveras " +
  "HHSA's Senior Planet series. This month's topic: Smartphone Photography and " +
  "Camera Uses Beyond Photography. You'll cover basic camera functions, then " +
  "other uses like scanning, searching info, translating, and measuring. Works " +
  "for both Android and iPhones. Space is limited, so email hhsatrainer44@gmail.com " +
  "to reserve your spot.";

async function main(): Promise<void> {
  const dedupKey = generateDedupKey(NAME, DATE, TOWN);

  const { data: existing } = await supabaseAdmin
    .from("hwy4_events")
    .select("id")
    .eq("dedup_key", dedupKey)
    .maybeSingle();

  if (existing) {
    console.log(`Already present (${existing.id}). Nothing to do.`);
    return;
  }

  const row = {
    name: NAME,
    description: DESCRIPTION,
    date: DATE,
    start_time: START_TIME,
    end_time: END_TIME,
    venue_name: VENUE_NAME,
    venue_key: VENUE_KEY,
    town: TOWN,
    address: ADDRESS,
    image_url: IMAGE_URL,
    poster_locked: true,
    category: "civic", // "Community" bucket
    status: "confirmed",
    is_past: false,
    price: null,
    cost_tier: "free", // free library program — locked so extract-prices won't downgrade it
    price_locked: true,
    description_locked: true, // hand-written from the flyer — keep it
    event_url: null,
    source_url: "https://hwy4events.com/submit",
    source_name: "Community Submission",
    visibility: "public",
    org_slug: null,
    is_weekly: false,
    robs_pick: false,
    community_sourced: true,
    dedup_key: dedupKey,
    last_scraped_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin.from("hwy4_events").insert(row);
  if (error) throw error;
  console.log(`Inserted "${NAME}" on ${DATE} (dedup_key ${dedupKey}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

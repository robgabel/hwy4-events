// One-shot seeder for The Lube Room Saloon's "Live at The Lube — Summer of Music"
// 2026 series. Transcribed from a chalkboard photo (IMG_4103.HEIC) on 2026-05-20,
// re-verified against a fresh photo on 2026-05-30.
// The venue's website doesn't publish this list, so the live scraper can't find it.
//
// This script is the SINGLE SOURCE OF TRUTH for the venue. The venue is also
// blocklisted in scripts/lib/manual-sources.ts ("lube room"), so the auto-scrapers
// (GoCalaveras et al.) skip it and can no longer overwrite these rows. To change
// the schedule, edit SHOWS below and re-run — nothing else writes these events.
//
// Re-runnable: upsertEvents() dedups by hash(name|date|town).
//
// Run: npx tsx scripts/seed-lube-room-summer-2026.ts

import { upsertEvents, type UpsertResult } from "./lib/dedup.js";
import type { ExtractedEvent } from "./lib/extract.js";

const VENUE = "The Lube Room Saloon";
const TOWN = "Dorrington";
const ADDRESS = "3431 Highway 4, Dorrington, CA 95223";
const SOURCE_NAME = "The Lube Room Saloon";
const ORG_SLUG = "lube-room";
const SOURCE_URL = "https://www.theluberoom.com/new-events";

// Generic series blurb + photo used for every show that doesn't carry its own.
// (Both originated from the venue's GoCalaveras listings; preserved so the cards
// keep their image and description after the venue was pulled from the scrapers.)
const SERIES_IMAGE =
  "https://www.gocalaveras.com/wp-content/uploads/2026/05/lube-room-concert.jpg";
const SERIES_DESCRIPTION =
  "Join us for the Summer Concert Series at the Lube Room, featuring live music in a relaxed mountain setting. Enjoy great performances, scenic views, and a laid-back atmosphere with friends all season long.";

type ShowRow = {
  date: string;
  artist: string;
  start: string;
  end: string;
  description?: string; // overrides SERIES_DESCRIPTION for this show
  image?: string; // overrides SERIES_IMAGE for this show
};

const SHOWS: ShowRow[] = [
  { date: "2026-05-23", artist: "Lost in the Shuffle", start: "19:00", end: "22:00" },
  { date: "2026-05-24", artist: "Hold Your Horses", start: "19:00", end: "22:00" },
  { date: "2026-06-12", artist: "Poison Oakies", start: "19:00", end: "22:00" },
  { date: "2026-06-27", artist: "VC3 Band", start: "19:00", end: "22:00" },
  { date: "2026-07-03", artist: "Flashback", start: "19:00", end: "22:00" },
  { date: "2026-07-04", artist: "The Delta Chicks", start: "15:00", end: "18:00" },
  { date: "2026-07-04", artist: "Angela St. Band", start: "19:00", end: "22:00" },
  { date: "2026-07-10", artist: "Earthtones", start: "19:00", end: "22:00" },
  { date: "2026-07-18", artist: "The Blue Monday Band", start: "19:00", end: "22:00" },
  { date: "2026-07-25", artist: "Sally and the Fields", start: "19:00", end: "22:00" },
  { date: "2026-07-31", artist: "Star Dogs", start: "19:00", end: "22:00" },
  { date: "2026-08-01", artist: "Overdrive", start: "19:00", end: "22:00" },
  { date: "2026-08-07", artist: "Breakaway", start: "19:00", end: "22:00" },
  { date: "2026-08-08", artist: "One Man Gone Band", start: "19:00", end: "22:00" },
  { date: "2026-08-15", artist: "Surf Creeps", start: "19:00", end: "22:00" },
  { date: "2026-08-22", artist: "Hitman", start: "19:00", end: "22:00" },
  { date: "2026-08-28", artist: "Plan B", start: "19:00", end: "22:00" },
  { date: "2026-08-29", artist: "Hired Gunn", start: "19:00", end: "22:00" },
  { date: "2026-09-05", artist: "Brian Jirka Project", start: "19:00", end: "22:00" },
  { date: "2026-09-06", artist: "Snarky Cats", start: "19:00", end: "22:00" },
  { date: "2026-09-12", artist: "Hit Eject", start: "18:00", end: "21:00" },
  { date: "2026-09-19", artist: "Hit Replay", start: "18:00", end: "21:00" },
  {
    date: "2026-09-25",
    artist: "Firelight",
    start: "18:00",
    end: "21:00",
    description:
      "Kimberly Annand and myself have decided to start a little side project called Firelight – Acoustic Duo and we just got our first gig at the Lube Room Saloon in Dorrington on Friday Evening Sept 25, 2026. We hope to see you there.",
    image: "https://www.gocalaveras.com/wp-content/uploads/2026/04/firelight.jpg",
  },
];

function toExtracted(row: ShowRow): ExtractedEvent {
  return {
    name: `Live at The Lube: ${row.artist}`,
    description: row.description ?? SERIES_DESCRIPTION,
    date: row.date,
    start_time: row.start,
    end_time: row.end,
    venue_name: VENUE,
    town: TOWN,
    address: ADDRESS,
    category: "live_music",
    price: null,
    artists: [row.artist],
    event_url: null,
    image_url: row.image ?? SERIES_IMAGE,
  };
}

async function main(): Promise<void> {
  console.log(`=== Seeding ${SHOWS.length} Lube Room summer 2026 events ===`);
  const events = SHOWS.map(toExtracted);
  for (const e of events) {
    console.log(`  - ${e.date} ${e.start_time}-${e.end_time}  ${e.name}`);
  }
  const result: UpsertResult = await upsertEvents(events, SOURCE_NAME, ORG_SLUG, SOURCE_URL);
  console.log("\n=== Result ===");
  console.log(`Inserted:     ${result.inserted}`);
  console.log(`Updated:      ${result.updated}`);
  console.log(`Unchanged:    ${result.unchanged}`);
  console.log(`Skipped (fuzzy): ${result.skippedFuzzy}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

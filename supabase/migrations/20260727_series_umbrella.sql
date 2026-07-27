-- HWY-10: mark curated festival "umbrella" cards explicitly.
--
-- An umbrella row (one card dated the festival's opening day saying "this runs
-- Jul 17 to Aug 2", alongside the real nightly shows) stayed out of every merge
-- only because its NULL start_time could never share a dedup bucket. That same
-- blindness hid genuine duplicates whose listing simply omitted a start time
-- (the Kane Brown Ironstone double, the Moose Lodge "Rib Feed" pair). Marking
-- umbrellas explicitly lets the matcher treat a missing start as mergeable for
-- everything else, while umbrellas stay separate by intent rather than accident.
alter table hwy4_events
  add column if not exists series_umbrella boolean not null default false;

comment on column hwy4_events.series_umbrella is
  'Curated festival umbrella card (see CLAUDE.md "Festival umbrella rows"). Set only by the seed scripts; every scraper writes false. Excluded from the timeless-merge path in lib/event-identity.ts so an umbrella is never merged into one of its own nightly shows.';

-- Backfill the one umbrella that exists today (scripts/seed-bear-valley-music-festival-2026.ts).
-- Narrow + idempotent: exact title and date, which the seed script owns.
update hwy4_events
   set series_umbrella = true
 where name = 'Bear Valley Music Festival 2026'
   and date = '2026-07-17'
   and start_time is null;

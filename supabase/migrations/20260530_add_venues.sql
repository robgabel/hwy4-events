-- Venue-level info for the event detail page: a local-voice blurb (sourced from
-- docs/LOCAL-KNOWLEDGE-BASE.md via scripts/draft-venue-blurbs.ts) plus a live
-- facts strip (rating, hours, phone, website) synced from the Google Places API
-- by /api/sync-venue-facts. Seeded from the code registry (scripts/lib/venues.ts)
-- via scripts/seed-venues.ts; keyed by the registry's venue_key.

create table if not exists hwy4_venues (
  venue_key            text primary key,
  canonical            text not null,
  town                 text not null,
  address              text,

  -- Local-voice blurb (Rob reviews before publish).
  blurb                text,
  blurb_generated_at   timestamptz,

  -- Google Places live facts. place_id is cacheable indefinitely per Google's
  -- terms; the rest are refreshed weekly (well within Google's ~30-day limit).
  -- maps_url is Google's canonical place URL, used for the required attribution
  -- link when we display the rating.
  place_id             text,
  rating               numeric(2,1),
  user_ratings_total   integer,
  phone                text,
  website              text,
  maps_url             text,
  hours                jsonb,
  places_synced_at     timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table hwy4_venues is
  'Per-venue display info for event detail pages: local-voice blurb + Google Places live facts. Keyed by the scripts/lib/venues.ts registry key.';

-- Read-only to the public; writes only via the service role (seed/sync scripts
-- and the cron route, which use the service key and bypass RLS).
alter table hwy4_venues enable row level security;

create policy "Public read access to venues"
  on hwy4_venues for select
  using (true);

-- Events resolve to a venue via this key, populated at write time by the
-- scraper upsert (scripts/lib/dedup.ts) and backfilled by
-- scripts/backfill-venue-keys.ts. Nullable, no hard FK: an event at an
-- unrecognized venue simply has no key and shows no venue section.
alter table hwy4_events
  add column if not exists venue_key text;

comment on column hwy4_events.venue_key is
  'Registry key (scripts/lib/venues.ts) of the resolved venue, linking to hwy4_venues. NULL when the venue is not in the registry.';

create index if not exists hwy4_events_venue_key_idx
  on hwy4_events (venue_key);

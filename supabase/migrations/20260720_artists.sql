-- Artist / band descriptions (PRD-artist-descriptions.md, Phase 1).
--
-- The band-blurb sibling to hwy4_venues: give each live-music act the same
-- two-sentence local-voice treatment a venue gets. An event links to an artist
-- row by NORMALIZED NAME (no FK / no column on the big hwy4_events table) — the
-- same normalizeName() that keys the dedup logic, so "Star Dogs" / "StarDogs"
-- collapse to one artist_key.
--
-- Accuracy contract (identical to venues): the machine only ever stages a PENDING
-- draft (blurb_draft*); a human Save at /admin/artists is the ONLY path that writes
-- the live `blurb`/`genre`/`links`. A confident-wrong band bio is worse than a
-- blank, so the drafter errs on nothing (see lib/agent/research-artist.ts).
--
-- Columns:
--   artist_key        — normalizeName() slug, primary key
--   name              — canonical display name (first-seen spelling)
--   genre             — short published genre tag ("Classic rock covers"), Tier B
--   blurb             — published two-sentence local-voice prose, human-approved only
--   blurb_generated_at— when the human last published the blurb
--   blurb_draft       — pending machine draft prose (NULL = none / found nothing)
--   blurb_draft_at    — when the drafter last looked (also the "already tried" marker,
--                       stamped even on an empty result so a no-signal act isn't re-run)
--   blurb_draft_meta  — {confidence, genre, hometown, is_local, links, notes, sources[]}
--   links             — published outbound links {website?, facebook?, spotify?, bandcamp?, instagram?}
--   hometown          — "Murphys, CA" when known
--   is_local          — corridor / Calaveras act (the AEO priority set)
create table if not exists hwy4_artists (
  artist_key          text primary key,
  name                text not null,
  genre               text,
  blurb               text,
  blurb_generated_at  timestamptz,
  blurb_draft         text,
  blurb_draft_at      timestamptz,
  blurb_draft_meta    jsonb,
  links               jsonb,
  hometown            text,
  is_local            boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Public read (the blurb renders on public event detail pages in Phase 2), like
-- hwy4_venues. Writes are service-role only (the whole /admin tree + drafter use
-- the service key, which bypasses RLS).
alter table hwy4_artists enable row level security;

drop policy if exists "hwy4_artists public read" on hwy4_artists;
create policy "hwy4_artists public read"
  on hwy4_artists for select
  to anon, authenticated
  using (true);

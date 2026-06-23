-- Pending, machine-drafted venue blurb awaiting human review (Phase 1B of
-- PRD-live-music-experience.md). The weekly `draft-venue-blurbs.ts --queue` run
-- writes a Tier-B draft here for any venue missing a blurb; a human publishes it
-- to `blurb` from /admin/venues (Save) or discards it.
--
-- The accuracy contract: a machine may DRAFT but never PUBLISH voice copy.
-- `blurb` is only ever written by a human Save; `blurb_draft` is never rendered
-- on the public site. RLS is already on hwy4_venues (public read, service-role
-- write) — these nullable columns inherit it, so no policy change is needed.
alter table hwy4_venues
  add column if not exists blurb_draft text,
  add column if not exists blurb_draft_at timestamptz;

comment on column hwy4_venues.blurb_draft is
  'Pending AI-drafted blurb (Tier B) awaiting human review at /admin/venues. Written by scripts/draft-venue-blurbs.ts --queue; published to blurb only by a human Save, or discarded. Never rendered publicly.';

comment on column hwy4_venues.blurb_draft_at is
  'When blurb_draft was last generated. Retained after a human discard as the weekly drafter''s "already proposed, human declined" marker, so a declined venue is not auto-re-drafted; reset to NULL when a blurb is published or the venue is cleared. The --queue gate is: blurb IS NULL AND blurb_draft IS NULL AND blurb_draft_at IS NULL AND place_id IS NOT NULL.';

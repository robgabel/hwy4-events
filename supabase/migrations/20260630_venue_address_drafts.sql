-- Self-healing venue ADDRESS drafts, mirroring the blurb_draft queue (Phase 1B).
--
-- A venue row can land in hwy4_venues with no street address (a manual insert, a
-- create_venue_row approval where research came back empty, or a seed without one).
-- Without an address the detail-page map pin falls back to the town centroid. The
-- daily venue-field drafter (/api/agent/draft-venue-addresses) web-researches the
-- Tier-A street address for any such venue and stages it here as a PENDING draft;
-- a human reviews + approves it at /admin/venues. The machine never writes the live
-- `address` column directly — a human Save does (same accuracy contract as blurbs).
--
-- address_draft       — the researched street address awaiting review (NULL = none staged)
-- address_draft_at    — when the drafter last looked (also the "already tried" marker,
--                       so an empty research result isn't re-run every day)
-- address_draft_meta  — {confidence, notes, sources[]} from the research, shown in the UI
alter table hwy4_venues
  add column if not exists address_draft text,
  add column if not exists address_draft_at timestamptz,
  add column if not exists address_draft_meta jsonb;

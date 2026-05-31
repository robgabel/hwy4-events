-- Lock flag for venues with no correct Google Places listing (permanently
-- closed, or private / no distinct listing). When true, /api/sync-venue-facts
-- skips the venue entirely, so the weekly sync can't re-populate a wrong match
-- after we've cleared it. Mirrors the price_locked / description_locked pattern
-- on hwy4_events.
alter table hwy4_venues
  add column if not exists places_locked boolean not null default false;

comment on column hwy4_venues.places_locked is
  'When true, /api/sync-venue-facts skips this venue entirely. Set for venues with no correct Google Places listing (permanently closed, or private/no distinct listing) so the weekly sync cannot re-populate a wrong match.';

-- Factual Google Places (New) attributes, refreshed weekly by
-- /api/sync-venue-facts, used to ground venue blurbs in real persona signals
-- (dogs / kids / groups / outdoor / live music / parking) and available for
-- future UI badges. Review TEXT is deliberately NOT stored (Google ToS) — the
-- blurb drafter fetches reviews live and uses them only transiently.
alter table hwy4_venues
  add column if not exists places_attributes jsonb;

comment on column hwy4_venues.places_attributes is
  'Factual Google Places (New) attributes refreshed weekly by /api/sync-venue-facts: primary_type, allows_dogs, good_for_children, good_for_groups, outdoor_seating, serves_beer/wine/cocktails, live_music, menu_for_children, restroom, reservable, parking[]. Grounds blurbs in real persona signals. Review text is NOT stored.';

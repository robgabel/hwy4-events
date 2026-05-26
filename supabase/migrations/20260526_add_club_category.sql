-- Add 'club' to the allowed hwy4_events.category check constraint.
-- BLS (Blue Lake Springs HOA) events are members-only club events; the scraper
-- writes them with category='club' and the UI shows a "Members & Guests" badge.
-- See: docs/PRD-blue-lake-springs.md

ALTER TABLE hwy4_events DROP CONSTRAINT IF EXISTS hwy4_events_category_check;

ALTER TABLE hwy4_events
  ADD CONSTRAINT hwy4_events_category_check
  CHECK (category = ANY (ARRAY[
    'live_music'::text,
    'festival'::text,
    'civic'::text,
    'resort'::text,
    'lodge'::text,
    'club'::text,
    'other'::text
  ]));

-- Backfill: existing BLS rows were inserted with visibility='private' and a
-- non-club category. Flip them now that the constraint allows 'club'.
UPDATE hwy4_events
SET visibility = 'public', category = 'club'
WHERE org_slug = 'blue-lake-springs';

-- Add the "fine_arts" event type for theater/plays, comedy, and visual/craft
-- arts (pottery, ceramics, painting, drawing classes). These previously had no
-- home in the 8-type taxonomy and all fell into "other" by design — Murphys
-- Creek Theatre alone produced dozens of "other" rows.
--
-- This migration only widens the CHECK constraint. The data reclassification is
-- handled by scripts/backfill-categories.ts (the shared lib/categorize.ts
-- classifier), so the rule stays in one place.

-- 0. Drop the CHECK constraint so we can write the new value.
ALTER TABLE hwy4_events DROP CONSTRAINT IF EXISTS hwy4_events_category_check;

-- 1. Re-add the CHECK constraint with the fine_arts type included.
ALTER TABLE hwy4_events
  ADD CONSTRAINT hwy4_events_category_check
  CHECK (category = ANY (ARRAY[
    'live_music'::text,
    'festival'::text,
    'civic'::text,
    'hike_walk'::text,
    'kids'::text,
    'wine'::text,
    'games'::text,
    'fine_arts'::text,
    'other'::text
  ]));

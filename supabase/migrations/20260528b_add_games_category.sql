-- Add the "games" event type for social/pub games (bingo, trivia, pool, bocce,
-- cribbage, card tournaments) and reclassify the matching events out of "other".

-- 0. Drop the CHECK constraint so we can write the new value.
ALTER TABLE hwy4_events DROP CONSTRAINT IF EXISTS hwy4_events_category_check;

-- 1. Reclassify by name (scoped to "other" so nothing else is touched).
UPDATE hwy4_events SET category = 'games'
WHERE category = 'other' AND (name IN (
  'Thirsty Thursday Trivia',
  'Bingo Night at Murphys Pourhouse',
  'Pool Tournament @ My Bar',
  'Bocce fun!',
  'Cribbage Tournament @ Murphys Poorhouse',
  'STC Bracket 3 Tourny'
) OR name LIKE 'Women%s Pool Tournament');

-- 2. Re-add the CHECK constraint with the games type included.
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
    'other'::text
  ]));

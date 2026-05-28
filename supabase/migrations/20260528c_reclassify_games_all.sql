-- Reclassify game events that landed in other categories (mostly Moose Lodge
-- bingo / shuffle board / queen of hearts that the earlier overhaul swept into
-- civic) into the games type. Matches the scraper's classification.
UPDATE hwy4_events SET category = 'games'
WHERE category <> 'games'
  AND name ~* '(bingo|shuffle ?board|queen of hearts)';

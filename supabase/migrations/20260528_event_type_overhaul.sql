-- Event-type taxonomy overhaul.
--
-- Event types now describe WHAT an event is, not WHERE it happens. The
-- venue-based buckets (lodge, club, resort) are retired and their events
-- reclassified into activity types. Adds: hike_walk, kids, wine.
--
-- Members-only gating is unchanged: it comes from visibility='private' +
-- org_slug (the "Clubs" filter), independent of category.

-- 0. Drop the old CHECK constraint first so the reclassification UPDATEs can
--    write the new category values. The new constraint is re-added in step 3.
ALTER TABLE hwy4_events DROP CONSTRAINT IF EXISTS hwy4_events_category_check;

-- 1. Reclassify by event name. Scoped to the old buckets so any correctly
--    typed row is never touched. Recurring events share a name, so this also
--    fixes their future-dated copies.

-- → hike_walk
UPDATE hwy4_events SET category = 'hike_walk'
WHERE category IN ('other','lodge','club','resort') AND name IN (
  'Arnold Rim Trail : Ultra Trail Run',
  'Arnold Rim Trail: Natural History Hike with Nancy Muleady-Mecham, PhD',
  'Aronld Rim Trail : Tree Identifier Walks with Mary Anne Carlton',
  'Bear Valley Trail Stewardship',
  'Big Trees State Park - North Grove Guided Hike',
  'Big Trees State Park – North Grove Guided Hike',
  'Bird Walk @ Big Trees State Park',
  'Guided Sunset Hike to Cougar Rock : Arnold Rim Trail',
  'Introduction to North Grove @ Big Trees State Park',
  'Ironstone Vineyards Wine Run 5K',
  'Meadow Walk @ Big Trees State Park',
  'North Grove Guided Walk @ Big Trees State Park',
  'Run the Rim Trail Run',
  'South Grove Guided Hike @ Big Trees State Park',
  'Color Walk/Run'
);

-- → kids
UPDATE hwy4_events SET category = 'kids'
WHERE category IN ('other','lodge','club','resort') AND (name IN (
  'Bear Valley Summer Day Camp',
  'Creek Critters @ Big Trees State Park',
  'Forest School Adventure Camp',
  'Sierra Circus Camp',
  'Summer on Stage Camp – The Mirror Project',
  'Summer on Stage Camp – The Mirror Project Play',
  'Easter Egg Hunt at Ironstone Vineyards',
  'Kids Easter Party',
  'Touch A Truck',
  'Fishing Derby at Lodge Lake',
  'Illuminated Sandcastle Contest',
  'Paper Airplane Contest',
  'The Amazing Race',
  'Cardboard Boat Regatta',
  'Dig-A-Saurus: Roar and Explore',
  'Cheer Camp',
  'Far West U10 Championships @ Bear Valley Ski Resort',
  'Groms Big Day Out: Intro to Park - Ski & Snowboard'
) OR name LIKE 'Milo%s Misfits Reptile Exhibit');

-- → wine
UPDATE hwy4_events SET category = 'wine'
WHERE category IN ('other','lodge','club','resort') AND name IN (
  '7th Annual Cabernet Franc Wine Stroll 2026',
  'Blending Nights at Murphys Wine Bar',
  'Mimosa Sundays at Ironstone Vineyards',
  'Red, White & Rose Wine Experience',
  'Ride to Wine @ The Golf Club at Copper Valley',
  'Thirsty Thursday @ Murphys Wine Bar and Beer Garden',
  'Tuesdays Tasting for Two',
  'Wine Blending Night – Every First Friday',
  'Wine Down Wednesdays',
  'Murphys on the Mountain'
);

-- → live_music
UPDATE hwy4_events SET category = 'live_music'
WHERE category IN ('other','lodge','club','resort') AND (name IN (
  'Brice Station Vineyards – Hilltop Concert Series',
  'Gene Simmons – Murphys',
  'Ironstone Summer Concert Series',
  'Kane Brown – Murphys',
  'Live Music @ Brice Station Vineyards',
  'Live Music @ Ebbetts Pass Moose Lodge',
  'Live Music @ Murphys Community Park',
  'Live Music @ The Lube Room',
  'Music in the Parks Summer Concert Series',
  'Open Mic @ Murphys Irish Pub',
  'Open Mic @ Val du Vino Music Barn',
  'Opera in Concert at The Faith Lutheran Church',
  'Thursday Summer Concert Series @ The Watering Hole',
  'Flashback at Ebbetts Pass Moose Lodge'
) OR name LIKE 'Line Dancing @ Miner%s Lounge');

-- → civic
UPDATE hwy4_events SET category = 'civic'
WHERE category IN ('other','lodge','club','resort') AND (name IN (
  'Cinco de Mayo @ The Watering Hole',
  'Coffee & Cars',
  'Easter Brunch',
  'Easter Brunch @ Hotel Leger',
  'Easter Brunch at Camps',
  'Feast of Saint Patrick at The Mystic Saloon',
  'Frogtown Vintage Hop by Crafty Chicks & Co',
  'Gateway Street Heat Car Show at Copper Valley Town Square',
  'Hot Copper Car Show Show',
  'Masuda For Congress: Hang out at Hovey',
  'Memorial Day Weekend Flea Market',
  'Mother’s Day Brunch @ Murphys Historic Hotel',
  'Mother’s Day Brunch @ Sequoia Woods Golf Club',
  'Mothers Day at Hovey Winery',
  'Mothers Day Brunch at the Dorrington Hotel',
  'Murphys 3rd Annual Most Patriotic Car Cruise Celebrating America’s Independence!',
  'Murphys Park Farmers Market',
  'Welcome Home Makers Market',
  'Father''s Day Weekend Celebration',
  'Memorial Day Celebration - Watermelon Eating Contest',
  'Blue Lake Springs Talent Show',
  'Glow in the Dark Pool Party',
  'Celebrate Mother’s Day at Camps',
  'Season Passholder Appreciation Day',
  'Closing Day!'
) OR name LIKE 'St. Patrick%s Day Sip & Shop');

-- 2. Catch-alls so no venue bucket survives (the new CHECK rejects them).
--    Runs after the by-name passes, so only unmapped rows are swept up.
UPDATE hwy4_events SET category = 'civic' WHERE category IN ('lodge','club');
UPDATE hwy4_events SET category = 'other' WHERE category = 'resort';

-- 3. Add the CHECK constraint for the new activity-type taxonomy.
ALTER TABLE hwy4_events
  ADD CONSTRAINT hwy4_events_category_check
  CHECK (category = ANY (ARRAY[
    'live_music'::text,
    'festival'::text,
    'civic'::text,
    'hike_walk'::text,
    'kids'::text,
    'wine'::text,
    'other'::text
  ]));

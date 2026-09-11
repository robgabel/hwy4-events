-- family_friendly: durable tag for the homepage Kids chip (HWY-34).
--
-- Category is single-valued, so a concert that says "kids welcome" stays
-- live_music. The Kids chip used to key off category==='kids' alone and hid
-- every family-signalled event that had already won a more specific type.
-- This column is the tag that category could not be.
--
-- Written by scrapers from lib/family-friendly.ts `resolveFamilyFriendly`
-- (isFamilyFriendly over name+description, OR category='kids') on INSERT
-- and on unlocked UPDATE. Never guesses past that predicate: false beats
-- a wrong true on a 21+ listing.
--
-- family_friendly_locked joins the existing lock family (price_locked,
-- description_locked, poster_locked, notability_locked, times_locked,
-- visibility_locked). When true, no automated writer may overwrite the flag.
--
-- Hwy4-local: hwy4_events only. Shared Supabase with PAOS; no collision.
-- Public-read RLS on hwy4_events is unchanged (using (true) is load-bearing).
--
-- The SQL backfill only stamps category='kids' rows. The rest of the catalog
-- is set from the JS predicate (scripts/backfill-family-friendly.ts) so the
-- SQL cannot drift from isFamilyFriendly. Unlocked-only; a locked row is
-- a human pin.
--
-- Same reversibility contract as the other locks, per row:
--   lock:   UPDATE hwy4_events SET family_friendly=true,  family_friendly_locked=true  WHERE id=…;
--   unlock: UPDATE hwy4_events SET family_friendly_locked=false WHERE id=…;
--
-- Same caveat as the rest: the lock is per row. A recurring event keeps
-- getting NEW rows for future dates, and those start unlocked.

ALTER TABLE hwy4_events
  ADD COLUMN IF NOT EXISTS family_friendly boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS family_friendly_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN hwy4_events.family_friendly IS
  'Stored family-friendly tag for the Kids chip. Written from resolveFamilyFriendly (isFamilyFriendly over name+description, or category=kids). Default false; never guess past the predicate.';

COMMENT ON COLUMN hwy4_events.family_friendly_locked IS
  'When true, family_friendly is human-set and no automated writer may overwrite it. Mirrors price_locked / description_locked / poster_locked / notability_locked / times_locked / visibility_locked.';

-- Belt-and-braces: a kids-category row is family-friendly even without a
-- hospitality phrase (Storytime with Miss Debbie). The JS backfill covers
-- the live_music / festival / civic rows that actually say "kids welcome".
UPDATE hwy4_events
  SET family_friendly = true
  WHERE category = 'kids'
    AND family_friendly_locked = false
    AND family_friendly = false;

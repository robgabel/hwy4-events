-- visibility_locked: human-pinned public / members-only visibility.
--
-- Joins the existing lock family on hwy4_events (price_locked,
-- description_locked, poster_locked, notability_locked, times_locked). When
-- true, the row's `visibility` is authoritative and no automated writer may
-- rewrite it.
--
-- Why this exists (roadmap ticket HWY-24, found 2026-08-10 while reading the
-- Ebbetts Pass Moose Lodge August newsletter). Two members-only gatherings were
-- being advertised to the open web:
--
--   * Aug 11  WOTM 50th Anniversary Celebration — a free dinner for members,
--             "check the sign-up board in the lodge entryway"
--   * Aug 14  Car Show Setup — a volunteer work call ("Volunteers Needed!!");
--             the route's prompt already lists workdays as private, so the
--             model simply whiffed
--
-- Both were corrected by hand, and both only stayed corrected because their
-- dates passed before the next Monday scrape (the route processes future events
-- only). /api/scrape-moose-lodge reads its calendar with an LLM and writes its
-- OWN update, re-deriving `visibility` on every run, so the same
-- misclassification recurs for next year's car show setup and for anything else
-- the model reads as public. Every other lock-protected field class had an
-- escape hatch; this one did not.
--
-- This is a privacy-shaped defect, not a cosmetic one: the failure mode is
-- publishing a members-only gathering to the open web.
--
-- Scope note: `scripts/lib/dedup.ts` (upsertEvents) writes `visibility` only on
-- INSERT — it is absent from every update payload — so no scraper on the shared
-- path can flip an existing row. The exposure was the self-contained route.
-- scripts/test/visibility-locked.test.ts pins both halves.
--
-- Same reversibility contract as the other locks, per row:
--   lock:   UPDATE hwy4_events SET visibility='private', visibility_locked=true WHERE id=…;
--   unlock: UPDATE hwy4_events SET visibility_locked=false WHERE id=…;
--
-- Same caveat as the rest: the lock is per row. A recurring event keeps getting
-- NEW rows for future dates, and those start unlocked.

ALTER TABLE hwy4_events
  ADD COLUMN IF NOT EXISTS visibility_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN hwy4_events.visibility_locked IS
  'When true, visibility (public / private) is human-set and no automated writer may overwrite it. Mirrors price_locked / description_locked / poster_locked / notability_locked / times_locked.';

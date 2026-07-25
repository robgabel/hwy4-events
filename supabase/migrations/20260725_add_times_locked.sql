-- times_locked: human-pinned start_time / end_time.
--
-- Joins the existing lock family on hwy4_events (price_locked,
-- description_locked, poster_locked, notability_locked). When true, the event's
-- times are authoritative — set by a human, or applied from the organizer's own
-- canonical page — and NO automated writer may touch them: every update payload
-- in scripts/lib/dedup.ts omits start_time/end_time for a locked row.
--
-- Why this exists (2026-07-25). The Arnold Rim Trail sunset hikes were showing a
-- start 30 minutes wrong on the day of the hike: the organizer moves the time as
-- sunset shifts, our row came from an aggregator that snapshots a listing once,
-- and every scraper writes start_time unconditionally — so a hand-corrected time
-- would have been reverted on the next nightly run. There was no way to pin one.
--
-- Same reversibility contract as the other locks, per row:
--   lock:   UPDATE hwy4_events SET start_time=…, end_time=…, times_locked=true WHERE id=…;
--   unlock: UPDATE hwy4_events SET times_locked=false WHERE id=…;
--
-- Same caveat as price_locked: the lock is per row. A recurring event keeps
-- getting NEW rows for future dates, and those start unlocked.

ALTER TABLE hwy4_events
  ADD COLUMN IF NOT EXISTS times_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN hwy4_events.times_locked IS
  'When true, start_time/end_time are human-set (or organizer-confirmed) and no automated writer may overwrite them. Mirrors price_locked / description_locked / poster_locked / notability_locked.';

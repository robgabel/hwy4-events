-- Organizer-stated times staged for human review by /api/verify-events.
--
-- Same accuracy contract as the venue blurb_draft / address_draft queues: a
-- machine proposes, a human applies. The verifier never writes start_time
-- itself; it records what the organizer's canonical page states, and
-- /admin/verification offers a one-click "Use organizer's time" that writes the
-- value AND sets times_locked (migration 20260725_add_times_locked.sql) so a
-- later aggregator re-scrape can't undo the correction.
--
-- Nullable + advisory: a page that states no time leaves these NULL, and NULL
-- must never be read as "the organizer says no time" — only as "we don't know".

ALTER TABLE hwy4_events
  ADD COLUMN IF NOT EXISTS verification_suggested_start time,
  ADD COLUMN IF NOT EXISTS verification_suggested_end time;

COMMENT ON COLUMN hwy4_events.verification_suggested_start IS
  'Start time stated on the organizer canonical page, per /api/verify-events. Advisory only — a human applies it at /admin/verification. NULL = page stated no time.';
COMMENT ON COLUMN hwy4_events.verification_suggested_end IS
  'End time stated on the organizer canonical page, per /api/verify-events. Advisory only.';

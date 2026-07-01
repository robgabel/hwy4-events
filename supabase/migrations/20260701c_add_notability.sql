-- Event notability: hide a venue's mundane recurring OPERATIONS (Thursday-night
-- dinners, Sunday brunches, "open for Father's Day", weekly deli specials) that
-- aren't really events, while keeping genuine events (a concert, a car show, a
-- special dinner WITH live music).
--
--   is_routine        — the hide flag. Read-time filters drop it like a
--                       cancelled row. Only the two operational-venue write
--                       paths (sequoia-woods, moose-lodge) ever set it true.
--   notability_locked — human override; when true no writer touches is_routine.
--                       Mirrors price_locked / description_locked / poster_locked.
--   routine_reason    — which rule (or "llm") fired, for auditing false hides.
ALTER TABLE hwy4_events
  ADD COLUMN IF NOT EXISTS is_routine boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notability_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS routine_reason text;

-- Partial index: the read path filters `is_routine = false` (the common case),
-- so we only need to index the small set of hidden rows.
CREATE INDEX IF NOT EXISTS idx_hwy4_events_is_routine
  ON hwy4_events (is_routine) WHERE is_routine = true;

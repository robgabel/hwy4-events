-- Track when we last sent a confirmation email so /api/newsletter/subscribe
-- can rate-limit re-sends to at most 1 per email per 10 minutes.
--
-- Backfill existing rows with created_at so the first re-signup after this
-- migration uses a sensible starting point (avoids letting old unconfirmed
-- rows immediately re-send on the next attempt).

ALTER TABLE newsletter_subscribers
  ADD COLUMN last_confirmation_sent_at TIMESTAMPTZ;

UPDATE newsletter_subscribers
  SET last_confirmation_sent_at = created_at
  WHERE last_confirmation_sent_at IS NULL;

COMMENT ON COLUMN newsletter_subscribers.last_confirmation_sent_at IS
  'Timestamp of the most recent confirmation email send. Used by /api/newsletter/subscribe to rate-limit resends to once per 10 minutes per email.';

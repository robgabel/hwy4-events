-- Email-to-event ingestion (PRD-email-ingest.md).
--
-- A curator forwards an unstructured event email (often with a poster image) to a
-- dedicated address. /api/inbound-email reads the email AND the poster (Sonnet),
-- then lands a `source='email'` PENDING event_submissions row. From there it rides
-- the existing Agent Cockpit Stage 1 engine: the same `triageSubmissionById` that
-- runs on form submissions analyzes it (dup check via the shared isSameEvent +
-- web research), the same /admin/submissions UI reviews it, and the same publish /
-- reversible-merge actions decide it. No new dedup or merge logic — this just adds
-- the email front door.
--
-- These columns are additive + nullable; existing rows backfill source='form'.
-- RLS is already enabled on event_submissions; the route writes via the service
-- role, so no policy change.
--
-- `poster_url` is shared with the community submit-form's flyer upload (the form
-- and the email front door both stash a flyer in the public event-posters bucket
-- and publish pins it via image_url + poster_locked). It lives here because no
-- other migration file declares it.

ALTER TABLE event_submissions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'form',
  ADD COLUMN IF NOT EXISTS poster_url text,
  ADD COLUMN IF NOT EXISTS raw_email jsonb,
  ADD COLUMN IF NOT EXISTS source_message_id text;

-- Re-delivery idempotency: the inbound route stamps each row with the email's
-- Resend `email_id` (suffixed `#<index>` when one email yields multiple events),
-- so a provider retry can't double-insert. Partial index: form rows leave it NULL
-- and are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS event_submissions_source_message_id_key
  ON event_submissions (source_message_id)
  WHERE source_message_id IS NOT NULL;

COMMENT ON COLUMN event_submissions.source IS
  '''form'' (the /submit form) or ''email'' (forwarded to /api/inbound-email).';
COMMENT ON COLUMN event_submissions.poster_url IS
  'Public URL in the event-posters bucket for a flyer attached to a form or email submission. On publish/merge it becomes hwy4_events.image_url with poster_locked=true.';
COMMENT ON COLUMN event_submissions.raw_email IS
  'Audit copy of an inbound email: { from, subject, text, message_id, received_at }. NULL for form submissions.';
COMMENT ON COLUMN event_submissions.source_message_id IS
  'Resend email_id (+ #index) for an email submission; powers re-delivery idempotency. NULL for form submissions.';

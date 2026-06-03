-- Audit columns for /admin/submissions review actions (PRD-admin-submissions.md).
-- Adds traceability to event_submissions: when a submission was reviewed, which
-- hwy4_events row a publish created (so a wrongly-published event points back to
-- its source submission), and an optional dismissal note. RLS is already enabled
-- on event_submissions (it has a public-insert policy), so this is a plain ALTER.

ALTER TABLE event_submissions
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_event_id uuid,
  ADD COLUMN IF NOT EXISTS review_note text;

COMMENT ON COLUMN event_submissions.published_event_id IS
  'The hwy4_events.id created when this submission was published from /admin/submissions. NULL if not published.';
COMMENT ON COLUMN event_submissions.reviewed_at IS
  'When an admin published or dismissed this submission.';

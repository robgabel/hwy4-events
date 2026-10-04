-- Expired community submissions (daily /api/agent/expire-submissions).
--
-- No new column. The sent copy stays on event_submissions.ai_reply. When the
-- cron itself emails the submitter, the jsonb also carries auto_sent=true and
-- sent_at. Human drafts (approved / questions / declined) omit those fields
-- and still go out through the Gmail compose link.
--
-- Reversible status flip:
--   update event_submissions
--      set status = 'pending', reviewed_at = null, review_note = null, ai_reply = null
--    where review_note = 'Expired: event date passed without review';
-- The email, once accepted by Resend, cannot be unsent.

COMMENT ON COLUMN event_submissions.ai_reply IS
  'Latest reply to the submitter: { outcome (approved|questions|declined|expired), subject, body, to, generated_at, model, auto_sent?, sent_at? }. Human decisions stay drafts for the Gmail compose link. outcome=expired with auto_sent=true was emailed by /api/agent/expire-submissions.';

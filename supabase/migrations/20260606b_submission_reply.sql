-- Submission reply drafts (the CRM loop — PRD-agent-cockpit.md, Stage 1).
--
-- After the owner approves / asks questions / declines a submission, the agent
-- (lib/agent/submission-reply.ts) drafts a short reply to the submitter in the
-- Hwy4Events neighbor voice. The draft is stored here so /admin/submissions can
-- show it with a one-click Gmail compose deep-link. The app never sends mail; the
-- human edits and sends from their own Gmail.
--
-- RLS already enabled on event_submissions; this is a plain additive ALTER.

ALTER TABLE event_submissions
  ADD COLUMN IF NOT EXISTS ai_reply jsonb;

COMMENT ON COLUMN event_submissions.ai_reply IS
  'Latest agent-drafted reply to the submitter: { outcome (approved|questions|declined), subject, body, to, generated_at, model }. Advisory copy only — the human sends it from their own Gmail via a compose deep-link.';

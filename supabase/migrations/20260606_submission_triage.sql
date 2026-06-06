-- AI submission triage (PRD-agent-cockpit.md — Stage 1, submissions).
--
-- When a neighbor submits an event, an agent (lib/agent/submission-triage.ts,
-- driven by /api/agent/triage-submissions + an on-submit after() hook) researches
-- it: checks the DB for an existing match with the shared isSameEvent matcher,
-- web-searches for canonical info, and forms a verdict so the human reviewing
-- /admin/submissions gets an expert opinion (publish as new / already a duplicate
-- / duplicate but adds new info / reject) with a why. The agent NEVER publishes;
-- a human always clicks. These columns store that opinion + the reversible state
-- for the one-click "merge new info into existing event" action.
--
-- RLS is already enabled on event_submissions (it has a public-insert policy),
-- so this is a plain additive ALTER — no policy change.

ALTER TABLE event_submissions
  ADD COLUMN IF NOT EXISTS ai_verdict text,            -- publish_new | duplicate | duplicate_needs_update | reject
  ADD COLUMN IF NOT EXISTS ai_confidence text,         -- high | medium | low
  ADD COLUMN IF NOT EXISTS ai_matched_event_id uuid,   -- hwy4_events.id this duplicates (verdict duplicate*)
  ADD COLUMN IF NOT EXISTS ai_headline text,           -- one-line recommendation the reviewer reads first
  ADD COLUMN IF NOT EXISTS ai_analysis jsonb,          -- full result: rationale, new_info, suggested fields, sources, flags, candidates
  ADD COLUMN IF NOT EXISTS ai_model text,              -- model id that produced the verdict
  ADD COLUMN IF NOT EXISTS ai_analyzed_at timestamptz, -- when triage last ran (NULL = not yet analyzed, the cron's work queue)
  ADD COLUMN IF NOT EXISTS ai_error text,              -- last analysis error, if the run failed
  ADD COLUMN IF NOT EXISTS merged_into_event_id uuid,  -- target event when this submission was MERGED (vs published-new)
  ADD COLUMN IF NOT EXISTS merge_snapshot jsonb;        -- the target event's pre-merge row, for reversibility

-- The cron backstop's work queue: pending submissions that have not been triaged.
CREATE INDEX IF NOT EXISTS idx_event_submissions_ai_unanalyzed
  ON event_submissions (created_at)
  WHERE status = 'pending' AND ai_analyzed_at IS NULL;

COMMENT ON COLUMN event_submissions.ai_verdict IS
  'Agent triage verdict: publish_new | duplicate | duplicate_needs_update | reject. Advisory only — a human always clicks Publish/Merge/Dismiss.';
COMMENT ON COLUMN event_submissions.ai_analysis IS
  'Full triage payload (jsonb): rationale, new_info, suggested field-fills, web sources, flags, and the DB candidates considered.';
COMMENT ON COLUMN event_submissions.merge_snapshot IS
  'The matched hwy4_events row as it was BEFORE a "merge new info" action, captured for reversibility (restore by writing it back over merged_into_event_id). Mirrors event_merge_log.';

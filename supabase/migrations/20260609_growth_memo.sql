-- Growth memo (PRD-growth-agent.md, Phase 1) — the weekly Head-of-Growth
-- reasoner. It shares the existing agent_runs table with the daily chief-of-staff
-- digest; this column distinguishes the two so each surface (/admin/today vs
-- /admin/growth-memo) reads only its own runs.
--
--   chief_of_staff  — daily ops pulse (verification queue, submissions). Demoted.
--   growth_memo     — weekly growth memo (North Star, move of the week). Flagship.
--
-- Read-only, like Stage 0: the growth memo proposes and DRAFTS, it executes
-- nothing. No new table needed (reuses agent_runs' token/status/context plumbing);
-- still service-role only via the existing RLS policy.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS run_type text NOT NULL DEFAULT 'chief_of_staff'
    CHECK (run_type IN ('chief_of_staff', 'growth_memo'));

-- Each surface queries "latest run of my type", so index (run_type, ran_at desc).
CREATE INDEX IF NOT EXISTS idx_agent_runs_type_ran_at
  ON agent_runs (run_type, ran_at DESC);

COMMENT ON COLUMN agent_runs.run_type IS
  'Which reasoner produced this run: chief_of_staff (daily ops digest, /admin/today) or growth_memo (weekly growth memo, /admin/growth-memo). See PRD-growth-agent.md.';

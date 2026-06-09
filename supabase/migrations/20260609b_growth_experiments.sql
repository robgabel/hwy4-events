-- Growth experiments (PRD-growth-agent.md, Phase 3) — the growth agent's memory.
-- Without this, the weekly memo re-guesses what's being tested every run. Each
-- row is one deliberate growth change with a hypothesis and the metric to watch;
-- the growth memo reads the running + recently-concluded rows as GROUND TRUTH and
-- reports an early read on each (it no longer invents experiments). Rob logs and
-- concludes them at /admin/experiments (no raw SQL), mirroring the cockpit's
-- no-SQL philosophy.
--
-- Service-role only (the /admin pages use the service client behind Basic Auth;
-- the agent reads as service role). RLS enabled WITH an explicit service-role
-- policy in this same migration (project hard rule). anon/authenticated denied.

CREATE TABLE growth_experiments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,                 -- short label, e.g. "Newsletter box after event 5"
  hypothesis   text,                          -- what we expect to move and why
  metric       text,                          -- the number to watch, e.g. "newsletter net adds / week"
  status       text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'won', 'lost', 'inconclusive', 'abandoned')),
  baseline     text,                          -- free-text reading at start ("~0-2 net/wk")
  result       text,                          -- the human's conclusion once read
  started_on   date NOT NULL DEFAULT current_date,
  concluded_on date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_growth_experiments_status ON growth_experiments (status, started_on DESC);

ALTER TABLE growth_experiments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access"
  ON growth_experiments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE growth_experiments IS
  'The growth agent''s memory: one row per deliberate growth change (hypothesis + metric). The weekly growth memo reads running/recent rows as ground truth and reports an early read. Managed at /admin/experiments. Service-role only. See PRD-growth-agent.md.';

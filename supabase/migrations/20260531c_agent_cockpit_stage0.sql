-- Agent Cockpit — Stage 0 (read-only "chief of staff" digest).
-- See PRD-agent-cockpit.md. Stage 0 introduces only the two tables the
-- read-only reasoner needs: agent_runs (one row per nightly digest) and
-- seo_snapshots (Google Search Console rows the digest summarizes).
--
-- Both are service-role only. The reasoner (/api/agent/chief-of-staff) and
-- the collector (/api/agent/collect-seo) run as service role (which bypasses
-- RLS). RLS is enabled WITH an explicit service-role policy in this same
-- migration (project hard rule: never create a table without RLS + a policy).
-- anon and authenticated get no policy, so they are denied entirely.
-- agent_actions / agent_policy / aeo_results / fb_candidates arrive in Stage 1+.

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'ok',     -- ok | degraded | empty | error
  model text,                            -- e.g. claude-sonnet-4-6
  input_tokens integer,
  output_tokens integer,
  context_in jsonb,                      -- the structured ground-truth signals handed to the model
  digest jsonb,                          -- the parsed digest the cockpit renders
  error text
);

CREATE INDEX idx_agent_runs_ran_at ON agent_runs (ran_at DESC);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS, but the project hard rule requires an explicit
-- policy in the create migration; this documents intent and makes the access
-- model explicit. anon/authenticated have no policy and are therefore denied.
CREATE POLICY "service role full access"
  ON agent_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE agent_runs IS
  'One row per chief-of-staff reasoner run (/api/agent/chief-of-staff). context_in is the structured ground truth; digest is the rendered summary. Read-only Stage 0 — no actions executed. Service-role only.';


CREATE TABLE seo_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'gsc',    -- gsc | bing
  query text,
  page text,
  clicks numeric,
  impressions numeric,
  ctr numeric,
  position numeric
);

CREATE INDEX idx_seo_snapshots_captured_at ON seo_snapshots (captured_at DESC);

ALTER TABLE seo_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access"
  ON seo_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE seo_snapshots IS
  'Search Console / Bing query+page performance rows, one capture per collector run (/api/agent/collect-seo). The chief-of-staff digest summarizes the latest capture. Service-role only.';

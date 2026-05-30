-- Audit + restore log for the self-healing event identity reconcile
-- (lib/reconcile.ts, run daily by /api/reconcile-dupes and on demand by
-- scripts/backfill-dedup.ts). One row is written here BEFORE each duplicate
-- loser is deleted, capturing the full deleted row in merged_snapshot so any
-- false merge is one `INSERT INTO hwy4_events SELECT merged_snapshot...` away
-- from restoration.
--
-- Service-role only: the reconcile runs as service role (which bypasses RLS).
-- RLS is enabled WITH an explicit service-role policy in this same migration
-- (project hard rule: never create a table without RLS + a policy). anon and
-- authenticated get no policy, so they are denied entirely.

CREATE TABLE event_merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_id uuid NOT NULL,        -- the row that was kept
  merged_from_id uuid NOT NULL,     -- the row that was deleted
  merged_snapshot jsonb NOT NULL,   -- full deleted row, for restore
  signal text NOT NULL,             -- which isSameEvent signal fired (audit label)
  merged_at timestamptz NOT NULL DEFAULT now()
);

-- Recent-merges queries (the /api/check-events 24h line) hit merged_at.
CREATE INDEX idx_event_merge_log_merged_at ON event_merge_log (merged_at DESC);

ALTER TABLE event_merge_log ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS, but the project hard rule requires an explicit
-- policy in the create migration; this documents intent and makes the access
-- model explicit. anon/authenticated have no policy and are therefore denied.
CREATE POLICY "service role full access"
  ON event_merge_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE event_merge_log IS
  'Reversible audit log of automated duplicate merges (lib/reconcile.ts). One row per deleted loser, captured before deletion; merged_snapshot holds the full row for restore. Service-role only.';

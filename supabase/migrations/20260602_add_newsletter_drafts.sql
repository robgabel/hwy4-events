-- Weekly newsletter approval gate (PRD-agent-cockpit Stage 2 retrofit).
--
-- Until now the Thursday cron (/api/newsletter/send) generated the weekly email
-- with an LLM and shipped it to every subscriber in one shot, with no human
-- preview — the single most outward-facing action in the system and the only one
-- with no gate. This table inserts a human between generation and send:
--
--   Wednesday  /api/newsletter/prepare  → INSERT a draft (status 'pending')
--   (human)    /admin/newsletter        → edit + Approve (status 'approved')
--   Thursday   /api/newsletter/send      → ship ONLY an 'approved' draft (→ 'sent')
--
-- If no approved draft exists on send day, the send is skipped (safe failure:
-- never ship unreviewed copy) and a Slack warning fires.
--
-- One draft per target Thursday (target_send_date UNIQUE) so prepare/regenerate
-- is idempotent — re-running upserts the same row rather than piling up drafts.
--
-- Service-role only: prepare/send run as service role and the /admin pages use
-- the service client behind Basic Auth (middleware.ts). RLS is enabled WITH an
-- explicit service-role policy in this same migration (project hard rule: never
-- create a table without RLS + a policy). anon/authenticated get no policy and
-- are therefore denied entirely.

CREATE TABLE newsletter_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_send_date date NOT NULL UNIQUE,   -- the Thursday this draft ships on
  subject text NOT NULL,
  content text NOT NULL,                    -- AI-generated body (markdown links)
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'sent', 'canceled')),
  model text,
  event_count int,
  edited boolean NOT NULL DEFAULT false,    -- true once a human hand-edits the body
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  sent_at timestamptz,
  sent_count int
);

-- The send route looks up "today's" draft by target_send_date; the admin page
-- lists most-recent-first.
CREATE INDEX idx_newsletter_drafts_target ON newsletter_drafts (target_send_date DESC);

ALTER TABLE newsletter_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access"
  ON newsletter_drafts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE newsletter_drafts IS
  'Weekly newsletter approval gate. prepare (Wed) inserts a pending draft; a human approves it at /admin/newsletter; send (Thu) ships only the approved draft. One row per target Thursday. Service-role only.';

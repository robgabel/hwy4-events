-- Durable newsletter send ledger + suppression list.
--
-- Adopted from Peter Hollens's Eugene fork (eugene/codex/eugene-bootstrap,
-- 20260619_newsletter_send_log.sql) per HANDOFF-newsletter-reconcile.md: the
-- delivery route must be able to resume after a timeout or rate limit without
-- re-blasting recipients who already received the message. The
-- UNIQUE(campaign_id, email) + upsert is the whole point — re-blasting becomes
-- structurally impossible, not just guarded against.

CREATE TABLE newsletter_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES newsletter_drafts(id) ON DELETE CASCADE,
  email text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('pending', 'sent', 'failed', 'suppressed')),
  resend_id text,
  error text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, email)
);

CREATE INDEX idx_newsletter_send_log_campaign_status
  ON newsletter_send_log (campaign_id, status);
CREATE INDEX idx_newsletter_send_log_email
  ON newsletter_send_log (email);

ALTER TABLE newsletter_send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access"
  ON newsletter_send_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE newsletter_send_log IS
  'Durable per-recipient delivery ledger for newsletter sends. Used for idempotent, resumable Resend batch delivery. Service-role only.';

CREATE TABLE newsletter_suppressions (
  email text PRIMARY KEY,
  reason text NOT NULL
    CHECK (reason IN ('hard_bounce', 'complaint', 'manual', 'invalid', 'other')),
  source text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE newsletter_suppressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access"
  ON newsletter_suppressions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE newsletter_suppressions IS
  'Emails suppressed from newsletter delivery due to hard bounces, complaints, manual holds, invalid addresses, or future Resend webhook events. Service-role only.';

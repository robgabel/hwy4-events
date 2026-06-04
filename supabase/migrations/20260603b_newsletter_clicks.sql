-- Per-event newsletter click tracking (PRD-newsletter-click-tracking.md).
-- Each row is one click on a newsletter event link, logged by the first-party
-- redirect route app/r/n/[campaign]/[event] before it 302s to the event page.
-- This is the source of truth for "which events got clicked from the newsletter"
-- (Cloudflare RUM can't see it: it drops query strings and email has no referer).
--
-- Internal/ops data: RLS enabled WITH a service-role-only policy in this same
-- migration (project hard rule). The redirect route and the Growth tab both use
-- the service role (which bypasses RLS); anon/authenticated get no policy.

CREATE TABLE newsletter_clicks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id text NOT NULL,        -- the newsletter_drafts.id this link shipped under ("test"/"preview" for smoke tests)
  event_id    uuid,                 -- hwy4_events.id the link points to (null if the event couldn't be resolved)
  slug        text,                 -- the event slug (redirect target + a stable label if the event is later deleted)
  clicked_at  timestamptz NOT NULL DEFAULT now(),
  user_agent  text,
  is_bot      boolean NOT NULL DEFAULT false  -- flagged by UA; email scanners pre-click links
);

CREATE INDEX idx_newsletter_clicks_campaign ON newsletter_clicks (campaign_id, event_id);
CREATE INDEX idx_newsletter_clicks_clicked_at ON newsletter_clicks (clicked_at DESC);

ALTER TABLE newsletter_clicks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access"
  ON newsletter_clicks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE newsletter_clicks IS
  'One row per click on a newsletter event link (logged by app/r/n/[campaign]/[event]). Powers the Growth tab "Newsletter clicks" panel. Internal/ops only. See PRD-newsletter-click-tracking.md.';

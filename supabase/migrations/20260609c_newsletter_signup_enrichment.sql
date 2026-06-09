-- Newsletter signup enrichment (PRD-growth-agent.md, R1b + R1c). Captures, at
-- signup time, WHERE a subscriber came from and WHETHER they look local or a
-- visitor, so the growth agent can see who the list is, not just how big it is.
--
--   signup_source — which box/page the signup came from (homepage_event5,
--     temporal_weekend, town_murphys, ...). The cheapest down payment on
--     attribution; measures the placement experiments directly.
--   visitor_class — local | visitor | unknown, classified server-side from
--     Vercel geo headers at signup (lib/geo.ts classifyVisitor). We store ONLY
--     the class, never the IP and never city/region — a subscriber row is tied
--     to an email (PII), so we do not attach a location to a named person.
--
-- Both nullable: existing rows predate the columns and stay null. Daily series
-- + running total are derived on the fly from created_at/confirmed_at/
-- unsubscribed_at (lib/newsletter-stats.ts), so no snapshot table is needed.

ALTER TABLE newsletter_subscribers
  ADD COLUMN IF NOT EXISTS signup_source text,
  ADD COLUMN IF NOT EXISTS visitor_class text
    CHECK (visitor_class IN ('local', 'visitor', 'unknown'));

COMMENT ON COLUMN newsletter_subscribers.signup_source IS
  'Which signup placement this subscriber came from (homepage_event5, temporal_weekend, town_<slug>, ...). Set at write time by /api/newsletter/subscribe. Null for pre-R1 rows. See PRD-growth-agent.md.';
COMMENT ON COLUMN newsletter_subscribers.visitor_class IS
  'local | visitor | unknown, classified from Vercel geo headers at signup (lib/geo.ts). Class only, never the IP or city/region. Directional: a visitor signing up from inside their rental geolocates local. See PRD-growth-agent.md.';

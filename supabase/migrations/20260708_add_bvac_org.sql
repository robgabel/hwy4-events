-- Add Bear Valley Adventure Co. as an event-source organization.
--
-- Required so hwy4_events rows written by the config-driven Firecrawl scraper
-- (org_slug = 'bvac', scripts/scrapers/firecrawl-sources.ts) satisfy
-- fk_hwy4_events_org (org_slug -> hwy4_orgs.slug).
--
-- canonical_url is intentionally left NULL: BVAC's Squarespace events page
-- gives every event a durable per-event permalink (bvadventures.com/events/
-- <slug>), which the scraper stores as event_url — so the link resolver
-- (lib/event-link.ts) surfaces that precise page (path 3) instead of one
-- generic organizer URL. Same reasoning as the red-cross org row.
INSERT INTO hwy4_orgs (slug, display_name)
VALUES ('bvac', 'Bear Valley Adventure Co.')
ON CONFLICT (slug) DO NOTHING;

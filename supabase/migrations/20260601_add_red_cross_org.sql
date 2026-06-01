-- Add the American Red Cross as a community event-source organization.
--
-- Required so hwy4_events rows written by scripts/scrapers/red-cross.ts
-- (org_slug = 'red-cross') satisfy fk_hwy4_events_org (org_slug -> hwy4_orgs.slug).
--
-- canonical_url is intentionally left NULL: each blood-drive row carries a
-- per-ZIP redcrossblood.org drive-results event_url, so the link resolver
-- (lib/event-link.ts) surfaces that precise booking link (path 3) instead of a
-- single generic organizer URL. visibility_default falls back to 'public'.
INSERT INTO hwy4_orgs (slug, display_name)
VALUES ('red-cross', 'American Red Cross')
ON CONFLICT (slug) DO NOTHING;

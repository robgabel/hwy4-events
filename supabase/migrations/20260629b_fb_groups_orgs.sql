-- Add three Highway 4 community Facebook groups as event-source organizations.
--
-- Required so hwy4_events rows written by scripts/scrapers/hwy4-fb-groups.ts
-- (org_slug = 'fb-group-*') satisfy fk_hwy4_events_org (org_slug -> hwy4_orgs.slug).
-- One org per group (rather than a single 'fb-groups') so scrape-health and the
-- /admin/sources panel can tell which group is actually productive.
--
-- canonical_url is intentionally left NULL (like red-cross): each extracted event
-- carries its originating group post as event_url, and a Facebook group landing
-- page is not a durable per-event link, so the link resolver must not promote it.
-- Display names are placeholders derived from the URL handles; rename freely.
INSERT INTO hwy4_orgs (slug, display_name) VALUES
  ('fb-group-uh4ccc',          'Facebook group: uh4ccc'),
  ('fb-group-upperhwy4',       'Facebook group: Upper Hwy 4'),
  ('fb-group-388511408445423', 'Facebook group: Hwy 4 (388511408445423)')
ON CONFLICT (slug) DO NOTHING;

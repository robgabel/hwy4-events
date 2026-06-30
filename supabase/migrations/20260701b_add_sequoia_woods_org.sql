-- Add Sequoia Woods Country Club as a member-only org.
--
-- Required so hwy4_events rows written by the Sequoia Woods Firecrawl source
-- (org_slug = 'sequoia-woods', visibility = 'private') satisfy
-- fk_hwy4_events_org (org_slug -> hwy4_orgs.slug).
--
-- The club's calendar is public to view, but its events are members-only, so the
-- scraper writes visibility='private'. The frontend already lists 'sequoia-woods'
-- in MEMBER_ORG_SLUGS (components/EventList.tsx), so the Clubs filter + the
-- "Members & Guests" badge light up once rows exist. canonical_url left NULL.
INSERT INTO hwy4_orgs (slug, display_name)
VALUES ('sequoia-woods', 'Sequoia Woods Country Club')
ON CONFLICT (slug) DO NOTHING;

-- Add Hinterhaus Distilling (Arnold) as an event-source organization.
--
-- Required so the hwy4_events rows written by
-- scripts/seed-hinterhaus-tours-2026.ts (org_slug = 'hinterhaus-distilling')
-- satisfy fk_hwy4_events_org (org_slug -> hwy4_orgs.slug).
--
-- canonical_url is the distillery's VISIT page (tasting-room hours + tour
-- booking), so lib/event-link.ts resolves the detail-page CTA to the organizer
-- instead of a source link. match_patterns lets that resolution also cover any
-- future Hinterhaus event an aggregator lists under its own org_slug.
--
-- canonical_check_enabled stays FALSE: per the CLAUDE.md rule, a canonical page
-- is enrolled in /api/verify-events only after auditing that a plain
-- server-side fetch yields per-event dates. That audit has not been run.
INSERT INTO hwy4_orgs (slug, display_name, town, canonical_url, match_patterns)
VALUES (
  'hinterhaus-distilling',
  'Hinterhaus Distilling',
  'Arnold',
  'https://www.hinterhausdistilling.com/visit',
  ARRAY['hinterhaus']
)
ON CONFLICT (slug) DO NOTHING;

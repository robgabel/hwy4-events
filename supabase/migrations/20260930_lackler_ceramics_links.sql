-- Lackler Ceramics (Arnold) ticket links (HWY-51).
--
-- GoCalaveras lists the studio's classes with no EventON external link
-- (_evcal_exlink is absent; _evcal_exlink_option = 1, "event page"). The
-- only organizer URL on those pages is the Google Business Profile homepage
-- (lacklerceramics.com/?utm_source=google&utm_medium=wix_google_business_profile&...),
-- which is not a booking page. Every upcoming row therefore resolved to the
-- non-durable GoCalaveras permalink — the actionable link gap
-- ("Lackler Ceramics (15 events)" on the 2026-09-29 audit; 16 when HWY-51
-- was filed on 2026-09-23).
--
-- The studio's own booking list is https://www.lacklerceramics.com/workshops
-- (Wix Bookings: Kids Clay, Making Smalls, Steins/Cups/Mugs, each with a
-- service-page Book Now). match_patterns covers aggregator rows that keep
-- org_slug = 'gocalaveras', so resolveEventLink sends all of them to that
-- page without rewriting event_url (the next scrape would put the
-- GoCalaveras permalink back).
--
-- canonical_check_enabled stays FALSE. The workshops page is a JS bookings
-- widget; the server-rendered Kids Clay blurb still says "September 10 and
-- 11" while the live series runs Thursdays through December. Enrolling it
-- in /api/verify-events would false-flag the series.
--
-- The venue row is the registry twin (scripts/lib/venues.ts). venue_key has
-- no FK, and writtenVenueKey is upgrade-only, so stamping null keys here
-- sticks even if a scrape runs before this code deploys. Address on the
-- event rows ("728 Hwy-4") is left as scraped; the registry address is the
-- display address for the venue row.

INSERT INTO hwy4_orgs (slug, display_name, town, canonical_url, match_patterns, canonical_check_enabled)
VALUES (
  'lackler-ceramics',
  'Lackler Ceramics',
  'Arnold',
  'https://www.lacklerceramics.com/workshops',
  ARRAY['lackler ceramics'],
  false
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO hwy4_venues (venue_key, canonical, town, address)
VALUES (
  'lackler-ceramics',
  'Lackler Ceramics',
  'Arnold',
  '728 Hwy 4, Arnold, CA 95223'
)
ON CONFLICT (venue_key) DO NOTHING;

UPDATE hwy4_events
SET venue_key = 'lackler-ceramics'
WHERE venue_key IS NULL
  AND venue_name ILIKE '%lackler ceramics%';

-- The cockpit already proposed these two rows (2026-09-14) and never
-- disposed them. Approving either after this migration would fail the
-- "slug/key already exists" guard, so close them as done-by-this-change.
UPDATE agent_actions
SET status = 'rejected',
    decided_at = now(),
    decided_note = 'Superseded by migration 20260930_lackler_ceramics_links (HWY-51): org canonical is the workshops booking page, venue row is registered.'
WHERE status = 'proposed'
  AND (
    (type = 'create_org_row' AND payload->>'slug' = 'lackler-ceramics')
    OR (type = 'create_venue_row' AND payload->>'venue_key' = 'lackler-ceramics')
  );

-- Canonical source verification for scraped events.
--
-- Some events arrive via aggregator scrapers (e.g., GoCalaveras) that occasionally
-- get dates wrong. For orgs we trust as canonical (e.g., Arnold Rim Trail's own
-- site), we cross-check the aggregator data against the organizer's official
-- events page and flag mismatches as needs_verification for admin review.

-- Org-side: which orgs to verify against, and the canonical URL to check.
alter table hwy4_orgs
  add column if not exists canonical_url text,
  add column if not exists canonical_check_enabled boolean not null default false,
  add column if not exists match_patterns text[];

comment on column hwy4_orgs.canonical_url is
  'Official events/calendar URL. /api/verify-events fetches this and cross-checks scraped events.';
comment on column hwy4_orgs.canonical_check_enabled is
  'When true, scraped events tied to this org get cross-checked against canonical_url.';
comment on column hwy4_orgs.match_patterns is
  'Case-insensitive substrings used to match an event to this org. Searched against event name + description + venue_name. Backup signal when org_slug points at an aggregator (e.g., gocalaveras) instead of the actual organizer.';

-- Event-side: verification status + audit trail.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'event_verification_status') then
    create type event_verification_status as enum (
      'unchecked',
      'verified',
      'needs_verification',
      'dismissed'
    );
  end if;
end $$;

alter table hwy4_events
  add column if not exists verification_status event_verification_status not null default 'unchecked',
  add column if not exists verification_checked_at timestamptz,
  add column if not exists verification_reason text,
  add column if not exists verification_snapshot text;

comment on column hwy4_events.verification_status is
  'unchecked = not yet processed. verified = found on canonical site. needs_verification = mismatch or absent; surfaces in /admin/verification. dismissed = admin chose to ignore the flag (do not re-check).';
comment on column hwy4_events.verification_snapshot is
  'Excerpt of canonical page text at check time. Lets admin see what the verifier saw without re-fetching.';

-- Queue index: small partial index, only matters for the admin page.
create index if not exists idx_hwy4_events_needs_verification
  on hwy4_events (verification_checked_at desc)
  where verification_status = 'needs_verification';

-- Seed: Arnold Rim Trail (the org whose dates we want canonical-checked).
-- match_patterns catches events tagged with aggregator org_slugs (e.g.,
-- gocalaveras) but whose name/description names Arnold Rim Trail as organizer.
insert into hwy4_orgs (slug, display_name, canonical_url, canonical_check_enabled, match_patterns)
values (
  'arnold-rim-trail',
  'Arnold Rim Trail',
  'https://arnoldrimtrail.org/events/',
  true,
  array['arnold rim trail']
)
on conflict (slug) do update
  set canonical_url = excluded.canonical_url,
      canonical_check_enabled = excluded.canonical_check_enabled,
      match_patterns = excluded.match_patterns;

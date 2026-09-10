-- Cloudflare RUM spike guard (2026-09-10).
--
-- rumPageloadEventsAdaptiveGroups can return a capped day (~10,000 pageviews
-- AND ~10,000 visits) that is not real traffic. On 2026-09-01 that number was
-- stored as a real day and the Friday growth memo narrated a Labor Day spike.
-- Blank beats a fake day: keep the row so the gap is visible, null the totals,
-- stamp rejected + reject_reason. Do NOT invent a replacement count (unsampled
-- RUM for old days is already gone).
--
-- Hwy4-local: only touches public.analytics_daily (the hwy4events RUM snapshot
-- table). The shared rob-ai / PAOS project also hosts unrelated schemas; this
-- migration does not name them. RLS stays as-is (enabled, no public-read
-- policy; service-role writers bypass). Idempotent.

alter table public.analytics_daily
  add column if not exists rejected boolean not null default false;

alter table public.analytics_daily
  add column if not exists reject_reason text;

comment on column public.analytics_daily.rejected is
  'True when the Cloudflare RUM snapshot for this UTC day was refused as unusable (adaptive-groups cap or totals/referrer mismatch). Totals are null; the row stays so the gap is visible. See lib/cloudflare-analytics.ts judgeRumSnapshot.';

comment on column public.analytics_daily.reject_reason is
  'Why the day was rejected: adaptive_groups_ceiling | referrer_mismatch. Null on a usable day.';

-- Rejected days have no honest total. 0 is a real quiet day; null is "we
-- refused to store the number CF returned."
alter table public.analytics_daily
  alter column pageviews drop not null;

alter table public.analytics_daily
  alter column visits drop not null;

-- One-time cleanup: any already-stored ceiling day (the Sep 1 shape). Leave
-- the row. Do not backfill a guessed count.
update public.analytics_daily
set
  pageviews = null,
  visits = null,
  rejected = true,
  reject_reason = 'adaptive_groups_ceiling'
where rejected = false
  and (pageviews >= 10000 or visits >= 10000);

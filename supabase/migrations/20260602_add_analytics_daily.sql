-- Daily snapshot of Cloudflare Web Analytics (RUM) for hwy4events.com.
-- Written by /api/snapshot-analytics (daily Vercel cron) via lib/cloudflare-analytics.ts.
-- Cloudflare keeps unsampled RUM only ~7 days and its GraphQL adaptive API serves
-- only ~3 weeks back (the dashboard's 6-month view is sampled aggregate); this table
-- is the unbounded, full-fidelity local history that powers the admin Growth view +
-- AEO referral tracking. Internal/ops data: NOT public. See PRD-cloudflare-analytics.md.

create table if not exists analytics_daily (
  date          date primary key,
  pageviews     integer     not null default 0,
  visits        integer     not null default 0,
  top_pages     jsonb       not null default '[]'::jsonb,  -- [{ key, pageviews, visits }]
  referrers     jsonb       not null default '[]'::jsonb,  -- [{ key, pageviews, visits }]
  countries     jsonb       not null default '[]'::jsonb,  -- [{ key, pageviews, visits }]
  devices       jsonb       not null default '[]'::jsonb,  -- [{ key, pageviews, visits }]
  browsers      jsonb       not null default '[]'::jsonb,  -- [{ key, pageviews, visits }]
  ai_referrals  jsonb       not null default '{}'::jsonb,  -- { chatgpt, perplexity, gemini, copilot, claude }
  synced_at     timestamptz not null default now()
);

comment on table analytics_daily is
  'Daily Cloudflare Web Analytics (RUM) snapshot for hwy4events.com. Internal/ops only (no public read). Source: /api/snapshot-analytics. See PRD-cloudflare-analytics.md.';

-- Internal data: enable RLS and deny all access under it. The admin page and the
-- snapshot cron both use the service role, which bypasses RLS. This is a deliberate
-- departure from the public-read site tables (analytics is not public), and it
-- satisfies the project rule that every table ships with RLS enabled AND a policy.
alter table analytics_daily enable row level security;

create policy "No public access to analytics_daily"
  on analytics_daily for select
  using (false);

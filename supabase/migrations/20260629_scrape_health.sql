-- Scrape-source health (observability for the event pipeline).
--
-- The daily GitHub scrape + the two Vercel cron writers (BLS, Moose) write
-- nothing durable about a *run* today: only per-event hwy4_events.last_scraped_at
-- and an in-memory status that dies with the process. And the GitHub job can be
-- cancelled by a timeout before its end-of-run health check executes. That blind
-- spot let Facebook (fb-discover-arnold) and Visit Murphys go dark for 30-40 days
-- with no alert. This migration adds the two signals the health model needs:
--
--   1. scrape_runs  — one row per source per run attempt, written incrementally
--      by the orchestrator (so a later timeout still leaves a breadcrumb trail).
--      The "did it run / did it hard-error" telemetry layer.
--   2. scrape_source_liveness() — a cap-immune aggregate of
--      max(last_scraped_at) + event counts per org_slug. The "did it actually
--      produce?" layer, derived from DB state so it survives a cancelled job and
--      is blind to which writer touched the row. This signal alone would have
--      caught all three dark sources.
--
-- The two are combined in lib/scrape-health.ts; surfaced in /api/check-events
-- (Slack alarm), /admin/sources (panel), and the agent reasoners' context.
--
-- HARD RULES (honored): RLS enabled + a service-role-only policy in this same
-- migration. Internal/ops data, no public read. RLS is never disabled.

create table if not exists scrape_runs (
  id          uuid primary key default gen_random_uuid(),
  -- Groups the per-source rows of a single scrape.ts invocation. NULL for the
  -- single-source Vercel cron writers (scrape-bls, scrape-moose-lodge).
  run_id      uuid,
  source      text not null,                 -- org_slug (e.g. 'gocalaveras', 'visit-murphys')
  trigger     text not null default 'github' check (trigger in ('github', 'vercel-cron', 'manual')),
  started_at  timestamptz,
  finished_at timestamptz not null default now(),
  status      text not null check (status in ('ok', 'failed', 'empty', 'skipped')),
  inserted    integer,                       -- best-effort upsert counts; NULL when unknown
  updated     integer,
  unchanged   integer,
  error       text,                          -- the failure message when status = 'failed'
  created_at  timestamptz not null default now()
);

alter table scrape_runs enable row level security;

create policy "scrape_runs service role full access"
  on scrape_runs for all
  to service_role
  using (true)
  with check (true);

create index if not exists scrape_runs_source_time_idx on scrape_runs (source, finished_at desc);
create index if not exists scrape_runs_time_idx        on scrape_runs (finished_at desc);

comment on table scrape_runs is
  'Per-source telemetry for each scrape run (status/timing/error). Written incrementally by scripts/scrape.ts + the BLS/Moose cron routes so a timeout-cancelled run still leaves breadcrumbs. Internal/ops only. See lib/scrape-health.ts.';

-- ── liveness: max(last_scraped_at) + counts per org_slug ────────────────────
-- Aggregates in the DB and returns one row per source, so it is immune to the
-- ~1,000-row PostgREST cap (hwy4_events has >1,600 rows; gocalaveras alone is
-- ~680). Same fix shape as the growth_*_stats RPCs. SECURITY INVOKER (default):
-- hwy4_events is public-read, and every caller here is the service-role client.
create or replace function scrape_source_liveness()
returns table (
  org_slug        text,
  total_events    bigint,
  future_events   bigint,
  last_success_at timestamptz
)
language sql
stable
as $$
  select
    org_slug,
    count(*)                                          as total_events,
    count(*) filter (where date >= current_date)      as future_events,
    max(last_scraped_at)                              as last_success_at
  from hwy4_events
  where org_slug is not null
  group by org_slug;
$$;

revoke all on function scrape_source_liveness() from public;
grant execute on function scrape_source_liveness() to service_role;

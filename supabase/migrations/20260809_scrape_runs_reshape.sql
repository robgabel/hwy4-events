-- Fix: scrape_runs health logging has been silently dead since 2026-07-09.
--
-- 20260709_scrape_runs.sql used CREATE TABLE IF NOT EXISTS against a prod DB
-- that already had a per-source prototype table of the same name (rows through
-- 2026-06-30: run_id/source/inserted/... columns), so it silently NO-OPPED.
-- Every summary insert from scripts/lib/scrape-run-log.ts since then has
-- failed on missing columns inside its best-effort catch, and /admin/scrapers
-- plus the Monday scraper-health memo have been reading an empty 14-day
-- window. (Found 2026-08-09 while tracing why the Murphys Irish Pub phantom
-- inserts never surfaced on any ops surface.)
--
-- Preserve the prototype rows aside, then create the intended shape (verbatim
-- from 20260709_scrape_runs.sql, minus IF NOT EXISTS — after the rename the
-- name is free, and a plain CREATE fails loudly if it ever is not).

alter table if exists scrape_runs rename to scrape_runs_prototype_2026_06;
alter index if exists scrape_runs_started_at_idx rename to scrape_runs_prototype_started_at_idx;

create table scrape_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  duration_ms integer not null,
  sources_attempted integer not null default 0,
  sources_errored integer not null default 0,
  total_inserted integer not null default 0,
  total_updated integer not null default 0,
  -- { [org_slug_or_source_name]: { inserted, updated, unchanged, skippedFuzzy, error } }
  source_results jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index scrape_runs_started_at_idx on scrape_runs (started_at desc);

alter table scrape_runs enable row level security;

create policy "service role full access" on scrape_runs
  for all
  to service_role
  using (true)
  with check (true);

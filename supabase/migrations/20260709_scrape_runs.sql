-- Durable per-run scraper health for the /admin operational-health tab.
-- One row per `scripts/scrape.ts` run, written by scripts/lib/scrape-run-log.ts
-- right after the scraper loop (before the slower URL-validation pass), so a
-- GitHub Actions runner timeout can't erase health visibility for the run.
create table if not exists scrape_runs (
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

create index if not exists scrape_runs_started_at_idx on scrape_runs (started_at desc);

alter table scrape_runs enable row level security;

create policy "service role full access" on scrape_runs
  for all
  to service_role
  using (true)
  with check (true);

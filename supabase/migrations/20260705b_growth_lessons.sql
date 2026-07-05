-- growth_lessons — the growth agent's durable memory (Roadmap ticket HWY-5,
-- PRD-growth-agent.md). The weekly growth-memo reasoner was stateless: it read
-- live signals + running experiments, wrote a memo, and forgot everything. This
-- table is its analog of LESSONS.md: distilled "what worked / what flopped" that
-- the memo reads back every run so it can compound instead of starting fresh.
--
-- Populated two ways: auto-distilled from a concluded growth_experiments row
-- (source='experiment', source_ref = that experiment's id, deduped), or added by
-- a human at /admin/experiments (source='manual'). A wrong lesson is archived,
-- not deleted-from-history.
--
-- HARD RULES: RLS enabled + a service-role-only policy in THIS migration.
-- Internal/ops data, no public read. RLS is never disabled.

create table if not exists growth_lessons (
  id          uuid primary key default gen_random_uuid(),
  lesson      text not null,
  source      text not null default 'manual' check (source in ('experiment', 'manual')),
  source_ref  text, -- the growth_experiments.id this was distilled from (dedup key for auto-capture)
  status      text not null default 'active' check (status in ('active', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table growth_lessons enable row level security;

create policy "growth_lessons service role full access"
  on growth_lessons for all
  to service_role
  using (true)
  with check (true);

create index if not exists growth_lessons_active_idx on growth_lessons (status, created_at desc);

-- One lesson per concluded experiment: makes the auto-capture idempotent (re-runs
-- can't duplicate). A FULL (non-partial) unique index so it's a valid ON CONFLICT
-- target for the upsert. Manual lessons carry a NULL source_ref, and Postgres
-- treats NULLs as distinct, so they're effectively unconstrained; only the
-- experiment ids (non-null) dedup.
create unique index if not exists growth_lessons_source_ref_uq
  on growth_lessons (source_ref);

comment on table growth_lessons is
  'Growth agent durable memory (HWY-5): distilled what-worked/what-flopped the weekly growth memo reads back each run. source=experiment (auto from a concluded growth_experiments row, deduped by source_ref) or manual (/admin). Internal/ops only; service-role write. RLS never disabled.';

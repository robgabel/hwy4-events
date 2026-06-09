-- Agent Cockpit Stage 1: the proposed-action queue + per-type autonomy policy.
--
-- BACKFILL. These two tables were applied to prod directly via the Supabase MCP
-- when Stage 1 shipped (commit ea7f3a0) but the migration file was never committed,
-- so the schema was not reproducible from supabase/migrations/. This file captures
-- the live schema exactly. It is fully idempotent (IF NOT EXISTS / DROP-then-CREATE
-- policy / ON CONFLICT DO NOTHING), so applying it to prod is a no-op and applying
-- it to a fresh database recreates Stage 1 as it runs today.
--
-- Safety model (see lib/agent/policy.ts, PRD-agent-cockpit.md): a human approves
-- every proposed action; an action only auto-runs when it is low blast-radius AND
-- reversible AND NOT outward-facing AND its agent_policy row has auto_execute=true.
-- Outward-facing actions can never auto-run, regardless of policy.

-- ── agent_actions: one row per agent-proposed action ───────────────────────────
create table if not exists public.agent_actions (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  run_id          uuid,                                  -- originating agent_runs row (soft ref)
  type            text not null,                         -- e.g. create_org_row, flag_spam_submission
  title           text,
  rationale       text,
  payload         jsonb not null default '{}'::jsonb,
  blast_radius    text not null default 'low',           -- low | med | high
  reversible      boolean not null default true,
  outward_facing  boolean not null default false,
  status          text not null default 'proposed',      -- proposed|approved|rejected|executed|reverted|failed
  before_snapshot jsonb,                                  -- reversible record, written before execution
  target_table    text,
  target_id       text,
  decided_note    text,
  error           text,
  decided_at      timestamptz,
  executed_at     timestamptz,
  reverted_at     timestamptz
);

-- ── agent_policy: per-action-type autonomy gate ────────────────────────────────
create table if not exists public.agent_policy (
  action_type     text primary key,
  auto_execute    boolean not null default false,        -- the graduation flag (Stage 2)
  min_clean_weeks integer not null default 4,             -- approval-rate canary threshold
  notes           text,
  updated_at      timestamptz not null default now()
);

-- ── RLS: service-role only (the whole /admin tree is Basic-Auth gated in middleware) ──
alter table public.agent_actions enable row level security;
alter table public.agent_policy  enable row level security;

drop policy if exists "service role full access" on public.agent_actions;
create policy "service role full access" on public.agent_actions
  for all to service_role using (true) with check (true);

drop policy if exists "service role full access" on public.agent_policy;
create policy "service role full access" on public.agent_policy
  for all to service_role using (true) with check (true);

-- ── Seed the two staged action types, both human-gated (auto_execute=false) ─────
insert into public.agent_policy (action_type, auto_execute, min_clean_weeks, notes) values
  ('create_org_row',        false, 4, 'Insert a durable organizer hwy4_orgs row to drain a link gap. Internal, reversible.'),
  ('flag_spam_submission',  false, 4, 'Mark an obvious-junk event_submissions row rejected. Internal, reversible.')
on conflict (action_type) do nothing;

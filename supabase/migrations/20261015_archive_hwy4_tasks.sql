-- Retire the Roadmap board table (#325). GitHub Issues is the only backlog; since
-- #414 no code reads or writes hwy4_tasks. The rows stay as a private, read-only
-- archive instead of being dropped or exported: the repo is public and the rows
-- hold internal agent reasoning (ai_rationale, decided_note). Same pattern as
-- scrape_runs_prototype_2026_06. Approved by Rob 2026-10-15; applied the same day.
--
-- Deliberately DROP-free (the sequence, policy and FK are renamed or left in
-- place): the Supabase MCP holds DROP statements for a confirmation that a cloud
-- session cannot give. Read-only comes from the revokes, not from the policy.

begin;
set local lock_timeout = '5s';

alter table public.hwy4_tasks rename to hwy4_tasks_archive_2026_10;
alter sequence public.hwy4_task_ref_seq rename to hwy4_tasks_archive_2026_10_ref_seq;
alter index public.hwy4_tasks_status_idx rename to hwy4_tasks_archive_2026_10_status_idx;
alter index public.hwy4_tasks_proposed_idx rename to hwy4_tasks_archive_2026_10_proposed_idx;
alter policy "hwy4_tasks service role full access" on public.hwy4_tasks_archive_2026_10
  rename to "hwy4_tasks archive service role";

-- Read-only. RLS stays enabled (never disabled). Name every role: revoking from
-- PUBLIC alone does not reach anon/authenticated (CLAUDE.md security posture).
revoke insert, update, delete, truncate on public.hwy4_tasks_archive_2026_10
  from public, anon, authenticated, service_role;
revoke usage, update on sequence public.hwy4_tasks_archive_2026_10_ref_seq
  from public, anon, authenticated, service_role;

comment on table public.hwy4_tasks_archive_2026_10 is
  'Read-only archive of the retired Roadmap board (hwy4_tasks, 2026-07-03 to 2026-10-15). GitHub Issues replaced it (#325). Writes revoked. Internal/ops only; never export to the public repo.';

commit;

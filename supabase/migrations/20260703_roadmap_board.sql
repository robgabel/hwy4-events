-- hwy4_tasks — the Roadmap board (PRD-roadmap-board.md). A lightweight kanban that
-- lives inside /admin: Rob, the cockpit agents, a QA agent, and Claude Code/Cowork
-- sessions file dev tickets here; Claude Code implements an approved one and opens a
-- DRAFT PR (never merges); the board tracks it through to done.
--
-- Linked to GitHub PRs (NOT GitHub Issues): each ticket carries a stable `ref`
-- (HWY-N). Claude Code writes "Builds HWY-N" in the PR body and stores pr_number on
-- the row; a later merge webhook parses that back to flip the row to done. So we get
-- the git-linking without adopting a second tracker.
--
-- Fourth instance of the cockpit's propose -> human-approve -> execute -> revert
-- shape: agent-filed rows land status='proposed' and wait for a human to promote.
--
-- HARD RULES (see CLAUDE.md): RLS enabled + a service-role-only policy in THIS same
-- migration. Internal/ops data — no anon/public read. RLS is never disabled.

create sequence if not exists hwy4_task_ref_seq;

create table if not exists hwy4_tasks (
  id                    uuid primary key default gen_random_uuid(),
  -- Human handle (HWY-42). Default off a sequence so PR bodies + Slack can name it.
  ref                   text unique not null default ('HWY-' || nextval('hwy4_task_ref_seq')),
  title                 text not null,
  body                  text,                       -- markdown spec Claude Code reads
  type                  text not null default 'feature'
                          check (type in ('feature','bug','qa','growth','chore')),
  status                text not null default 'backlog'
                          check (status in ('proposed','backlog','ready','in_progress','in_review','done','wont_do')),
  priority              text not null default 'p2'
                          check (priority in ('p0','p1','p2','p3')),
  rank                  double precision,           -- reserved for in-column ordering (unused in P1)
  source                text not null default 'manual'
                          check (source in ('chief_of_staff','growth_memo','qa_agent','manual','cowork','claude_code')),
  created_by            text,
  ai_rationale          jsonb,                      -- why an agent filed it (mirrors event_submissions.ai_analysis)
  -- Git link, set by Claude Code when it opens the draft PR.
  pr_url                text,
  pr_number             integer,
  branch                text,
  before_snapshot       jsonb,                      -- reversibility hook (reserved)
  -- Optional joins to domain rows a ticket is *about* (no FK on the last two to keep
  -- the board decoupled from tables whose rows may be deleted underneath it).
  linked_event_id       uuid references hwy4_events(id) on delete set null,
  linked_submission_id  uuid,
  linked_run_id         uuid,
  decided_note          text,                       -- human note on promote/dismiss
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  done_at               timestamptz
);

alter table hwy4_tasks enable row level security;

create policy "hwy4_tasks service role full access"
  on hwy4_tasks for all
  to service_role
  using (true)
  with check (true);

create index if not exists hwy4_tasks_status_idx on hwy4_tasks (status, priority, created_at desc);
create index if not exists hwy4_tasks_proposed_idx on hwy4_tasks (status) where status = 'proposed';

comment on table hwy4_tasks is
  'Roadmap board (PRD-roadmap-board.md): dev-work kanban inside /admin. Rob + cockpit agents + a QA agent + Claude Code/Cowork file tickets; Claude Code implements approved ones and links a DRAFT PR via ref/pr_number. Internal/ops only; service-role write. RLS never disabled.';

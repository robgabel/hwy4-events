-- Event feedback: corrections (and, in Phase 2, replacement poster candidates)
-- submitted from an event page by organizers or visitors. Reviewed at
-- /admin/feedback. Mirrors event_submissions. Phase 1 is notes-only; poster_path
-- is reserved for Phase 2 (Supabase Storage).
--
-- Writes happen via /api/events/feedback using the service-role key; the admin
-- reads via the service role. No anon access. RLS + policy live in THIS migration
-- per the project's hard rule (never ship a table without them).

create table if not exists event_feedback (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid references hwy4_events(id) on delete set null,
  event_slug      text not null,                 -- resilient identifier + admin link
  event_name      text,                          -- denormalized for admin/Slack display
  note            text,                          -- the correction / free-text feedback
  poster_path     text,                          -- Phase 2: Storage path to candidate
  submitter_role  text check (submitter_role in ('organizer','visitor')),
  submitter_name  text,
  submitter_email text,
  status          text not null default 'pending'
                    check (status in ('pending','approved','dismissed')),
  applied         text check (applied in ('poster','note')),  -- what approval did
  reviewed_at     timestamptz,
  review_note     text,
  user_agent      text,                          -- light spam triage
  created_at      timestamptz not null default now(),
  constraint event_feedback_has_content check (note is not null or poster_path is not null)
);

alter table event_feedback enable row level security;

create policy "service_role_full_access" on event_feedback
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index event_feedback_status_idx on event_feedback (status, created_at desc);
create index event_feedback_event_idx  on event_feedback (event_id);

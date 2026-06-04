-- poster_submissions — organizer/community poster swaps (PRD-event-poster-loop.md §10).
-- An organizer lands on their event page, uploads their own poster, and it queues
-- here as `pending`. A human approves it at /admin/posters, which sets
-- hwy4_events.image_url on every upcoming row of that event (poster_locked=true)
-- so the poster system shows their art untouched (posterKind → "supplied", §9).
--
-- Follows the HARD RULES: RLS enabled + a service-role policy in the SAME
-- migration; writes happen only through the service role (the /api/submit-poster
-- route and the /admin/posters server actions). RLS is never disabled. The
-- uploaded image lives in the public `event-posters` Storage bucket (created
-- below); image_url is its public URL.

create table if not exists poster_submissions (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid references hwy4_events(id) on delete set null,
  event_slug      text,
  image_url       text not null,
  submitter_name  text,
  submitter_email text,
  note            text,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected')),
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz,
  review_note     text
);

alter table poster_submissions enable row level security;

-- Service role only (the /api/submit-poster route + /admin/posters actions). No
-- anon/public access: submissions are moderated internal state, and every write
-- is funneled through the service role.
create policy "poster_submissions service role full access"
  on poster_submissions for all
  to service_role
  using (true)
  with check (true);

create index if not exists poster_submissions_status_idx
  on poster_submissions (status, created_at desc);
create index if not exists poster_submissions_event_idx
  on poster_submissions (event_id);

comment on table poster_submissions is
  'Organizer/community poster swaps queued for /admin/posters review. Approve sets hwy4_events.image_url on all upcoming rows of the event (poster_locked=true). Service-role only. See PRD-event-poster-loop.md §10.';

-- The public bucket the uploaded posters live in. Public read (posters render on
-- public event pages); writes are service-role only (the API route), so no
-- storage.objects policies are granted to anon. file_size_limit +
-- allowed_mime_types are a storage-layer backstop to the route's own validation.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-posters',
  'event-posters',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

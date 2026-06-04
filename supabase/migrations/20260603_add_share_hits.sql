-- share_hits — per-event, per-channel attribution for the poster/share loop.
-- Written by /api/track-share (service role) when someone lands on an event
-- page via a tracked link (?src=share|qr|pdf|download|via=<org>). Read by the
-- admin area via service role. The heartbeat of the organizer-led growth loop:
-- which events get shared, through which door.
--
-- Follows the HARD RULES: RLS enabled + a policy in the same migration; writes
-- happen only through the service role (the API route). RLS is never disabled.

create table if not exists share_hits (
  id          uuid primary key default gen_random_uuid(),
  event_slug  text not null,
  event_id    uuid references hwy4_events(id) on delete set null,
  src         text not null check (src in ('share','qr','pdf','link','download','page')),
  via         text,                       -- organizer code, post-claim
  referrer    text,
  created_at  timestamptz not null default now()
);

alter table share_hits enable row level security;

-- Service role only (the /api/track-share route). No anon/public access:
-- attribution data is internal, and writes are funneled through the API.
create policy "share_hits service role full access"
  on share_hits for all
  to service_role
  using (true)
  with check (true);

create index if not exists share_hits_event_idx on share_hits (event_slug, created_at desc);
create index if not exists share_hits_src_idx   on share_hits (src, created_at desc);

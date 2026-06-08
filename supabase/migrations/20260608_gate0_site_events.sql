-- site_events — first-party engagement log for Gate 0 (BUSINESS-PLAN.md §15).
-- Answers the two things Cloudflare RUM cannot:
--   1. visitor vs local — each row is geo-classified server-side from Vercel's
--      x-vercel-ip-* headers (the client never sends a location).
--   2. business-referral clicks — outbound taps from an event page toward a
--      business (the "More info" CTA, Get Directions, a venue's website/phone).
-- Written only by /api/track (service role; best-effort, never errors to client).
-- Bots that don't run JS never fire the beacon; JS bots are UA-flagged.
--
-- HARD RULES: RLS enabled + a service-role-only policy in this same migration.
-- Internal/ops data — no anon/public read. RLS is never disabled.

create table if not exists site_events (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  kind          text not null check (kind in ('view','outbound')),
  visitor_class text not null default 'unknown' check (visitor_class in ('local','visitor','unknown')),
  region        text,
  city          text,
  country       text,
  path          text,
  session_id    text,
  event_id      uuid references hwy4_events(id) on delete set null,
  click_type    text check (click_type in ('more_info','directions','venue_website','venue_phone','venue_maps')),
  target_host   text,
  is_bot        boolean not null default false
);

alter table site_events enable row level security;

create policy "site_events service role full access"
  on site_events for all
  to service_role
  using (true)
  with check (true);

create index if not exists site_events_kind_time_idx  on site_events (kind, created_at desc);
create index if not exists site_events_class_time_idx on site_events (visitor_class, created_at desc);
create index if not exists site_events_click_idx      on site_events (click_type, created_at desc) where kind = 'outbound';
create index if not exists site_events_event_idx      on site_events (event_id, created_at desc);

comment on table site_events is
  'First-party engagement log (Gate 0): visitor-vs-local pageviews + business-referral outbound clicks. Written by /api/track (service role). Internal/ops only. See BUSINESS-PLAN.md.';

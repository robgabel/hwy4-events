-- ============================================================================
-- Hwy4Events fork bootstrap schema
-- ============================================================================
-- Run this ONCE against a FRESH Supabase project (SQL Editor, or
-- `psql < 00_schema.sql`). It creates the complete current-state schema for
-- every table the app uses: the historical files in supabase/migrations/
-- are already folded in, so do NOT run those after this. Future migrations
-- (anything dated after this file was generated) apply on top as usual.
--
-- Generated from the production schema on 2026-06-13. Schema only: no data,
-- no keys, no Rob. See FORKING.md for the full setup guide.
--
-- Conventions this schema follows (keep them in new tables):
--   * RLS is enabled on every table.
--   * Public (anon) access is read-only, and only on the user-facing tables
--     (events, orgs, venues, sources, site_config) plus INSERT on the two
--     public forms (event_submissions, newsletter_subscribers).
--   * Everything else is service-role only (the server API routes).
-- ============================================================================

create extension if not exists pg_trgm;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

create type event_verification_status as enum
  ('unchecked', 'verified', 'needs_verification', 'dismissed');

create type event_cost_tier as enum
  ('free', 'paid', 'donation', 'varies', 'unknown');

-- ----------------------------------------------------------------------------
-- Core: orgs, sources, venues, events, site_config
-- ----------------------------------------------------------------------------

create table hwy4_orgs (
  id uuid not null default gen_random_uuid() primary key,
  slug text not null unique,
  display_name text not null,
  scrape_urls jsonb not null default '[]'::jsonb,
  visibility_default text not null default 'public'
    check (visibility_default in ('public', 'private')),
  notes text,
  created_at timestamptz default now(),
  town text,
  show_on_about boolean not null default false,
  canonical_url text,
  canonical_check_enabled boolean not null default false,
  match_patterns text[]
);

create table hwy4_sources (
  id uuid not null default gen_random_uuid() primary key,
  name text not null unique,
  display_name text not null,
  url text not null,
  category text not null,
  last_checked_at timestamptz,
  last_successful_at timestamptz,
  status text default 'active',
  created_at timestamptz default now()
);

create table hwy4_venues (
  venue_key text not null primary key,
  canonical text not null,
  town text not null,
  address text,
  blurb text,
  blurb_generated_at timestamptz,
  place_id text,
  rating numeric(2,1),
  user_ratings_total integer,
  phone text,
  website text,
  maps_url text,
  hours jsonb,
  places_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  places_locked boolean not null default false,
  places_attributes jsonb
);

create table hwy4_events (
  id uuid not null default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  name text not null,
  description text,
  date date not null,
  start_time time,
  end_time time,
  venue_name text not null,
  town text not null,
  address text,
  category text not null
    check (category in ('live_music', 'festival', 'civic', 'hike_walk',
                        'kids', 'wine', 'games', 'fine_arts', 'other')),
  artists text[],
  status text default 'confirmed'
    check (status in ('confirmed', 'tentative', 'cancelled')),
  price text,
  event_url text,
  source_url text not null,
  source_name text,
  dedup_key text not null unique,
  is_past boolean default false,
  source_id uuid references hwy4_sources(id),
  visibility text not null default 'public'
    check (visibility in ('public', 'private')),
  org_slug text,
  importance text check (importance in ('major', 'minor')),
  importance_score double precision,
  importance_override boolean not null default false,
  last_scraped_at timestamptz,
  image_url text,
  robs_pick boolean default false,
  is_weekly boolean default false,
  source_event_id text,
  sources jsonb not null default '[]'::jsonb,
  verification_status event_verification_status not null default 'unchecked',
  verification_checked_at timestamptz,
  verification_reason text,
  verification_snapshot text,
  cost_tier event_cost_tier not null default 'unknown',
  price_extracted_at timestamptz,
  community_sourced boolean not null default false,
  venue_key text,
  price_locked boolean not null default false,
  description_locked boolean not null default false,
  poster_locked boolean not null default false,
  pick_reason text,
  constraint fk_hwy4_events_org foreign key (org_slug) references hwy4_orgs(slug)
);

create index idx_hwy4_events_date on hwy4_events (date);
create index idx_hwy4_events_town on hwy4_events (town);
create index idx_hwy4_events_category on hwy4_events (category);
create index idx_hwy4_events_cost_tier on hwy4_events (cost_tier);
create index idx_hwy4_events_importance on hwy4_events (importance);
create index idx_hwy4_events_is_past on hwy4_events (is_past);
create index idx_hwy4_events_visibility on hwy4_events (visibility);
create index idx_hwy4_events_org_slug on hwy4_events (org_slug);
create index hwy4_events_venue_key_idx on hwy4_events (venue_key);
create index idx_hwy4_events_is_weekly on hwy4_events (is_weekly)
  where is_weekly = true;
create index idx_hwy4_events_needs_verification
  on hwy4_events (verification_checked_at desc)
  where verification_status = 'needs_verification';
create index hwy4_events_name_trgm on hwy4_events using gin (name gin_trgm_ops);

create index idx_hwy4_sources_status on hwy4_sources (status);
create index hwy4_orgs_show_on_about_idx on hwy4_orgs (show_on_about)
  where show_on_about = true;

create table site_config (
  key text not null primary key,
  value text,
  updated_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- Briefings, submissions, newsletter
-- ----------------------------------------------------------------------------

create table briefing_history (
  id uuid not null default gen_random_uuid() primary key,
  briefing_date date not null unique,
  text text not null,
  event_count integer,
  created_at timestamptz default now()
);
create index idx_briefing_history_date on briefing_history (briefing_date desc);

create table event_submissions (
  id uuid not null default gen_random_uuid() primary key,
  event_name text not null,
  event_date date not null,
  start_time text,
  venue_name text,
  town text not null,
  description text,
  category text,
  event_url text,
  submitter_name text,
  submitter_email text,
  status text not null default 'pending',
  created_at timestamptz default now(),
  reviewed_at timestamptz,
  published_event_id uuid,
  review_note text,
  source text not null default 'form',
  poster_url text,
  raw_email jsonb,
  source_message_id text,
  proposed_event_id uuid references hwy4_events(id) on delete set null,
  proposed_action text,
  extraction_confidence text,
  artists text[],
  ai_verdict text,
  ai_confidence text,
  ai_matched_event_id uuid,
  ai_headline text,
  ai_analysis jsonb,
  ai_model text,
  ai_analyzed_at timestamptz,
  ai_error text,
  merged_into_event_id uuid,
  merge_snapshot jsonb,
  ai_reply jsonb
);
create index idx_event_submissions_status on event_submissions (status);
create index idx_event_submissions_ai_unanalyzed on event_submissions (created_at)
  where status = 'pending' and ai_analyzed_at is null;
create unique index event_submissions_source_message_id_key
  on event_submissions (source_message_id)
  where source_message_id is not null;

create table newsletter_subscribers (
  id uuid not null default gen_random_uuid() primary key,
  email text not null unique,
  confirmed boolean default false,
  unsubscribe_token uuid default gen_random_uuid(),
  created_at timestamptz default now(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  last_confirmation_sent_at timestamptz,
  signup_source text,
  visitor_class text check (visitor_class in ('local', 'visitor', 'unknown'))
);
create index idx_subscribers_active on newsletter_subscribers (confirmed)
  where confirmed = true and unsubscribed_at is null;

create table newsletter_notes (
  id bigint generated by default as identity primary key,
  body text not null,
  starts_at date not null,
  ends_at date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint newsletter_notes_window_valid check (starts_at <= ends_at)
);
create index newsletter_notes_window_idx on newsletter_notes
  using gist (daterange(starts_at, ends_at, '[]'));

create table newsletter_drafts (
  id uuid not null default gen_random_uuid() primary key,
  target_send_date date not null unique,
  subject text not null,
  content text not null,
  status text not null default 'pending'
    check (status in ('pending', 'vetoed', 'sent', 'canceled')),
  model text,
  event_count integer,
  edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  vetoed_at timestamptz,
  sent_at timestamptz,
  sent_count integer
);
create index idx_newsletter_drafts_target on newsletter_drafts (target_send_date desc);

create table newsletter_clicks (
  id uuid not null default gen_random_uuid() primary key,
  campaign_id text not null,
  event_id uuid,
  slug text,
  clicked_at timestamptz not null default now(),
  user_agent text,
  is_bot boolean not null default false
);
create index idx_newsletter_clicks_campaign on newsletter_clicks (campaign_id, event_id);
create index idx_newsletter_clicks_clicked_at on newsletter_clicks (clicked_at desc);

-- ----------------------------------------------------------------------------
-- Dedup reconcile log, analytics, engagement tracking
-- ----------------------------------------------------------------------------

create table event_merge_log (
  id uuid not null default gen_random_uuid() primary key,
  survivor_id uuid not null,
  merged_from_id uuid not null,
  merged_snapshot jsonb not null,
  signal text not null,
  merged_at timestamptz not null default now()
);
create index idx_event_merge_log_merged_at on event_merge_log (merged_at desc);

create table analytics_daily (
  date date not null primary key,
  pageviews integer not null default 0,
  visits integer not null default 0,
  top_pages jsonb not null default '[]'::jsonb,
  referrers jsonb not null default '[]'::jsonb,
  countries jsonb not null default '[]'::jsonb,
  devices jsonb not null default '[]'::jsonb,
  browsers jsonb not null default '[]'::jsonb,
  ai_referrals jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table share_hits (
  id uuid not null default gen_random_uuid() primary key,
  event_slug text not null,
  event_id uuid references hwy4_events(id) on delete set null,
  src text not null
    check (src in ('share', 'qr', 'pdf', 'link', 'download', 'page')),
  via text,
  referrer text,
  created_at timestamptz not null default now()
);
create index share_hits_event_idx on share_hits (event_slug, created_at desc);
create index share_hits_src_idx on share_hits (src, created_at desc);

create table site_events (
  id uuid not null default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('view', 'outbound')),
  visitor_class text not null default 'unknown'
    check (visitor_class in ('local', 'visitor', 'unknown')),
  region text,
  city text,
  country text,
  path text,
  session_id text,
  event_id uuid references hwy4_events(id) on delete set null,
  click_type text
    check (click_type in ('more_info', 'directions', 'venue_website',
                          'venue_phone', 'venue_maps')),
  target_host text,
  is_bot boolean not null default false,
  src text
);
create index site_events_kind_time_idx on site_events (kind, created_at desc);
create index site_events_class_time_idx on site_events (visitor_class, created_at desc);
create index site_events_event_idx on site_events (event_id, created_at desc);
create index site_events_click_idx on site_events (click_type, created_at desc)
  where kind = 'outbound';
create index site_events_src_idx on site_events (src) where src is not null;

-- ----------------------------------------------------------------------------
-- Community feedback + poster swaps
-- ----------------------------------------------------------------------------

create table poster_submissions (
  id uuid not null default gen_random_uuid() primary key,
  event_id uuid references hwy4_events(id) on delete set null,
  event_slug text,
  image_url text not null,
  submitter_name text,
  submitter_email text,
  note text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  review_note text
);
create index poster_submissions_status_idx on poster_submissions (status, created_at desc);
create index poster_submissions_event_idx on poster_submissions (event_id);

create table event_feedback (
  id uuid not null default gen_random_uuid() primary key,
  event_id uuid references hwy4_events(id) on delete set null,
  event_slug text not null,
  event_name text,
  note text,
  poster_path text,
  submitter_role text check (submitter_role in ('organizer', 'visitor')),
  submitter_name text,
  submitter_email text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'dismissed')),
  applied text check (applied in ('poster', 'note')),
  reviewed_at timestamptz,
  review_note text,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint event_feedback_has_content
    check (note is not null or poster_path is not null)
);
create index event_feedback_status_idx on event_feedback (status, created_at desc);
create index event_feedback_event_idx on event_feedback (event_id);

-- ----------------------------------------------------------------------------
-- Agent cockpit (digests, SEO snapshots, action queue, growth experiments)
-- ----------------------------------------------------------------------------

create table agent_runs (
  id uuid not null default gen_random_uuid() primary key,
  ran_at timestamptz not null default now(),
  status text not null default 'ok',
  model text,
  input_tokens integer,
  output_tokens integer,
  context_in jsonb,
  digest jsonb,
  error text,
  run_type text not null default 'chief_of_staff'
    check (run_type in ('chief_of_staff', 'growth_memo'))
);
create index idx_agent_runs_ran_at on agent_runs (ran_at desc);
create index idx_agent_runs_type_ran_at on agent_runs (run_type, ran_at desc);

create table seo_snapshots (
  id uuid not null default gen_random_uuid() primary key,
  captured_at timestamptz not null default now(),
  source text not null default 'gsc',
  query text,
  page text,
  clicks numeric,
  impressions numeric,
  ctr numeric,
  "position" numeric
);
create index idx_seo_snapshots_captured_at on seo_snapshots (captured_at desc);

create table agent_actions (
  id uuid not null default gen_random_uuid() primary key,
  created_at timestamptz not null default now(),
  run_id uuid,
  type text not null,
  title text,
  rationale text,
  payload jsonb not null default '{}'::jsonb,
  blast_radius text not null default 'low',
  reversible boolean not null default true,
  outward_facing boolean not null default false,
  status text not null default 'proposed',
  before_snapshot jsonb,
  target_table text,
  target_id text,
  decided_note text,
  error text,
  decided_at timestamptz,
  executed_at timestamptz,
  reverted_at timestamptz
);
create index idx_agent_actions_status_created on agent_actions (status, created_at desc);

create table agent_policy (
  action_type text not null primary key,
  auto_execute boolean not null default false,
  min_clean_weeks integer not null default 4,
  notes text,
  updated_at timestamptz not null default now()
);

create table growth_experiments (
  id uuid not null default gen_random_uuid() primary key,
  name text not null,
  hypothesis text,
  metric text,
  status text not null default 'running'
    check (status in ('running', 'won', 'lost', 'inconclusive', 'abandoned')),
  baseline text,
  result text,
  started_on date not null default current_date,
  concluded_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_growth_experiments_status on growth_experiments (status, started_on desc);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------

alter table hwy4_orgs enable row level security;
alter table hwy4_sources enable row level security;
alter table hwy4_venues enable row level security;
alter table hwy4_events enable row level security;
alter table site_config enable row level security;
alter table briefing_history enable row level security;
alter table event_submissions enable row level security;
alter table newsletter_subscribers enable row level security;
alter table newsletter_notes enable row level security;
alter table newsletter_drafts enable row level security;
alter table newsletter_clicks enable row level security;
alter table event_merge_log enable row level security;
alter table analytics_daily enable row level security;
alter table share_hits enable row level security;
alter table site_events enable row level security;
alter table poster_submissions enable row level security;
alter table event_feedback enable row level security;
alter table agent_runs enable row level security;
alter table seo_snapshots enable row level security;
alter table agent_actions enable row level security;
alter table agent_policy enable row level security;
alter table growth_experiments enable row level security;

-- Public (anon) read on the user-facing tables.
create policy "Public read" on hwy4_events for select using (true);
create policy "Public read" on hwy4_orgs for select using (true);
create policy "Public read" on hwy4_sources for select using (true);
create policy "Public read" on hwy4_venues for select using (true);
create policy "Public read" on site_config for select using (true);

-- Public (anon) insert on the two community forms.
create policy "Public submit" on event_submissions for insert with check (true);
create policy "Public subscribe" on newsletter_subscribers for insert with check (true);

-- Everything else is service-role only (the server API routes).
create policy "service role full access" on briefing_history
  for all to service_role using (true) with check (true);
create policy "service role full access" on newsletter_notes
  for all to service_role using (true) with check (true);
create policy "service role full access" on newsletter_drafts
  for all to service_role using (true) with check (true);
create policy "service role full access" on newsletter_clicks
  for all to service_role using (true) with check (true);
create policy "service role full access" on event_merge_log
  for all to service_role using (true) with check (true);
create policy "service role full access" on analytics_daily
  for all to service_role using (true) with check (true);
create policy "service role full access" on share_hits
  for all to service_role using (true) with check (true);
create policy "service role full access" on site_events
  for all to service_role using (true) with check (true);
create policy "service role full access" on poster_submissions
  for all to service_role using (true) with check (true);
create policy "service role full access" on event_feedback
  for all to service_role using (true) with check (true);
create policy "service role full access" on agent_runs
  for all to service_role using (true) with check (true);
create policy "service role full access" on seo_snapshots
  for all to service_role using (true) with check (true);
create policy "service role full access" on agent_actions
  for all to service_role using (true) with check (true);
create policy "service role full access" on agent_policy
  for all to service_role using (true) with check (true);
create policy "service role full access" on growth_experiments
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- Storage: public bucket for organizer poster uploads (/api/submit-poster).
-- Public read (the site serves images from it); writes are service-role only.
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-posters',
  'event-posters',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

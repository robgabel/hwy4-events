-- visitor_class gains a third LOCATED value: 'hub' (lib/geo.ts, 2026-09-04).
--
-- Rural ISPs route many corridor residents through a regional hub city
-- (verified 2026-09-04: a Comcast connection physically in Arnold geolocates to
-- Lodi). A hub-city IP is therefore a mix of hub-routed locals and genuine
-- Central Valley visitors that nothing in the IP can split, so it is counted
-- apart from both instead of being called either. Since 2026-06-08 the
-- "visitor" bucket held Sacramento 1,365 / Stockton 1,054 / Lodi 108 /
-- Modesto 109 sessions against 329 sessions labeled local in total; Valley
-- Springs (a Calaveras County town, 299 sessions) was labeled visitor too and
-- is now local via the widened regions/<slug>/core.ts localIpCities list.
--
-- Three things here, all additive:
--   1. The CHECK on site_events.visitor_class and newsletter_subscribers.
--      visitor_class admits 'hub'. The existing constraints were created inline
--      (auto-named), so they are found by definition and dropped dynamically
--      rather than by an assumed name.
--   2. The three aggregation RPCs (gate0_stats, growth_session_stats,
--      growth_outbound_stats) count 'hub' as its own bucket. Same signatures;
--      the JSON gains keys, existing keys keep their meaning ('local' and
--      'visitor' never include hub rows).
--   3. Column comments state the four classes.
--
-- APPLY BEFORE THE CODE DEPLOYS. /api/track swallows insert errors (a 'hub'
-- row rejected by the old CHECK would silently vanish) and
-- /api/newsletter/subscribe would 500 on a hub-city signup. Existing rows are
-- deliberately NOT rewritten here: scripts/reclassify-visitor-class.ts
-- (dry-run by default, --apply to write) recomputes them from the stored
-- city/region and prints before/after counts.
--
-- RLS on both tables is unchanged (service-role only). No SECURITY DEFINER.

-- ── 1. widen the CHECK constraints ──────────────────────────────────────────
do $$
declare
  c record;
begin
  for c in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where contype = 'c'
      and conrelid in ('public.site_events'::regclass, 'public.newsletter_subscribers'::regclass)
      and pg_get_constraintdef(oid) ilike '%visitor_class%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

alter table public.site_events
  add constraint site_events_visitor_class_check
  check (visitor_class in ('local', 'hub', 'visitor', 'unknown'));

alter table public.newsletter_subscribers
  add constraint newsletter_subscribers_visitor_class_check
  check (visitor_class in ('local', 'hub', 'visitor', 'unknown'));

comment on column public.site_events.visitor_class is
  'Gate 0 IP classification (lib/geo.ts): local (in the region box or a local IP city), hub (a regional ISP hub city: hub-routed locals + genuine regional visitors, unsplittable, counted apart from both), visitor (any other located request), unknown (no geo). Directional, never exact.';

comment on column public.newsletter_subscribers.visitor_class is
  'Geo-at-signup class only (lib/geo.ts classifyVisitor): local | hub | visitor | unknown. Never the IP or city: the row is tied to an email.';

-- ── 2a. gate0_stats: /admin/analytics Gate 0 panel ─────────────────────────
-- Unchanged from 20260621_gate0_stats_rpc.sql except views/views7 gain 'hub'.
create or replace function gate0_stats(p_since timestamptz, p_since7 timestamptz)
returns jsonb
language sql
stable
as $$
  with v as (
    select visitor_class, src, created_at
    from site_events
    where kind = 'view' and is_bot = false and created_at >= p_since
  ),
  o as (
    select click_type, event_id
    from site_events
    where kind = 'outbound' and is_bot = false and created_at >= p_since
  )
  select jsonb_build_object(
    'views', jsonb_build_object(
      'local',   count(*) filter (where visitor_class = 'local'),
      'hub',     count(*) filter (where visitor_class = 'hub'),
      'visitor', count(*) filter (where visitor_class = 'visitor'),
      'unknown', count(*) filter (where visitor_class = 'unknown'),
      'total',   count(*)
    ),
    'views7', jsonb_build_object(
      'local',   count(*) filter (where visitor_class = 'local'   and created_at >= p_since7),
      'hub',     count(*) filter (where visitor_class = 'hub'     and created_at >= p_since7),
      'visitor', count(*) filter (where visitor_class = 'visitor' and created_at >= p_since7),
      'unknown', count(*) filter (where visitor_class = 'unknown' and created_at >= p_since7),
      'total',   count(*) filter (where created_at >= p_since7)
    ),
    'bySrc', coalesce((
      select jsonb_agg(jsonb_build_object('src', src_key, 'count', n) order by n desc)
      from (
        select coalesce(nullif(src, ''), 'direct') as src_key, count(*) as n
        from v group by 1 order by n desc limit 8
      ) s
    ), '[]'::jsonb),
    'outboundTotal', (select count(*) from o),
    'outboundByType', coalesce((
      select jsonb_agg(jsonb_build_object('type', click_type, 'count', n) order by n desc)
      from (select click_type, count(*) as n from o where click_type is not null group by 1) t
    ), '[]'::jsonb),
    'topEvents', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', event_id, 'count', n) order by n desc)
      from (select event_id, count(*) as n from o where event_id is not null group by 1 order by n desc limit 8) e
    ), '[]'::jsonb)
  )
  from v;
$$;

revoke all on function gate0_stats(timestamptz, timestamptz) from public;
grant execute on function gate0_stats(timestamptz, timestamptz) to service_role;

-- ── 2b. growth_session_stats: the weekly memo's audience proxies ───────────
-- Unchanged from 20260621b_growth_signal_rpcs.sql except a 'hub7' block.
create or replace function growth_session_stats(p_d7 timestamptz, p_d14 timestamptz)
returns jsonb
language sql
stable
as $$
  with v as (
    select session_id, visitor_class, src, created_at
    from site_events
    where kind = 'view' and is_bot = false
      and created_at >= p_d14
      and session_id is not null and session_id <> ''
  ),
  local7 as (
    select session_id, count(*) as n from v
    where visitor_class = 'local' and created_at >= p_d7
    group by session_id
  ),
  local_prev7 as (
    select session_id, count(*) as n from v
    where visitor_class = 'local' and created_at < p_d7
    group by session_id
  ),
  hub7 as (
    select session_id, count(*) as n from v
    where visitor_class = 'hub' and created_at >= p_d7
    group by session_id
  ),
  visitor7 as (
    select session_id, count(*) as n from v
    where visitor_class = 'visitor' and created_at >= p_d7
    group by session_id
  ),
  by_src7 as (
    select coalesce(nullif(src, ''), 'direct') as src_key,
           count(distinct session_id) as n
    from v
    where created_at >= p_d7
    group by 1
  )
  select jsonb_build_object(
    'local7', jsonb_build_object(
      'distinct', (select count(*) from local7),
      'engaged',  (select count(*) from local7 where n >= 2)
    ),
    'localPrev7', jsonb_build_object(
      'distinct', (select count(*) from local_prev7),
      'engaged',  (select count(*) from local_prev7 where n >= 2)
    ),
    'hub7', jsonb_build_object(
      'distinct', (select count(*) from hub7),
      'engaged',  (select count(*) from hub7 where n >= 2)
    ),
    'visitor7', jsonb_build_object(
      'distinct', (select count(*) from visitor7),
      'engaged',  (select count(*) from visitor7 where n >= 2)
    ),
    'sessionsBySrc7d', coalesce(
      (select jsonb_object_agg(src_key, n) from by_src7),
      '{}'::jsonb
    )
  );
$$;

revoke all on function growth_session_stats(timestamptz, timestamptz) from public;
grant execute on function growth_session_stats(timestamptz, timestamptz) to service_role;

-- ── 2c. growth_outbound_stats: referral clicks by class ────────────────────
-- Unchanged from 20260621b_growth_signal_rpcs.sql except 'hubClicks30'.
create or replace function growth_outbound_stats(p_d7 timestamptz, p_d30 timestamptz)
returns jsonb
language sql
stable
as $$
  with o as (
    select click_type, visitor_class, event_id, src, created_at
    from site_events
    where kind = 'outbound' and is_bot = false
      and created_at >= p_d30
  )
  select jsonb_build_object(
    'total30', (select count(*) from o),
    'total7',  (select count(*) from o where created_at >= p_d7),
    'visitorClicks30', (select count(*) from o where visitor_class = 'visitor'),
    'hubClicks30',     (select count(*) from o where visitor_class = 'hub'),
    'byType', coalesce((
      select jsonb_object_agg(t, n) from (
        select coalesce(click_type, 'other') as t, count(*) as n
        from o group by 1
      ) s
    ), '{}'::jsonb),
    'bySrc', coalesce((
      select jsonb_object_agg(k, n) from (
        select coalesce(nullif(src, ''), 'direct') as k, count(*) as n
        from o group by 1
      ) s
    ), '{}'::jsonb),
    'topEvents', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', event_id, 'count', n) order by n desc)
      from (
        select event_id, count(*) as n
        from o where event_id is not null
        group by event_id order by n desc limit 5
      ) e
    ), '[]'::jsonb)
  );
$$;

revoke all on function growth_outbound_stats(timestamptz, timestamptz) from public;
grant execute on function growth_outbound_stats(timestamptz, timestamptz) to service_role;

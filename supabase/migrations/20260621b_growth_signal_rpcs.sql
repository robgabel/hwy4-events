-- growth_*_stats: server-side aggregation for the weekly Head-of-Growth memo
-- (lib/agent/growth-context.ts, PRD-growth-agent.md). The signal pack used to
-- SELECT raw site_events / share_hits / newsletter_clicks rows and tally them in
-- JS, but a PostgREST rowset is capped at ~1,000. So once a window held >1,000
-- rows every derived metric silently undercounted: the North Star proxy (weekly
-- local sessions) froze first, but the referral, share, and newsletter-click
-- numbers all degraded the same way. These functions aggregate in the DB and
-- return a single jsonb value each, immune to the row cap and exact at any
-- volume. Same fix shape as gate0_stats (20260621_gate0_stats_rpc.sql).
--
-- SECURITY INVOKER (default): callers run with their own privileges. All three
-- tables are RLS service-role-only, so anon/authenticated callers read nothing
-- (zeros); the growth-memo route's service-role client sees the real counts.
-- No SECURITY DEFINER.

-- ── views -> distinct/engaged sessions (14d window, split by class + week) ───
-- Mirrors sessionStats(): distinct = distinct non-empty session_id; engaged =
-- sessions with >= 2 views. prev7 is [d14, d7); sessionsBySrc7d is distinct
-- sessions per first-touch src in the last 7d (empty/null src -> 'direct').
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

-- ── outbound business clicks (30d window) ───────────────────────────────────
-- byType: null click_type -> 'other' (?? semantics). bySrc: falsy src -> 'direct'
-- (truthy check). topEvents: top 5 non-empty event_id by count.
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

-- ── share_hits by src (7d window) ───────────────────────────────────────────
-- Returns the src -> count map directly. null src -> 'other' (matches JS ??).
create or replace function growth_share_stats(p_d7 timestamptz)
returns jsonb
language sql
stable
as $$
  select coalesce((
    select jsonb_object_agg(k, n) from (
      select coalesce(src, 'other') as k, count(*) as n
      from share_hits where created_at >= p_d7 group by 1
    ) s
  ), '{}'::jsonb);
$$;

-- ── newsletter clicks for one campaign ──────────────────────────────────────
-- total = all non-bot click rows; topSlugs = top 5 non-empty slugs by count.
create or replace function growth_newsletter_click_stats(p_campaign_id text)
returns jsonb
language sql
stable
as $$
  with c as (
    select slug from newsletter_clicks
    where campaign_id = p_campaign_id and is_bot = false
  )
  select jsonb_build_object(
    'total', (select count(*) from c),
    'topSlugs', coalesce((
      select jsonb_agg(jsonb_build_object('slug', slug, 'clicks', n) order by n desc)
      from (
        select slug, count(*) as n from c
        where slug is not null and slug <> ''
        group by slug order by n desc limit 5
      ) s
    ), '[]'::jsonb)
  );
$$;

revoke all on function growth_session_stats(timestamptz, timestamptz) from public;
grant execute on function growth_session_stats(timestamptz, timestamptz) to service_role;
revoke all on function growth_outbound_stats(timestamptz, timestamptz) from public;
grant execute on function growth_outbound_stats(timestamptz, timestamptz) to service_role;
revoke all on function growth_share_stats(timestamptz) from public;
grant execute on function growth_share_stats(timestamptz) to service_role;
revoke all on function growth_newsletter_click_stats(text) from public;
grant execute on function growth_newsletter_click_stats(text) to service_role;

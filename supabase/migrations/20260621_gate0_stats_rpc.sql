-- gate0_stats: server-side aggregation for the /admin/analytics "Visitor vs local"
-- (Gate 0) panel. The page used to SELECT raw site_events rows and tally them in
-- JS, but a PostgREST rowset is capped at ~1,000, so once a window held >1,000
-- human views the totals silently froze at 1,000 (and the 7d slice, filtered from
-- the truncated set, was undercounted). Aggregating in the DB returns a single
-- jsonb value, immune to the row cap and exact at any volume.
--
-- SECURITY INVOKER (default): callers run with their own privileges. site_events
-- is RLS service-role-only, so anon/authenticated callers read nothing (zeros);
-- the admin page's service-role client sees the real counts. No SECURITY DEFINER.

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
      'visitor', count(*) filter (where visitor_class = 'visitor'),
      'unknown', count(*) filter (where visitor_class = 'unknown'),
      'total',   count(*)
    ),
    'views7', jsonb_build_object(
      'local',   count(*) filter (where visitor_class = 'local'   and created_at >= p_since7),
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

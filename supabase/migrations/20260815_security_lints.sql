-- Supabase security-advisor cleanup, hwy4-events scope.
--
-- The advisor flags 24 SECURITY warnings on project uzediwokyshjbsymevtp. That
-- project is SHARED (hwy4-events + PAOS + BrainsFor), so 9 of them belong to
-- other tenants and are deliberately NOT touched here: home_todos_touch_updated_at
-- (PAOS todos), handle_new_user (PAOS Supabase Auth), search_brain_atoms
-- (BrainsFor), the pack_downloads/pack_events policies (BrainsFor pack
-- telemetry -- zero references anywhere in this repo), and the leaked-password
-- Auth setting (hwy4 has no Supabase Auth users; /admin is Basic Auth). Fix
-- those from ~/rob-ai, not from this repo.
--
-- This migration closes the 15 that are ours, in five parts:
--   1. drop five dead functions
--   2. pin search_path + actually revoke EXECUTE on the six survivors
--   3. move pg_trgm + btree_gist out of the public schema
--   4. delete two always-true INSERT policies (an unauthenticated write channel)
--   5. delete a dead duplicate SELECT policy on hwy4_events
--
-- Nothing in app/, lib/, components/ or scripts/ changes. The dropped functions
-- have zero call sites; the surviving RPCs keep identical signatures and return
-- shapes.


-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK REFERENCE
-- ─────────────────────────────────────────────────────────────────────────────
-- The five functions dropped in Part 1 have no DDL anywhere in this repo (they
-- were applied out-of-band and never checked in), so the definitions below --
-- captured from pg_get_functiondef on 2026-08-15 -- are the ONLY surviving copy.
-- Do not delete this block.
--
-- CREATE OR REPLACE FUNCTION public.hwy4_name_root(name text)
--  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
-- AS $function$
--   SELECT trim(regexp_replace(
--     regexp_replace(
--       regexp_replace(
--         regexp_replace(
--           regexp_replace(lower(coalesce(name,'')), '\s*\([^)]*\)\s*$', ''),
--           '\s+(at|@)\s+.+$', '', 'i'),
--         '^(free|the)\s+', ''),
--       '[‐-―−]', '-', 'g'),
--     '\s+', ' ', 'g'))
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.hwy4_detect_duplicate_candidates()
--  RETURNS TABLE(event_a_id uuid, event_b_id uuid, reason text, inserted boolean)
--  LANGUAGE plpgsql
-- AS $function$
-- DECLARE
--   pair record;
--   did_insert boolean;
-- BEGIN
--   FOR pair IN
--     SELECT
--       LEAST(a.id, b.id)    AS event_a_id,
--       GREATEST(a.id, b.id) AS event_b_id,
--       similarity(a.name, b.name) AS sim
--     FROM hwy4_events a
--     JOIN hwy4_events b
--       ON a.id < b.id
--       AND a.date = b.date
--       AND hwy4_name_root(a.name) = hwy4_name_root(b.name)
--       AND a.dedup_key IS DISTINCT FROM b.dedup_key
--     WHERE a.date >= CURRENT_DATE
--       AND a.visibility = 'public' AND a.status = 'confirmed'
--       AND b.visibility = 'public' AND b.status = 'confirmed'
--   LOOP
--     INSERT INTO hwy4_duplicate_candidates (
--       event_a_id, event_b_id, similarity, reason
--     ) VALUES (
--       pair.event_a_id, pair.event_b_id, pair.sim, 'same_name_root_diff_key'
--     )
--     ON CONFLICT DO NOTHING;
--     did_insert := FOUND;
--
--     event_a_id := pair.event_a_id;
--     event_b_id := pair.event_b_id;
--     reason := 'same_name_root_diff_key';
--     inserted := did_insert;
--     RETURN NEXT;
--   END LOOP;
-- END;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.hwy4_snapshot_dedup_health()
--  RETURNS hwy4_dedup_health LANGUAGE plpgsql
-- AS $function$
-- DECLARE
--   result hwy4_dedup_health;
-- BEGIN
--   INSERT INTO hwy4_dedup_health (
--     snapshot_date, future_events, duplicate_groups,
--     null_address_count, unknown_venue_count, candidates_pending
--   )
--   SELECT
--     CURRENT_DATE,
--     (SELECT COUNT(*) FROM hwy4_events WHERE date >= CURRENT_DATE),
--     (SELECT COUNT(*) FROM (
--       SELECT 1 FROM hwy4_events
--       WHERE date >= CURRENT_DATE AND visibility = 'public' AND status = 'confirmed'
--       GROUP BY hwy4_name_root(name), date
--       HAVING COUNT(*) > 1
--     ) g),
--     (SELECT COUNT(*) FROM hwy4_events WHERE date >= CURRENT_DATE AND address IS NULL),
--     (SELECT COUNT(*) FROM hwy4_events WHERE date >= CURRENT_DATE AND
--        (venue_name IS NULL OR lower(venue_name) IN ('unknown venue','unknown','tbd'))),
--     (SELECT COUNT(*) FROM hwy4_duplicate_candidates WHERE status = 'pending')
--   ON CONFLICT (snapshot_date) DO UPDATE SET
--     future_events       = EXCLUDED.future_events,
--     duplicate_groups    = EXCLUDED.duplicate_groups,
--     null_address_count  = EXCLUDED.null_address_count,
--     unknown_venue_count = EXCLUDED.unknown_venue_count,
--     candidates_pending  = EXCLUDED.candidates_pending,
--     created_at          = now()
--   RETURNING * INTO result;
--
--   RETURN result;
-- END;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.hwy4_merge_event_pair(p_candidate_id uuid, p_winner_id uuid, p_loser_id uuid, p_resolved_by text)
--  RETURNS void LANGUAGE plpgsql
-- AS $function$
-- DECLARE
--   winner hwy4_events%ROWTYPE;
--   loser  hwy4_events%ROWTYPE;
--   GENERIC_VENUES constant text[] := ARRAY['unknown venue','unknown','tbd',''];
--   pick_venue text; pick_addr text; pick_desc text; pick_start text;
--   pick_end text; pick_price text; pick_url text; loser_sources jsonb;
-- BEGIN
--   SELECT * INTO winner FROM hwy4_events WHERE id = p_winner_id FOR UPDATE;
--   SELECT * INTO loser  FROM hwy4_events WHERE id = p_loser_id  FOR UPDATE;
--   IF winner.id IS NULL OR loser.id IS NULL THEN
--     RAISE EXCEPTION 'Winner or loser row not found (winner=%, loser=%)', p_winner_id, p_loser_id;
--   END IF;
--   pick_venue := CASE
--     WHEN coalesce(lower(loser.venue_name),'') = ANY(GENERIC_VENUES) THEN winner.venue_name
--     WHEN coalesce(lower(winner.venue_name),'') = ANY(GENERIC_VENUES) THEN loser.venue_name
--     WHEN coalesce(length(loser.venue_name),0) > coalesce(length(winner.venue_name),0) THEN loser.venue_name
--     ELSE winner.venue_name END;
--   pick_addr  := CASE WHEN coalesce(length(loser.address),0)  > coalesce(length(winner.address),0)  THEN loser.address  ELSE winner.address  END;
--   pick_desc  := CASE WHEN coalesce(length(loser.description),0) > coalesce(length(winner.description),0) THEN loser.description ELSE winner.description END;
--   pick_start := coalesce(winner.start_time, loser.start_time);
--   pick_end   := coalesce(winner.end_time,   loser.end_time);
--   pick_price := coalesce(winner.price,      loser.price);
--   pick_url   := coalesce(winner.event_url,  loser.event_url);
--   loser_sources := COALESCE(loser.sources, '[]'::jsonb);
--   UPDATE hwy4_events SET
--     venue_name = pick_venue, address = pick_addr, description = pick_desc,
--     start_time = pick_start::time, end_time = pick_end::time,
--     price = pick_price, event_url = pick_url,
--     sources = (SELECT jsonb_agg(DISTINCT s) FROM (
--       SELECT jsonb_array_elements(COALESCE(winner.sources, '[]'::jsonb)) AS s
--       UNION SELECT jsonb_array_elements(loser_sources) AS s) u),
--     last_scraped_at = now()
--   WHERE id = winner.id;
--   DELETE FROM hwy4_events WHERE id = loser.id;
--   UPDATE hwy4_duplicate_candidates
--   SET status = 'merged', resolved_by = p_resolved_by, resolved_at = now()
--   WHERE id = p_candidate_id;
-- END;
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.scrape_source_liveness()
--  RETURNS TABLE(org_slug text, total_events bigint, future_events bigint, last_success_at timestamp with time zone)
--  LANGUAGE sql STABLE
-- AS $function$
--   select org_slug,
--     count(*)                                     as total_events,
--     count(*) filter (where date >= current_date) as future_events,
--     max(last_scraped_at)                         as last_success_at
--   from hwy4_events where org_slug is not null group by org_slug;
-- $function$;
--
-- Parts 3-5 reverse with:
--   alter extension pg_trgm    set schema public;
--   alter extension btree_gist set schema public;
--   create policy "Public submit"    on public.event_submissions     for insert with check (true);
--   create policy "Public subscribe" on public.newsletter_subscribers for insert with check (true);
--   create policy "Public can read upcoming events" on public.hwy4_events for select using (is_past = false);


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1: drop five dead functions
-- ─────────────────────────────────────────────────────────────────────────────
-- All five are unreferenced: zero .rpc( call sites in app/, lib/, components/,
-- scripts/; no cron.job entry names them; hwy4_duplicate_candidates holds 0 rows
-- and hwy4_dedup_health 1 row last written 2026-05-20. lib/reconcile.ts
-- reimplemented the whole merge in TypeScript against event_merge_log, which is
-- what /api/reconcile-dupes has run nightly since 2026-07-01.
--
-- hwy4_merge_event_pair is the one that actually mattered: it runs an unqualified
-- DELETE FROM hwy4_events and is EXECUTE-able by anon today. (RLS stops it from
-- deleting anything -- it is SECURITY INVOKER and hwy4_events has no anon DELETE
-- policy -- but a delete path should not be on the public API at all.)
--
-- Drop order: callers first. hwy4_snapshot_dedup_health returns
-- hwy4_dedup_health%ROWTYPE and hwy4_detect_duplicate_candidates calls
-- hwy4_name_root, so hwy4_name_root goes last.
--
-- The two now-orphaned tables (hwy4_duplicate_candidates, hwy4_dedup_health) are
-- deliberately LEFT IN PLACE. They are empty, they are not lints, and this repo
-- soaks a removal before taking the next one. Drop them in a follow-up.

drop function if exists public.hwy4_merge_event_pair(uuid, uuid, uuid, text);
drop function if exists public.hwy4_snapshot_dedup_health();
drop function if exists public.hwy4_detect_duplicate_candidates();
drop function if exists public.scrape_source_liveness();
drop function if exists public.hwy4_name_root(text);


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2: pin search_path, and actually revoke EXECUTE
-- ─────────────────────────────────────────────────────────────────────────────
-- 20260621_gate0_stats_rpc.sql and 20260621b_growth_signal_rpcs.sql both end in
-- `revoke all ... from public` and their headers assert the functions are
-- service-role-only. They are not. The live ACL reads
-- {postgres=X, anon=X, authenticated=X, service_role=X}: Supabase's default
-- privileges grant EXECUTE *explicitly* to anon and authenticated on every new
-- function in public, and revoking from PUBLIC does not remove an explicit role
-- grant. All five have been unauthenticated-callable since they shipped.
--
-- Nothing leaked through them -- they are SECURITY INVOKER over service-role-only
-- tables, so an anon call returns zeros, exactly as those headers reasoned. The
-- bug is that the intent was never enforced. Revoking by role name fixes it.
--
-- search_path is pinned to '' (empty) rather than 'public', so every table
-- reference below is schema-qualified. Empty is strictly stronger: it cannot be
-- satisfied by any schema an attacker could create. Only pg_catalog builtins
-- (count, coalesce, nullif, jsonb_*) are left unqualified -- pg_catalog is always
-- searched implicitly and cannot be shadowed.
--
-- The signatures below must match the originals argument-for-argument. A type
-- mismatch creates an OVERLOAD instead of replacing, silently leaving the
-- unpinned original in place.

create or replace function public.gate0_stats(p_since timestamptz, p_since7 timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with v as (
    select visitor_class, src, created_at
    from public.site_events
    where kind = 'view' and is_bot = false and created_at >= p_since
  ),
  o as (
    select click_type, event_id
    from public.site_events
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

create or replace function public.growth_session_stats(p_d7 timestamptz, p_d14 timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with v as (
    select session_id, visitor_class, src, created_at
    from public.site_events
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

create or replace function public.growth_outbound_stats(p_d7 timestamptz, p_d30 timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with o as (
    select click_type, visitor_class, event_id, src, created_at
    from public.site_events
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

create or replace function public.growth_share_stats(p_d7 timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select jsonb_object_agg(k, n) from (
      select coalesce(src, 'other') as k, count(*) as n
      from public.share_hits where created_at >= p_d7 group by 1
    ) s
  ), '{}'::jsonb);
$$;

create or replace function public.growth_newsletter_click_stats(p_campaign_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with c as (
    select slug from public.newsletter_clicks
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

-- trg_hide_san_andreas on hwy4_events. San Andreas is outside the corridor, so
-- any row that names it is forced private on write. This is the FIRST time this
-- function's definition has been checked into the repo -- it was applied
-- out-of-band and exists only in the live database, which also means a fork
-- bootstrapped from supabase/bootstrap/00_schema.sql has never had it.
--
-- Body touches only NEW.* and pg_catalog builtins (lower, coalesce, ILIKE), so
-- search_path = '' needs no rewrite. Left as SECURITY INVOKER: scrapers write as
-- service_role, and a trigger function is privilege-checked at CREATE TRIGGER
-- time rather than on each fire.
create or replace function public.hide_out_of_corridor_san_andreas()
returns trigger
language plpgsql
set search_path = ''
as $$
BEGIN
  IF lower(coalesce(NEW.town, '')) = 'san andreas'
     OR NEW.venue_name ILIKE '%san andreas%'
     OR NEW.address ILIKE '%san andreas%'
     OR NEW.description ILIKE '%in san andreas%'
     OR NEW.description ILIKE '%san andreas, ca%'
  THEN
    NEW.visibility := 'private';
  END IF;
  RETURN NEW;
END;
$$;

-- The grant fix. `from public` alone is what the 20260621 migrations tried and
-- it is not enough -- anon and authenticated hold explicit grants that survive it.
revoke execute on function public.gate0_stats(timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public.gate0_stats(timestamptz, timestamptz) to service_role;

revoke execute on function public.growth_session_stats(timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public.growth_session_stats(timestamptz, timestamptz) to service_role;

revoke execute on function public.growth_outbound_stats(timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public.growth_outbound_stats(timestamptz, timestamptz) to service_role;

revoke execute on function public.growth_share_stats(timestamptz) from public, anon, authenticated;
grant  execute on function public.growth_share_stats(timestamptz) to service_role;

revoke execute on function public.growth_newsletter_click_stats(text) from public, anon, authenticated;
grant  execute on function public.growth_newsletter_click_stats(text) to service_role;

revoke execute on function public.hide_out_of_corridor_san_andreas() from public, anon, authenticated;
grant  execute on function public.hide_out_of_corridor_san_andreas() to service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 3: move extensions out of public
-- ─────────────────────────────────────────────────────────────────────────────
-- The extensions schema already exists (pg_net, pgcrypto, vector, uuid-ossp).
--
-- pg_trgm: after Part 1, its only remaining dependent is the hwy4_events_name_trgm
-- GIN index. That index STAYS -- pg_stat_user_indexes shows 41 scans, it is live.
-- Postgres tracks the gin_trgm_ops opclass by OID, so the index follows the
-- extension without a rebuild (verified in a rolled-back transaction against
-- prod: index definition unchanged, ILIKE query still returns 220 rows).
--
-- btree_gist: unused. newsletter_notes_no_overlap is
-- EXCLUDE USING gist (daterange(...) WITH &&), which is core range-gist, not
-- btree_gist -- 20260525_add_newsletter_notes.sql created the extension it turned
-- out not to need. Kept rather than dropped in case another tenant wants it.

alter extension pg_trgm    set schema extensions;
alter extension btree_gist set schema extensions;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 4: delete two always-true INSERT policies
-- ─────────────────────────────────────────────────────────────────────────────
-- Dropped outright rather than tightened, because neither is load-bearing. Every
-- writer of both tables uses the service-role key, which bypasses RLS entirely:
--   event_submissions      -- app/api/submit-event, app/api/inbound-email,
--                             app/admin/submissions/actions.ts
--   newsletter_subscribers -- app/api/newsletter/{subscribe,confirm,unsubscribe,send}
--
-- What they DO grant is a direct-to-PostgREST write path for anyone holding the
-- anon key, which ships in the client bundle. Confirmed against prod inside a
-- rolled-back transaction: `set local role anon` writes a row to each table.
--
--   event_submissions      -- skips all three protections in the submit route
--                             (the company_url honeypot, the 10-per-email-per-day
--                             cap, and field validation). An injected row still
--                             lands in the admin Inbox, and the daily
--                             /api/agent/triage-submissions backstop picks up
--                             every ai_analyzed_at IS NULL row, so each one burns
--                             a Sonnet call plus a web search.
--   newsletter_subscribers -- with check (true) permits setting confirmed = true
--                             explicitly, so pre-confirmed addresses can be
--                             injected straight onto the Thursday send list.
--                             That is unsolicited mail from our sending domain:
--                             a deliverability and CAN-SPAM exposure, not just
--                             spam noise.
--
-- Neither table has a SELECT policy, so read access is unchanged (anon could
-- never read these rows back, only write them).

drop policy if exists "Public submit"    on public.event_submissions;
drop policy if exists "Public subscribe" on public.newsletter_subscribers;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 5: delete the dead duplicate SELECT policy on hwy4_events
-- ─────────────────────────────────────────────────────────────────────────────
-- hwy4_events carried two permissive SELECT policies: "Public read" using (true)
-- and "Public can read upcoming events" using (is_past = false). Permissive
-- policies OR together, so the second can never narrow anything and has been
-- dead since the first was added.
--
-- "Public read" using (true) STAYS, deliberately. It looks over-broad -- anon can
-- read 233 rows with visibility <> 'public' -- but that is the feature, not a
-- leak: lib/events-data.ts:67 fetches private rows on purpose
-- (.or("is_routine.neq.true,visibility.eq.private")) because the members-only
-- Clubs filter is applied CLIENT-side via enabledOrgs. Those Blue Lake Springs /
-- Moose Lodge rows already ship to every browser by design. Narrowing this policy
-- to visibility = 'public' would empty the Clubs view.

drop policy if exists "Public can read upcoming events" on public.hwy4_events;

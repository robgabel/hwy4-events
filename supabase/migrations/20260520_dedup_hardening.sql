-- Phase 1+2 dedup hardening (see docs/PRD-event-deduplication.md).
--
-- Applied to production via Supabase MCP on 2026-05-20. Captured here so the
-- worktree migration history matches the live schema.

-- 1) Relax dedup_key NOT NULL temporarily — needed during the one-shot rehash
--    cleanup. Restored once the cleanup completes. See
--    scripts/maintenance/rehash-dedup-keys.ts.
--    (Effectively a no-op on subsequent applies because we re-set NOT NULL.)
ALTER TABLE hwy4_events ALTER COLUMN dedup_key DROP NOT NULL;
ALTER TABLE hwy4_events ALTER COLUMN dedup_key SET NOT NULL;

-- 2) Multi-source tracking on events. `sources` is a per-row jsonb array of
--    {source_name, source_url, source_event_id, last_seen_at} so a single
--    canonical row can attribute its provenance to N scrapers.
ALTER TABLE hwy4_events
  ADD COLUMN IF NOT EXISTS source_event_id text,
  ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: convert legacy single-source columns into a 1-element sources array.
UPDATE hwy4_events
SET sources = jsonb_build_array(jsonb_build_object(
  'source_name', source_name,
  'source_url',  source_url,
  'last_seen_at', COALESCE(last_scraped_at, created_at)
))
WHERE jsonb_array_length(sources) = 0
  AND source_name IS NOT NULL;

-- 3) Long-tail duplicate review queue.
CREATE TABLE IF NOT EXISTS hwy4_duplicate_candidates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_a_id    uuid NOT NULL REFERENCES hwy4_events(id) ON DELETE CASCADE,
  event_b_id    uuid NOT NULL REFERENCES hwy4_events(id) ON DELETE CASCADE,
  similarity    numeric NOT NULL CHECK (similarity BETWEEN 0 AND 1),
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','merged','rejected','ignored')),
  resolved_by   text,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (event_a_id <> event_b_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS hwy4_duplicate_candidates_pair_uniq
  ON hwy4_duplicate_candidates (LEAST(event_a_id, event_b_id), GREATEST(event_a_id, event_b_id));

CREATE INDEX IF NOT EXISTS hwy4_duplicate_candidates_status_idx
  ON hwy4_duplicate_candidates (status, created_at DESC);

ALTER TABLE hwy4_duplicate_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hwy4_duplicate_candidates_service_only ON hwy4_duplicate_candidates;
CREATE POLICY hwy4_duplicate_candidates_service_only
  ON hwy4_duplicate_candidates
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 4) pg_trgm for the fuzzy detector + a name index.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS hwy4_events_name_trgm
  ON hwy4_events USING gin (name gin_trgm_ops);

-- 5) Daily health snapshot table.
CREATE TABLE IF NOT EXISTS hwy4_dedup_health (
  snapshot_date            date PRIMARY KEY,
  future_events            int NOT NULL,
  duplicate_groups         int NOT NULL,
  null_address_count       int NOT NULL,
  unknown_venue_count      int NOT NULL,
  candidates_pending       int NOT NULL,
  candidates_auto_merged   int NOT NULL DEFAULT 0,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hwy4_dedup_health ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hwy4_dedup_health_service_only ON hwy4_dedup_health;
CREATE POLICY hwy4_dedup_health_service_only
  ON hwy4_dedup_health
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS hwy4_dedup_health_public_read ON hwy4_dedup_health;
CREATE POLICY hwy4_dedup_health_public_read
  ON hwy4_dedup_health
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- 6) Server-side simplified-name canonicalization. Mirrors
--    scripts/lib/dedup.ts:nameRoot in pure SQL.
CREATE OR REPLACE FUNCTION hwy4_name_root(name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(coalesce(name,'')), '\s*\([^)]*\)\s*$', ''),
          '\s+(at|@)\s+.+$', '', 'i'),
        '^(free|the)\s+', ''),
      '[‐-―−]', '-', 'g'),
    '\s+', ' ', 'g'))
$$;

-- 7) Duplicate-candidate detector. Returns one row per candidate evaluated,
--    with inserted=true for new ones. Idempotent: existing pairs are skipped
--    via the unique index above.
CREATE OR REPLACE FUNCTION hwy4_detect_duplicate_candidates()
RETURNS TABLE (
  event_a_id uuid,
  event_b_id uuid,
  reason text,
  inserted boolean
)
LANGUAGE plpgsql
AS $$
DECLARE
  pair record;
  did_insert boolean;
BEGIN
  FOR pair IN
    SELECT
      LEAST(a.id, b.id)    AS event_a_id,
      GREATEST(a.id, b.id) AS event_b_id,
      similarity(a.name, b.name) AS sim
    FROM hwy4_events a
    JOIN hwy4_events b
      ON a.id < b.id
      AND a.date = b.date
      AND hwy4_name_root(a.name) = hwy4_name_root(b.name)
      AND a.dedup_key IS DISTINCT FROM b.dedup_key
    WHERE a.date >= CURRENT_DATE
      AND a.visibility = 'public' AND a.status = 'confirmed'
      AND b.visibility = 'public' AND b.status = 'confirmed'
  LOOP
    INSERT INTO hwy4_duplicate_candidates (
      event_a_id, event_b_id, similarity, reason
    ) VALUES (
      pair.event_a_id, pair.event_b_id, pair.sim, 'same_name_root_diff_key'
    )
    ON CONFLICT DO NOTHING;
    did_insert := FOUND;

    event_a_id := pair.event_a_id;
    event_b_id := pair.event_b_id;
    reason := 'same_name_root_diff_key';
    inserted := did_insert;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- 8) Health snapshot RPC.
CREATE OR REPLACE FUNCTION hwy4_snapshot_dedup_health()
RETURNS hwy4_dedup_health
LANGUAGE plpgsql
AS $$
DECLARE
  result hwy4_dedup_health;
BEGIN
  INSERT INTO hwy4_dedup_health (
    snapshot_date,
    future_events,
    duplicate_groups,
    null_address_count,
    unknown_venue_count,
    candidates_pending
  )
  SELECT
    CURRENT_DATE,
    (SELECT COUNT(*) FROM hwy4_events WHERE date >= CURRENT_DATE),
    (SELECT COUNT(*) FROM (
      SELECT 1 FROM hwy4_events
      WHERE date >= CURRENT_DATE AND visibility = 'public' AND status = 'confirmed'
      GROUP BY hwy4_name_root(name), date
      HAVING COUNT(*) > 1
    ) g),
    (SELECT COUNT(*) FROM hwy4_events WHERE date >= CURRENT_DATE AND address IS NULL),
    (SELECT COUNT(*) FROM hwy4_events WHERE date >= CURRENT_DATE AND
       (venue_name IS NULL OR lower(venue_name) IN ('unknown venue','unknown','tbd'))),
    (SELECT COUNT(*) FROM hwy4_duplicate_candidates WHERE status = 'pending')
  ON CONFLICT (snapshot_date) DO UPDATE SET
    future_events       = EXCLUDED.future_events,
    duplicate_groups    = EXCLUDED.duplicate_groups,
    null_address_count  = EXCLUDED.null_address_count,
    unknown_venue_count = EXCLUDED.unknown_venue_count,
    candidates_pending  = EXCLUDED.candidates_pending,
    created_at          = now()
  RETURNING * INTO result;

  RETURN result;
END;
$$;

-- 9) Atomic merge for the admin queue. Smart-merges sibling-rich fields into
--    the winner, appends sibling sources, then deletes the loser.
CREATE OR REPLACE FUNCTION hwy4_merge_event_pair(
  p_candidate_id uuid,
  p_winner_id uuid,
  p_loser_id uuid,
  p_resolved_by text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  winner hwy4_events%ROWTYPE;
  loser  hwy4_events%ROWTYPE;
  GENERIC_VENUES constant text[] := ARRAY['unknown venue','unknown','tbd',''];
  pick_venue text;
  pick_addr  text;
  pick_desc  text;
  pick_start text;
  pick_end   text;
  pick_price text;
  pick_url   text;
  loser_sources jsonb;
BEGIN
  SELECT * INTO winner FROM hwy4_events WHERE id = p_winner_id FOR UPDATE;
  SELECT * INTO loser  FROM hwy4_events WHERE id = p_loser_id  FOR UPDATE;

  IF winner.id IS NULL OR loser.id IS NULL THEN
    RAISE EXCEPTION 'Winner or loser row not found (winner=%, loser=%)', p_winner_id, p_loser_id;
  END IF;

  pick_venue := CASE
    WHEN coalesce(lower(loser.venue_name),'') = ANY(GENERIC_VENUES) THEN winner.venue_name
    WHEN coalesce(lower(winner.venue_name),'') = ANY(GENERIC_VENUES) THEN loser.venue_name
    WHEN coalesce(length(loser.venue_name),0) > coalesce(length(winner.venue_name),0) THEN loser.venue_name
    ELSE winner.venue_name
  END;
  pick_addr  := CASE
    WHEN coalesce(length(loser.address),0)  > coalesce(length(winner.address),0)  THEN loser.address  ELSE winner.address  END;
  pick_desc  := CASE
    WHEN coalesce(length(loser.description),0) > coalesce(length(winner.description),0) THEN loser.description ELSE winner.description END;
  pick_start := coalesce(winner.start_time, loser.start_time);
  pick_end   := coalesce(winner.end_time,   loser.end_time);
  pick_price := coalesce(winner.price,      loser.price);
  pick_url   := coalesce(winner.event_url,  loser.event_url);

  loser_sources := COALESCE(loser.sources, '[]'::jsonb);

  UPDATE hwy4_events SET
    venue_name = pick_venue,
    address    = pick_addr,
    description= pick_desc,
    start_time = pick_start::time,
    end_time   = pick_end::time,
    price      = pick_price,
    event_url  = pick_url,
    sources    = (
      SELECT jsonb_agg(DISTINCT s) FROM (
        SELECT jsonb_array_elements(COALESCE(winner.sources, '[]'::jsonb)) AS s
        UNION
        SELECT jsonb_array_elements(loser_sources) AS s
      ) u
    ),
    last_scraped_at = now()
  WHERE id = winner.id;

  DELETE FROM hwy4_events WHERE id = loser.id;

  UPDATE hwy4_duplicate_candidates
  SET status = 'merged',
      resolved_by = p_resolved_by,
      resolved_at = now()
  WHERE id = p_candidate_id;
END;
$$;

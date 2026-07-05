-- Enrich seo_snapshots for multi-dimension Search Console analytics.
--
-- The Stage-0 collector captured a single query+page cut per run (100 rows).
-- To power the /admin/analytics Search panel and the Growth Agent's
-- month-over-month + striking-distance signals, the collector now writes three
-- cuts per run: a by-DATE time series (the trend spine), a by-QUERY top list,
-- and a by-PAGE top list. Two new columns tag and time-stamp those cuts:
--
--   dimension  -- which cut this row is: 'date' | 'query' | 'page' | 'query_page'
--   data_date  -- the GSC row's own date (only for the 'date' cut; NULL otherwise)
--
-- The by-date cut is the durable, back-fillable history. GSC revises the most
-- recent ~3 days after first publish, so daily runs re-pull a trailing window
-- and must OVERWRITE each date rather than pile up duplicates. A partial unique
-- index on (source, data_date) WHERE dimension='date' makes that an idempotent
-- upsert. The by-query / by-page cuts are point-in-time snapshots read at their
-- latest captured_at, so they are plain inserts (no uniqueness).
--
-- Existing rows (dimension NULL) are the legacy 'query_page' shape; left as-is.
-- Table stays service-role only (RLS + policy unchanged from the create migration).

ALTER TABLE seo_snapshots ADD COLUMN IF NOT EXISTS dimension text;
ALTER TABLE seo_snapshots ADD COLUMN IF NOT EXISTS data_date date;

-- Idempotent daily upsert target for the by-date time series. NOT partial:
-- PostgREST's onConflict can't name a partial index's predicate. A plain
-- UNIQUE(source, data_date) is safe here because the query/page cuts carry
-- data_date = NULL, and Postgres treats NULLs as DISTINCT by default, so those
-- rows never collide — only the by-date rows (one real date each) are constrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_seo_snapshots_date
  ON seo_snapshots (source, data_date);

-- The Growth panel + agent read "the latest by-query / by-page capture", i.e.
-- rows at the newest captured_at for a given dimension. Index the common filter.
CREATE INDEX IF NOT EXISTS idx_seo_snapshots_dimension_captured
  ON seo_snapshots (dimension, captured_at DESC);

COMMENT ON COLUMN seo_snapshots.dimension IS
  'Which GSC cut this row is: date | query | page | query_page (legacy). date rows carry data_date and are upserted; query/page rows are point-in-time snapshots read at their latest captured_at.';
COMMENT ON COLUMN seo_snapshots.data_date IS
  'The GSC row''s own calendar date. Set only for dimension=''date'' (the trend spine); NULL for aggregate query/page cuts.';

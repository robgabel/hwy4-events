-- Two-phase completion of HWY-19 (2026-08-18). Phase 1 (2026-08-11, PR #244)
-- deleted the last code references to the dormant importance / importance_score /
-- importance_override columns and the legacy per-source `sources` provenance
-- array; after a 7-day soak with zero references in Vercel or scrape logs, this
-- drops the columns themselves (Rob-ratified two-phase plan).
--
-- The T5 audit's premise was that importance* were all NULL and sources all
-- '[]'. Prod disagreed at drop time: 26 rows carried importance data (old
-- manual-curation flags) and 579 rows carried legacy sources provenance from
-- the pre-2026-06 scraper era. So everything is archived first — same pattern
-- as hwy4_events_horizon_archive. Restore any value by joining on id:
--   UPDATE hwy4_events e SET ... FROM hwy4_events_dropped_cols_archive a
--   WHERE a.id = e.id;
-- (After a restore the columns would need re-adding first; the archive is the
-- record, not a live mirror.)
--
-- Old snapshots in event_merge_log / hwy4_events_removed_archive /
-- hwy4_events_horizon_archive still carry these keys in their jsonb;
-- jsonb_populate_record ignores keys the row type no longer has, so every
-- documented restore path keeps working unchanged.

create table if not exists hwy4_events_dropped_cols_archive (
  id uuid primary key,
  importance text,
  importance_score double precision,
  importance_override boolean,
  sources jsonb,
  archived_at timestamptz not null default now()
);

comment on table hwy4_events_dropped_cols_archive is
  'Values of the importance*/sources columns dropped from hwy4_events on 2026-08-18 (HWY-19 phase 2). Service-role only.';

insert into hwy4_events_dropped_cols_archive (id, importance, importance_score, importance_override, sources)
select id, importance, importance_score, importance_override, sources
from hwy4_events
where importance is not null
   or importance_score is not null
   or importance_override is distinct from false
   or (sources is not null and sources != '[]'::jsonb)
on conflict (id) do nothing;

alter table hwy4_events_dropped_cols_archive enable row level security;
-- No policies: service-role only, matching the other archive tables.

alter table hwy4_events
  drop column if exists importance,
  drop column if exists importance_score,
  drop column if exists importance_override,
  drop column if exists sources;

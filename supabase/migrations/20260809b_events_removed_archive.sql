-- Reversible archive for hwy4_events rows removed by automated retraction —
-- the window-scoped stale sweeps (scripts/lib/stale-sweep.ts, 2026-08-09:
-- Murphys Irish Pub + Sequoia Woods) and one-off curator purges (the
-- 2026-08-09 pub phantom purge). Same restore idiom as event_merge_log and
-- hwy4_events_horizon_archive:
--
--   insert into hwy4_events
--   select (jsonb_populate_record(null::hwy4_events, snapshot)).*
--   from hwy4_events_removed_archive where event_id = '…';
--
-- `reason` says which sweep/purge wrote the row, so a bad sweep's damage is
-- enumerable (select ... where reason = '…') and restorable as a set.

create table if not exists hwy4_events_removed_archive (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  reason text not null,
  snapshot jsonb not null,
  removed_at timestamptz not null default now()
);

create index if not exists hwy4_events_removed_archive_event_id_idx
  on hwy4_events_removed_archive (event_id);
create index if not exists hwy4_events_removed_archive_removed_at_idx
  on hwy4_events_removed_archive (removed_at desc);

alter table hwy4_events_removed_archive enable row level security;

create policy "service role full access" on hwy4_events_removed_archive
  for all
  to service_role
  using (true)
  with check (true);

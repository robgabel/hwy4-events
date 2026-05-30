-- Manual description override lock.
--
-- Sibling to price_locked. The scraper (scripts/lib/dedup.ts) re-writes
-- `description` from the source feed on every changed re-scrape, so a hand-edited
-- description gets clobbered. description_locked freezes it: when true, no
-- scrape write may touch `description` for that row.
--
-- Motivating case: Ironstone "Mimosa Sundays" — GoCalaveras' description text
-- literally says "$15 each", which is stale. Locking lets us scrub the price out
-- of the prose and have it stick across re-scrapes.

alter table hwy4_events
  add column if not exists description_locked boolean not null default false;

comment on column hwy4_events.description_locked is
  'When true, description is human-set and must not be overwritten by the scraper (dedup.ts). Sibling to price_locked.';

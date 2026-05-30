-- Manual price override lock.
--
-- Both the scraper (scripts/lib/dedup.ts) and the Haiku price extractor
-- (/api/extract-prices) write `price` / `cost_tier` automatically. When a human
-- corrects a price the automated writers would clobber it on the next run — the
-- extractor re-lifts a stale amount out of the description, the scraper re-writes
-- the field from the source feed. price_locked freezes both fields: when true,
-- no automated path may touch `price` or `cost_tier` for that row.
--
-- Mirrors the existing `importance_override` pattern for the importance fields.

alter table hwy4_events
  add column if not exists price_locked boolean not null default false;

comment on column hwy4_events.price_locked is
  'When true, price + cost_tier are human-set and must not be overwritten by the scraper (dedup.ts) or /api/extract-prices. Mirrors importance_override.';

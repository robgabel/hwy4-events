-- Sold-out marker for event rows.
--
-- A sold-out event is still a real, happening event: it stays in the feed,
-- keeps its detail page, and keeps its JSON-LD (with an availability of
-- SoldOut). It is only no longer a *recommendation*, so it renders a loud
-- SOLD OUT badge and is excluded from the homepage picks/spotlight.
--
-- Human-set only. No scraper writes this column, so a re-scrape can never
-- clear it (the upsert payloads in scripts/lib/dedup.ts enumerate their
-- columns explicitly). Reverse with: UPDATE hwy4_events SET sold_out = false.
ALTER TABLE hwy4_events
  ADD COLUMN IF NOT EXISTS sold_out boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN hwy4_events.sold_out IS
  'Human-set: tickets are gone. Renders a SOLD OUT badge and drops the event from Rob''s Picks. No automated writer touches it.';

-- Flag events that came in through the community submission form (/submit),
-- as opposed to the external scrapers. Drives a "Community sourced" badge on
-- the public site so neighbor-submitted events read as locally contributed.
alter table hwy4_events
  add column if not exists community_sourced boolean not null default false;

comment on column hwy4_events.community_sourced is
  'True when the row originated from a /submit community submission rather than a scraper. UI shows a "Community sourced" badge.';

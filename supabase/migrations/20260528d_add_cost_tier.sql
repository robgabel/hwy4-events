-- Structured cost signal for events.
--
-- The fee an event charges is often present in the scraped `price` free-text
-- (e.g. "$25", "PAY-WHAT-YOU-CAN") or buried in the description, but free-text
-- can't reliably drive a badge or a "Free only" filter. cost_tier is the typed
-- handle the UI keys off; `price` stays the human-readable string.
--
-- /api/extract-prices backfills both fields from description/name via Haiku and
-- stamps price_extracted_at so events aren't reprocessed.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'event_cost_tier') then
    create type event_cost_tier as enum (
      'free',      -- explicitly no charge
      'paid',      -- a dollar amount is stated
      'donation',  -- pay-what-you-can / suggested donation / pay-it-forward
      'varies',    -- ticketed but price depends (tiers, varies, "+")
      'unknown'    -- no fee information found
    );
  end if;
end $$;

alter table hwy4_events
  add column if not exists cost_tier event_cost_tier not null default 'unknown',
  add column if not exists price_extracted_at timestamptz;

comment on column hwy4_events.cost_tier is
  'Typed cost signal. free = no charge. paid = dollar amount in `price`. donation = pay-what-you-can. varies = ticketed, price depends. unknown = no fee info found. Derived from `price` text + description by /api/extract-prices.';
comment on column hwy4_events.price_extracted_at is
  'When /api/extract-prices last processed this event. NULL = never processed (queue candidate).';

-- Backfill cost_tier from the 76 events that already have a `price` string.
-- Order matters: a stated dollar amount wins over a stray "free" mention
-- (e.g. "$5, kids free" is paid), donation/varies keywords come last.
update hwy4_events
set cost_tier = case
  when price ~* '(pay[- ]?what[- ]?you[- ]?can|pay[- ]?it[- ]?forward|donation)' then 'donation'::event_cost_tier
  when price ~  '\$\s*\d' then 'paid'::event_cost_tier
  when price ~* 'free' then 'free'::event_cost_tier
  when price ~* 'vary|varies' then 'varies'::event_cost_tier
  else 'unknown'::event_cost_tier
end
where price is not null and price <> '';

-- Filter index for the "Free only" quick filter on the homepage.
create index if not exists idx_hwy4_events_cost_tier
  on hwy4_events (cost_tier);

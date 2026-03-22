-- Newsletter subscribers table for weekly email newsletter
create table newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  confirmed boolean default false,
  unsubscribe_token uuid default gen_random_uuid(),
  created_at timestamptz default now(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz
);

-- Index for efficiently querying active subscribers
create index idx_subscribers_active on newsletter_subscribers (confirmed)
  where confirmed = true and unsubscribed_at is null;

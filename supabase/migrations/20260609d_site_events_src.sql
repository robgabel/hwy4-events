-- Gate-0 attribution: arrival channel on the first-party beacon.
--
-- site_events recorded geo/path/session/click but not WHICH channel brought the
-- session (qr, share, host, newsletter, an external referrer). Without it the two
-- live growth experiments are unmeasurable (the host-kit's metric is literally
-- "scans tagged src=host -> referrals") and the growth memo can't say which
-- channel is working. This adds the column the beacon now populates first-touch.
--
-- Nullable (older rows + direct/untagged visits stay NULL). RLS on site_events is
-- unchanged (service-role only; adding a column doesn't alter policies). The
-- partial index supports the by-channel aggregation in lib/agent/growth-context.
alter table public.site_events add column if not exists src text;
create index if not exists site_events_src_idx on public.site_events (src) where src is not null;

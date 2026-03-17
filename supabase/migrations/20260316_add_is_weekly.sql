ALTER TABLE hwy4_events ADD COLUMN IF NOT EXISTS is_weekly boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_hwy4_events_is_weekly ON hwy4_events (is_weekly) WHERE is_weekly = true;

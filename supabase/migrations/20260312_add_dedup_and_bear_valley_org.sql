-- Add dedup_key and last_scraped_at columns to hwy4_events
ALTER TABLE hwy4_events
  ADD COLUMN IF NOT EXISTS dedup_key text UNIQUE,
  ADD COLUMN IF NOT EXISTS last_scraped_at timestamptz;

-- Index for fast dedup lookups
CREATE INDEX IF NOT EXISTS idx_hwy4_events_dedup_key ON hwy4_events (dedup_key);

-- Insert Bear Valley Mountain Resort into hwy4_orgs
INSERT INTO hwy4_orgs (slug, display_name)
VALUES ('bear-valley', 'Bear Valley Mountain Resort')
ON CONFLICT (slug) DO NOTHING;

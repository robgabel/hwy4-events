-- Weekly narrative cache for "The Week on the 4"
CREATE TABLE IF NOT EXISTS hwy4_weekly_narratives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_of date NOT NULL UNIQUE,          -- Monday of the week (or generation date)
  narrative text NOT NULL,                -- The generated narrative text
  date_log jsonb NOT NULL DEFAULT '[]',   -- [{date, label, dayName}] for display headers
  generated_at timestamptz NOT NULL DEFAULT now(),
  event_count integer NOT NULL DEFAULT 0
);

-- Index for fast lookup by week
CREATE INDEX IF NOT EXISTS idx_weekly_narratives_week ON hwy4_weekly_narratives (week_of DESC);

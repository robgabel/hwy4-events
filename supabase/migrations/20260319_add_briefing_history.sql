-- Stores daily briefing narratives so the generator can avoid repeating creative elements
CREATE TABLE briefing_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  briefing_date date NOT NULL UNIQUE,
  text text NOT NULL,
  event_count integer,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_briefing_history_date ON briefing_history (briefing_date DESC);

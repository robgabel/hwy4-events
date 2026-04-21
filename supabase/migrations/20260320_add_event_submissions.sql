CREATE TABLE event_submissions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_name text NOT NULL,
  event_date date NOT NULL,
  start_time text,
  venue_name text,
  town text NOT NULL,
  description text,
  category text,
  event_url text,
  submitter_name text,
  submitter_email text,
  status text DEFAULT 'pending' NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_event_submissions_status ON event_submissions (status);

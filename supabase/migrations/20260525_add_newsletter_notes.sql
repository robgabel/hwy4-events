-- Scheduled newsletter notes with non-overlapping date windows.
-- Replaces the older site_config-based single-override system.
-- Admin-only access via service role; RLS enabled with no policies = denied
-- for anon/authenticated.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE newsletter_notes (
  id BIGSERIAL PRIMARY KEY,
  body TEXT NOT NULL,
  starts_at DATE NOT NULL,
  ends_at DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT newsletter_notes_window_valid CHECK (starts_at <= ends_at),
  CONSTRAINT newsletter_notes_no_overlap
    EXCLUDE USING gist (daterange(starts_at, ends_at, '[]') WITH &&)
);

CREATE INDEX newsletter_notes_window_idx
  ON newsletter_notes USING gist (daterange(starts_at, ends_at, '[]'));

ALTER TABLE newsletter_notes ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE newsletter_notes IS 'Scheduled "From Rob" newsletter notes. Service-role only; the admin page at /admin/newsletter-note manages CRUD.';

-- Add new venue organizations for Hwy 4 corridor scraping

INSERT INTO hwy4_orgs (slug, display_name)
VALUES
  ('camp-connell-general-store', 'Camp Connell General Store'),
  ('lube-room', 'The Lube Room Saloon'),
  ('branding-iron', 'Branding Iron Saloon'),
  ('murphys-irish-pub', 'Murphys Irish Pub'),
  ('mystic-saloon', 'Howard''s Mystic Saloon')
ON CONFLICT (slug) DO NOTHING;

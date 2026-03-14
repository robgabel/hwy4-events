-- Add new organizations for community event sources and The Watering Hole

INSERT INTO hwy4_orgs (slug, display_name)
VALUES
  ('watering-hole', 'The Watering Hole'),
  ('gocalaveras', 'GoCalaveras'),
  ('visit-murphys', 'Visit Murphys')
ON CONFLICT (slug) DO NOTHING;

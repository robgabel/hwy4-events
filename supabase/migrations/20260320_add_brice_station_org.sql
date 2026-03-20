-- Add Brice Station Vineyards to hwy4_orgs so events can be inserted
INSERT INTO hwy4_orgs (slug, display_name)
VALUES ('brice-station', 'Brice Station Vineyards')
ON CONFLICT (slug) DO NOTHING;

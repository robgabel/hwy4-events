-- Add Blue Lake Springs HOA as a member-only org
INSERT INTO hwy4_orgs (slug, display_name)
VALUES ('blue-lake-springs', 'Blue Lake Springs')
ON CONFLICT (slug) DO NOTHING;

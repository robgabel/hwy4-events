-- Rename existing BLS Beach / Blue Lake Springs Beach rows to "Lodge Lake".
-- The physical place is the same; "Lodge Lake" is the name locals (and the
-- blsha.com /recreation/ page) actually use.
UPDATE hwy4_events
SET venue_name = 'Lodge Lake'
WHERE venue_name IN ('BLS Beach', 'Blue Lake Springs Beach');

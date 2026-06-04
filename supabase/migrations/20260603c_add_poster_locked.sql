-- poster_locked: when true, image_url is human-pinned and no scraper or
-- automated writer may overwrite it. Mirrors price_locked / description_locked.
ALTER TABLE hwy4_events
  ADD COLUMN IF NOT EXISTS poster_locked boolean NOT NULL DEFAULT false;

-- Lock the two Ironstone concert poster images the curator wants to keep.
UPDATE hwy4_events SET poster_locked = true
WHERE id IN (
  '8cedab0a-2a32-42e0-87f5-8a37f3d8512a',  -- Alison Krauss and Union Station (2026-08-28)
  'f72f9bcf-e7e9-4b6f-ba3d-d6bb3b44b8d2'   -- Ironstone Summer Concert Series / Lynyrd Skynyrd (2026-10-02)
);

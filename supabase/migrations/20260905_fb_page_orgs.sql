-- Org rows for the Facebook /events-tab sources (hwy4-fb-pages, mystic-saloon).
--
-- hwy4_events.org_slug is FK-constrained to hwy4_orgs.slug, so a scraper whose
-- org row is missing cannot insert a single event — it fails per row with
-- "violates foreign key constraint fk_hwy4_events_org".
--
-- mystic-saloon has had a scraper since long before this migration and NO org
-- row, so it could never have written an event. Nobody noticed because the
-- scraper it used (lib/facebook.ts, the batch Facebook POST scraper, deleted in
-- this change) extracted nothing to insert: a broken writer sitting behind an
-- empty reader. Pointing it at the venue's /events tab surfaced both at once —
-- two real upcoming shows, one of which the FK then rejected.
--
-- canonical_url stays NULL on both, deliberately. A Facebook page is not an
-- enrollable canonical (JS-rendered, so /api/verify-events would flag every
-- event as missing — see the audit table in CLAUDE.md), and as of 2026-09-05
-- resolveEventLink treats social hosts as non-durable anyway, so a facebook.com
-- canonical would resolve to null rather than a CTA.

insert into hwy4_orgs (slug, display_name, town, notes)
values
  (
    'mystic-saloon',
    'Howard''s Mystic Saloon',
    'Avery',
    'Read from the venue''s own Facebook /events tab (scripts/scrapers/mystic-saloon.ts), with a mysticsaloon.com Firecrawl pass as fallback.'
  ),
  (
    'fb-page-copperopolis-town-square',
    'Facebook Page (Copperopolis Town Square)',
    'Copperopolis',
    'Read from the venue''s own Facebook /events tab (scripts/scrapers/hwy4-fb-pages.ts). Carries the act name where the town explore feed carries a generic series title.'
  )
on conflict (slug) do nothing;

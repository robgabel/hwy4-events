# Hwy4Events — Improvements Backlog

Non-blocking improvements queued for future work. Add new items at the top with a date.

---

## 2026-05-20 — Expand FB Events Discover to remaining corridor towns

The [hwy4-fb-discover scraper](../scripts/scrapers/hwy4-fb-discover.ts) currently only covers Arnold (FB location_id `105475469485316`, explore slug `arnold-ca`). Expand to the other Hwy 4 towns to catch long-tail community events not on Pages we scrape individually.

**To enable each town:**
1. In a logged-in browser, open `https://www.facebook.com/events/` and use the location filter for the town name.
2. Copy the resulting URL — it will look like `https://www.facebook.com/events/explore/<slug>/<numeric-id>`.
3. Add the config entry in [hwy4-fb-discover.ts](../scripts/scrapers/hwy4-fb-discover.ts) (commented placeholders are already there).
4. Insert a matching row into `hwy4_orgs`: `INSERT INTO hwy4_orgs (slug, display_name) VALUES ('fb-discover-<town>', 'Facebook Events (<Town>)');`
5. Run `npm run scrape -- --source hwy4-fb-discover` to verify before committing.

**Towns to add:**
- Murphys
- Angels Camp
- Bear Valley
- Copperopolis

**Cost:** ~$0.20–0.50 per town per run at Apify's `apify/facebook-events-scraper` pricing ($0.013/event on FREE tier, ~30–50 events per town).

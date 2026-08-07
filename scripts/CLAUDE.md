# CLAUDE.md — scripts/ (scrape pipeline + sources)

> Moved verbatim from the root CLAUDE.md's "Event Sources" section on 2026-08-07 (context trim). This file auto-loads when a session works under `scripts/`. The cross-cutting rules stay in the root CLAUDE.md: "Deduplication (defense in depth)", "Manually Curated Venues" (incl. festival umbrella rows + the `manual-sources.ts` blocklist), "Event Verification", and the cron table. Update this file inline with any scraper/source change, same as the root doc.

## Event Sources (scripts/scrape.ts — daily GitHub Action)

Most events come from the `scripts/scrape.ts` orchestrator, run daily by
`.github/workflows/scrape.yml` (a GitHub Action, **not** a Vercel cron). It
dispatches per-source scrapers and writes through the shared
`scripts/lib/dedup.ts::upsertEvents` path (dedup_key + corridor drop +
cross-source merge). Two source shapes:

- **Config-driven Firecrawl** — one entry in `scripts/scrapers/firecrawl-sources.ts`
  (single fixed venue/town). The generic runner fetches markdown + LLM-extracts.
  A source may set `extractHint` — a per-source instruction appended to the shared
  extraction prompt's Rules (added 2026-07-08 for **bvac**, Bear Valley Adventure Co.:
  skip its season-pass-sale promos, lift each event's own venue + Squarespace
  permalink; see `PRD-bvac-events.md`). The shared extractor also skips already-past
  events by prompt (BVAC's page lists past events alongside upcoming; the runner's
  date filter stays as the backstop) and runs at `max_tokens: 8192` — a ~50-event
  page overflows 2048 and truncated JSON silently extracts 0.
- **Special scrapers** — hand-written files for non-generic shapes (GoCalaveras
  EventON AJAX, visit-murphys + arnold-rim-trail WP REST, **red-cross**, …),
  registered in `SPECIAL_SCRAPERS`. **Organizer-owned sources are listed first**
  in that object so a same-night aggregator pass is never the last writer on a
  row they own (the `manual-sources.ts` blocklist is the real guard; ordering is
  belt-and-braces).

**URL-stated date/time correction ([scripts/lib/url-date.ts](scripts/lib/url-date.ts), 2026-07-26).** Organizer permalinks routinely carry the occurrence date, and sometimes the start time, in a string the venue authored themselves (`bricestation.com/products/wolf-jett-july-25-2026-7pm`, `visitmurphys.com/event/music-on-the-rooftop/2026-07-31/`). That beats an LLM's reading of a rendered page. `correctFromUrl` runs in the shared `upsertEvents` pre-pass **before `dedup_key` is computed** (so the corrected date keys the row) and covers every scraper. **The Wolf Jett bug it closes:** the `brice-station` scraper wrote a row dated 2026-07-26 for an event whose own product URL said July 25 — the correct July 25 row already existed, so the site showed a duplicate advertising a show that had already happened. Deliberately a *correction, never a source*: it only overrides a date/time already extracted, only from the event's own `event_url`, and only when the URL states one unambiguously — a month **name** + day + 4-digit year, or an ISO path segment; a bare year ("…-2026"), a season, and "4th-of-july-2026" all parse to null, as does a calendar-impossible date. A slug time needs an explicit meridiem (a bare number is too ambiguous). Every correction is logged (`URL_DATE_CORRECTION`) — it firing means an extractor is getting dates wrong and that should be visible. Locked by `scripts/test/url-date.test.ts`.

**Recurring-series ingest horizon ([scripts/lib/ingest-horizon.ts](scripts/lib/ingest-horizon.ts), 2026-07-25).** The Events Calendar materializes a recurring event as a real post per occurrence, so Visit Murphys' feed offers weekly instances **two years out** — and we ingested all of them: 104 rows of "Live Music Upstairs" at Boyle MacDonald, every one asserting a 6:00 PM start, running to 2028-07-21. Across the catalog that was 82 upcoming rows past 12 months from just 4 series (~12% of the whole upcoming set). Wrong for two reasons: **accuracy** (nobody confirmed a bar's trivia start time in July 2028, yet the site stated it as fact — the same "asserted a time we don't know" failure as the stale sunset-hike times, arriving from the other direction) and **crawl budget** (`PRD-search-indexing.md` blames exactly this population for the sitewide "Discovered – currently not indexed"; the sitemap was trimmed then, but the rows were never capped — this is the upstream fix). `capSeriesHorizon` runs in the shared `upsertEvents` pre-pass next to `dropOutOfCorridor`, so it covers **every** scraper, and is deliberately narrow: an event is dropped only when it is BOTH beyond `SERIES_HORIZON_DAYS` (365) AND one of `MIN_SERIES_SIZE` (6) or more instances sharing a name + venue in the same batch. A far-future **one-off** — next year's festival announced early — has a tiny group and always survives. Drops are logged per series (a silent cap would read as "we covered everything"). Locked by `scripts/test/ingest-horizon.test.ts`. The 82 resident rows were archived + deleted 2026-07-25; every one is restorable from **`hwy4_events_horizon_archive`** (migration `20260725_events_horizon_archive.sql`, service-role only): `INSERT INTO hwy4_events SELECT (jsonb_populate_record(null::hwy4_events, snapshot)).* FROM hwy4_events_horizon_archive WHERE event_id = '…'`.

**Runner timeout + health logging (2026-07-09).** The GitHub Action job runs at
`timeout-minutes: 20` (raised from 10 — the job was landing right at the old
cap, hitting a runner-timeout **kill** on most days, which GitHub Actions
reports as `cancelled`, not `failure`, so the workflow's own `if: failure()`
alerting never fired). Independent of the timeout headroom, every run now
writes a durable summary to **`scrape_runs`** via
[scripts/lib/scrape-run-log.ts](scripts/lib/scrape-run-log.ts) — instrumented
once at `upsertEvents` (`scripts/lib/dedup.ts`, the one choke point every
scraper writes through) and flushed **right after the scraper loop, before**
the slower URL-validation pass, so a future timeout kill during validation
can't erase scraper health visibility again. Read at **`/admin/scrapers`**
(the Pulse "Scrapers" tab) — see the Admin cockpit section above.

### Shopify ticket-store sources (`scripts/lib/shopify-events.ts`)

Some corridor venues have no calendar at all — they sell each concert as a
Shopify **ticket product**, so the product list *is* the schedule. Shopify
exposes every storefront collection as clean JSON at
`/collections/<handle>/products.json`: title, permalink handle, description,
price, images, and a stable numeric id. Pure parsing lives in
`scripts/lib/shopify-events.ts` (locked by `scripts/test/shopify-events.test.ts`),
transport is a plain fetch with the usual Firecrawl fallback.

- **brice-station** (`scripts/scrapers/brice-station.ts`) — moved off the generic
  Firecrawl + LLM runner 2026-07-26 after it produced two defects in two days: a
  row dated 2026-07-26 for the **July 25** Wolf Jett show (a duplicate
  advertising a concert that had already happened) and a mis-set start time. The
  date and time were in structured fields all along. The venue hand-types the
  titles, so the shape wobbles four ways — hyphen vs **en dash** separator, `@`
  vs `-` before the time, doubled whitespace, and a trailing note
  (`… @ 6pm ~ Earlier Time!`) — which is exactly what the model tripped on; every
  live variant is a test case. The JSON is also **more complete than the rendered
  page** (7 products vs 4 in the HTML grid), and it yields ticket prices we
  previously had no source for.
  **Deliberately NOT blocklisted** in `manual-sources.ts`: unlike Arnold Rim
  Trail, this store only lists shows it is actively selling, so GoCalaveras
  legitimately covers Brice events with no ticket product yet and blocklisting
  would lose them. Ordering is the guard instead — it is registered **last** in
  `SPECIAL_SCRAPERS` so the organizer is the final writer on the rows it covers,
  and `correctFromUrl` cross-checks every row against the date/time in its own
  product permalink.

### Tribe / The Events Calendar sources (`scripts/lib/tribe.ts`)

Several corridor sites run the same WordPress plugin ("The Events Calendar",
a.k.a. Tribe), which exposes clean structured JSON at
`/wp-json/tribe/events/v1/events` — venue, address, exact start/end datetimes,
categories, cost, image. Far more reliable than Firecrawl-markdown + LLM
extraction, and for an **organizer's own** site it is the authoritative record.
The shared client holds the transport + field mappers (`fetchAllTribeEvents`,
`splitDateTime`, `joinAddress`, `normalizeCost`, `htmlToText`,
`stripTitleDateSuffix`), locked by `scripts/test/tribe.test.ts`.

**Bot walls:** visitmurphys.com 403s a plain server-side fetch (or 200s with an
HTML challenge page instead of JSON) since late June 2026 — confirmed from
multiple source IPs, so it's not a User-Agent fix. `fetchTribePage` tries the
plain fetch first (free, works if the wall ever lifts) and falls back to the
same URL through **Firecrawl** (`formats: ["rawHtml"]`, which returns the
endpoint's raw JSON body unprocessed) — the escape hatch `red-cross.ts` and
`sequoia-woods.ts` use. So `FIRECRAWL_API_KEY` is required for **visit-murphys**.
**arnoldrimtrail.org has not been observed walling anything** — the 403 seen
while building that scraper came from the dev container's own egress allowlist,
not the site — so its plain fetch should succeed in CI, with the fallback kept
as insurance. (Don't repeat that diagnosis mistake: check
`curl -sS "$HTTPS_PROXY/__agentproxy/status"` before concluding a site blocks us.)

Adding another Tribe organizer is ~40 lines: clone
`scripts/scrapers/arnold-rim-trail.ts`, point `API_URL` at their wp-json
endpoint, map their venue cities to corridor towns, and register it in
`SPECIAL_SCRAPERS`.

- **visit-murphys** (`scripts/scrapers/visit-murphys.ts`) — the Murphys
  aggregator. Keeps its own LLM cross-source dedup + virtual-event filtering.
- **arnold-rim-trail** (`scripts/scrapers/arnold-rim-trail.ts`) — the
  **organizer's own** calendar. Added 2026-07-25 after the site showed a hike
  time 30 minutes wrong on the day of the hike. ART's guided hikes start at
  sunset, so the start shifts ~40 min month to month, **and ART edits an
  occurrence as the date nears** (the Jul 25 2026 hike moved 5:45 → 6:15 PM on
  Jul 20, five days out). We were carrying these only via GoCalaveras, which
  snapshots a listing once and never revisits it, so our copy was frozen at the
  April scrape. Reading the organizer directly means the times self-heal on
  every daily scrape; it also picked up the Volunteer Trail Workday series the
  aggregator never listed. ART titles each occurrence with its own date
  ("… – July 25, 2026"), stripped by `stripTitleDateSuffix`.

### American Red Cross blood drives (`scripts/scrapers/red-cross.ts`)

- Searches the public Red Cross **drive-results** SPA for corridor ZIP anchors
  (Murphys 95247, Angels Camp 95222, Arnold 95223 — add ZIPs to `ANCHORS` to expand coverage).
- The page is a JS SPA behind Akamai bot-protection (a plain `fetch` 403s), so it is
  rendered + JSON-extracted via **Firecrawl** (`FIRECRAWL_API_KEY`, already set), not direct fetch.
- Each drive → `category='civic'` (Community), `cost_tier='free'`, `visibility='public'`,
  `org_slug='red-cross'`, `event_url` = the per-ZIP drive-results page (donor lands on the
  bookable list). Cross-anchor repeats and out-of-corridor overspill (San Andreas, Sonora)
  are dropped by the corridor filter + dedup. A 10-day-grace stale sweep removes cancelled drives.
- Requires the `red-cross` row in `hwy4_orgs` (migration `20260601_add_red_cross_org.sql`;
  FK `fk_hwy4_events_org`). `canonical_url` is left NULL so the link resolver surfaces the
  precise per-ZIP `event_url` (path 3) instead of one generic organizer URL.
- **URL validation:** `scripts/lib/validate-urls.ts` now treats **401/403** like 429
  (access-denied / bot-walled ≠ dead link) and never nulls those URLs. Without this the
  nightly check would HEAD the Red Cross page, get a 403, and wipe the booking CTA every run.


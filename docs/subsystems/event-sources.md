# Event sources

> Moved verbatim from [CLAUDE.md](../../CLAUDE.md) (#329). Read this to answer: Which scraper owns a listing, and what may it write or retract?
>
> Markdown links in the sections below were rewritten so they resolve from `docs/subsystems/`. The prose is the original section text.

## Event Sources (scripts/scrape.ts — daily GitHub Action)

Most events come from the `scripts/scrape.ts` orchestrator, run daily by
`.github/workflows/scrape.yml` (a GitHub Action, **not** a Vercel cron). It
dispatches per-source scrapers and writes through the shared
`scripts/lib/dedup.ts::upsertEvents` path (dedup_key + corridor drop +
cross-source merge). Two source shapes:

- **Config-driven Firecrawl** — one entry in `scripts/scrapers/firecrawl-sources.ts`
  (single fixed venue/town). The generic runner fetches markdown + LLM-extracts.
  **Registry audited + trimmed 2026-08-11 (HWY-20):** `watering-hole` +
  `branding-iron` deleted (zero rows ever — neither site has an events page;
  gocalaveras covers The Watering Hole accurately) and `lube-room` +
  `camp-connell-general-store` deleted (silently zero for 65+ days, 100%
  unpinned, writing under the identical org_slug/source_name as their seed
  scripts — an invented row would have been indistinguishable from a curated
  one; the seeds + fingerprint watchers own those venues). Three entries
  remain: `bear-valley` (now with a commerce-promo `extractHint` + `dumpOnEmpty`),
  `bvac`, and the `moose-lodge` public-events page (its 3 marquee public rows
  are disjoint from the members' PDF calendar — unique coverage, kept).
  A source may set `extractHint` — a per-source instruction appended to the shared
  extraction prompt's Rules (added 2026-07-08 for **bvac**, Bear Valley Adventure Co.:
  skip its season-pass-sale promos, lift each event's own venue + Squarespace
  permalink; see `PRD-bvac-events.md`). The shared extractor also skips already-past
  events by prompt (BVAC's page lists past events alongside upcoming; the runner's
  date filter stays as the backstop) and runs at `max_tokens: 8192` — a ~50-event
  page overflows 2048 and truncated JSON silently extracts 0.
- **Special scrapers** — hand-written files for non-generic shapes (GoCalaveras
  EventON AJAX, visit-murphys + arnold-rim-trail WP REST, **red-cross**,
  **hwy4-fb-groups** — the one that writes submissions, not events, …),
  registered in `SPECIAL_SCRAPERS`. **Organizer-owned sources are listed first**
  in that object so a same-night aggregator pass is never the last writer on a
  row they own (the `manual-sources.ts` blocklist is the real guard; ordering is
  belt-and-braces).

**GoCalaveras detail-page enrichment: honest counts + backoff ([scripts/lib/enrich-report.ts](../../scripts/lib/enrich-report.ts), HWY-32, 2026-09-05).** The month AJAX feed often carries no description, poster, location name or address; the per-event detail page is where all of that comes from, so `enrichEvents` fetches every parsed event's page. On 2026-09-04 **every one of those fetches returned HTTP 429** and the run still logged `Enriched 130/130 events from detail pages`, because that line counted **attempts, not successes** — a total enrichment outage rendering as a perfect score, while new rows landed in the degraded shape that fed the Arnold Angels location red runs. Same rule as the `scrape_runs` writer: a sensor that can fail silently is not a sensor. Now the count leads with what was actually **enriched**, names the rest by reason (`rate-limited (429)` / `http error` / `network error` / `no detail fields` / `skipped after circuit break`), treats a **200 that yields no usable field as `empty` rather than success** (so a markup change can't read as a clean run forever), and warns when the throttled share crosses `RATE_LIMIT_WARN_RATIO` (20%) or when nothing at all was gained. Politeness: `ENRICH_CONCURRENCY` 5→**3**, `ENRICH_BATCH_DELAY_MS` 350→**500**, `Retry-After` honored with **one** gentle serial retry capped at 5s (a hostile header can't park the scrape). **The circuit breaker is what makes the politeness affordable:** after `CIRCUIT_BREAK_CONSECUTIVE_429` (12) consecutive 429s the rest of the call is abandoned and counted as `skipped`, because when the site is refusing everything, continuing burns the Action's 20-minute budget and buys nothing — enrichment re-runs daily, so partial coverage is fine. The month AJAX fetch also names a 429 explicitly now, so "the feed is down" and "we're throttled on detail pages only" are distinguishable in the log. **A page with no nonce or calendar shortcode throws (2026-10-04), with the HTTP status** (`pageConfigFailure`): it used to log one line and `return`, which read as a clean run, so 2026-09-28's total GoCalaveras outage recorded no error in `scrape_runs` and the health table printed `gocalaveras OK` (other sources' merges keep bumping `last_scraped_at` on its rows). The health table now prints `ERROR this run` for a source that threw; a scraper key that is not an org slug (the Facebook bundles) gets a warning line instead. It also lists every source now: its source list was one unpaged select, and PostgREST's silent 1000-row cap cut it off inside gocalaveras's rows, so ten sources (visit-murphys, red-cross, sequoia-woods and murphys-irish-pub among them) never appeared; `fetchAllOrgSlugs` pages until an empty page. Locked by `scripts/test/source-failure-visibility.test.ts`. Counting, thresholds, backoff and breaker are pure and locked by `scripts/test/enrich-report.test.ts` (including the exact Sep 4 shape). `fetchEventDetails` keeps its old signature for `scripts/backfill-gocalaveras-details.ts`; the scraper uses `fetchEventDetailsResult`.

**Degraded-insert hold ([scripts/lib/degraded-hold.ts](../../scripts/lib/degraded-hold.ts), dedup v2 Phase 0.4, 2026-09-28).** A failed enrichment used to leave more than a gap: when a GoCalaveras listing had been merged into another source's row (so its keys no longer resolved), the venue-less, description-less shape the month feed yields on a 429 day was exactly what the fuzzy matcher could not place, and it inserted as a fresh duplicate (Bear Valley Trail Stewardship 10-10, five copies in 30 days). Now `enrichEvents` stamps each event's final outcome (`enrichment_failed`, via `isEnrichFailure`: 429, a non-2xx other than 404/410, a transport error or a breaker skip; a page that loaded bare is `empty` and a page that is gone is permanent, so neither is a failure worth waiting on), and `upsertEvents` holds a would-be INSERT, after exact-key and strong-match both miss, when enrichment failed and the row still has no venue, no description and no street number (a street number gives the matcher its same-street-number anchor; `streetNumber` in `lib/event-identity.ts` is the shared rule). Held rows log `DEGRADED_INSERT_HELD` and count as `held` in `scrape_runs.source_results` (recorded, not yet surfaced on `/admin/scrapers`, same as `unpinned`; a persistent 403 wall would defer every new degraded GoCalaveras listing to its event day with only that count to show for it, so surfacing it is the open follow-up in the PRD); a run that enriches them inserts them normally. Events dated on the run day always insert, so a held listing appears on its first enriched run or its own day's run at the latest; only an event-day run that fails outright can still miss it, and since the breaker trips on many days, few-day deferrals are routine. Updates and merges are untouched. Locked by `scripts/test/degraded-hold.test.ts`: behavioral tests drive the real `upsertEvents` through both write paths against a fake Supabase (so a hold moved ahead of the strong-match lookup fails), plus a structural check that every `hwy4_events` insert site in `dedup.ts` consults the hold.

**Organizer-source skeleton ([scripts/lib/organizer-source.ts](../../scripts/lib/organizer-source.ts), HWY-23, 2026-08-11).** Four scrapers read an organizer's own structured feed — `brice-station` (Shopify products.json), `arnold-rim-trail` (Tribe REST), `sequoia-woods` (a Duda month grid), `murphys-irish-pub` (Wix per-event pages) — and had independently grown the same tail. That sequence is now declared once. `beginOrganizerRun({title, sourceName, orgSlug, pageUrl})` banners the run and reads the run date **once** (the future floor and any sweep window must compare against one string, not two clock reads either side of UTC midnight); `writeOrganizerBatch(run, {events, privateEvents?, planSweep?})` — the DB half in `organizer-source-exec.ts` — applies a future-only floor, upserts public-then-members-only (skipping an empty group; `upsertEvents` takes one visibility per call), then runs the source's sweep plan: **after** the write (sweeping first would archive-and-delete rows the upsert is about to refresh), under the **same `org_slug` the write used**, and **only when the run actually wrote rows** — an empty batch can't be told apart from a broken fetch, and a sweep with an empty presence set selects every resident row in its window. Deliberately **not** unified, because unifying them would change behavior or hide judgment: each source's fetch, its per-item mapping and logging, venue detection (three call it, each reporting differently), each bespoke summary block, and every sweep input that decides what gets deleted — the window derivation, the presence set, the ownership predicate — which stay in the scraper that can explain them. `brice-station` and `arnold-rim-trail` pass no plan at all (their file headers say why neither may retract). Pure rules locked by `scripts/test/organizer-source.test.ts`; the sweep primitive itself is unchanged (`stale-sweep.ts`, which now also defines the shared `SweepPlan` option shape).

**URL-stated date/time correction ([scripts/lib/url-date.ts](../../scripts/lib/url-date.ts), 2026-07-26).** Organizer permalinks routinely carry the occurrence date, and sometimes the start time, in a string the venue authored themselves (`bricestation.com/products/wolf-jett-july-25-2026-7pm`, `visitmurphys.com/event/music-on-the-rooftop/2026-07-31/`). That beats an LLM's reading of a rendered page. `correctFromUrl` runs in the shared `upsertEvents` pre-pass **before `dedup_key` is computed** (so the corrected date keys the row) and covers every scraper. **The Wolf Jett bug it closes:** the `brice-station` scraper wrote a row dated 2026-07-26 for an event whose own product URL said July 25 — the correct July 25 row already existed, so the site showed a duplicate advertising a show that had already happened. Deliberately a *correction, never a source*: it only overrides a date/time already extracted, only from the event's own `event_url`, and only when the URL states one unambiguously — a month **name** + day + 4-digit year, or an ISO path segment; a bare year ("…-2026"), a season, and "4th-of-july-2026" all parse to null, as does a calendar-impossible date. A slug time needs an explicit meridiem (a bare number is too ambiguous). Every correction is logged (`URL_DATE_CORRECTION`) — it firing means an extractor is getting dates wrong and that should be visible. Locked by `scripts/test/url-date.test.ts`.

**Recurring-series ingest horizon ([scripts/lib/ingest-horizon.ts](../../scripts/lib/ingest-horizon.ts), 2026-07-25).** The Events Calendar materializes a recurring event as a real post per occurrence, so Visit Murphys' feed offers weekly instances **two years out** — and we ingested all of them: 104 rows of "Live Music Upstairs" at Boyle MacDonald, every one asserting a 6:00 PM start, running to 2028-07-21. Across the catalog that was 82 upcoming rows past 12 months from just 4 series (~12% of the whole upcoming set). Wrong for two reasons: **accuracy** (nobody confirmed a bar's trivia start time in July 2028, yet the site stated it as fact — the same "asserted a time we don't know" failure as the stale sunset-hike times, arriving from the other direction) and **crawl budget** (`PRD-search-indexing.md` blames exactly this population for the sitewide "Discovered – currently not indexed"; the sitemap was trimmed then, but the rows were never capped — this is the upstream fix). `capSeriesHorizon` runs in the shared `upsertEvents` pre-pass next to `dropOutOfCorridor`, so it covers **every** scraper, and is deliberately narrow: an event is dropped only when it is BOTH beyond `SERIES_HORIZON_DAYS` (365) AND one of `MIN_SERIES_SIZE` (6) or more instances sharing a name + venue in the same batch. A far-future **one-off** — next year's festival announced early — has a tiny group and always survives. Drops are logged per series (a silent cap would read as "we covered everything"). Locked by `scripts/test/ingest-horizon.test.ts`. The 82 resident rows were archived + deleted 2026-07-25; every one is restorable from **`hwy4_events_horizon_archive`** (migration `20260725_events_horizon_archive.sql`, service-role only): `INSERT INTO hwy4_events SELECT (jsonb_populate_record(null::hwy4_events, snapshot)).* FROM hwy4_events_horizon_archive WHERE event_id = '…'`.

**Unpinned-row guard ([scripts/lib/unpinned-guard.ts](../../scripts/lib/unpinned-guard.ts), HWY-17, 2026-08-11).** A row carrying **neither `source_event_id` nor `event_url`** is unverifiable (nothing to re-read), uncorrectable (`correctFromUrl` has no URL to check the date against) and unretractable (a window-scoped stale sweep keys rows by sid/URL, so it can never select one) — precisely the shape of all 36 Murphys Irish Pub phantoms. `partitionUnpinned` runs in the shared `upsertEvents` pre-pass, right after `normalizeBatch` (so it judges the URL that will actually be stored: post-`correctFromUrl`, post the non-http(s) null-out), and every call reports `UpsertResult.unpinned`, summed into `scrape_runs.source_results` by `recordSourceResult` so the count is durable per source per run. **The policy is per-source because most unpinned rows are legitimate:** the seed scripts transcribe schedules that have no per-event page anywhere (`lib/bigtrees-schedule.ts` literally writes both fields null), so a blanket rule would delete hand-curated events. Three policies: **`allow`** = expected shape here, nothing dropped and the count reported as **0** (not an anomaly worth a number on an ops dashboard); **`warn`** = the default, nothing dropped but the count reported (`UNPINNED_ROWS <source> <n> (policy=warn)` in the scrape log); **`reject`** = refused at the write boundary, one `UNPINNED_REJECTED` line per row. Today `allow` is set at exactly two callers, both seeds (`seed-bigtrees-programs-2026`, `seed-lube-room-summer-2026`); every scraper is on the default `warn` and **nothing is on `reject`**. The flip of a text-scrape source warn→reject is a later, soak-gated change: **7 consecutive clean days of zero warns for that source** first, which proves its rows are reliably pinned before keyless ones start being refused. Locked by `scripts/test/unpinned-guard.test.ts` (which asserts the `allow` no-op as hard as the `reject` behavior).

**Runner timeout + health logging (2026-07-09).** The GitHub Action job runs at
`timeout-minutes: 20` (raised from 10 — the job was landing right at the old
cap, hitting a runner-timeout **kill** on most days, which GitHub Actions
reports as `cancelled`, not `failure`, so the workflow's own `if: failure()`
alerting never fired). Independent of the timeout headroom, every run now
writes a durable summary to **`scrape_runs`** via
[scripts/lib/scrape-run-log.ts](../../scripts/lib/scrape-run-log.ts) — instrumented
once at `upsertEvents` (`scripts/lib/dedup.ts`, the one choke point every
scraper writes through) and flushed **right after the scraper loop, before**
the slower URL-validation pass, so a future timeout kill during validation
can't erase scraper health visibility again. Read at **`/admin/scrapers`**
(the Pulse "Scrapers" tab) — see the Admin cockpit section above.

### Facebook page/group event tabs (`scripts/scrapers/hwy4-fb-pages.ts`)

`hwy4-fb-discover` points the Apify events actor at a TOWN (`/events/explore/<slug>/<id>`); this points the **same actor at one page's own `/events` tab**. That is not a duplicate source, because the two return **different Facebook event objects for the same night**. Copperopolis Town Square, measured 2026-09-05:

| Feed | Date | FB event id | Title |
|---|---|---|---|
| `explore/copperopolis-ca` | 09-12 | `769764202448727` | "Copperopolis Summer Concert series" |
| `TheTownSquareAtCV/events` | 09-12 | `1801994517316530` | "Music In The Square- The Yacht Rockers" |

The venue creates a generic series listing **and** a named-act listing; explore surfaces only the former, and 09-05's "Hired Gunn" is on the tab and not in explore at all. So the page tab is where the **act name** lives, and the act name feeds the artists chip, the artist-blurb queue and the HWY-7 title work.

**The pair needed no new dedup, which is the point.** `isGenericTitle` already reads "… Concert series" as a placeholder, so `isSameEvent` merges the two once the venues agree, and the merge writes the specific title because `isActlessPlaceholderTitle` (the narrower test that governs `placeholderNameSteal`) does **not** classify a named-act title as actless. Live result on the first run: three "Saturday Night Music in Copper Valley Town Square" rows became Hired Gunn / The Yacht Rockers / Bad Jovi, zero rows inserted, zero duplicates.

**The registry is short on purpose, and every entry was probed first.** Candidates rejected on evidence, not taste: `BearValleyResort` (1 upcoming + a season-pass promo), `groups/uh4ccc/events` (3 events, all past), Ironstone, `boylemacdonaldwines`, `Prospect772`, `indianrockvineyards` (all zero upcoming). The wineries are the instructive rejection — Boyle MacDonald alone has 52 upcoming generic-titled rows, so it looks like the biggest prize here, and its page publishes no Facebook events at all. **Corridor venues mostly post to a feed rather than create event objects.** Re-probe before adding a page; do not add one because a venue is busy. (This is the HWY-20 lesson: four config entries were deleted for being silently zero.)

Registered **last** in `SPECIAL_SCRAPERS` for the brice-station reason — organizer-owned but deliberately not blocklisted, so both writers coexist and the organizer writes last. `isConfiguredPage` ([scripts/lib/fb-page-config.ts](../../scripts/lib/fb-page-config.ts), locked by `scripts/test/fb-page-config.test.ts`) is the `isConfiguredTown` twin: it refuses a bare `facebook.com/` (the global feed), any URL already containing an `events` segment (a config carrying one would build `/events/events`; an explore URL scraped from here would re-ingest a whole town under one page's org_slug), non-https and non-Facebook hosts, and the bare `/groups` directory.

**`lib/facebook.ts` was deleted with this change** (the `apify~facebook-posts-scraper` path). It pulled a page's POSTS, concatenated all of them into a single 15,000-char blob and made **one** LLM call over the merged text, so nothing could attribute an event back to the post it came from and nothing could inherit that post's permalink — the unverifiable/uncorrectable/unretractable shape HWY-17 flags, and the shape `hwy4-fb-groups` avoids by making one model call per post. Its only consumer, `mystic-saloon`, now reads the venue's `/events` tab (keeping its mysticsaloon.com Firecrawl fallback). That swap surfaced a latent bug: **`mystic-saloon` had no `hwy4_orgs` row**, so `fk_hwy4_events_org` had been rejecting every insert it ever attempted — invisible because the batch scraper extracted nothing to insert. A broken writer behind an empty reader. Migration `20260905_fb_page_orgs.sql` adds that row plus the Town Square one. Also folded in: `health.ts` now reads `getFacebookDiscoverStatus`, which had been exported and read by **nobody** since it was written, so a town feed could fail silently while the report printed one page scraper's status.

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

### Wix event-page sources (`scripts/lib/wix-events.ts`)

Murphys Irish Pub posts its lineup on a Wix site (murphysirishpubca.com, also served as goirishinmurphys.com) whose homepage events widget exposes **no absolute dates** to a text scrape. As a generic Firecrawl + LLM source (Jul 4 – Aug 9 2026) the extractor therefore **invented** them: every few days each act re-inserted a few days forward (Mon/Tue rows at a closed-Mon-Tue pub, the Wednesday open mic drifting onto Saturdays, three different acts stacked on one "6 PM Thursday"), and each drifted copy was a fresh title+date `dedup_key` with no `source_event_id`/`event_url` — invisible to every dedup layer (different dates never compare), uncorrectable by `correctFromUrl`, never retracted. 36 of the venue's 50 upcoming rows were phantoms when caught (2026-08-09; purged reversibly into `hwy4_events_removed_archive`).

- **`scripts/scrapers/murphys-irish-pub.ts`** replaces the config entry: the homepage is read **only** for its `/event-details/` links; each per-event page yields its date from schema.org Event JSON-LD or a dated occurrence slug (`open-mic-night-2026-08-05-18-00`), parsed by the pure [scripts/lib/wix-events.ts](../../scripts/lib/wix-events.ts) (locked by `scripts/test/wix-events.test.ts`). **Fails closed:** a page stating no unambiguous date yields no event, so a site redesign degrades to zero coverage, never back to fiction. `source_event_id` = the stable Wix slug (a reschedule updates in place); every row carries its permalink so `correctFromUrl` cross-checks dated slugs on every pass. Deliberately NOT blocklisted (GoCalaveras's weekly pub Open Mic rows are real data); registered **last** in `SPECIAL_SCRAPERS` beside brice-station so the organizer writes last.

### Square Online event products (`scripts/lib/prospect-772.ts`, 2026-10-06, #359)

Prospect 772 Winery publishes its concert series as Square event products, not as HTML on [prospect772.com/calendar](https://www.prospect772.com/calendar). The CMS page lists `featuredEventIds`; the products API returns `product_type_details.start_date` / `start_time` / `end_time`, the permalink, and the price. GoCalaveras titles the same nights `Live Music @ Prospect 772` with `artists` null and no end. [scripts/scrapers/prospect-772.ts](../../scripts/scrapers/prospect-772.ts) maps each product through `titleWithNamedAct` so the public name stays `{Act} Live Music @ Prospect 772` (the Breakaway slug from the Oct 5 hand retitle does not move; Boomer's hand title 301s). Registered after GoCalaveras in `SPECIAL_SCRAPERS` (Stevenot is last), **not** blocklisted: a show the featured block has not picked up yet still arrives via GoCalaveras, and this writer merges onto that row (same `venue_key`, date, and start) instead of inserting a second one. No stale sweep. The featured block is not a full calendar. `org_slug` is `prospect-772`; an INSERT needs a `hwy4_orgs` row that this change does not add (a merge into an existing GoCalaveras row is an UPDATE and does not). Locked by `scripts/test/prospect-772.test.ts`.

### Stevenot Winery Tribe feed (`scripts/lib/stevenot.ts`, 2026-10-09, #373)

Stevenot's own calendar is Tribe REST at `https://www.stevenotwinery.com/wp-json/tribe/events/v1/events`. GoCalaveras had the only copy, and it was wrong: Oct 25 was stored as Perarez while the feed bills Skull Country, the Halloween party was 7–10pm with no price against the feed's 4–8pm and $25, and the later Sunday shows were missing. [scripts/scrapers/stevenot.ts](../../scripts/scrapers/stevenot.ts) fetches with `${REGION.botName}/1.0 (${SITE_URL})`, the same shape as `WEATHER_USER_AGENT`. The shared Tribe Mozilla UA can get a SiteGround 403 page, not a captcha; a non-JSON body throws, a feed that returns events and parses none throws, and this scraper does not fall through to Firecrawl. Owner-blocklisted (`{ pattern: "stevenot", owner: "stevenot" }`), same as Arnold Rim Trail: GoCalaveras stays on for every other venue and skips this one. Tribe is the full calendar, so that skip does not drop a show the organizer has not published. Without the blocklist the next GoCalaveras pass exact-matches the kept EventON id and `buildExactMatchUpdate` writes the Perarez name and the 7pm Halloween clock back. Sunday titles stay `{Act} Live Music @ Stevenot Winery`. A stored title is kept when the act is the same identity or a shortening (Greg Sutton / Gregory Sutton, Private Reserve / Private Reserve Band), so those slugs do not move. A wrong act is corrected on the existing row (Perarez becomes Skull Country); the old slug 301s, and a second row is not inserted. The Halloween title is kept byte for byte so its URL and `dedup_key` stay; the clock and price change. Corrections omit `source_event_id` (the EventON id stays on the row; the blocklist is what stops the next pass from matching it) and pass an empty artists list into `buildExactMatchUpdate` so the new act replaces Perarez instead of being unioned with it. New shows insert with the Tribe id. Town is Murphys (the feed's city is Vallecito). The `stevenot` `hwy4_orgs` row is ensured at runtime (`ignoreDuplicates`), not by a migration. No stale sweep. A description line that leads with a clock contradicting the structured start is dropped (the Halloween blurb still says 7–10pm). Locked by `scripts/test/stevenot.test.ts`.

### Facebook group posts → the submissions queue (`scripts/scrapers/hwy4-fb-groups.ts`, 2026-09-05)

Corridor Facebook groups carry long-tail community events no aggregator lists — a June 2026 one-off run surfaced the SIRs branch walking the 4th of July parade behind a restored 1942 Willys MB, a punk lineup with no venue named, and the Homemakers Swap at The Urban Ladybug Farm, none of them anywhere else in the catalog. The content is real. The **shape** is the problem, and it is why this scraper is the only one in `scripts/scrapers/` that writes **no `hwy4_events` rows at all**.

**A group post is not a listing.** A calendar feed asserts a date, a venue and a stable per-event id; a neighbour writes "punk show on the 4th" and the model supplies the rest. Every safeguard downstream keys off a per-event URL a group post does not have (`dedup_key`, `correctFromUrl`, the stale sweeps, verification). Three of the four rows that June run wrote straight into `hwy4_events` carried **neither `source_event_id` nor `event_url`** — the unverifiable / uncorrectable / unretractable shape of the 36 Murphys Irish Pub phantoms, and exactly what the HWY-17 unpinned guard exists to flag. So group posts land as **pending `event_submissions` rows** (`source='facebook_group'`) and stop there, riding the shipped triage engine unchanged exactly as inbound email does: `/api/agent/triage-submissions` (18:30 UTC, after the ~11:30 scrape) attaches a verdict, and a human clicks Publish / Merge / Dismiss at `/admin/submissions`. **The human click is the pin.** Blast radius of a bad extraction is one row in a review queue, never a phantom on the homepage.

- **One model call PER POST, not per batch.** That is what fixes pinning at the root: with a single post in context every returned event provably came from it, so it inherits that post's permalink into `event_url` with no attribution bookkeeping for the model to get wrong. A group-sourced submission therefore always links back to the human sentence it came from — a reviewer reads the original before publishing, and the triage agent has a citation to research from (that Homemakers Swap post already yielded theurbanladybug.com on its own).
- **Public groups only.** The Groups API died April 2024 (Graph v19), Firecrawl refuses facebook.com outright, so Apify is the only transport. Its group actors accept a member's `cookieString` for private groups — deliberately **not used**: that means a personal FB session in a CI secret with an account ban attached, and long-tail listings do not justify it.
- **Triage precision is the product.** A venue Page posts about its own events; a community group is mostly chatter. The loose `EVENT_KEYWORDS` gate in `scripts/lib/facebook.ts` fires on the bare token "pm", any month name, and "food" — it would pass most of a group's traffic into a paid model call and then into Rob's queue. `looksLikeEventPost` requires **both** a day anchor and an event signal, rejects question-shaped and classified-ad posts, and enforces a length floor. The tests assert what must be REJECTED as hard as what passes, because a queue that fills with noise stops being opened, and that is how this becomes the fourth dead Facebook source.
- **Cost control is two-layered:** the candidate filter decides what earns a model call, and a per-group high-water cursor in `site_config` (`fb_group_cursor_<slug>`) stops re-reading the same post daily — advanced over every post READ, including ones that yielded nothing, and never moved by an empty/failed fetch. Hard ceiling `MAX_EXTRACTIONS_PER_GROUP` (12) per group per run. `source_message_id` (`fbgroup:<post>#<i>`, on the existing UNIQUE partial index) is the correctness guarantee; the cursor is only the cost optimization.
- **Fails closed everywhere.** An unmappable Apify item is skipped, never guessed at (the store has several competing group actors with no stable schema, so `mapGroupPost` reads `text`/`postText`/`message`/`content`/`caption` and `url`/`postUrl`/`facebookUrl`/`permalink`/`link` permissively); an item with no text or no identity is dropped; a failed model call returns `[]`; past-dated events are dropped (group posts are often recaps). `--dry-run` writes nothing and prints the first raw item so the actor's real field shape can be checked against the mapper.
- Pure core in [scripts/lib/facebook-groups.ts](../../scripts/lib/facebook-groups.ts), locked by `scripts/test/facebook-groups.test.ts`. The corridor extraction contract (JSON shape, the 8 categories, never-invent-a-date) is **defined once** in `lib/inbound-email.ts` (`buildExtractionContract`) and shared by both front doors, so email and group ingestion cannot drift; the email prompt's output is byte-identical to before that extraction.

**FB Discover town expansion (same date).** `scripts/scrapers/hwy4-fb-discover.ts` now carries five more corridor towns (Murphys, Angels Camp, Bear Valley, Copperopolis, Avery) as live entries with an **empty `locationId`**, their `hwy4_orgs` rows already inserted, so enabling one is a single paste rather than a code edit. `isConfiguredTown` ([scripts/lib/fb-town-config.ts](../../scripts/lib/fb-town-config.ts), dependency-free so the gate tests without pulling in the Apify transport) skips any entry whose id is not all digits — necessary because the explore URL built from an empty or half-pasted id resolves to Facebook's **global** events page, which would pour non-corridor events into the corridor filter and burn an Apify run every day. The ids are only visible to a logged-in browser: see **[docs/HANDOFF-fb-location-ids.md](../HANDOFF-fb-location-ids.md)**.

**Retired sources no longer cry wolf.** `scripts/lib/health.ts` derives its table from every `org_slug` that has ever written an event, so a source with no scraper behind it warned forever — `fb-group-uh4ccc`, `fb-group-388511408445423` and `fb-group-upperhwy4` (that June one-off; no scraper for them was ever committed) were generating 4 of the report's 11 daily warnings while nothing was failing. They are now listed as `RETIRED (no scraper)` and raise none. Their historical rows are untouched.

### Organizer retraction — window-scoped stale sweeps (`scripts/lib/stale-sweep.ts`, 2026-08-09)

An append-only ingest plus an organizer who **edits** their calendar equals permanent ghosts: Sequoia Woods renamed "Patio Party #4 … (TBD)" to "… - The Hit Men" and the TBD row lived on beside it (reconcile caught that one only because the titles overlapped; a same-night act swap strands a ghost **no dedup layer may merge**, since different named acts are different events — that rule protects real back-to-back events and stays). Dedup can't fix rows that aren't duplicates; they're listings the source no longer asserts. Both organizer-owned scrapers (**murphys-irish-pub**, **sequoia-woods**) therefore run a **window-scoped stale sweep** after upserting: a resident row this source owns, inside the dates the run provably covered, absent from the batch, is archived to `hwy4_events_removed_archive` (migration `20260809b_events_removed_archive.sql`) then deleted. Both wire it through the organizer-source skeleton above, which owns the after-the-write / same-org / only-if-rows-were-written ordering; each scraper still supplies its own window, presence set and ownership test. Guardrails (pure core `scripts/lib/stale-sweep.ts`, locked by `scripts/test/stale-sweep.test.ts`; executor `stale-sweep-exec.ts`): only cleanly-parsed windows are sweepable (a failed/thin month view or list fetch contributes no window — and for the pub, every *linked* page counts as present even when unparseable, so a parse failure can never delete a row); rows carrying another source's sid/URL are untouchable; `robs_pick` / `community_sourced` / `series_umbrella` / any `*_locked` row is skipped and logged; selections above the effective cap abort the whole sweep as a bad fetch (`effectiveSweepCap`: the relative `maxSweepAllowed` — ~⅓ of resident rows, floor 3, ceiling 20 — further lower-bounded by an optional per-source `maxPerRun` budget); and **sweeps run report-only until `SWEEP_EXECUTE` names the source** (a GitHub Actions repository variable, not Vercel; an allowlist with no all-sources value — see Environment Variables). **First dry-run logs land 2026-08-11**: the last scrape before this shipped (Aug 10) predates the merge, so no sweep of any kind has yet run in prod. Restore any removal: `INSERT INTO hwy4_events SELECT (jsonb_populate_record(null::hwy4_events, snapshot)).* FROM hwy4_events_removed_archive WHERE event_id = '…'`.

**Aggregator retraction — the GoCalaveras sweep (`scripts/lib/gocalaveras-sweep.ts`, 2026-08-11, HWY-21, SHIPPED DRY-RUN).** Aggregator rows rot the same way with no retraction (`stale_scrapes` was 138 on 2026-08-08), and the EventON feed does enumerate a bounded forward window with stable ids: one AJAX POST per month with `fixed_month`/`fixed_year` + a `focus_*_date_range` unix pair, answered by one unpaginated JSON array whose every entry carries a numeric `event_id` (written to `source_event_id` on every row). So the same primitive attaches — with a **strictly narrower ownership test**, because a corridor-wide source has corridor-wide blast radius. `org_slug` cannot answer "who owns this row": it is written only on INSERT while `buildStrongMatchUpdate` overwrites `event_url` + `source_event_id` when an organizer scraper merges into a resident row, so `org_slug='gocalaveras'` means "GoCalaveras inserted it once", not "GoCalaveras still maintains it". `ownsGoCalaverasRow` therefore requires **all** of: a bare-numeric EventON `source_event_id` (any other scheme is an organizer's key, written over ours), an `event_url` that is null or on gocalaveras.com (an organizer domain means that merge, or an EventON listing whose only link is the organizer's `_evcal_exlink` — indistinguishable here, so both are spared), a usable key at all (**unlike the pub sweep, a key-less row is never swept** — it can never be proven present, so an aggregator sweep would select it every run forever), and a venue/name not on the `manual-sources.ts` blocklist (those are filtered out of the batch, so their ids never enter the presence set). Two more aggregator-specific rules: **presence is measured against the RAW feed enumeration**, not the batch we write — an event dropped by the corridor filter, the blocklist, or the cross-source LLM dedup is still an event GoCalaveras lists, and treating our own filtering as the source's retraction would delete every corridor event a venue scraper also covers; and a month contributes a window only when its payload **proves it is that month** (≥⅔ of returned start dates inside the requested month, catching a feed that ignores `fixed_month` and echoes another one) and did not hit a display cap declared by the page's own `data-sc` shortcode (`detectShortcodeCap`, since a truncated tail looks exactly like a retracted one; cap-shape matching has burned twice in prod — `show_limit_paged=1`, a pagination toggle, read as a cap of 1 on 2026-08-11, then `jumper_count=5`, the month-jumper dropdown size, read as a cap of 5 for three runs after the toggle floor shipped — so values below `MIN_PLAUSIBLE_CAP` are toggles, `jumper_*` keys are denylisted UI chrome, and every cap-shaped key logs one disposition line — kept, toggle, or ignored — because a silently-withheld window is an invisibly inert sweep and each episode was diagnosed one masked key at a time). Slug keys are secondary, best-effort (regexed out of the response HTML), and **anchored to `/events/<slug>`** — EventON appends an occurrence tail to a recurring series permalink (`/events/mimosa-sundays-at-ironstone-vineyards/var/ri-13.l-L1`, live on four Ironstone rows), so keying on the last path segment would both invent a key the feed never emits (the row reads as retracted while plainly still listed) and collide across every series sharing an occurrence index; a run whose permalink extraction is thin (`slugExtractionHealthy`) also leaves id-less legacy rows alone, and a URL that yields no slug is not ownership. The month floor is **15**, not the primitive's single-venue 3: live months run 136/114/60/13/16/4, and a 4-listing far-future month cannot distinguish a truncated payload from a quiet one, so the thin tail intentionally contributes no window until it fills in. The sweep also passes a per-source `maxPerRun` of **10**, because at 169 resident rows the relative cap is pinned to the flat 20 (~12% of the aggregator's catalog deletable nightly). Locked by `scripts/test/gocalaveras-sweep.test.ts`. **`SWEEP_EXECUTE` is a per-source allowlist with no all-sources value** (`sweepExecuteEnabled`) precisely so graduating the organizer sweeps cannot arm this one. Review a few days of the `Sweep DRY-RUN would remove:` lines before adding `gocalaveras`; if that first honest report is a big backlog it needs a reviewed one-off purge, since the cap makes the sweep a steady-state maintainer, not a drain.

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
The fallback also covers a plain fetch that gets **no answer at all** (2026-10-04):
on 2026-09-28 visitmurphys.com timed out from the runner, the thrown `TypeError`
skipped the fallback, and the whole Visit Murphys scrape died. The direct fetch
carries its own 15s timeout (`DIRECT_FETCH_TIMEOUT_MS`), because every page tries it
before Firecrawl and undici's default headers timeout is 300s: a host that accepts the
connection and never answers would otherwise cost about 25 minutes over five pages and
take the 20-minute job down with it. A body that breaks off mid-read falls back too, and
every fallback error carries the direct failure, so `scrape_runs` records the real cause.
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
  aggregator. Still does its own virtual-event filtering; the in-scraper LLM
  cross-source dedup step (a per-source Haiku call comparing its batch against
  resident rows) was deleted 2026-08-11 (HWY-19) as predates-the-real-fix dead
  weight — the write-time strong match (`scripts/lib/dedup.ts`) + nightly
  `/api/reconcile-dupes` own cross-source dedup deterministically now.
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
- **URL validation:** `scripts/lib/validate-urls.ts` treats **401/403** like 429
  (access-denied / bot-walled ≠ dead link) and never nulls those URLs. Without this the
  nightly check would HEAD the Red Cross page, get a 403, and wipe the booking CTA every run.
  **Since 2026-10-04 only a 404/410 that a GET confirms nulls a link** (rules in
  [scripts/lib/url-check.ts](../../scripts/lib/url-check.ts), locked by `scripts/test/url-check.test.ts`).
  No answer, a 5xx and a refused HEAD are "unconfirmed": kept and summarized per host in
  the log. A host where half or more of its answered links come back not-found (at least 3
  distinct answered URLs) is spared whole as a host problem (`HOST_ANOMALY`); the share is
  over distinct URLs that got an answer, so a half-down host can't dilute its own 404s and
  four drives sharing one Red Cross page count once. Each distinct URL is requested once.
  Only upcoming events are checked, since no scraper ever rewrites a past row's link.
  Accepted trade-off: a domain that no longer resolves (DNS `ENOTFOUND`) now keeps its link
  too, since a resolver failure reads the same as an outage; the window is bounded to
  upcoming rows, and scraper-owned rows are rewritten daily. On 2026-09-28 visitmurphys.com
  timed out from the runner and the old rule (any error, or any status ≥ 400 other than
  401/403/429, = dead) nulled 139 links in one run: every visitmurphys.com link it checked,
  plus 4 others (three hosts that never answered and a 503).

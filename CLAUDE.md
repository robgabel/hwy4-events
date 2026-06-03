# CLAUDE.md — Hwy4Events

Community events site for the Highway 4 corridor (Angels Camp to Bear Valley, CA). Next.js app deployed on Vercel, data in Supabase.

## Tech Stack

- **Framework:** Next.js 16 (App Router) + React 19 + Tailwind v4
- **Database:** Supabase (`hwy4_events`, `hwy4_orgs`, `hwy4_venues`, `site_config`, `event_submissions`)
- **AI:** Anthropic SDK (Claude Opus) for daily briefing generation
- **Maps:** Leaflet / react-leaflet
- **Hosting:** Vercel (auto-deploys from main branch)

## Architecture

- Events are scraped externally and loaded into Supabase — this app is **read-only** against event data (except community submissions via `/submit`)
- Community submissions land in `event_submissions` (status `pending`). To publish one, insert into `hwy4_events` with `community_sourced=true` and `source_name='Community Submission'` (compute `dedup_key` the same way the scraper does — `sha256(normalizeName|date|normalizeTown)`, first 32 hex chars), then set the submission's status to `approved`. `community_sourced=true` renders a pine **"Community sourced"** badge on the event card and detail page.
- Weekly recurring events use `is_weekly: true` and get collapsed in the UI (`CollapsedEvent` type)
- `site_config` table is a key-value store (briefing text, timestamps, etc.)
- `hwy4_orgs` maps venues/sources to display names and slugs for org pages

## Deduplication (defense in depth)

The same real-world event can appear twice: one source re-lists it under a changed title, or two sources describe it independently (e.g. the GoCalaveras aggregator lists "Live Music @ The Lube Room" while the venue feed lists "Live at The Lube: Poison Oakies" — same night). The title-based `dedup_key` only catches byte-identical re-scrapes of the *same* title, so it cannot see these. Four layers guard against dupes:

1. **Read-time collapse** — [lib/dedupe-events.ts](lib/dedupe-events.ts) (`dedupeEvents`) runs on every user-facing list (homepage, town pages) and both briefing generators. It buckets by `town | date | normalized start | visibility` — **not end time**: a source that omits the end ("7:00 PM") must share a bucket with the same source's fuller listing ("7:00 PM – 10:00 PM"), so the end-agrees-only-when-both-known rule lives in `timesAnchor` inside `isSameEvent`, mirroring the write-time matcher. It then merges rows in a bucket only on a strong identity signal: near-identical title, overlapping artists, near-identical description, or same venue + a generic/umbrella placeholder title. `isGenericTitle` (in `lib/event-identity.ts`) covers both per-night placeholders ("Live Music @ The Lube Room") and **umbrella-series listings an aggregator repeats for a venue's whole program** ("Bistro Summer Concerts Series", "Hilltop Concert Series"), so the GoCalaveras umbrella row merges with the venue feed's specific act. **Two different specific titles never merge on venue/time alone** (a park hosts different events back to back). The survivor is the *enriched* row (`mergeCluster`): the specific act wins the title slot (umbrella/generic titles are penalized in `richness`) while the umbrella's description + poster are backfilled onto it, so the card shows the band name AND the season blurb. Penalizes scraper-artifact venues like `@Murphys Park featuring …`.
2. **Write-time merge** — `scripts/lib/dedup.ts` (`isStrongEventMatch` / `buildStrongMatchUpdate`) replaces the old name-only fuzzy. When a scraped event has no `dedup_key`/`source_event_id` hit, it merges into an existing same-date/same-town row that shares an exact time slot + the same strong signal, field-merging so the survivor keeps the best of both (and unions artists). Conservative — never merges on title similarity alone.
3. **Continuous reconcile (self-healing identity)** — [lib/reconcile.ts](lib/reconcile.ts) (`reconcileDuplicates`) operates on DB state, blind to who wrote the rows, so it covers **every** write path — the `upsertEvents` scrapers AND the three raw-insert writers (`scrape-bls`, `scrape-moose-lodge`, `bistro-espresso`) AND any future writer. It clusters resident rows with the same shared `clusterEvents`/`pickSurvivor`, back-fills the survivor from its losers, and deletes the losers — writing a full reversible snapshot to `event_merge_log` **before** each delete. Run daily by [`/api/reconcile-dupes`](app/api/reconcile-dupes/route.ts) (15:30 UTC, after scrapes, before the audit). **Ships in dry-run mode** (reports what it would merge, mutates nothing); flip to live by setting Vercel env `RECONCILE_EXECUTE=true` after a clean canary week (or `?execute=1` for a one-off). Every merge is reversible: `INSERT INTO hwy4_events SELECT (jsonb_populate_record(null::hwy4_events, merged_snapshot)).* FROM event_merge_log WHERE merged_from_id = '…'`.
4. **Backfill + audit** — [scripts/backfill-dedup.ts](scripts/backfill-dedup.ts) is a thin CLI wrapper over the same `reconcileDuplicates` engine: `tsx backfill-dedup.ts` (dry-run) / `--execute` (apply). Needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. `/api/check-events` reports same-event dupes (venue+time, different title) that the old name-only check missed, plus a `merges_last_24h` count.

The "same event" rule is defined **once** in `lib/event-identity.ts` (`isSameEvent`, locked by `scripts/test/event-identity.test.ts`) and reused everywhere via `lib/dedupe-events.ts` (`clusterEvents`/`pickSurvivor`): the read-time collapse, the write-time merge (`scripts/lib/dedup.ts`), the reconcile engine, the backfill, and the audit all import it, so the definition can't drift.

> **Open item (dedup Move 3, Step 4):** once `/api/reconcile-dupes` runs live and `/api/check-events` reports 0 same-event clusters + 0 surprising merges for **4 consecutive weeks**, downgrade read-time `dedupeEvents` to a dev-only assertion, then remove it a release later. Until then it stays as a free backstop. Canary-week clock starts when `RECONCILE_EXECUTE=true` is set.

## Manually Curated Venues

Some venues publish their schedule in a form the scrapers can't read — e.g. The Lube Room Saloon posts its "Live at the Lube" lineup only as an image, the Camp Connell General Store posts its "Beer Garden" concert lineup only as a season poster, and Calaveras Big Trees State Park posts its season as recurrence rules in prose ("Creek Critters: June 13 – August 15, Tuesdays and Saturdays"), which aggregators re-list as wrong, flattened rows. These are curated by hand and protected two ways:

- **A seed script owns the rows** (e.g. `scripts/seed-lube-room-summer-2026.ts`; `scripts/seed-camp-connell-beer-garden-2026.ts`; or `scripts/seed-bigtrees-programs-2026.ts`, whose schedule rules live in `scripts/lib/bigtrees-schedule.ts` and expand to dated rows via the tested `scripts/lib/recurrence.ts`). Edit the data there and re-run to change a venue's events.
- **`scripts/lib/manual-sources.ts`** (`isManuallyManagedEvent`) lists venue substrings; every auto-scraper skips matches before upserting, so a re-scrape can't overwrite the hand-entered rows. Cameo Plaza, The Lube Room, Calaveras Big Trees State Park, and the Camp Connell General Store (incl. its "Beer Garden") are blocklisted today.

For schedules the scrapers can't read, a watcher cron fingerprints the source and pings Slack on change without auto-writing: `/api/check-lube-schedule` (the Lube Room's image), `/api/check-bigtrees-schedule` (Big Trees' program text on parks.ca.gov), and `/api/check-camp-connell-schedule` (the Camp Connell General Store's Squarespace poster).

## Cron Jobs (vercel.json)

| Route | Schedule | Purpose |
|---|---|---|
| `/api/generate-briefing` | Daily 2pm UTC | Generate daily briefing via Opus |
| `/api/check-briefing` | Daily 5pm UTC | Verify briefing was generated |
| `/api/generate-weekend-briefing` | Fridays 2pm UTC | Weekend-specific briefing |
| `/api/newsletter/prepare` | Wednesdays 3pm UTC | Generate the weekly newsletter body and store it as a **pending** `newsletter_drafts` row for the coming Thursday, then Slack-ping a review link. Writes a draft only — never emails. Idempotent per target Thursday; won't clobber a vetoed/edited draft unless `?force=1`. |
| `/api/newsletter/send` | Thursdays 3pm UTC | Ship the week's newsletter on a **24h veto window**: auto-sends today's `newsletter_drafts` row *unless* a human vetoed it at `/admin/newsletter` (the ~24h between Wed prepare and Thu send). No draft at all (prepare didn't run) → sends nothing and Slack-warns; it never auto-generates-and-blasts unsupervised. On send, marks the draft `sent` and archives the body to `site_config.latest_newsletter`. `?preview=1` renders the current draft (no auth, no send); `?test_email=…` generates fresh + sends to one address (template smoke-test, bypasses the gate). |
| `/api/scrape-bls` | Mondays 1pm UTC | Scrape Blue Lake Springs flyer images via Vision AI |
| `/api/scrape-moose-lodge` | Mondays 2pm UTC | Scrape Ebbetts Pass Moose Lodge monthly PDF calendar via Claude PDF document API. Replaces the deprecated `scrape-moose-lodge` Supabase edge function (2026-05-26). |
| `/api/verify-events` | Daily 3pm UTC | Cross-check upcoming events against organizers' canonical sites; flag mismatches as `needs_verification` |
| `/api/extract-prices` | Daily 1:30pm UTC | Extract explicitly-stated admission fees from event description/name into `price` + `cost_tier` via Haiku. Only lifts fees that are stated, never guesses. Processes 40/run by default; `?limit=150` for manual backfill. Stamps `price_extracted_at` so events aren't reprocessed. |
| `/api/reconcile-dupes` | Daily 3:30pm UTC | Self-healing event identity: clusters resident `hwy4_events` rows via the shared matcher and merges duplicates (back-fill survivor, snapshot loser to `event_merge_log`, delete loser). Covers every write path including the raw-insert writers. **Dry-run by default**; set `RECONCILE_EXECUTE=true` (or `?execute=1`) to apply. After scrapes, before the audit. |
| `/api/check-events` | Daily 6pm UTC | Data-quality audit on `hwy4_events`: duplicates, hidden rows, missing fields, stale scrapes, plus `merges_last_24h`. Posts to Slack if `SLACK_WEBHOOK_URL` is set. Read-only. |
| `/api/aeo-audit-reminder` | 1st of month, 8am PT (16:00 UTC) | Posts the monthly AEO prompt-audit checklist to Slack (`SLACK_WEBHOOK_URL`). Manual ritual — a human runs the 13-query bank against AI engines and logs results in `AEO-SEO-MEASUREMENT.md`. Read-only. |
| `/api/sync-venue-facts` | Mondays 12pm UTC | Refresh `hwy4_venues` live facts (rating, review count, phone, website, hours, Maps URL) from the Google Places API (New). `place_id` is resolved once and cached; the rest refresh weekly. Needs `GOOGLE_PLACES_API_KEY`. `?limit=` to cap the batch. |
| `/api/check-lube-schedule` | Mondays 4pm UTC | Fingerprints the Shopify CDN images on [theluberoom.com/pages/events](https://www.theluberoom.com/pages/events). If the "Live at the Lube" schedule graphic changed, posts to Slack so a human can update + re-run `scripts/seed-lube-room-summer-2026.ts`. The venue's schedule is image-only / hand-curated and blocklisted from the auto-scrapers, so this **never writes events** — it only watches. State in `site_config.lube_schedule_fingerprint`. |
| `/api/check-bigtrees-schedule` | Mondays 5pm UTC | Fingerprints the interpretive-program text on [parks.ca.gov ?page_id=25994](https://www.parks.ca.gov/?page_id=25994) (the program section only, blind to site chrome). If Calaveras Big Trees changed its schedule, posts to Slack so a human re-transcribes the rules in `scripts/lib/bigtrees-schedule.ts` + re-runs `scripts/seed-bigtrees-programs-2026.ts`. The schedule is prose recurrence rules / hand-curated and blocklisted from the auto-scrapers, so this **never writes events**. State in `site_config.bigtrees_schedule_fingerprint`. |
| `/api/check-camp-connell-schedule` | Mondays 5:30pm UTC | Fingerprints the Squarespace CDN images on [campconnellgeneralstore.com/events](https://www.campconnellgeneralstore.com/events). If the "Beer Garden" season poster changed (new act, date, or season), posts to Slack so a human can update + re-run `scripts/seed-camp-connell-beer-garden-2026.ts`. The lineup is image-only / hand-curated and blocklisted from the auto-scrapers, so this **never writes events** — it only watches. State in `site_config.camp_connell_schedule_fingerprint`. |

All cron routes require `CRON_SECRET` as a bearer token. To smoke-test any cron route manually:

```sh
curl -H "Authorization: Bearer $CRON_SECRET" https://hwy4events.com/api/<route>
```

## Event Sources (scripts/scrape.ts — daily GitHub Action)

Most events come from the `scripts/scrape.ts` orchestrator, run daily by
`.github/workflows/scrape.yml` (a GitHub Action, **not** a Vercel cron). It
dispatches per-source scrapers and writes through the shared
`scripts/lib/dedup.ts::upsertEvents` path (dedup_key + corridor drop +
cross-source merge). Two source shapes:

- **Config-driven Firecrawl** — one entry in `scripts/scrapers/firecrawl-sources.ts`
  (single fixed venue/town). The generic runner fetches markdown + LLM-extracts.
- **Special scrapers** — hand-written files for non-generic shapes (GoCalaveras
  EventON AJAX, visit-murphys WP REST, **red-cross**, …), registered in `SPECIAL_SCRAPERS`.

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

## Event Verification

Aggregator scrapers (e.g., GoCalaveras) occasionally get event dates wrong. For organizers we trust as canonical (e.g., Arnold Rim Trail), we cross-check scraped data against the organizer's own events page.

- `hwy4_orgs.canonical_url` — official events URL for the org
- `hwy4_orgs.canonical_check_enabled` — opt-in flag (default false)
- `hwy4_orgs.match_patterns` — substrings to identify the org's events when `org_slug` points at an aggregator
- `hwy4_events.verification_status` — `unchecked | verified | needs_verification | dismissed`
- `/api/verify-events` runs daily; fetches each canonical URL once, asks Haiku to confirm each event's date appears on the page
- Flagged events show a subtle "Date unconfirmed" badge on the public site and queue up at `/admin/verification` for manual review (confirm / dismiss / hide / delete)

Currently enabled: **Arnold Rim Trail** (`arnoldrimtrail.org/events/`). Add more orgs by setting `canonical_url` + `canonical_check_enabled=true` (plus `match_patterns` if upstream scrapers tag the org's events with an aggregator's `org_slug`).

## Event Pricing (cost_tier)

Some events charge admission (Brice Station concerts, ticketed festivals). The fee is often present in the scraped `price` free-text or buried in the description, but free-text can't drive a badge or filter — so we derive a typed signal.

- `hwy4_events.price` — human-readable amount string (`"$25"`, `"Pay what you can"`). Unchanged.
- `hwy4_events.cost_tier` — typed enum: `free | paid | donation | varies | unknown`. The handle the UI keys off.
- `hwy4_events.price_extracted_at` — when `/api/extract-prices` last processed the row (NULL = queue candidate).
- `hwy4_events.price_locked` — manual override (mirrors `importance_override`). When `true`, `price` + `cost_tier` are human-set and **no automated writer touches them**: `/api/extract-prices` skips locked rows, and the scraper (`scripts/lib/dedup.ts`) omits `price` from every update payload (exact-match, fuzzy-merge, serial + batched paths).
- `hwy4_events.description_locked` — sibling to `price_locked` for the free-text `description`. When `true`, the scraper (`scripts/lib/dedup.ts`) omits `description` from every update payload, so a hand-edited description survives re-scrapes. Use when the source's prose carries something stale that re-scrapes keep restoring — e.g. Ironstone "Mimosa Sundays", whose GoCalaveras description literally says "$15 each". Set via SQL: `UPDATE hwy4_events SET description=…, description_locked=true WHERE …`. Same per-row caveat as `price_locked`: new rows for a recurring event start unlocked. Use this when a source's listed price is wrong or stale and re-scrapes/extraction would otherwise keep restoring it — e.g. Ironstone "Mimosa Sundays", whose description literally says "$15 each" so extract-prices re-lifted $15 every run. Set via SQL: `UPDATE hwy4_events SET price=…, cost_tier=…, price_locked=true WHERE …`. **Caveat:** the lock is per-row. A recurring weekly event keeps getting *new* rows inserted for future dates; those start unlocked, so a stale price can reappear on the newly-scraped Sundays and they need re-locking (re-run the same UPDATE periodically).
- `/api/extract-prices` runs daily; reads description+name and lifts **explicitly-stated** fees via Haiku. Never guesses an amount — no fee text means `cost_tier='unknown'`, not free. Skips `price_locked=true` rows.
- The public site shows a green **"Free"** badge or a **"$25" / "Ticketed" / "Pay what you can"** cost badge on each event card (scan-level), plus a **"Free"** quick filter on the homepage. `unknown` shows nothing.
- Backfill the whole upcoming queue by hitting the route repeatedly (it's idempotent via `price_extracted_at`): `curl -H "Authorization: Bearer $CRON_SECRET" "https://hwy4events.com/api/extract-prices?limit=150"`.

## Outbound Event Links

The "Visit Event Page" button links to a **destination derived from event identity, not scrape provenance**. The old behavior linked to `event_url` (where the scraper found the event); for GoCalaveras-sourced events (~69% of the table) that's a churning EventON permalink that 404s and a host that 403s server-side validation. Provenance is not destination — see `PRD-event-link-resolution.md`.

- **`lib/event-link.ts`** is the single source of truth: `resolveEventLink(event, { org, venueUrl })` resolves in priority order **organizer canonical → venue canonical → stable-source `event_url` → none**. `matchOrgForEvent(event, orgs)` maps an event to its organizer by `org_slug` (only when that org has a `canonical_url` — an aggregator slug like `gocalaveras` deliberately falls through) or by `hwy4_orgs.match_patterns` (normalized substring; enumerate spelling variants — the source really lists "Aronld Rim Trail"). Locked by `scripts/test/event-link.test.ts`.
- **`UNSTABLE_SOURCE_HOSTS`** (currently `gocalaveras.com`) are aggregators we never render as the CTA and never server-validate. **`AGGREGATOR_FALLBACK`** (default `false`) keeps it that way: an event whose only link is an unstable-host `event_url` shows **no** outbound button — the internal event page is the destination (a dead link is worse than none, and it's the AEO-correct call). Flip to `true` only with live, browser-grade validation for a specific aggregator.
- **Consumers** (all import the resolver, none read `event_url` directly for a destination): the event detail CTA + its JSON-LD `offer.url` ([app/events/[slug]/page.tsx](app/events/[slug]/page.tsx)), the patriotic detail layout, and `buildEvent` in [lib/schema.tsx](lib/schema.tsx) (which now points `ItemList` offers at the internal page). The three briefing/newsletter generators already link to internal pages, so they were already safe.
- **To give an organizer's events a real outbound link**, add the org to `hwy4_orgs` with `canonical_url` + `match_patterns` (no code change). `/api/verify-events` shares the same `matchOrgForEvent`, so date-verification and link resolution always agree on which org owns an event. Setting `canonical_url` is enough for links; `canonical_check_enabled=true` additionally enrolls the org in date-verification.
- **`validateEventUrls`** ([scripts/lib/validate-urls.ts](scripts/lib/validate-urls.ts)) skips `UNSTABLE_SOURCE_HOSTS` (it can't see them and we don't render them — a 403 there is not a dead link).
- **`/api/check-events` link-gap KPI.** A raw count of link-less events lies: a gap at a siteless one-off venue is the *correct* terminal state (our own page is the destination), not a to-do. So the audit reports two things: `aggregator_link_gaps` (raw count, trend only) and `actionable_link_gaps` — distinct venues with **≥5 upcoming events** and no organizer canonical (`GAP_VENUE_THRESHOLD` in the route). The Slack post lists those venues by name and **fires on a high-frequency gap alone**, even with zero other issues — so a new recurring organizer (a new concert series, a new winery) surfaces itself for a ~10-min `hwy4_orgs` row. Watch `actionable_link_gaps`, not the raw count.
- **Decision (2026-05-30): do NOT build canonical auto-discovery.** The long tail below the threshold is one-offs at venues with no usable site, where no outbound link is correct — chasing them is optimizing something that shouldn't exist. The threshold-filtered KPI surfaces the few high-frequency venues worth a manual row; that's the whole mechanism. Only revisit automation if `actionable_link_gaps` starts climbing fast (watch the rate, not the count). To give an organizer a link, add its `hwy4_orgs` row by hand (canonical URL must be a page that renders server-side — JS-only calendars like `bigtrees.org/events/` are fine as a *link* but can't be enrolled in `canonical_check_enabled` date-verification).

## Venue Info (`hwy4_venues`)

The event detail page shows a venue section: a **local-voice blurb** (what the place is, the vibe, named specifics) plus a **live-facts strip** (rating, today's hours, phone, website). This serves the personas who want venue context (Miguel deciding if the drive is worth it, Jen checking logistics, Mia recommending to guests) without violating the "local voice, not corporate voice" rule — the prose is ours; only the factual strip is third-party.

- **`hwy4_venues`** — one row per registry venue, keyed by `venue_key` (the `scripts/lib/venues.ts` key). Columns: `canonical/town/address` (seeded from the registry), `blurb` + `blurb_generated_at` (local voice), and Google Places facts (`place_id`, `rating`, `user_ratings_total`, `phone`, `website`, `maps_url`, `hours` JSONB of weekday strings, `places_synced_at`). RLS on, public read only.
- **`hwy4_events.venue_key`** — links an event to its venue row. Populated at write time by the scraper upsert (`scripts/lib/dedup.ts` via `resolveVenueKey` in `scripts/lib/venue-matcher.ts`) and backfilled by `scripts/backfill-venue-keys.ts`. NULL when the venue isn't in the registry → the detail page shows no venue section (graceful no-op).
- **Blurbs** are drafted by `scripts/draft-venue-blurbs.ts` (Opus). Sources, in priority: `places_attributes` (verified persona signals — stated plainly), live Google Places **review snippets** (vibe + named specifics only; fetched transiently, never quoted or stored), and `docs/LOCAL-KNOWLEDGE-BASE.md` (owners, history). Em-dash + banned-phrase enforced (incl. no internal-tooling references). Dry-run by default; `--apply` to write; `--all` to regenerate; `--out <file>` to export proposals as JSON without touching the DB (used for the review-sheet workflow); pass venue keys to target specific ones. **Rob reviews before publish** — the script refuses to auto-write a blurb that trips a hard voice rule. ⚠️ Review-sourced names/dishes are lower-confidence than the knowledge base — sanity-check them.
- **`places_attributes`** (JSONB) — factual Places attributes (dogs / kids / groups / outdoor / live music / parking / type) refreshed weekly by `/api/sync-venue-facts`. Grounds blurbs and is available for future UI badges. Review text is never stored (Google ToS).
- **Live facts** come from `/api/sync-venue-facts` (weekly cron, Google Places API New). `place_id` is cached indefinitely; rating/hours/etc. refresh weekly. The UI attributes the rating to Google (links to `maps_url`, "via Google" label) as required by Google's terms.
- **`places_locked`** — when `true`, `/api/sync-venue-facts` skips the venue entirely. Set it (and null the facts) for venues with no *correct* Places listing so the weekly sync can't re-match a wrong one: permanently-closed venues (Twisted Oak), venues with no distinct listing (The Poor House), and private/no-own-listing spots (the Blue Lake Springs amphitheater/pool/lake, which otherwise all collapse onto the one HOA listing). Mirrors `hwy4_events.price_locked` / `description_locked`. To pin a *correct* listing instead, set `place_id` + null `places_synced_at` and let the next sync re-fetch.
- **Adding/refreshing a venue:** add it to `scripts/lib/venues.ts`, then `cd scripts && npm run seed-venues` (registry → `hwy4_venues`), `npm run draft-venue-blurbs -- --apply` (blurb), and let the weekly cron (or a manual `curl .../api/sync-venue-facts`) fill the Places facts. Re-run `npm run backfill-venue-keys -- --apply` so existing events link to the new venue.

## Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `ANTHROPIC_API_KEY`
- `CRON_SECRET`
- `NEXT_PUBLIC_CF_BEACON_TOKEN` (optional) — Cloudflare Web Analytics beacon token. When set, `app/layout.tsx` injects the Cloudflare RUM script. Get it from https://dash.cloudflare.com/?to=/:account/web-analytics.
- `SLACK_WEBHOOK_URL` (optional — enables `/api/check-events` to post audit issues and `/api/aeo-audit-reminder` to post the monthly AEO checklist to Slack)
- `GOOGLE_PLACES_API_KEY` — billing-enabled Google Cloud key with the Places API (New) enabled. Powers `/api/sync-venue-facts` (venue rating/hours/phone/website). ~45 venues refreshed weekly stays within Google's free credit.
- `RECONCILE_EXECUTE` (optional) — when `"true"`, `/api/reconcile-dupes` actually merges duplicates; otherwise it runs in dry-run (report-only). Leave unset during the canary week, then set in Vercel to go live.

## Dev Workflow

- `npm run dev` for local development
- Vercel auto-deploys from `main`
- Migrations in `supabase/migrations/` — apply via Supabase dashboard or CLI
- No test suite currently
- **Venue & address resolution:** `scripts/lib/venues.ts` is the venue registry (canonical name, aliases, town, street address) — the single source of truth. The matcher (`scripts/lib/venue-matcher.ts` `applyVenueDetection`) resolves generic/messy venue names; the upsert path (`scripts/lib/dedup.ts` `normalizeEventLocation`) fills a registry address when an event's address is missing or town-only. When a real venue shows up with a bad/missing address, add it to the registry — don't hand-edit rows. To retro-fix existing rows after a registry change, run `cd scripts && npm run backfill-venues` (dry-run; add `--apply` to write, `--future-only` to limit). Out-of-corridor venues are dropped at write time via `scripts/lib/corridor.ts`. The daily `/api/check-events` audit reports any remaining unresolved venues / town-only addresses to Slack.
- **Static venue maps:** the event detail page shows a static map thumbnail centered on the **venue** (not the town) and only loads the interactive Leaflet map on tap. The page server-geocodes the address ([lib/geocode.ts](lib/geocode.ts), cached weekly, tag `geocode`) and renders `<img src="/api/static-map?lat&lng&z">`. That route ([app/api/static-map/route.ts](app/api/static-map/route.ts) + [lib/static-map.ts](lib/static-map.ts)) stitches CARTO Voyager tiles with `sharp` into a webp, cached **immutably** (the image is a pure function of lat/lng/zoom — never needs busting). No street address / geocode miss → falls back to the town centroid. The old pre-baked `public/maps/*.webp` town assets and `generate-town-maps.ts` were removed in favor of this.
  - **Warm + bust:** after a deploy or a venue/address backfill, run `cd scripts && SITE_URL=https://hwy4events.com REVALIDATION_SECRET=… npm run warm-maps`. It busts the `geocode` tag via `/api/revalidate` (so pages re-geocode with corrected addresses) and pre-warms `/api/static-map` for every distinct upcoming-event center. `REVALIDATION_SECRET` lives in Vercel env, not local `.env.local` — set it inline to enable the bust (warm runs without it).

## Project Structure

```
app/
  page.tsx              ← homepage (event list + briefing)
  events/               ← individual event pages
  about/, faq/, privacy/, terms/  ← static pages
  submit/               ← community event submission form
  og/                   ← dynamic OG image generation
  api/
    generate-briefing/  ← daily AI briefing (Opus)
    generate-weekend-briefing/
    check-briefing/     ← monitoring/fallback
    submit-event/       ← form submission handler
    revalidate/         ← on-demand ISR
components/
  EventCard.tsx         ← single event display
  EventList.tsx         ← main list with filtering
  FilterBar.tsx         ← category/town filters
  WeeklyBriefing.tsx    ← "This Week on the 4" display
  EventMapStatic.tsx    ← detail-page map entry point: static town thumbnail + Get Directions; mounts interactive Leaflet (EventMap.tsx) only on tap
  EventMap.tsx          ← interactive Leaflet map (CARTO Voyager tiles), lazy-loaded by EventMapStatic
  VenueInfo.tsx         ← detail-page venue section: local-voice blurb + Google Places facts strip (server component)
  Header.tsx, LiveBadge.tsx, ShareButton.tsx, etc.
lib/
  types.ts              ← Hwy4Event, EventCategory, TOWNS, etc.
  supabase.ts           ← Supabase client singleton
  event-time.ts         ← time formatting helpers
  towns.ts, slugs.ts, constants.ts
```

## Design & Product

- **Personas:** `docs/PERSONAS.md` — 7 canonical user personas (Gary, Mia, Dave, Rob, Karen, Jen, Miguel). Reference these when making product/design/feature decisions.
- **Design Principles:** Derived from personas — see bottom of PERSONAS.md. Key ones: mobile-first, no gates, "This Weekend" is the killer view, trust built on accuracy.
- **Local Knowledge Base:** `docs/LOCAL-KNOWLEDGE-BASE.md` — Comprehensive hyperlocal knowledge: businesses by town (with hours, owners, vibe), persona daily routines, local vocabulary glossary, seasonal rhythms, media/info channels, inter-town cultural dynamics, community figures. Reference when writing copy, event descriptions, briefings, or anything that needs to sound like a local neighbor.
- **PRDs & Plans:**
  - `PRD-about-page-redesign.md` — About page redesign (Approach C: story top + reference bottom). Persona checklist, page structure, content guidelines, implementation priority.
  - `PRD-local-authenticity.md` — Local voice and authenticity strategy
  - `PRD-event-visibility.md` — Event discovery and visibility improvements
  - `PRD-bear-valley-events.md` — Bear Valley events coverage expansion
  - `PLAN-seo-aeo.md` — SEO and answer-engine optimization plan (the build)
  - `AEO-SEO-MEASUREMENT.md` — measuring SEO/AEO success at $0: GSC + Bing setup, monthly SEO scoreboard, monthly AEO prompt-audit ritual + query bank, log template. Reminder delivered via `/api/aeo-audit-reminder` cron.
  - `PRD-blue-lake-springs.md` — Blue Lake Springs HOA integration: members-only club events, Vision AI scraping of flyer images, `club` category, "Members & Guests" badge
  - `PRD-event-identity-ingest.md` — Self-healing event identity (dedup Move 3): continuous DB-state reconcile (`lib/reconcile.ts` + `/api/reconcile-dupes`) so duplicates can't survive at rest, with a reversible `event_merge_log`. Implemented; rolling out dry-run-first.
  - `PRD-event-identity-ingest.md` — Move 3 of the dedup work (deferred from the matcher consolidation): a self-healing reconcile engine + Vercel cron + `event_merge_log` so duplicate rows can't survive at rest, covering all four write paths (including the three that bypass `upsertEvents`). Reuses the shared `isSameEvent`; gates read-time `dedupeEvents` removal on a clean-streak. Not yet built.
  - `PRD-event-link-resolution.md` — Fixes rotting "Visit Event Page" links (404/403 GoCalaveras permalinks; ~69% of upcoming events). Root cause: the UI links to scrape *provenance* (`event_url`) instead of event *identity*. Plan: one pure `resolveEventLink()` in `lib/event-link.ts` (organizer canonical → venue canonical → stable-source permalink → none; aggregator permalinks never the CTA), reused by the detail page + its JSON-LD (briefings/newsletter already link to internal pages, so they needed no change); backfill `hwy4_orgs.canonical_url`; narrow `validateEventUrls` to skip bot-walled hosts. Render-time-first, single-source-of-truth, lock-with-a-test — same arc as the dedup work. **Implemented 2026-05-30** (`lib/event-link.ts` + 9 tests; detail CTA + JSON-LD, `schema.tsx` offer URL, patriotic page wired; `verify-events` shares `matchOrgForEvent`; Big Trees + Arnold Rim canonicals backfilled incl. the "Aronld" misspelling; `/api/check-events` reports `aggregator_link_gaps`). See "Outbound Event Links" below.

## UI Standards

- **Cursor:** Every `<button>` and clickable non-`<a>`/non-`<Link>` element MUST include `cursor-pointer` in its Tailwind classes. Tailwind v4 does not set `cursor: pointer` on buttons by default — the browser shows an arrow, which makes buttons look non-interactive.
- **Client bundle weight:** Avoid importing heavy libraries (date-fns, lodash, etc.) in `"use client"` components. Use `lib/date-utils.ts` for date formatting on the client. Heavy/non-critical components should be lazy-loaded with `next/dynamic`.
- **Hydration budget:** Links and navigation must work within 1–2s on mobile. Keep the client component tree shallow; prefer server components with small client wrappers (see `WeeklyBriefing.tsx` + `WeeklyBriefingTabs.tsx` pattern).

## Content & Brand Rules

- **Voice:** local, human, slightly wry. Never corporate or AI-sounding. The full voice profile lives in [system/SOUL.md](/Users/robgabel/rob-ai/system/SOUL.md) under "Voice" — read it before drafting any user-facing copy (town pages, FAQ, briefings, blog posts).
- **Mascot:** Millie (Rob's sheepadoodle). Cartoon line-art illustrations available in /public.
- **Coverage area:** Angels Camp, Copperopolis, Murphys, Arnold, Avery, Camp Connell, Dorrington, White Pines, Bear Valley.
- **Rob's Picks** (`robs_pick: true`) are hand-curated event highlights.
- **Categories (event types — describe WHAT, not WHERE):** Live Music, Festival, Community, Hike & Walk, Kids, Wine, Games, Other. Venue buckets (Lodge, Club, Resort) were retired in favor of activity types. Members-only events (Blue Lake Springs, Moose Lodge meetings) are gated by `visibility='private'` + `org_slug` (the Clubs filter), independent of category.

### Voice rules specific to Hwy4Events copy

These reinforce SOUL.md and are non-negotiable for any user-facing copy on this site:

- **No em dashes.** SOUL.md rule. Use commas, periods, semicolons, parentheses. The Opus draft script at [scripts/draft-town-content.ts](scripts/draft-town-content.ts) enforces this in the system prompt and via post-generation check.
- **Don't generic-ify the geography.** Each town has specific venues, owners, landmarks, and character. Use them by name. "Newsome Harlow's fire pit" beats "a local winery's outdoor seating."
- **Verify cadence and hours claims.** Statements like "open every day" or "live music every Thursday" go stale and get quoted forever. Either link to the venue's site, hedge ("often", "most weeks"), or omit. Rule was added after the Murphys Irish Pub "7 days a week" hallucination on 2026-05-25. The knowledge base ([docs/LOCAL-KNOWLEDGE-BASE.md](docs/LOCAL-KNOWLEDGE-BASE.md)) is a draft input, not a verified source.
- **Named entities over generic descriptors.** Real owners (Chuck Hovey, River Klass, Siri & Rich Gilpin), real venues, real numbers. This is also the AEO win.
- **Q&A blocks should mirror real search queries.** First sentence of the answer fully resolves the question. Lift-able by answer engines.
- **The conference-dinner gut check:** would Rob actually say this out loud to another operator at a conference dinner? If it sounds like a marketing intern wrote it, kill the line.
- **Never reference internal tooling in public copy.** Words like "the knowledge base", "my notes", "my sources", "public info", or "the data" are plumbing — they mean nothing to a reader and break the neighbor voice. When there isn't much to say, punt like a human: "I've never been there" (only if true), "I don't have much on it yet", then point somewhere useful (the venue's site, the event details, or invite the reader to send the scoop). Enforced in the venue-blurb generator ([scripts/draft-venue-blurbs.ts](scripts/draft-venue-blurbs.ts)) via a hard prompt rule + banned-phrase check.

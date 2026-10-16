# CLAUDE.md — Hwy4Events

Community events site for the Highway 4 corridor (Angels Camp to Bear Valley, CA). Next.js app deployed on Vercel, data in Supabase.

This file is the map a session needs before it edits. It holds the stack, the standing rules, the cron schedule, the env list, and a pointer to every subsystem. The dated incident writeups and the per-source reference live in `docs/subsystems/`. Open the row below before changing that subsystem. Update the subsystem file in the same change. Update this map when the one-line answer, a schedule, an env var, or a standing rule changes. Old `##` headings still exist inside the linked file, so a search for one (for example `Festival umbrella rows` or `Outbound Event Links`) lands there.

## Tech Stack

- **Framework:** Next.js 16 (App Router) + React 19 + Tailwind v4
- **Database:** Supabase project **`uzediwokyshjbsymevtp`** — the shared rob-ai / PAOS project (org "Gabel.Global", labeled "Claude Code" in the Supabase dashboard, **not** a separate hwy4 project). Reachable via the Supabase MCP (`apply_migration` / `execute_sql` with that project_id). Tables: `hwy4_events`, `hwy4_orgs`, `hwy4_venues`, `hwy4_artists`, `hwy4_sources`, `site_config`, `event_submissions`, `analytics_daily`.
- **AI:** Anthropic SDK. Model ids live in [`lib/agent/models.ts`](lib/agent/models.ts): `claude-opus-5-5` (`PREMIUM_COPY_MODEL`) for voice copy (briefings, newsletter, venue/town drafts; adaptive thinking cannot be disabled, so those calls set `output_config.effort` to medium and a higher `max_tokens`), `claude-sonnet-5` (`REASONER_MODEL`) for reasoners and extraction, `claude-haiku-4-5-20251001` (`HAIKU_MODEL`) for cheap classifiers. Visible reply text is read with `messageText` in [`lib/agent/message-text.ts`](lib/agent/message-text.ts), which joins `type === "text"` blocks, because a thinking block is often first. Scrape/dedup Sonnet calls that must return a bare JSON array pass `thinking: { type: "disabled" }`.
- **Maps:** Leaflet / react-leaflet
- **Hosting:** Vercel (auto-deploys from main branch)

## Standing rules

These are the rules a change has to obey. The incident that produced each one is in the linked subsystem doc or in [LESSONS.md](LESSONS.md).

- **Migrations need Rob's OK.** Commit SQL under `supabase/migrations/`. Do not apply it (dashboard, CLI, or Supabase MCP `apply_migration`) unless Rob has said to. The database is the shared production project `uzediwokyshjbsymevtp` (hwy4-events + PAOS + BrainsFor).
- **Do not change an event's public URL.** `generateDedupKey` stays stable; folding new normalization into the hash orphans every stored key and re-duplicates the catalog. A renamed or merged row keeps the old slug alive through the detail-page fallback (301). Add an expired seasonal slug to `SEASONAL_REDIRECTS` only after that instance page is no longer live. See [Deduplication](docs/subsystems/dedup.md) and [Architecture](docs/subsystems/architecture.md).
- **Prefer the venue's own source over GoCalaveras.** Organizer-owned scrapers are registered so they write last. A blocklist entry with an `owner` lets that scraper through and keeps aggregators off the row. See [Event sources](docs/subsystems/event-sources.md).
- **A finding a person has to act on goes to `agent_actions`, not Slack alone.** Slack may still ping. The cockpit queue is the record, because a Slack-only alert is not a sensor. The Big Trees watcher is the pattern. See [LESSONS.md](LESSONS.md) (2026-10-12) and [Cron jobs](docs/subsystems/crons.md).
- **Locks and cancellation.** A `*_locked` column means a person set that field. No automated writer touches it. To drop a listing a scraper will re-insert, set `status='cancelled'` (the tombstone the next exact-key update hits) rather than deleting the row. `sold_out` marks tickets gone; it does not remove the event. Because a merge tombstone and an organizer cancellation share `status='cancelled'`, any reader that tells people an event is cancelled must filter through `realCancellations` in [lib/briefing-cancellations.ts](lib/briefing-cancellations.ts) (issue #405). See [Event record](docs/subsystems/event-record.md) and [Deduplication](docs/subsystems/dedup.md).
- **PR QA before merge.** Branch from a fresh `origin/main`, open a draft PR, then a separate pass per [.claude/skills/pr-qa/SKILL.md](.claude/skills/pr-qa/SKILL.md). Findings go to Rob as three options and one recommendation; the builder waits. Rob merges. No auto-merge.
- **Never-guess.** Prices, times, artist blurbs, family-friendly, and verification times are written only when the source states them. A blank beats a guessed fact. High-confidence artist blurbs auto-publish; venue blurbs stay behind a human Save.
- **Scraped rows are not hand-edited in the app.** The write exceptions are community publish and merge, the human lock and Save paths, and the scrapers. Agents advise. A person clicks Publish, Merge, or Dismiss.
- **`is_routine` is only `sequoia-woods` and `moose-lodge`.** Do not wire the flag into another scraper. The read filter is global. See [Event notability](docs/subsystems/notability.md).
- **A festival umbrella beside its nightly rows is intentional.** `series_umbrella` keeps them apart. See [Deduplication](docs/subsystems/dedup.md).
- **Voice, UI, and security** are the sections below. New public copy injects `withVoice()` and passes `voice-lint`. JSON-LD goes through `serializeJsonLd()`.

## Subsystem map

One hop from this table. Each file answers one question.

| Doc | Question it answers |
|---|---|
| [Architecture](docs/subsystems/architecture.md) | What does each public page show, and which evergreen URL should a dated query land on? |
| [Admin cockpit](docs/subsystems/cockpit.md) | Where does Rob review, and what may an agent write? Includes the weekly PM pass. |
| [Deduplication (defense in depth)](docs/subsystems/dedup.md) | When are two rows the same event, and how does a merge stay reversible? |
| [Event sources](docs/subsystems/event-sources.md) | Which scraper owns a listing, and what may it write or retract? |
| [Event verification](docs/subsystems/verification.md) | Which organizer pages are checked, and what does a flag mean? |
| [Newsletter and briefing links](docs/subsystems/newsletter.md) | How is the Thursday email rendered, linked, and sent? Includes Rob's Picks in briefings. |
| [Search and audience](docs/subsystems/seo-aeo.md) | How do we measure search demand and visitor versus local? |
| [Venues](docs/subsystems/venues.md) | How is a venue registered, described, and kept off an aggregator overwrite? Includes manually curated venues and venue blurbs. |
| [Event notability](docs/subsystems/notability.md) | Which lodge meals are hidden, and which orgs may set `is_routine`? |
| [Weather](docs/subsystems/weather.md) | How does the event-hour weather chip get its number? Includes the event-card click affordance. |
| [Event record](docs/subsystems/event-record.md) | What may a writer change on price, description, poster, times, and the outbound link? Includes description hygiene, cost tier, and outbound event links. |
| [Cron jobs](docs/subsystems/crons.md) | What does each scheduled job actually do, beyond the one-line schedule below? |
| [Design and product](docs/subsystems/design-product.md) | Which PRD is the record for a product decision? |
| [Dev workflow](docs/subsystems/dev-workflow.md) | How do venue backfill, address correction, and map thumbnails work? |

## Cron jobs

Schedule only. The full purpose of each row, including the flags and the failure modes, is [Cron jobs](docs/subsystems/crons.md). All of these routes take `Authorization: Bearer $CRON_SECRET`.

| Route | Schedule | Purpose |
|---|---|---|
| `/api/generate-briefing` | Daily 8am UTC | Daily briefing. Do not schedule it earlier than 08:00 UTC. |
| `/api/check-briefing` | Daily 5pm UTC | Verify the briefing was generated. |
| `/api/generate-weekend-briefing` | Thu + Fri 2pm UTC | Weekend briefing. Friday inserts the history row; Thursday refreshes the same window. |
| `/api/newsletter/prepare` | Wed 3pm UTC | Draft the Thursday issue. Does not send. |
| `/api/newsletter/send` | Thu 3pm UTC | Send unless vetoed. Ledger-backed. Stops at 85 recipients. |
| `/api/newsletter/send?resume=1` | Fri 3pm UTC | Drain yesterday's unsent recipients. |
| `/api/scrape-bls` | Mon 1pm UTC | Blue Lake Springs flyer scrape. |
| `/api/scrape-moose-lodge` | Mon 2pm UTC | Moose Lodge PDF calendar. `?pdf_url=` is additive and skips the stale sweep. |
| `/api/verify-events` | Daily 3pm UTC | Flag organizer-page mismatches. Does not apply a new time. |
| `/api/extract-prices` | Daily 1:30pm UTC | Lift fees the text states. Skips `price_locked`. |
| `/api/reconcile-dupes` | Daily 3:30pm UTC | Merge duplicates when `RECONCILE_EXECUTE=true`. |
| `/api/indexnow` | Daily 4pm UTC | Push event URLs created in the last ~24h. |
| `/api/snapshot-analytics` | Daily 9am UTC | Cloudflare RUM snapshot. The spike guard nulls a bad day's totals. |
| `/api/check-events` | Daily 6pm UTC | Data-quality audit. Stashes `latest_audit_summary`. Files a missed-scrape row when the newest run is older than 30 hours. |
| `/api/aeo-audit-reminder` | 1st of the month, 16:00 UTC | Slack reminder for the manual AEO ritual. |
| `/api/sync-venue-facts` | Mon 12pm UTC | Weekly Google Places refresh. |
| `/api/sync-venue-facts?only=new` | Daily 11:30am UTC | Places onboarding for venues never synced. |
| `/api/agent/draft-venue-addresses` | Daily 10am UTC | Stage `address_draft`. Does not write the live address. |
| `/api/agent/draft-artist-blurbs` | Daily 10:30am UTC | Research acts. High confidence with prose auto-publishes; the rest wait for a person. |
| `/api/check-lube-schedule` | Mon 4pm UTC | Watch the Lube Room poster. Slack. Does not write events. |
| `/api/check-bigtrees-schedule` | Mon 5pm UTC | Watch the Big Trees program list. Files `agent_actions`. Does not write events. |
| `/api/check-camp-connell-schedule` | Mon 5:30pm UTC | Watch the Beer Garden poster. Slack. Does not write events. |
| `/api/check-murphys-senior-center-schedule` | Mon 6pm UTC | Watch the senior-center calendar images. Slack. Does not write events. |
| `/api/agent/triage-submissions` | Daily 6:30pm UTC | Advise on pending submissions. Does not publish. |
| `/api/agent/expire-submissions` | Daily 14:30 UTC | Reject past pending submissions and email the submitter. |
| `/api/agent/collect-seo` | Daily 11am UTC | Search Console snapshots. Read-only. |
| `/api/agent/chief-of-staff` | Daily 7pm UTC | Ops digest. Read-only. |
| `/api/agent/propose-actions` | Mon 7:30pm UTC | Propose org and venue rows. Does not execute them. |
| `/api/agent/qa-audit` | Sun 8pm UTC | HTTP-check money pages and file `proposed` GitHub issues. |
| `/api/agent/scraper-health-memo` | Mon 6:30pm UTC | Weekly scraper memo. Read-only. |
| `/api/agent/growth-memo` | Fri 4pm UTC | Weekly growth memo. Drafts copy and sends nothing; files `proposed` GitHub issues for builds it implies. |

The weekly PM pass is a Cowork scheduled task, not a row in `vercel.json`. It is documented in [Admin cockpit](docs/subsystems/cockpit.md).

```sh
curl -H "Authorization: Bearer $CRON_SECRET" https://hwy4events.com/api/<route>
```

## Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `ANTHROPIC_API_KEY`
- `APIFY_API_TOKEN` (GitHub Action scrape env, not Vercel) — Apify token for the Facebook scrapers (`scripts/lib/apify-client.ts`, `scripts/lib/facebook.ts`, `scripts/scrapers/hwy4-fb-discover.ts`). The scrape orchestrator skips Facebook sources when unset.
- `INDEXNOW_KEY` (optional) — overrides the region's IndexNow key (`REGION_OPS.seo.indexNowKey`, 8-128 chars of `[A-Za-z0-9-]`). Not a secret: the key is published at `/indexnow-key.txt`. Unset → the region default; neither valid → `/api/indexnow` is a logged no-op.
- `CRON_SECRET`
- `GITHUB_ISSUES_TOKEN`: fine-grained GitHub token, Issues read/write on `robgabel/hwy4-events` only, Vercel Production only. The QA audit and the growth memo file `proposed` GitHub issues with it ([lib/github-issues.ts](lib/github-issues.ts), #325). Unset → both log `GITHUB_ISSUES_TOKEN_MISSING` and file nothing (the QA audit also says so in Slack). It expires; re-mint it before then. `GITHUB_ISSUES_REPO` (optional, `owner/repo`) points a fork at its own repo.
- `NEXT_PUBLIC_CF_BEACON_TOKEN` (optional) — Cloudflare Web Analytics beacon token. When set, `app/layout.tsx` injects the Cloudflare RUM script. Get it from https://dash.cloudflare.com/?to=/:account/web-analytics.
- `CLOUDFLARE_API_TOKEN` — account-owned Cloudflare API token (permission: Account · Account Analytics · Read). Server-only. Powers the analytics **read** path (`lib/cloudflare-analytics.ts`, `/api/analytics`, `/api/snapshot-analytics`). ⚠️ Gotcha: account-owned tokens do NOT validate against `/user/tokens/verify` (that endpoint only knows *user* tokens — it returns code 1000 "Invalid API Token" for a perfectly good account token). Test against the GraphQL endpoint (`POST /client/v4/graphql`) instead. See PRD-cloudflare-analytics.md.
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account tag (32-hex); the `accountTag` filter for the GraphQL Analytics API.
- `CLOUDFLARE_WEB_ANALYTICS_SITE_TAG` — Web Analytics RUM site tag (32-hex; **distinct** from the beacon token). For hwy4events it is `c2807310a1f9469c8955db02d84f7fce`. Discover via the GraphQL `siteTag` dimension or the `rum/site_info/list` REST endpoint.
- `NEXT_PUBLIC_CARTO_API_KEY` — free CARTO basemap key (https://carto.com/basemaps/apikey, no approval queue), used by **both** maps: the server-stitched static thumbnail (`lib/static-map.ts`) and the on-tap interactive Leaflet map (`components/EventMap.tsx`), via the shared `withCartoKey` in [lib/carto.ts](lib/carto.ts). **CARTO requires a key for its raster basemaps and a keyless request is not an error** — it returns HTTP 200 with a valid PNG that has an "API KEY REQUIRED / carto.com/basemaps/apikey" watermark baked into the pixels, so `res.ok` passes and the stitcher composites the watermark straight into an image it then caches immutably (live on the site until 2026-09-01). Nothing at runtime can detect this; the key being set is the only guard, so a missing one logs `CARTO_BASEMAP_KEY_MISSING` rather than degrading quietly. `NEXT_PUBLIC_` because the interactive map fetches tiles from the browser — the key ships in the client bundle by necessity, so restrict it **by domain in the CARTO dashboard** instead of treating it as a secret. Bump `BASEMAP_VERSION` in `lib/carto.ts` whenever the rendered image changes: `/api/static-map` is `immutable`-cached for a year, and the `&v=` the detail page appends is the only way to retire images already sitting in browser + CDN caches.
- `SLACK_WEBHOOK_URL` (optional — enables `/api/check-events` to post audit issues and `/api/aeo-audit-reminder` to post the monthly AEO checklist to Slack)
- `RESEND_API_KEY` — Resend key (already used by the newsletter send). The inbound email route **also** needs it: Resend's `email.received` webhook is metadata-only, so the route calls back (`resend.emails.receiving.get` for the body + `.attachments.list` for the poster's `download_url`). See `PRD-email-ingest.md`.
- `RESEND_INBOUND_WEBHOOK_SECRET` — Standard Webhooks (Svix) signing secret for the Resend **inbound** email webhook (`/api/inbound-email`). Unset = the route refuses all inbound mail (503).
- `INBOUND_EMAIL_ALLOWLIST` — comma-separated curator email addresses permitted to email events in. **Fails closed:** unset = no sender is allowed, so the inbound route ignores everything until it is set.
- `GOOGLE_PLACES_API_KEY` — billing-enabled Google Cloud key with the Places API (New) enabled. Powers `/api/sync-venue-facts` (venue rating/hours/phone/website). ~45 venues refreshed weekly stays within Google's free credit.
- `RECONCILE_EXECUTE` — when `"true"`, `/api/reconcile-dupes` actually merges duplicates; otherwise it runs in dry-run (report-only). **Set to `true` in Vercel production 2026-07-01** (the read-time-dedupe removal canary runs from that date).
- `SWEEP_EXECUTE` — which stale sweeps (`scripts/lib/stale-sweep-exec.ts`) may actually archive+delete; every other sweep runs report-only (would-sweep rows logged in the scrape Action output, each annotated `0 keys (legacy row)` vs `keys present, absent from batch`). **A comma-separated allowlist of org slugs and nothing else** (`sweepExecuteEnabled`, per-source since 2026-08-11 / HWY-21): `murphys-irish-pub,sequoia-woods` arms those two; unset, `"true"`, or any other text arms **nothing**. There is deliberately **no all-sources value** — the obvious way to graduate the pub sweep is to type `true`, and while that meant "all" it would have armed the corridor-wide **gocalaveras** sweep over hundreds of rows on the same run with zero dry-run review. Arming a sweep costs exactly one deliberate act: naming it. **A GitHub Actions repository VARIABLE (`vars.SWEEP_EXECUTE` in [.github/workflows/scrape.yml](.github/workflows/scrape.yml)) — NOT a Vercel env: the scrapers run in the Action, so setting it in Vercel is a silent no-op.** Add a source only after reviewing its report-only logs; for murphys-irish-pub, also wait until every future row has adopted a `source_event_id` (`SELECT count(*) FROM hwy4_events WHERE org_slug='murphys-irish-pub' AND date >= current_date AND source_event_id IS NULL` = 0).
- `GOOGLE_SEARCH_CONSOLE_SA_JSON` — Google Cloud service-account credentials JSON (the full file contents, as a single env value) for the Search Console API, used by `/api/agent/collect-seo`. **Wired live 2026-07-05.** The service account is **`gsc-reader@hwy4events.iam.gserviceaccount.com`** (GCP project `hwy4events`, Search Console API enabled), added as a **Full** user on the `sc-domain:hwy4events.com` property; a working JSON key is stashed at `~/.config/hwy4/gsc-reader.json` (chmod 600, outside the repo — re-mint from the GCP console → the `gsc-reader` SA → Keys if lost, the private key only shows once at download). The daily cron `/api/agent/collect-seo` (11:00 UTC) is back in vercel.json. Unset = SEO collection is a dormant no-op (the collector, the `/admin/analytics` Search panel, and the growth memo's SEO signals all degrade to empty). The collector pulls three cuts per run (a by-date trend spine upserted on `(source, data_date)`, by-query top 500, by-page top 500 — schema in migration `20260705_seo_snapshots_enrich.sql`); `?history=NNN` (28–480) seeds the by-date spine over a longer window as a one-time backfill. The property is new, so history starts ~2026-05-27 (a 480-day pull just returns everything available).
- `GOOGLE_SEARCH_CONSOLE_SITE_URL` (optional) — GSC property to query; defaults to `sc-domain:hwy4events.com` (the Domain property). Only set to override.
- `NEXT_PUBLIC_REGION` / `REGION` (optional) — selects the active region from the config registry (`regions/`, see **Region parameterization** below). `NEXT_PUBLIC_REGION` is read by the app (inlined into client bundles), `REGION` by the `scripts/` package + GitHub Actions. **Unset resolves to `calaveras`**, so the live deployment needs neither set. An unknown slug throws at build/boot.
- `NEWSLETTER_FROM` (optional) — overrides the newsletter/transactional From address (`newsletterFromHeader()` in [lib/newsletter.ts](lib/newsletter.ts)). Unset → the active region's `emails.newsletterFrom` (Calaveras: `newsletter@hwy4events.com`). The display name is always `SITE_NAME`.
- `NEWSLETTER_REPLY_TO` (optional) — overrides the newsletter Reply-To (`newsletterReplyTo()`). Unset → the active region's `emails.replyTo` (Calaveras: `robgabel@gmail.com`).

## Region parameterization (engine/instance split)

The engine is region-parameterized so it can run as N deployments off one repo (BUSINESS-PLAN §6: Calaveras is the beachhead, the 30A/Los Gatos port is the monetization). **The full contract lives in [docs/REGIONS.md](docs/REGIONS.md)** — read it before touching anything region-shaped. In brief:

- **`regions/<slug>/core.ts`** (client-safe: brand + geo + timezone) and **`regions/<slug>/ops.ts`** (server-only: emails, SEO, schema.org, newsletter chrome) hold every region-specific value as pure data. Registries: `regions/index.ts` + `regions/ops.ts`. The env var picks the active region; unset → `calaveras`.
- Engine code reads exactly two accessors: **`lib/region.ts`** (core) and **`lib/region-ops.ts`** (ops). **Never import `lib/region-ops.ts` from a client component** — it must stay out of public bundles.
- Region modules are **pure data, zero runtime imports, relative import paths only** — they load in client bundles, the edge runtime (middleware, `/og`), and the `scripts/` tsx runner alike.
- `requireRegion("calaveras")` in [lib/cron-auth.ts](lib/cron-auth.ts) gates the region-specific crons (the 4 venue-schedule watchers + `scrape-bls` + `scrape-moose-lodge`) so they no-op on other regions — `vercel.json` is shared across deployments. No-op on Calaveras.
- `next.config.ts` image `remotePatterns` stay hardcoded (an instance file) but are pinned equal to the union of every region's `imageHosts` by `scripts/test/image-hosts.test.ts`.
- **This is an in-progress program.** Landed: the config seam + brand/domain/email/UA/timezone threading (this doc). Planned (see docs/REGIONS.md): the LLM prompt + `content/VOICE.md` split, the content packs (town/intent/holiday/faq prose), and the `scripts/lib` pipeline data (venue registry, manual-source blocklist, corridor arrays). Explicitly out of the program: `lib/tables.ts`, table/type/column renames, the Supabase project move.

## Dev workflow

- **PR workflow (standing rule, 2026-09-24):** branch from a fresh `origin/main`, open a draft PR, then a separate subagent QAs it per [.claude/skills/pr-qa/SKILL.md](.claude/skills/pr-qa/SKILL.md). Any finding goes to Rob as three options plus one recommendation and the builder waits for his pick; fix, re-QA until PASS. Rob merges, never Claude, never auto-merge.
- `npm run dev` for local development.
- Vercel auto-deploys from `main`.
- **Migrations need Rob's OK** before they are applied. The file belongs in `supabase/migrations/`.
- **Scripts typecheck root resolves `@/` (HWY-75).** `scripts/tsconfig.json` maps `@/*` to `../*`, the same directory the root tsconfig maps to `./`. Keep the two mappings aligned.
- **Tests:** `cd scripts && npm test`. CI installs root and `scripts/` dependencies, then runs `npx tsc --noEmit` in both trees ([.github/workflows/test.yml](.github/workflows/test.yml)).
- Venue registry, address backfill, static map thumbnails, and the warm/bust step: [Dev workflow](docs/subsystems/dev-workflow.md).

## Database security posture

The Supabase project is **shared** (hwy4-events + PAOS + BrainsFor), so a security-advisor run returns other tenants' findings alongside ours. Before acting on one, check whether the object is hwy4's: `home_todos_touch_updated_at`, `handle_new_user`, `search_brain_atoms`, and the `pack_downloads` / `pack_events` policies are **not** — fix those from `~/rob-ai`. Migration `20260815_security_lints.sql` closed the 15 that were ours, and three of its findings are standing rules:

- **`revoke ... from public` does not revoke from `anon` / `authenticated`.** Supabase's default privileges grant EXECUTE **explicitly** to both roles on every new function in `public`, and an explicit role grant survives a revoke aimed at `PUBLIC`. `20260621_gate0_stats_rpc.sql` and `20260621b_growth_signal_rpcs.sql` both did this and their headers claimed the functions were service-role-only; the live ACL said `{postgres=X, anon=X, authenticated=X, service_role=X}` for 7 weeks. Always name the roles: `revoke execute on function public.f(args) from public, anon, authenticated;`. Verify with `select proacl from pg_proc where proname = '…'` — the ACL, not the migration text, is the source of truth. Same trap applies to any new RPC.
- **A public form's RLS INSERT policy is a liability, not a feature, when the route uses the service-role key.** Every writer of `event_submissions` and `newsletter_subscribers` is a service-role route, which bypasses RLS entirely — so the old `with check (true)` policies granted the app nothing and granted anyone holding the (publicly-shipped) anon key a direct PostgREST write path around the honeypot, the per-email rate cap, and validation. Both are dropped; **RLS enabled with zero policies is the intended end state** for these tables, and the resulting `rls_enabled_no_policy` INFO lint is expected. Don't "fix" it by adding a policy back.
- **`hwy4_events`' `Public read using (true)` is load-bearing — do not narrow it to `visibility = 'public'`.** It reads like an over-broad policy (anon can read members-only Blue Lake Springs / Moose Lodge / Sequoia Woods rows) but the Clubs filter is applied **client-side**: [lib/events-data.ts](lib/events-data.ts) still fetches non-routine private rows on purpose, and [lib/list-visibility.ts](lib/list-visibility.ts) hides them until a club is opted in. Tightening the policy empties the Clubs view. Routine rows are excluded in the query itself (`.neq('is_routine', true)`, no private exemption, HWY-45) because their detail page 404s. The duplicate `Public can read upcoming events` policy was deleted as dead (permissive policies OR together, so it could never narrow anything).

Also: `pg_trgm` and `btree_gist` now live in the `extensions` schema, and every hwy4 function in `public` pins `set search_path = ''` with schema-qualified table references. Match that in any new function — an unpinned one is an advisor finding on the next run.

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

## Living Documents Registry

"Evergreen" is enforced here, not aspirational: every living doc has an update **trigger** (the event that forces a change) and, where one is cheap, a **drift catcher** (what surfaces staleness). Everything not in this table — the `PRD-*` / `HANDOFF-*` docs, `PLAN-seo-aeo.md`, `docs/research/*` — is a **frozen record**: each carries a `> **Status (date):** …` stamp under its title saying what shipped and where current truth lives (this map, then the subsystem doc it names). Update a stamp only when that doc's status genuinely changes; never "refresh" a record's body. A doc with no trigger and no consumer should become a record or be deleted (`docs/IMPROVEMENTS.md` was deleted 2026-07-04; its one actionable item moved into the config comment in `scripts/scrapers/hwy4-fb-discover.ts`, where someone acting on it would look).

| Doc | Tier | Update trigger | Drift catcher |
|---|---|---|---|
| [content/VOICE.md](content/VOICE.md) | 1 — mechanism-bound | deliberate voice-rule change (edit the md + `lib/voice.ts` together) | `voice-md-sync.test.ts` pins md ↔ code; `voice-lint` in CI |
| CLAUDE.md (this file) | 2 — consumer-bound | stack, standing rule, cron schedule, env var, or a new row on the subsystem map | [`scripts/test/claude-md-size.test.ts`](scripts/test/claude-md-size.test.ts) (60 KB and every relative link) |
| [Subsystem docs](docs/subsystems/architecture.md) | 2 — consumer-bound | a behavior change in that subsystem (edit that file; do not paste the detail back into this map) | the size test fails if this map does not link every file in `docs/subsystems/` |
| LESSONS.md | 2 — consumer-bound | append when a mistake earns a rule | session boot reads it |
| [BUSINESS-PLAN.md](BUSINESS-PLAN.md) | 3 — trigger-bound | a traction-gate crossing (§9), any monetization/port decision, or quarterly | the §2 "refreshed" date is the tell |
| [docs/PERSONAS.md](docs/PERSONAS.md) | 3 | evidence contradicts a persona (analytics, feedback, submissions); quarterly review (BUSINESS-PLAN §5) | — |
| [docs/LOCAL-KNOWLEDGE-BASE.md](docs/LOCAL-KNOWLEDGE-BASE.md) | 3 | new verified local knowledge; `local_facts` (DB) is authoritative for human-approved venue facts | declared a draft input, never a verified source |
| [AEO-SEO-MEASUREMENT.md](AEO-SEO-MEASUREMENT.md) | 3 | the monthly audit ritual (Slack reminder cron on the 1st) | **doc-freshness workflow** ([.github/workflows/doc-freshness.yml](.github/workflows/doc-freshness.yml), Mondays) files a GitHub issue if the month's log entry is missing after the 7th |
| [docs/CONTENT-MAP.md](docs/CONTENT-MAP.md) | 3 | any new content surface or LLM generator | header rule: reverify claims against code before leaning on them |
| [FORKING.md](FORKING.md) | 3 | any engine change a fork must replicate (new env var, cron, subsystem) | fork drift (the Eugene fork is the live test) |
| [docs/INFRA-AUDIT-2026-07.md](docs/INFRA-AUDIT-2026-07.md) | 3 (until drained) | punch-list execution | freezes to a record when the list is done |

Tiers: **1** = code enforces the doc (drift impossible). **2** = a daily consumer fails visibly when it drifts. **3** = explicit trigger + this registry. Prefer promoting a doc up a tier over adding review process; facts that code or the DB can express belong there, with the doc pointing at them (duplicated facts are how CONTENT-MAP drifted).

## UI Standards

- **Cursor:** Every `<button>` and clickable non-`<a>`/non-`<Link>` element MUST include `cursor-pointer` in its Tailwind classes. Tailwind v4 does not set `cursor: pointer` on buttons by default — the browser shows an arrow, which makes buttons look non-interactive.
- **Client bundle weight:** Avoid importing heavy libraries (date-fns, lodash, etc.) in `"use client"` components. Use `lib/date-utils.ts` for date formatting on the client. Heavy/non-critical components should be lazy-loaded with `next/dynamic`.
- **Hydration budget:** Links and navigation must work within 1–2s on mobile. Keep the client component tree shallow; prefer server components with small client wrappers (see `WeeklyBriefing.tsx` + `WeeklyBriefingTabs.tsx` pattern).
- **JSON-LD sinks:** every `<script type="application/ld+json">` must serialize via `serializeJsonLd()` in [lib/json-ld.ts](lib/json-ld.ts), never raw `JSON.stringify` into `dangerouslySetInnerHTML`. `JSON.stringify` leaves `<` unescaped, so scraped text containing `</script>` becomes stored XSS (Eugene fork security review 2026-07-02, `docs/research/2026-07-02-peter-security-handoff.md`). Locked by `scripts/test/json-ld.test.ts`.

## Content & Brand Rules

- **Voice:** local, human, slightly wry. Never corporate or AI-sounding. The full voice profile lives in [system/SOUL.md](/Users/robgabel/rob-ai/system/SOUL.md) under "Voice" — read it before drafting any user-facing copy (town pages, FAQ, briefings, blog posts).
- **Mascot:** Millie (Rob's sheepadoodle). Cartoon line-art illustrations available in /public.
- **Coverage area:** Angels Camp, Copperopolis, Murphys, Arnold, Avery, Camp Connell, Dorrington, White Pines, Bear Valley.
- **Rob's Picks** (`robs_pick: true`) are hand-curated event highlights.
- **Categories (event types — describe WHAT, not WHERE):** Live Music, Festival, Community, Hike & Walk, Kids, Wine, Games, Fine Arts (theater/plays, comedy, and visual/craft arts like pottery/painting/drawing), Other. Venue buckets (Lodge, Club, Resort) were retired in favor of activity types. **Classification is keyword-first:** `lib/categorize.ts` (`classifyEventCategory(name, description?)`) is the single source of truth — used directly by the Visit Murphys scraper + `/admin/submissions`, and as the deterministic *floor* under the LLM classifiers in GoCalaveras + the Facebook scrapers, so an LLM failure/whiff can never silently dump a batch into "other". **HWY-47 (2026-09):** `live_music_strong` is authoritative only when it matches the **title**; a description-only hit is soft (so civic/festival can win), and amenity phrasing ("and live music", "listening to live music by…") is stripped from the description score — farmers markets / car shows / Oktoberfest no longer wear a Live Music badge because a blurb mentioned music. Pass name and description as separate args (callers that still concatenate treat the whole blob as the title). Category also **self-heals on re-scrape**: `scripts/lib/dedup.ts` writes it on every update/merge (upgrade-only — a specific category is never overwritten back to "other"), fixing the old insert-only bug that let a row get permanently stuck in "other". One-time/backlog cleanup: `cd scripts && tsx backfill-categories.ts` (dry-run) / `--apply`; after a *retype* like HWY-47 use `--all-categories` (default only scans `category='other'`). Members-only events (Blue Lake Springs, Moose Lodge meetings) are gated by `visibility='private'` + `org_slug` (the Clubs filter), independent of category. Family-friendliness is a stored tag (`family_friendly` + `family_friendly_locked`, written from `resolveFamilyFriendly`), not a category those rows have to win — see the Kids quick-filter bullet above.

### Voice rules specific to Hwy4Events copy

These reinforce SOUL.md and are non-negotiable for any user-facing copy on this site:

> **The machine-checkable version of these rules is [content/VOICE.md](content/VOICE.md)** — the voice constitution. It is mirrored in [lib/voice.ts](lib/voice.ts) (`VOICE_MD`, pinned identical by `scripts/test/voice-md-sync.test.ts`) and injected into **every** LLM generator via `withVoice()` (briefing, weekend briefing, newsletter, description extraction, venue blurbs, town content). `scripts/voice-lint.ts` enforces the lint-able subset against static content in CI. **Any new content surface (prompt or page) must inject `withVoice()` / pass `voice-lint` before launch.**

- **No em dashes.** SOUL.md rule. Use commas, periods, semicolons, parentheses. The Opus draft script at [scripts/draft-town-content.ts](scripts/draft-town-content.ts) enforces this in the system prompt and via post-generation check.
- **Don't generic-ify the geography.** Each town has specific venues, owners, landmarks, and character. Use them by name. "Newsome Harlow's fire pit" beats "a local winery's outdoor seating."
- **Verify cadence and hours claims.** Statements like "open every day" or "live music every Thursday" go stale and get quoted forever. Either link to the venue's site, hedge ("often", "most weeks"), or omit. Rule was added after the Murphys Irish Pub "7 days a week" hallucination on 2026-05-25. The knowledge base ([docs/LOCAL-KNOWLEDGE-BASE.md](docs/LOCAL-KNOWLEDGE-BASE.md)) is a draft input, not a verified source.
- **Named entities over generic descriptors.** Real owners (Chuck Hovey, River Klass, Siri & Rich Gilpin), real venues, real numbers. This is also the AEO win.
- **Q&A blocks should mirror real search queries.** First sentence of the answer fully resolves the question. Lift-able by answer engines.
- **The conference-dinner gut check:** would Rob actually say this out loud to another operator at a conference dinner? If it sounds like a marketing intern wrote it, kill the line.
- **Never reference internal tooling in public copy.** Words like "the knowledge base", "my notes", "my sources", "public info", or "the data" are plumbing — they mean nothing to a reader and break the neighbor voice. When there isn't much to say, punt like a human: "I've never been there" (only if true), "I don't have much on it yet", then point somewhere useful (the venue's site, the event details, or invite the reader to send the scoop). Enforced in the venue-blurb generator ([scripts/draft-venue-blurbs.ts](scripts/draft-venue-blurbs.ts)) via a hard prompt rule + banned-phrase check.

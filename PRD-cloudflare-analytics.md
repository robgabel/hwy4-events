# PRD: Cloudflare Analytics Read API

**Status:** Shipped 2026-06-03. Phases 1–3 live in production — read path (`/api/analytics`), nightly persistence (`/api/snapshot-analytics` → `analytics_daily`, 30-day history backfilled), and the admin **Growth tab** (`/admin/analytics`) surfacing traffic + answer-engine (AEO) referral counts. Remaining: fold GSC/search into the Growth tab once `seo_snapshots` has data.
**Created:** 2026-06-01
**Owner:** Rob
**Related:** [PRD-agent-cockpit.md](PRD-agent-cockpit.md) — this is the cockpit's **Growth/traffic collector**: the chief-of-staff reasoner reads `analytics_daily`, and the `/admin/analytics` page below *is* the cockpit's Growth tab (same surface). [AEO-SEO-MEASUREMENT.md](AEO-SEO-MEASUREMENT.md), `/api/aeo-audit-reminder`

## Problem

hwy4events already *emits* Cloudflare Web Analytics data. [`app/layout.tsx`](app/layout.tsx) injects the RUM beacon via [`components/CloudflareAnalytics.tsx`](components/CloudflareAnalytics.tsx) using `NEXT_PUBLIC_CF_BEACON_TOKEN`. There is no **read path** back out, so traffic data can only be eyeballed in the Cloudflare dashboard. We want to read it programmatically: surface it on the site, persist a durable history, and auto-populate the answer-engine referral numbers the measurement plan already calls for.

## Key finding that shapes scope

hwy4events.com is served **direct from Vercel and is not proxied through Cloudflare as a zone** (verified 2026-06-01: `curl -sSI https://hwy4events.com` returns `server: Vercel` with no `cf-ray`). Consequences:

- There is **no zone-level analytics** for this domain (no requests, bandwidth, cache ratio, firewall/threat, or status-code data). Those datasets only exist for orange-clouded (proxied) domains.
- The entire Cloudflare "dashboard" for this site is the **Web Analytics (RUM)** product, populated by the JS beacon.
- Therefore "read web analytics" and "read dashboard data" are the **same single integration**: the **GraphQL Analytics API**, RUM datasets.

If we ever want zone-level data, the domain would have to move its DNS to Cloudflare and be proxied, which is a larger infra change and out of scope here. Recommendation: do not do this just for analytics.

## What is readable

Via `POST https://api.cloudflare.com/client/v4/graphql`:

| Dataset | Gives us |
|---|---|
| `rumPageloadEventsAdaptiveGroups` | pageviews (`count`), visits (`sum.visits`), and dimensions: `requestPath`, `refererHost`, `countryName`, `deviceType`, browser/OS. The core dataset. |
| `rumPerformanceEventsAdaptiveGroups` | Core Web Vitals (LCP, INP, CLS, TTFB). Optional, useful as an SEO page-experience signal. |

Both are **account-level** queries filtered by `siteTag`, with adaptive sampling.

## Why this is worth building

[AEO-SEO-MEASUREMENT.md](AEO-SEO-MEASUREMENT.md) already specifies a *manual* monthly task: watch Cloudflare Analytics for referral traffic from `perplexity.ai`, `chat.openai.com`, `gemini.google.com`, `copilot.microsoft.com`, `bing.com`. The `/api/aeo-audit-reminder` cron nags us to do it by hand. Reading the API lets that number **populate itself** from the `refererHost` dimension. This is the highest-leverage use case because it closes the loop on measurement we have already committed to, rather than building a generic dashboard for its own sake.

**Honesty caveat (bake into any UI/label):** Google AI Overviews referrals still arrive as `google.com` (indistinguishable from organic), and many AI clickthroughs arrive as "direct" with no referrer (user copied the link out of a chat). So CF referrer data is a **lower bound** on answer-engine traffic, not a complete count. Google Search Console covers the Google side. Label it as a directional signal, never as a precise total. (Consistent with the site's accuracy-over-hype voice rules.)

## Goals

- One typed, reusable client for the Cloudflare GraphQL RUM data.
- A durable daily history in Supabase, independent of Cloudflare's limited retention.
- Auto-computed answer-engine referral counts feeding the AEO measurement ritual.
- An internal admin view of traffic, top pages, referrers, and geography.

## Non-goals

- Zone-level analytics (not available without proxying the domain; see above).
- Replacing Google Search Console or Bing Webmaster Tools (those remain the search-side source of truth).
- A public-facing analytics page. This data is internal.
- Paid analytics tooling. The whole measurement design is $0.

## Architecture (phased)

Conventions mirrored from the existing codebase: pure `lib/*` helpers like [`lib/geocode.ts`](lib/geocode.ts); cron routes authed by `CRON_SECRET` bearer like [`app/api/check-events/route.ts`](app/api/check-events/route.ts); scripts run via `npx tsx` using `scripts/lib/supabase-admin.ts`; migrations under `supabase/migrations/` with RLS enabled.

### Phase 0 — Prereqs (manual, no code, ~10 min)

1. Create a Cloudflare API token scoped to **Account → Account Analytics → Read** (confirmed against CF docs). Nothing broader.
2. Capture the **Account ID** and the Web Analytics **site tag**. The site tag is distinct from the beacon token; fetch it once via `GET https://api.cloudflare.com/client/v4/accounts/{account_id}/rum/site_info/list` (match the entry for hwy4events.com).
3. Add to Vercel env (and local `.env.local`):
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_WEB_ANALYTICS_SITE_TAG`

### Phase 1 — Read path + proof

- **`lib/cloudflare-analytics.ts`** — single source of truth for the GraphQL queries. Modeled on `lib/geocode.ts` (pure functions, `fetch`, typed returns, no inline env reads; the calling route/script passes credentials in or the lib reads `process.env` at the edge like other server libs). Exported functions, each taking `{ since, until }`:
  - `getTotals` (pageviews, visits)
  - `getTopPages`
  - `getReferrers`
  - `getGeography`
  - `getDevices`
  - `classifyAiReferrals(referrers)` — buckets `refererHost` into answer engines (Perplexity, ChatGPT, Gemini, Copilot/Bing, Claude).
- **`scripts/cf-analytics-smoke.ts`** — run via `npx tsx scripts/cf-analytics-smoke.ts`. Pulls the last 7 days, prints it, and **introspects the live GraphQL schema** to lock the exact dimension field names (browser/OS field names vary by CF schema version). De-risks the queries before anything depends on them. Interactive exploration also available at `https://dash.cloudflare.com/?to=/:account/graphql` (GraphiQL).
- **`app/api/analytics/route.ts`** — server-only JSON endpoint, gated by the same `CRON_SECRET` bearer check as `check-events`. Accepts a date range, returns the aggregated JSON. Proves end-to-end read.

### Phase 2 — Persistence (durable history)

- **Migration** `supabase/migrations/2026XXXX_add_analytics_daily.sql` creating `analytics_daily` (schema below). RLS enabled, **no public-read policy** (internal data, service-role only). This is a deliberate departure from the public-read site tables; analytics is not public.
- **`app/api/snapshot-analytics/route.ts`** — daily Vercel cron (add to [`vercel.json`](vercel.json)) that writes yesterday's row. Idempotent on `date` (upsert). Authed by `CRON_SECRET`.
- **Why persist:** Cloudflare keeps **unsampled** RUM for only ~7 days (older data is aggregated to ~10%), and the GraphQL adaptive API we read serves only **~3 weeks** of history for this site (verified 2026-06-19: data present at 21 days back, gone by 25; the dashboard's "6 months" is heavily-sampled aggregate, *not* what the API returns). The daily snapshot is the system of record. A nightly capture of *yesterday* always lands inside the 7-day unsampled window, so the stored history is full-fidelity; a broken cron, though, loses fidelity within a week and data within ~3 weeks — hence the freshness alarm (below).

### Phase 3 — Surface it

- **`app/admin/analytics/page.tsx`** — server component in the existing `/admin` area (see [`app/admin/verification/page.tsx`](app/admin/verification/page.tsx) for the pattern): pageviews trend, top pages, top referrers, geography, and a dedicated **answer-engine referrals** strip.
- **AEO auto-fill** — compute the monthly answer-engine referral counts and optionally include them in the `/api/aeo-audit-reminder` Slack post, so the reminder ships *with* the numbers instead of asking a human to look them up.
- *(Optional)* weekly Slack traffic digest reusing `SLACK_WEBHOOK_URL`.
- *(Later)* feed "most-viewed events this week" into the briefing generator / Rob's Picks selection.

## Data model

```sql
create table analytics_daily (
  date          date primary key,
  pageviews     integer not null default 0,   -- true count = sum(count * sampleInterval)
  visits        integer not null default 0,
  top_pages     jsonb not null default '[]',  -- [{ path, pageviews, visits }]
  referrers     jsonb not null default '[]',  -- [{ host, visits }]
  countries     jsonb not null default '[]',  -- [{ country, visits }]
  devices       jsonb not null default '[]',  -- [{ type, visits }]
  ai_referrals  jsonb not null default '{}',  -- { perplexity, chatgpt, gemini, copilot, claude } derived from referrers
  synced_at     timestamptz not null default now()
);

alter table analytics_daily enable row level security;
-- Intentionally NO public-read policy: internal data, service-role only.
-- (Satisfies the project rule that RLS is enabled on every new table.
--  Deny-by-default is correct here; the admin page reads via the service role.)
```

## Technical reference

- **Endpoint:** `POST https://api.cloudflare.com/client/v4/graphql`
- **Auth header:** `Authorization: Bearer $CLOUDFLARE_API_TOKEN`
- **Token permission:** Account → Account Analytics → Read
- **Core query shape:**
  ```graphql
  query Rum($acct: String!, $site: String!, $start: Time!, $end: Time!) {
    viewer {
      accounts(filter: { accountTag: $acct }) {
        rumPageloadEventsAdaptiveGroups(
          filter: { AND: [{ datetime_geq: $start }, { datetime_leq: $end }, { siteTag: $site }] }
          limit: 25
          orderBy: [count_DESC]
        ) {
          count
          sum { visits }
          avg { sampleInterval }
          dimensions { requestPath refererHost countryName deviceType }
        }
      }
    }
  }
  ```
- **Sampling:** these are *adaptive* groups. True counts = `count * sampleInterval`. At hwy4events' traffic level `sampleInterval` is almost always 1, so values match the dashboard, but the client multiplies anyway so numbers never drift as traffic grows.
- **Site tag lookup:** `GET https://api.cloudflare.com/client/v4/accounts/{account_id}/rum/site_info/list`.

## Security

- API token is least-privilege (Account Analytics: Read only).
- All routes gated by `CRON_SECRET` bearer, matching existing crons.
- `analytics_daily` is RLS-enabled with no public policy (service-role access only). Never expose analytics on the public site.
- No PII: RUM is privacy-first and aggregate; we store only aggregates.

## Rollout / sequencing

- Phase 0 is a manual prereq (Rob creates the token).
- Phases 1 and 2 are the real work and are small: one lib, one route, one script, one migration, one cron. Roughly a focused afternoon.
- Phase 3 lands incrementally.
- Recommended lead deliverable: **AEO auto-fill on top of Phases 1 and 2**, because it is aligned with measurement already committed to in AEO-SEO-MEASUREMENT.md.

## Implementation log (2026-06-02)

Phase 1 + 2 built and smoke-tested against live data:

- `lib/cloudflare-analytics.ts` — typed RUM client (totals, top pages, referrers, geography, devices, browsers, AI-referral classifier, date-range helpers). Single source of truth for the queries.
- `app/api/analytics/route.ts` — ad-hoc read, `?days=` (1..92), CRON_SECRET-gated.
- `app/api/snapshot-analytics/route.ts` — daily persistence, idempotent upsert on `date`, `?date=YYYY-MM-DD` backfill.
- `supabase/migrations/20260602_add_analytics_daily.sql` — `analytics_daily` table (RLS on, explicit deny-all policy; added a `browsers` jsonb column beyond the original schema sketch).
- `scripts/cf-analytics-smoke.ts` — standalone credential/connectivity checker (runs in the `scripts/` workspace, which has `tsx`).
- `vercel.json` — `/api/snapshot-analytics` cron at 09:00 UTC daily.
- Env: `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_WEB_ANALYTICS_SITE_TAG` set in Vercel **Production** and appended to the main checkout `.env.local`. Site tag: `c2807310a1f9469c8955db02d84f7fce`.

**Token lesson:** the working token is an *account-owned* token (minted from the account-scoped `/{account_id}/api-tokens` page). Account-owned tokens return code 1000 "Invalid API Token" against `/user/tokens/verify` — a false negative, because that endpoint only knows *user* tokens. Validate against the GraphQL endpoint instead. (Now documented in CLAUDE.md's env section.)

### Update (2026-06-19) — retention verified + freshness alarm

- **Retention corrected.** Live probe + CF docs: unsampled RUM is kept only **7 days** (then aggregated to ~10%), and the GraphQL adaptive API we read serves only **~3 weeks** of history for this site (data present at 21 days back, gone by 25). The earlier "~6 months" was the *dashboard's* sampled-aggregate view, not the API. Operationally: the snapshot is the system of record, and a broken cron loses fidelity within a week / data within ~3 weeks.
- **Freshness alarm shipped** in [`/api/check-events`](app/api/check-events/route.ts): it now reads the latest `analytics_daily` row and Slack-alerts if the snapshot is ≥2 days behind (a missed run) or the latest captured day has 0 pageviews (the CF read silently failed). No new cron — folded into the existing daily audit (surfaced in its `summary.analytics`). Closes the one gap that made the durable-history design a silent single point of failure.
- **Pending:** the 24 backfilled all-zero rows (2026-05-04…05-27, from before the beacon had data) are cosmetic noise in trend averages; a one-line `DELETE FROM analytics_daily WHERE pageviews = 0 AND visits = 0` cleans them up. The automated delete was blocked by the prod-write safety guard, so it awaits a manual run.

### Remaining steps
- [x] **Migration applied (2026-06-02) via MCP.** Correction to an earlier wrong assumption: hwy4events is **not** a separate Supabase project. Its `NEXT_PUBLIC_SUPABASE_URL` points to `uzediwokyshjbsymevtp` — the shared rob-ai / PAOS project (org "Gabel.Global", labeled "Claude Code" in Supabase), which the MCP reaches. Applied with `apply_migration`; verified 10 columns + RLS + deny-all policy; the security advisor surfaced no new findings for `analytics_daily` (the other lints are pre-existing).
- [ ] **Vercel Preview env** (optional) — Production is set; Preview adds kept returning the CLI hint. Add via the Vercel dashboard if PR-deploy analytics is wanted.
- [x] **Phase 3 surface — shipped 2026-06-03.** `app/admin/analytics/page.tsx` (nav label "Growth", beside the cockpit's "Today"). Reads `analytics_daily` only (no live CF calls): 7d/30d stat strip, 14-day pageviews trend, **answer-engine referral counts** (the AEO auto-fill, with the lower-bound caveat), top pages/referrers/countries/devices. Matches the admin inline-style system; imports `CountRow` from `lib/cloudflare-analytics.ts`.
- [x] **Admin auth — resolved.** Main shipped `middleware.ts` (Basic Auth on `/admin/:path*`, user `rob`) in the agent-cockpit work, so the Growth tab is gated automatically.
- [ ] **GSC/search on the Growth tab.** `seo_snapshots` exists but is empty (cockpit's collect-seo hasn't produced data). The page cross-links to Today for now; fold a search section in once GSC data lands.

### Resolved
- [x] RUM dimension field names — confirmed live: `requestPath`, `refererHost`, `countryName`, `deviceType`, `userAgentBrowser`.
- [x] Cron time — 09:00 UTC daily (captures the complete prior UTC day; clear of the other crons in `vercel.json`).

# LESSONS.md

Running log of hard-won lessons, decisions, and gotchas. Each entry is dated and
scoped so a future session (or person) skips the re-derivation. Newest first.

---

## 2026-06-09 — Growth-agent pivot, host wedge, analytics measurement

### Strategy

- **Automating the back office isn't the bottleneck; demand is.** The business is ~75–80% zero-person on data ops, but the agent layer was pointed *inward* (queue triage). The high-leverage move was repointing the reasoner *outward* to demand generation. Lesson: before building more ops automation, ask "does this move the North Star (Weekly Returning Residents)?" If not, it's motion, not progress.
- **Split the funnel before optimizing it.** "Get the site to visitors" is two different problems: (1) people *already coming* (booked the Airbnb — high intent, easy, the host/Karen wedge) vs (2) people who *don't know the corridor exists* (Bay Area cold — hard, slow, AEO/editorial). Win #1 first; it's the cheap, measurable proving ground. Don't try to *create* demand for the towns — *intercept* the demand that already exists for their known draws (wine, Big Trees, Bear Valley).
- **The owned audience is the asset.** The newsletter is the one channel Google/FB can't take away. Treat list growth and composition as first-class, not a compliance checkbox. A double opt-in confirmation step is a real, measurable signup leak at small scale.
- **The cockpit/playbook is more valuable than any single instance.** Keep everything region-parameterized; the portable system is the actual product (the 30A port is the monetization).

### Measurement honesty (the recurring theme)

- **WRR can't be measured without a persistent visitor id.** `site_events` only has a per-session `session_id`, so "returning resident" is impossible to compute directly. We use *weekly distinct local sessions* as a labeled-directional proxy. Don't dress a proxy up as a headcount.
- **First-party returning id is build-not-buy.** Recommended: a `localStorage` UUID sent in the existing Gate-0 beacon (cookieless, no consent-banner friction, data stays ours). PostHog is the only turnkey tool that actually measures returning individuals; Plausible/Fathom/Vercel are deliberately cookieless and *cannot*. It's a per-device proxy (ITP/incognito reset it) — still label it directional.
- **Geo-at-signup has a blind spot exactly where it matters.** Classifying a newsletter signup local/visitor from IP is cheap and useful, BUT a visitor signing up from *inside their rental* geolocates as `local` — undercounting the very visitors the host kit targets. That's why `src` attribution (e.g. `?src=host`) is the complementary channel-truth signal. Use both; lean on source for channel decisions.
- **Privacy: store the class, never the IP.** For a row tied to an email (PII), store only `visitor_class` (local/visitor/unknown), not city/region — don't attach a location to a named person. (Anonymous `site_events` rows can hold coarse geo; named subscriber rows shouldn't.)
- **Don't confidently state a direction you haven't measured.** I claimed "site_events visitors run lower than Cloudflare," then the data showed it's *not* that simple: a third-party analytics beacon (`cloudflareinsights.com`) gets ad-blocked (pulls Cloudflare *down*), while our first-party `/api/track` dodges blockers (pulls site_events *up*) — but our beacon fires post-hydration via `sendBeacon` so it loses fast-bouncers (pulls it down). Net is genuinely uncertain. Lesson: measure before asserting; correct yourself out loud when the data disagrees.

### Technical / architecture

- **Cloudflare `analytics_daily` is UTC-only and can't be re-bucketed.** The snapshot cron stores one rollup row per *full UTC day* (`datetime_geq T00:00:00Z … T23:59:59Z`) — no sub-day grain is kept. So you can normalize a series to Pacific *only* if you hold the raw timestamps (newsletter `confirmed_at`, `site_events.created_at` do; Cloudflare doesn't). To align two series cheaply: bucket *both* to UTC (the only common denominator with no migration). Pacific-native requires switching the visitor source to `site_events`.
- **Derive history on the fly before adding a snapshot table.** Daily newsletter signups + running total come straight from `created_at`/`confirmed_at`/`unsubscribed_at` on `newsletter_subscribers` — no `newsletter_daily` table needed until you either hard-delete subscribers (GDPR) or scale past ~tens of thousands. KISS: don't add a snapshot table for data the source rows already imply.
- **One discriminator column beats a new table for a second reasoner.** The weekly growth memo shares `agent_runs` with the daily chief-of-staff via a `run_type` column; each surface filters its own type. Reused all the token/status/context plumbing. (Remember to scope the *existing* reader — `/admin/today` had to add `.eq('run_type','chief_of_staff')` or growth rows would leak in.)
- **Give the agent memory or it re-guesses.** A read-only memo that invents "experiments" every week is a dashboard, not an agent. The `growth_experiments` table (logged hypotheses + metrics) fed into the signal pack — with a prompt rule to report a read on each *logged* one and never invent — is what makes it accumulate a track record.
- **Single source of truth for derived stats.** `lib/newsletter-stats.ts` is consumed by both the Growth tab and the memo context, so they can't disagree (same discipline as `isSameEvent`). When adding it, *replace* the ad-hoc queries (dropped 7 head-count calls), don't run both.
- **Reuse the proven UX pattern.** The growth memo's draft copy reuses the submission-reply loop's copy-button + Gmail-deep-link. Outward actions stay a human click *by construction* — a read-only agent that drafts is the safe default.

### Process / environment

- **Apply the migration before the code deploys.** Additive columns (`run_type`, `signup_source`, `visitor_class`) are backward-compatible (old code ignores them, new inserts get defaults), so applying to the shared prod DB from a feature branch *first* is safe and avoids an ordering race. Verify referenced columns against the live schema (`list_tables`/`execute_sql`) when they came from docs, not a migration you read.
- **"Push to prod" = fast-forward `main`** (Vercel auto-deploys from `main`). `main` drifts constantly here — always `git fetch origin main`, merge, re-`tsc`, then push. A failed build doesn't promote, so the downside of a bad push is low, but check the Vercel deploy log.
- **This sandbox can't run a full `next build` (Google Fonts fetch is blocked) and intermittently kills `next dev`.** Don't treat that as a code failure. Validation hierarchy that actually works here: `tsc --noEmit` (types/imports) + live-schema checks via Supabase MCP + (when dev cooperates) a single route/page render. A route handler (e.g. an OG image) renders without the Google-font layout; admin pages need `ADMIN_PASSWORD` set and Basic auth (`rob:<pw>`).
- **`pkill`/`kill` in a Bash step returns 144 (128+SIGTERM) and masks the real result.** Put cleanup in its own command, or read the output file separately.

# LESSONS.md

Running log of hard-won lessons, decisions, and gotchas. Each entry is dated and
scoped so a future session (or person) skips the re-derivation. Newest first.

---

## 2026-06-19 — Cloudflare analytics retention + snapshot freshness alarm

### Cloudflare Web Analytics retention (the headline gotcha)

- **The dashboard's "6 months" is *sampled aggregate*; the GraphQL adaptive API we actually read (`rumPageloadEventsAdaptiveGroups`) serves only ~3 weeks — and unsampled data just 7 days.** Don't take a dashboard's history depth as its API's retention; they're different products. The `analytics_daily` PRD had assumed "~6 months" and was wrong everywhere. Verify empirically: probe single-day totals at increasing offsets (3/7/14/21/25/30/45/90d) and watch where it flips to "no data" (here: present at 21d, gone by 25d).
- **A backfill recovers only what's still inside the window; older days come back as silent zero rows, not errors.** The 2026-06-03 30-day backfill wrote 24 all-zero rows for dates CF had already aged out — those then masquerade as real "0 pageviews" days and drag trend averages. A 0 from a snapshot backfill means "no data available," not "no traffic."
- **Retention is unmeasurable while the source is younger than its window.** When the beacon only started ~3 weeks ago, "where data stops" can't separate the retention edge from the data-start edge. Flag the confound; don't assert a number you can't isolate.

### Architecture

- **A durable snapshot of a short-retention upstream is a silent single point of *permanent* data loss without a freshness alarm.** "It's built and the cron's been firing" is necessary, not sufficient: if the snapshotter breaks quietly you lose days you can never backfill (the upstream already forgot them). Beating short retention is the entire point of the snapshot — which is exactly what makes monitoring non-optional. Fix here: a freshness check (latest row ≥2 days behind **or** latest day = 0 pageviews) folded into the **existing** daily audit (`/api/check-events` → Slack), not a new cron. The "latest day = 0" arm catches the nastiest case — the cron "succeeds" but the upstream read silently returned nothing.
- **Before planning a build, check whether it already exists and *works*.** The ask was "store CF analytics daily — we might already"; the storage was fully built, deployed, and running with zero gaps. The real gap was the missing alarm, not the storage. Investigate live state (DB rows, cron `synced_at`, gap query) before writing a plan — the plan shrank from "build it" to "monitor it."

### Process

- **The prod-write safety classifier blocks DELETEs on shared prod tables even when the user approved them in-chat.** A `DELETE FROM analytics_daily …` via the Supabase MCP was denied (the classifier can't see conversational authorization). Don't retry the same path — hand the user the one-line SQL to run themselves. Default to treating destructive prod writes as human-run; reserve MCP writes for additive/idempotent ops.
- **For a one-off API probe, load only the keys you need from the *primary* checkout's `.env.local` (worktrees don't inherit it) and run a throwaway `tsx` script from `/tmp`** (keep it out of the repo): `set -a; eval "$(grep -E '^CLOUDFLARE_…=' …/hwy4-events/.env.local)"; set +a; scripts/node_modules/.bin/tsx /tmp/probe.ts`.

---

## 2026-06-12 — "Submit form keeps asking for a URL" (broken-URL-field fix + flyer attach)

### The bug

- **A form that "keeps rejecting" an input is usually the browser's native HTML constraint, not your server.** Feedback said the submit form "kept asking for URL even though I entered our website." The field was *optional* and the server never validated it — the culprit was `<input type="url">`, whose native validation **requires a scheme**, so a bare domain (`mywinery.com`) blocked submit. Check the HTML constraint (`type="url"`/`type="email"`/`pattern`) before hunting server code. Fix: accept what people actually type — `type="text"` + `inputMode="url"`, then normalize (prepend `https://` when no scheme) on both the client (`onBlur`) and server.
- **Put the normalize rule in one shared pure fn (`lib/url.ts` `normalizeUrl`)** so the field and the route can't disagree about what a bare domain means — same discipline as `isSameEvent`/`generateDedupKey`.

### Adding a file upload to an existing JSON form

- **To attach a file, switch the form from JSON to multipart and the route from `request.json()` to `request.formData()`.** On the client, build a `FormData` and **don't set `Content-Type`** — the browser sets the multipart boundary itself. The text fields come back as strings via `formData.get(k)`.
- **Reused existing infra instead of adding any.** `event_submissions.poster_url` (column) and the public `event-posters` Storage bucket already existed, plus the validated upload pattern (JPG/PNG/WebP, 4MB to stay under Vercel's 4.5MB body cap, orphan-cleanup on insert failure) from `/api/submit-poster`. No migration, no new bucket.
- **Two poster-hosting paths, two contexts — don't conflate them.** The 2026-06-10 lesson said "no `SUPABASE_SERVICE_ROLE_KEY` in the web env → host posters in `public/event-posters/`." That's about *me* uploading during a session. This flyer flow uploads from the **deployed serverless function**, which *does* have the service-role key — so it writes to the Storage bucket at runtime. Session-time curation → repo `public/`; runtime user upload → Storage bucket.
- **Pin a human-supplied flyer on publish: `image_url` + `poster_locked=true`.** Same semantics as the organizer poster-swap (PRD §9) — re-scrapes won't overwrite it, and it's shown untouched (no Hwy4 lockup, since it's the organizer's own art).

### Ops / comms

- **Feedback replies must not go *from* the forwarder address.** The "New Hwy4Events feedback" email arrives from `newsletter@hwy4events.com`, an **inbound-only ImprovMX forwarder** — replying to it bounces `550 5.1.3 Relay not permitted`. Rob's reply to the submitter never delivered. Reply to the submitter's real address (it's in the feedback body) from a real sending account, not by hitting "reply."

---



### Data

- **`hwy4_events.category` stores DB slugs, not the display names — and a CHECK constraint rejects the wrong token.** The "Community" bucket is `civic`; also `live_music`, `hike_walk`, `fine_arts`. Inserting `'community'` fails `hwy4_events_category_check`. Pull the exact allowed set before inserting: `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='hwy4_events_category_check'` → `live_music | festival | civic | hike_walk | kids | wine | games | fine_arts | other`.
- **Even a one-off hand-curated event gets a seed script, not just a raw insert.** The Arnold Library is scraper-blocklisted (`manual-sources.ts`), so a script owns the row like the weekly Storytime — but a single dated workshop needs no recurrence expansion (one row, no `expandWeekly`). Reuse the shared `generateDedupKey(name, date, town)` so a future scrape/community-submit of the same event collides instead of duplicating.
- **Compute the dedup_key locally with `tsx -e` — it's a pure function, no DB/env needed.** `npx tsx -e "import {generateDedupKey} from './lib/event-identity.ts'; console.log(generateDedupKey(name,date,town))"` gives the exact key to hand to a raw `INSERT … RETURNING`.

### Posters

- **`public/event-posters/` is an established repo-hosting pattern for posters — not only the Supabase `event-posters` Storage bucket.** Five posters already live there; `image_url` is `https://hwy4events.com/event-posters/<file>.jpg`. This is the path that works from the web environment, where there's **no `SUPABASE_SERVICE_ROLE_KEY`** to upload to Storage (the MCP does SQL only, not binary objects). Commit the file, set `image_url` + `poster_locked=true`.
- **A DB-only poster change is live instantly; a repo-hosted image is NOT live until `main` deploys.** Setting `image_url` via `execute_sql` updates prod immediately, but the JPG it points at 404s until the `public/` commit reaches `main` (Vercel build). So "the row is updated" ≠ "the poster shows" — the image needs the push to prod too.
- **Organizer-supplied art is shown untouched (no Hwy4 lockup/QR).** Per `PRD-event-poster-loop.md` §9, we only brand posters *we* generate; a real flyer (here HHSA/Senior Planet) goes in as-is.

### Process

- **Splitting "push to prod" into two senses bit me.** The user's first "push to prod" I read as push-the-branch; they meant *deploy to prod* (fast-forward `main`). The branch DB writes were already live, but the committed poster wasn't. When someone says "push to prod," default to fast-forwarding `main` unless the branch isn't ready.

## 2026-06-09 — Featuring a curated event (Hot Copper Car Show, America's 250th)

### Data / scrapers

- **Hand-edits to a scraped event's `name` or times get reverted on the next scrape — there is no `name_lock`/`time_lock`.** `scripts/lib/dedup.ts`'s matched-row update rewrites `name`, `venue_name`, `start_time`, `end_time`, `event_url`, `address`, `town` from the source whenever *any* field differs (`changed=true`); only `price`/`description`/`image_url` have per-field locks. To freeze a hand-corrected row, add it to the scraper blocklist `scripts/lib/manual-sources.ts` (`isManuallyManagedEvent` — substring match against `name + venue_name`). It can be scoped by **event-name** substring to freeze one event without freezing others at the same venue: blocklisting `"hot copper car show"` left the July 4 "Stars & Stripes" at the *same* town square scraping normally.
- **Aggregator titles carry real typos that flow into the slug — don't assume it's our bug.** GoCalaveras genuinely published "Hot Copper Car Show **Show**" (slug `hot-copper-car-show-show`, with a 23:50 placeholder end time). Check the source slug before "fixing" anything, and remember the DB correction won't survive a re-scrape without the blocklist above.

### Organizer / canonical links

- **Verify an organizer URL actually resolves over the scheme you store — vanity domains often only http-forward.** `hotcoppercarshow.com` has *no* HTTPS listener (the connection times out) and only http-301s to `copperopolislions.org`. Storing `https://…hotcoppercarshow.com` would have been a dead link that never loads (and a browser forcing HTTPS breaks an http-only link too). `curl -sIL` each candidate (http/https, apex/www) and store the final resolved **https** destination — here, the Lions site directly.

### Featured-event UI

- **Extending a themed treatment to a new occasion: hunt for hardcoded occasion strings.** `components/PatrioticEventCard.tsx` hardcoded a "July 4th" pill; a June "America's 250th" feature needed it parameterized (`patrioticCardTag`). The registry `lib/featured-events.ts` keys treatments off stable identity (event `id` / `org_slug`) so they survive title/date edits — reuse that, but the *rendering* components can still hide date-specific copy.
- **`robs_pick` is card-styling + dataset-inclusion, not homepage prominence.** There's no "Rob's Picks" rail. `lib/events-data.ts` only (a) keeps `robs_pick` rows past the 60-day homepage horizon and (b) the card adds a badge / Old-Glory skin. A pick 11 days out is *not* pinned to the top — it appears in date order as the day nears. Don't promise "front-page" placement without building a rail.

### Process

- **A fresh `.claude/worktrees/*` has no `node_modules` and no `.env.local`.** To run the preview: `npm install` at the worktree root + copy `.env.local` from the primary checkout (it's gitignored, so worktrees never inherit it). Without it the dev server 500s on every render with `Missing NEXT_PUBLIC_SUPABASE_URL` — an env gap, not a code bug. (`next dev` + a real page render worked fine here once the env was present.)

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

# Forking Hwy4Events for a New Region

A complete guide to standing up your own copy of this site for a different
place (written for the Eugene, Oregon fork, but it applies to any region).
The architecture is deliberately region-parameterized: almost everything you
need to change is **data and copy**, not engine code. Plan on roughly a
weekend to get a skeleton site live, then an ongoing trickle of work building
your local source list, which is the actual product.

> **The engine/instance boundary is [docs/REGIONS.md](docs/REGIONS.md).** A
> region-parameterization program is migrating the region-specific values into
> an explicit `regions/<slug>/` config layer (brand/domain/email/UA/timezone
> done; prompts/voice, content packs, and scraper data to follow). As it
> lands, "edit these hardcoded files" below becomes "fill in your region
> config" — check REGIONS.md for what has moved. Until then this guide's
> file-by-file list stays accurate for the parts not yet migrated.

What you are getting: a Next.js 16 events site with automated scraping,
LLM-written daily briefings, a weekly newsletter with a human veto gate,
four-layer event deduplication, venue pages fed by Google Places, poster
generation, community submissions with AI triage, and an admin cockpit.
What you are not getting: any of the original site's API keys, database,
subscriber list, or event data. You stand up your own everything. This guide
is the map.

> **A note on what's safe here:** this repo's git history contains no
> secrets — no `.env` files were ever committed and all credentials flow
> through Vercel / GitHub Actions environment variables. Forking the repo
> with full history is fine.

---

## Phase 0 — Accounts you'll need

Sign up for these first; everything else hangs off them.

| Service | Used for | Required? | Cost reality |
|---|---|---|---|
| **GitHub** | Code + the daily scraper (runs as an Action) | Yes | Free |
| **Vercel** | Hosting + cron jobs | Yes | **Pro ($20/mo)** — see the cron note below |
| **Supabase** | Database + poster image storage | Yes | Free tier is fine to start |
| **Anthropic** | Briefings, newsletter, triage, extraction agents | Yes | Pay-as-you-go; this site's workload is a few dollars/month |
| **Firecrawl** | The config-driven venue scrapers + bot-walled sources | Yes (for scraping) | Free tier to start; paid (~$16/mo) once you have many sources |
| **Resend** | Newsletter sending | Yes (for the newsletter) | Free to 3,000 emails/mo |
| **Google Cloud** | Places API (venue facts), Search Console API (SEO collector) | Places: yes; GSC: optional | Free credit covers the weekly venue sync |
| **Slack** | Ops alerts (audits, agent digests, schedule watchers) | Optional but very useful | Free |
| **Cloudflare** | Web Analytics (RUM) | Optional | Free |
| **Apify** | Facebook event discovery scraper | Optional | Paid; skip at first |
| **A domain** | e.g. `eugeneevents.com` | Yes | ~$12/yr |

**The Vercel cron gotcha:** `vercel.json` defines ~23 cron jobs. The Vercel
Hobby plan allows only 2 (daily-granularity, imprecise timing). Either start
on Pro, or trim `vercel.json` to the two you can't live without
(`/api/generate-briefing` and `/api/check-events`) and run the rest by hand
with `curl` until you upgrade.

**Timezone note:** every cron schedule in `vercel.json` and
`.github/workflows/scrape.yml` is UTC, tuned for Pacific time. Eugene is
also Pacific, so you can leave them all alone. Any other region: shift them.

---

## Phase 1 — Code

1. Fork `robgabel/hwy4-events` on GitHub (private fork is fine and probably
   what you want while you're mid-rebrand).
2. Clone it, `npm install` in the root **and** in `scripts/` (the scrapers
   are a separate package).
3. Copy `.env.example` to `.env.local` and start filling it in as you work
   through Phase 2. The example file documents every variable, which are
   required, and which are GitHub Actions secrets vs Vercel env vars.

Don't rename things yet. Get it running against your own database first,
verify you understand the moving parts, then rebrand.

---

## Phase 2 — Database (Supabase)

The original site shares a Supabase project with unrelated infrastructure,
so there is no project to copy. You create a fresh one:

1. Create a new Supabase project (pick a region near your users, e.g.
   `us-west-1`).
2. Open the SQL Editor and run **`supabase/bootstrap/00_schema.sql`** — the
   complete current-state schema: all 22 tables, enums, indexes, RLS
   policies, and the `event-posters` storage bucket. One file, one run.
3. **Do not run the historical files in `supabase/migrations/`.** They are
   this site's upgrade history and are already folded into the bootstrap.
   (They also assume base tables that were created before the migration
   system existed, so they won't apply cleanly to a fresh project anyway.)
   New migrations you write go in `supabase/migrations/` as usual, on top of
   the bootstrap.
4. Grab your project URL, anon key, and service-role key from
   Settings → API and put them in `.env.local`.

**Keep the `hwy4_` table names.** They're referenced in hundreds of places
across the app, scripts, and tests. The prefix is cosmetic; renaming it buys
you nothing and a giant find-and-replace risk. Think of it as the franchise
engine's brand name.

At this point `npm run dev` should boot and render an empty homepage. That's
correct — there are no events yet.

---

## Phase 3 — Define your region

This is the heart of the fork. The region lives in a handful of files:

1. **`lib/towns.ts` — the master list.** Replace `CORRIDOR_TOWNS` with your
   towns/neighborhoods (name, lat/lng, tagline, elevation, optional default
   address + map zoom). Everything downstream — town pages, filters, maps,
   sitemaps, the corridor filter — derives from this array. For Eugene,
   think in terms of the areas people actually use: Downtown, Whiteaker,
   South Eugene, Springfield, Coburg, etc. Also update
   `TOWN_ADDRESS_ALIASES` (alternate place names that should normalize to
   one of your towns).
2. **`scripts/lib/corridor.ts` — the write-time geofence.** Replace
   `NON_CORRIDOR_CITIES` with nearby cities your scrapers will inevitably
   pick up but you don't cover (for Eugene: Corvallis, Albany, Salem,
   Roseburg, Florence...). Events matching these get dropped at write time.
3. **`regions/<slug>/core.ts` `geo` — the visitor-vs-local classifier's
   data** (`lib/geo.ts` reads it). Set `visitorBox` (a generous lat/lng
   rectangle), `localIpCities` (the towns you serve, lowercased) and
   `hubIpCities` (the regional ISP hub cities your rural readers geolocate
   to; those sessions are counted `hub`, apart from local and visitor,
   because nothing in the IP splits a hub-routed local from a real visitor)
   so the Growth tab's split means something in your geography. The dry-run
   of `scripts/reclassify-visitor-class.ts` lists the top IP cities per class,
   which is how you find your hubs.
4. **`scripts/lib/venues.ts` — the venue registry.** Empty it of Calaveras
   venues and add your anchor venues as you discover them (canonical name,
   aliases, town, street address). This is the single source of truth that
   fixes messy scraped venue names and missing addresses.
5. **`scripts/lib/manual-sources.ts`** — empty the blocklist (it protects
   hand-curated Calaveras rows you won't have). You'll add your own entries
   when you create your first seed script (Phase 5).
6. **`lib/categorize.ts`** — the keyword → category classifier. The
   categories themselves (Live Music, Festival, Community, ...) are
   region-neutral and worth keeping; skim the keyword lists for anything
   Calaveras-flavored and add local vocabulary as you see misclassifications.

Run the test suite after each of these: `cd scripts && npm test`. Several
tests pin region behavior and will tell you what you broke.

---

## Phase 4 — Rebrand

### 4a. Domain and site identity

- **`lib/constants.ts`** — `SITE_URL` fallback, `SITE_NAME`, and the site
  descriptions. Set `NEXT_PUBLIC_SITE_URL` in env too; the constant is just
  the fallback.
- **Hardcoded `hwy4events.com` fallbacks** also live in
  `next.config.ts` (image remotePatterns — replace with your domain plus the
  domains your scraped event images come from),
  `app/api/check-briefing/route.ts`, and `scripts/warm-map-cache.ts`.
- **Email addresses are hardcoded, not env vars.** The newsletter sends from
  `newsletter@hwy4events.com` with a personal reply-to, and `hello@…`
  appears on the hosts page. Find every instance and replace with your own
  (you must also verify your sending domain in Resend first):

  ```sh
  grep -rn "hwy4events.com\|robgabel@gmail.com\|rob@gabel.ai" \
    app lib components scripts content docs --include='*.ts' --include='*.tsx'
  ```

  That one grep is your master checklist for this phase — work through every
  hit. It also catches the scraper User-Agent strings
  (`Hwy4EventsBot/1.0; +https://hwy4events.com`), the newsletter footer, the
  poster generator's `hwy4events.com` lockup text
  (`app/events/[slug]/poster/route.tsx`, `app/hosts/card/route.tsx`), and
  the GSC default property.
- **`middleware.ts`** — the `/admin` Basic Auth username is hardcoded
  (`"rob"`). Change it to yours; the password comes from `ADMIN_PASSWORD`.

### 4b. Mascot and visual brand

Millie (the sheepadoodle) is the original site's mascot and shouldn't follow
you to Oregon. Replace or remove:

- `/public/millie-*.svg` (site), `/public/email/millie-happy.png` +
  `/public/email/tree.png` (newsletter header art — regenerate your own with
  `node scripts/generate-email-assets.mjs` after swapping the source SVGs).
- The newsletter signs off as "— Millie 🐾" and the briefing/newsletter
  prompts reference her; you'll hit these in the voice rewrite (4c).
- Fonts (`public/fonts/`) are generic (Bitter + DM Sans) — keep or swap.

### 4c. Voice and editorial content

This is the largest pile of work after sources, and it's prose, not code.
The site's defining trait is that it sounds like a specific local human, and
every LLM generator is injected with a "voice constitution". Rewrite, don't
delete:

- **`content/VOICE.md`** — the machine-checkable voice rules. This file is
  mirrored into `lib/voice.ts` (`VOICE_MD`) and **a test pins them
  identical** (`scripts/test/voice-md-sync.test.ts`), so update both
  together. Keep the mechanical rules (no em dashes, verify cadence claims,
  named entities over generic descriptors); replace the persona and local
  references with your own.
- **`docs/LOCAL-KNOWLEDGE-BASE.md`** — ~50 pages of Calaveras micro-detail.
  Gut it and grow your own Eugene version over time; it feeds venue blurbs
  and briefing color.
- **`docs/PERSONAS.md`** — rewrite the 7 user personas for your population.
  They genuinely drive product decisions here.
- **`app/towns/town-content.ts`** + town pages — per-town editorial.
- **`app/about/`** — the founder story (including `about/rob-gabel/`,
  which you'll replace wholesale), FAQ, privacy/terms contact lines.
- **Prompts**: `scripts/draft-town-content.ts`, `scripts/draft-venue-blurbs.ts`,
  and the briefing/newsletter prompts reference Calaveras places and the
  original author by name. Search: `grep -rn "Calaveras\|Murphys\|Arnold\|Millie\|Rob" lib scripts app --include='*.ts' --include='*.tsx' | grep -vi robs_pick`
- The `robs_pick` field name (hand-curated highlights) is baked into the DB
  and code — keep the field, relabel the UI badge if you like.
- CI runs a **voice lint** (`scripts/voice-lint.ts`) against the shipped
  pages; it will fail on banned phrases until your rewrites pass.

---

## Phase 5 — Data sources (the real work)

Every scraper in this repo points at a Calaveras source. None of them will
return Eugene events; they're your **reference implementations**. The good
news: the write path they share (`scripts/lib/dedup.ts::upsertEvents`) gives
you dedup, geofencing, venue resolution, and category self-healing for free,
whatever the source.

**Source shapes, easiest first:**

1. **Config-driven Firecrawl venue** — one entry in
   `scripts/scrapers/firecrawl-sources.ts` (URL + default venue/town/
   address). The generic runner fetches the page as markdown and
   LLM-extracts events. This is the 15-minute path for a single venue's
   events page. Start here.
2. **Special scraper** — a hand-written file in `scripts/scrapers/`
   registered in `SPECIAL_SCRAPERS` in `scripts/scrape.ts`, for structured
   sources (WordPress/Tribe REST APIs, EventON AJAX, JSON embedded in
   pages). `visit-murphys.ts` (WP REST) and `gocalaveras.ts` (aggregator)
   are the templates. Your Eugene equivalent of "the aggregator that powers
   half the site" is the highest-value scraper you'll write — candidates to
   evaluate: Eugene Cascades & Coast's event calendar, Eugene Weekly's
   calendar, The Register-Guard, the Eugene Public Library, and the city
   Parks & Rec feed. **Check each source's terms of service before scraping,
   and prefer their API/RSS/iCal if one exists.**
3. **Seed script** — for schedules no scraper can read (poster images,
   prose recurrence rules, word-of-mouth weeklies). Copy
   `scripts/seed-camp-connell-beer-garden-2026.ts` or
   `scripts/seed-arnold-library-storytime-2026.ts` (weekly recurrence via
   `scripts/lib/recurrence.ts`) as templates. Add the venue to
   `scripts/lib/manual-sources.ts` so auto-scrapers can't overwrite your
   hand-entered rows, and optionally add a fingerprint-watcher cron (copy
   `app/api/check-camp-connell-schedule/route.ts`) to Slack-ping you when
   the source changes.

**Delete the Calaveras-only pieces** once you have your own sources running:
the entries in `firecrawl-sources.ts`, the special scrapers
(`gocalaveras.ts`, `visit-murphys.ts`, `mystic-saloon.ts`,
`bistro-espresso.ts`, `red-cross.ts` — or re-anchor red-cross to Eugene ZIP
codes, it's region-generic), the `seed-*.ts` scripts, the
`check-*-schedule` watcher routes + their `vercel.json` entries, and the
`/api/scrape-bls` + `/api/scrape-moose-lodge` cron routes (Vision-AI/PDF
scrapers for two specific Calaveras venues — keep the code around as
templates if you'll need image/PDF calendar scraping).

Also note `lib/event-link.ts`: `UNSTABLE_SOURCE_HOSTS` and the aggregator
fallback are tuned to GoCalaveras. When you adopt your own aggregator,
update that host list so outbound "Visit Event Page" links resolve sensibly.

**Run order to first events:**

```sh
cd scripts
# The scripts read process.env directly (no dotenv) and use SUPABASE_URL,
# not the NEXT_PUBLIC_ name. Export what the source needs:
export SUPABASE_URL=https://YOUR_REF.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=...
export ANTHROPIC_API_KEY=...     # only for LLM-extracting sources
export FIRECRAWL_API_KEY=...     # only for Firecrawl sources
npm run seed-venues              # venue registry -> hwy4_venues
npx tsx scrape.ts --source <your-first-source>
npm run backfill-venue-keys -- --apply
```

Each scraped source also wants a row in `hwy4_orgs` (slug, display name,
and, for organizers whose own site is canonical, `canonical_url` +
`canonical_check_enabled` — that powers both durable outbound links and
nightly date verification).

---

## Phase 6 — Deploy

1. **Vercel:** import your fork, set every variable from `.env.example`
   (Production scope). Point your domain at the project.
2. **GitHub Actions:** add the five scraper secrets
   (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`,
   `FIRECRAWL_API_KEY`, `APIFY_API_TOKEN` — the last is optional) in your
   fork's Settings → Secrets → Actions. The daily scrape
   (`.github/workflows/scrape.yml`) runs at 8am UTC and auto-files a GitHub
   issue on failure.
3. **Trim `vercel.json`** to the crons that match the features you're
   actually launching with (see Phase 5 deletions + the Hobby-plan note).
4. **Smoke-test the cron routes** by hand:

   ```sh
   curl -H "Authorization: Bearer $CRON_SECRET" https://YOURDOMAIN/api/check-events
   curl -H "Authorization: Bearer $CRON_SECRET" https://YOURDOMAIN/api/generate-briefing
   ```

5. **Newsletter:** verify your domain in Resend, then test the template
   end-to-end without touching real subscribers:
   `curl -H "Authorization: Bearer $CRON_SECRET" "https://YOURDOMAIN/api/newsletter/send?test_email=you@example.com"`.
   The weekly flow is: Wednesday `prepare` drafts → you review/veto at
   `/admin/newsletter` → Thursday `send` ships unless vetoed.

### Launch checklist

- [ ] Homepage renders your towns and real events
- [ ] `/admin` rejects wrong creds; all admin pages load with right ones
- [ ] An event detail page shows venue info, map thumbnail, working
      outbound link, and generates a poster (`/events/<slug>/poster`)
- [ ] `/submit` creates an `event_submissions` row and AI triage fills a
      verdict; you can Publish it from `/admin/submissions`
- [ ] Daily briefing generated; `/api/check-events` audit posts to Slack
- [ ] Newsletter test email renders with your branding (no Millie, no
      hwy4events.com in the footer)
- [ ] `sitemap.xml` and OG images carry your domain
- [ ] No grep hits remain: `grep -rni "hwy4events\|calaveras\|millie" app lib components content --include='*.ts' --include='*.tsx' --include='*.md'`

### Leave OFF until you've watched the system for a while

These follow the codebase's dry-run-first culture; keep them in their safe
defaults at launch:

- `RECONCILE_EXECUTE` unset — duplicate reconciliation reports but doesn't
  merge until you've watched a clean week of reports.
- `agent_policy.auto_execute` stays `false` — agent-proposed actions always
  wait for your click at `/admin/actions`.
- The newsletter veto gate is your safety net; check `/admin/newsletter`
  every Wednesday until you trust the drafts.

---

## Phase 7 — Staying in sync with upstream (optional)

Realistically you will diverge fast (sources, content, branding). If you
want to keep pulling engine improvements:

- The portable engine lives mostly in `lib/` (dedup, event identity, link
  resolution, newsletter rendering, agent plumbing) and `scripts/lib/`.
  Cherry-pick changes there; skip anything under `content/`, `docs/`,
  `app/towns/`, or `scripts/scrapers/`.
- New `supabase/migrations/*.sql` files dated after your fork apply cleanly
  to your project — your bootstrap is the same schema they expect.
- The shared "same event" definition (`lib/event-identity.ts`) is locked by
  tests; if you pull an update to it, run `cd scripts && npm test` before
  deploying.

---

## Where to ask questions

The PRDs in the repo root (`PRD-*.md`) and `CLAUDE.md` explain why nearly
every subsystem is shaped the way it is — read the relevant one before
changing a subsystem. `LESSONS.md` is the candid log of what went wrong and
got fixed. And the original operator is a phone call away; that's the
franchise model.

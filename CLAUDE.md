# CLAUDE.md — Hwy4Events

Community events site for the Highway 4 corridor (Angels Camp to Bear Valley, CA). Next.js app deployed on Vercel, data in Supabase.

## Tech Stack

- **Framework:** Next.js 16 (App Router) + React 19 + Tailwind v4
- **Database:** Supabase (`hwy4_events`, `hwy4_orgs`, `site_config`, `event_submissions`)
- **AI:** Anthropic SDK (Claude Opus) for daily briefing generation
- **Maps:** Leaflet / react-leaflet
- **Hosting:** Vercel (auto-deploys from main branch)

## Architecture

- Events are scraped externally and loaded into Supabase — this app is **read-only** against event data (except community submissions via `/submit`)
- Weekly recurring events use `is_weekly: true` and get collapsed in the UI (`CollapsedEvent` type)
- `site_config` table is a key-value store (briefing text, timestamps, etc.)
- `hwy4_orgs` maps venues/sources to display names and slugs for org pages

## Deduplication (defense in depth)

The same real-world event can appear twice: one source re-lists it under a changed title, or two sources describe it independently (e.g. the GoCalaveras aggregator lists "Live Music @ The Lube Room" while the venue feed lists "Live at The Lube: Poison Oakies" — same night). The title-based `dedup_key` only catches byte-identical re-scrapes of the *same* title, so it cannot see these. Three layers guard against dupes:

1. **Read-time collapse** — [lib/dedupe-events.ts](lib/dedupe-events.ts) (`dedupeEvents`) runs on every user-facing list (homepage, town pages) and both briefing generators. It buckets by `town | date | normalized start | visibility` — **not end time**: a source that omits the end ("7:00 PM") must share a bucket with the same source's fuller listing ("7:00 PM – 10:00 PM"), so the end-agrees-only-when-both-known rule lives in `timesAnchor` inside `isSameEvent`, mirroring the write-time matcher. It then merges rows in a bucket only on a strong identity signal: near-identical title, overlapping artists, near-identical description, or same venue + a generic placeholder title. **Two different specific titles never merge on venue/time alone** (a park hosts different events back to back). Keeps the richest row (`pickSurvivor`); penalizes scraper-artifact venues like `@Murphys Park featuring …`.
2. **Write-time merge** — `scripts/lib/dedup.ts` (`isStrongEventMatch` / `buildStrongMatchUpdate`) replaces the old name-only fuzzy. When a scraped event has no `dedup_key`/`source_event_id` hit, it merges into an existing same-date/same-town row that shares an exact time slot + the same strong signal, field-merging so the survivor keeps the best of both (and unions artists). Conservative — never merges on title similarity alone.
3. **Backfill + audit** — [scripts/backfill-dedup.ts](scripts/backfill-dedup.ts) is a re-runnable repair using the exact read-time definition: `tsx backfill-dedup.ts` (dry-run) / `--execute` (apply). Needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. `/api/check-events` reports same-event dupes (venue+time, different title) that the old name-only check missed.

The "same event" rule is defined **once** in `lib/dedupe-events.ts` and mirrored in `scripts/lib/dedup.ts`; the backfill and audit import the shared one so the definition can't drift.

## Cron Jobs (vercel.json)

| Route | Schedule | Purpose |
|---|---|---|
| `/api/generate-briefing` | Daily 2pm UTC | Generate daily briefing via Opus |
| `/api/check-briefing` | Daily 5pm UTC | Verify briefing was generated |
| `/api/generate-weekend-briefing` | Fridays 2pm UTC | Weekend-specific briefing |
| `/api/scrape-bls` | Mondays 1pm UTC | Scrape Blue Lake Springs flyer images via Vision AI |
| `/api/scrape-moose-lodge` | Mondays 2pm UTC | Scrape Ebbetts Pass Moose Lodge monthly PDF calendar via Claude PDF document API. Replaces the deprecated `scrape-moose-lodge` Supabase edge function (2026-05-26). |
| `/api/verify-events` | Daily 3pm UTC | Cross-check upcoming events against organizers' canonical sites; flag mismatches as `needs_verification` |
| `/api/extract-prices` | Daily 1:30pm UTC | Extract explicitly-stated admission fees from event description/name into `price` + `cost_tier` via Haiku. Only lifts fees that are stated, never guesses. Processes 40/run by default; `?limit=150` for manual backfill. Stamps `price_extracted_at` so events aren't reprocessed. |
| `/api/check-events` | Daily 6pm UTC | Data-quality audit on `hwy4_events`: duplicates, hidden rows, missing fields, stale scrapes. Posts to Slack if `SLACK_WEBHOOK_URL` is set. Read-only. |
| `/api/aeo-audit-reminder` | 1st of month, 8am PT (16:00 UTC) | Posts the monthly AEO prompt-audit checklist to Slack (`SLACK_WEBHOOK_URL`). Manual ritual — a human runs the 13-query bank against AI engines and logs results in `AEO-SEO-MEASUREMENT.md`. Read-only. |

All cron routes require `CRON_SECRET` as a bearer token. To smoke-test any cron route manually:

```sh
curl -H "Authorization: Bearer $CRON_SECRET" https://hwy4events.com/api/<route>
```

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
- `/api/extract-prices` runs daily; reads description+name and lifts **explicitly-stated** fees via Haiku. Never guesses an amount — no fee text means `cost_tier='unknown'`, not free.
- The public site shows a green **"Free"** badge or a **"$25" / "Ticketed" / "Pay what you can"** cost badge on each event card (scan-level), plus a **"Free"** quick filter on the homepage. `unknown` shows nothing.
- Backfill the whole upcoming queue by hitting the route repeatedly (it's idempotent via `price_extracted_at`): `curl -H "Authorization: Bearer $CRON_SECRET" "https://hwy4events.com/api/extract-prices?limit=150"`.

## Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `ANTHROPIC_API_KEY`
- `CRON_SECRET`
- `NEXT_PUBLIC_CF_BEACON_TOKEN` (optional) — Cloudflare Web Analytics beacon token. When set, `app/layout.tsx` injects the Cloudflare RUM script. Get it from https://dash.cloudflare.com/?to=/:account/web-analytics.
- `SLACK_WEBHOOK_URL` (optional — enables `/api/check-events` to post audit issues and `/api/aeo-audit-reminder` to post the monthly AEO checklist to Slack)

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

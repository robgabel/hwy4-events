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
- `dedup_key` on events prevents duplicates from scrapers
- Weekly recurring events use `is_weekly: true` and get collapsed in the UI (`CollapsedEvent` type)
- `site_config` table is a key-value store (briefing text, timestamps, etc.)
- `hwy4_orgs` maps venues/sources to display names and slugs for org pages

## Cron Jobs (vercel.json)

| Route | Schedule | Purpose |
|---|---|---|
| `/api/generate-briefing` | Daily 2pm UTC | Generate daily briefing via Opus |
| `/api/check-briefing` | Daily 5pm UTC | Verify briefing was generated |
| `/api/generate-weekend-briefing` | Fridays 2pm UTC | Weekend-specific briefing |
| `/api/scrape-bls` | Mondays 1pm UTC | Scrape Blue Lake Springs flyer images via Vision AI |
| `/api/scrape-moose-lodge` | Mondays 2pm UTC | Scrape Ebbetts Pass Moose Lodge monthly PDF calendar via Claude PDF document API. Replaces the deprecated `scrape-moose-lodge` Supabase edge function (2026-05-26). |
| `/api/verify-events` | Daily 3pm UTC | Cross-check upcoming events against organizers' canonical sites; flag mismatches as `needs_verification` |
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
- **Static town maps:** the event detail page shows a pre-generated town map thumbnail (`public/maps/<town-slug>.webp`) and only loads the interactive Leaflet map on tap. Regenerate with `cd scripts && npm run generate-town-maps` — re-run only when a town's coordinates change in `lib/towns.ts`. Maps are committed assets (9 towns, ~10kb each), stitched from CARTO Voyager tiles to match the on-tap interactive basemap.

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

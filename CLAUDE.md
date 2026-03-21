# Hwy4Events — Project Instructions for Claude

## About This Project

Community event discovery platform for the Highway 4 corridor (Angels Camp → Bear Valley) in California's Sierra Nevada foothills. Built by Rob Gabel, who's had a cabin in Arnold for 11+ years. The site aggregates local events and generates daily briefings with an opinionated, local voice.

**Live site:** hwy4events.com
**Tech stack:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS 4, Supabase, Claude API, Firecrawl

## Rob's Working Style

- **Detail-oriented on UX:** Notices click targets, mobile regressions, cursor states, text overflow. If something feels off on mobile, it matters.
- **Voice & tone perfectionist:** The briefing voice ("Today on the 4") has been iterated many times. Follow the established tone — warm, opinionated, specific to Hwy 4 towns. No corporate language. No emojis in body text. One subtle dog reference max.
- **Iterative refinement:** Expects multi-round polish. A feature ships, then gets 2-3 follow-up tweaks (shorter copy, better placement, cursor fixes). Don't assume v1 is done.
- **Cost-conscious on APIs:** Pre-flight checks before expensive API calls (Anthropic credits, Firecrawl). Optimize scraper costs (Apify resultsLimit, fetch-since-last-scrape patterns).
- **PRD-driven for big features:** Writes thoughtful PRDs before major work. Respect the design principles in PRD files — especially "specific over generic" and "warm over polished."
- **Commit messages:** Descriptive, action-oriented. Multi-change commits list changes. Bug fixes name the bug.

## Architecture Decisions

- **Server Components by default.** Client components only when interactivity is needed (filters, maps, forms). Mark with `"use client"`.
- **Supabase singleton** via proxy pattern in `lib/supabase.ts`. Never create additional clients.
- **ISR with `revalidate = 3600`** (hourly). Path revalidation on event submission and scraping.
- **Scrapers** live in `scripts/scrapers/`. Each venue has its own file. Claude API extracts structured events from scraped HTML/markdown.
- **Deduplication** in `scripts/lib/dedup.ts` — fuzzy match by name, date, venue before upserting.
- **Health checks** run post-scrape (`scripts/lib/health.ts`). Always validate after scraper changes.

## Code Conventions

- camelCase for variables/functions, PascalCase for components/types
- SCREAMING_SNAKE_CASE for constants
- Component filenames match exports: `EventCard.tsx` exports `EventCard`
- Tailwind utility-first. Custom design tokens: cream, warm-white, stone, pine
- Fonts: Bitter (display), DM Sans (body)
- Console logging with context prefixes: `[getEvents]`, `[scraper-name]`
- Date handling via date-fns. All event times in America/Los_Angeles timezone.

## Commands

- `npm run dev` — local dev server (port 3000)
- `npx tsx scripts/scrape.ts` — run all scrapers
- `npm run build` — production build (catches type errors)
- ESLint: `npx eslint .`

## Key Files

- `lib/types.ts` — Core interfaces (Hwy4Event, Hwy4Org, EventCategory)
- `lib/constants.ts` — Site metadata
- `lib/towns.ts` — Town definitions along the corridor
- `scripts/lib/extract.ts` — Claude-powered event extraction from HTML
- `app/api/generate-briefing/` — Daily briefing generation endpoint

## Don'ts

- Don't use emojis in component text or briefing copy
- Don't add generic stock-photo imagery — specificity is the brand
- Don't create new Supabase clients; use the singleton
- Don't skip health checks after scraper changes
- Don't add towns outside the Hwy 4 corridor without asking

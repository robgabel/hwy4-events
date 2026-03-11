# PRD: Event Visibility & Classification

## Overview

Add event visibility tiers (Public/Private) and importance scoring (Major/Minor) to Hwy 4 Events. This enables member-only events from organizations like Ebbetts Pass Moose Lodge to coexist alongside the public event listing, while also surfacing the most notable public events.

## Problem

1. **Moose Lodge members** want to see their full calendar (meetings, dinners, member events) alongside corridor-wide public events — but these shouldn't be visible to general users.
2. **General users** should see Moose Lodge's big public events (e.g., Crab Fest, community dinners) but not internal member activities.
3. **All users** benefit from distinguishing major destination events (Ironstone concerts, Murphys Irish Day) from smaller local happenings.

## Users

| Persona | Sees | How |
|---------|------|-----|
| General public | Public events only (Major + Minor) | Default view |
| Moose Lodge member | Public events + Moose private events | Toggle on "Moose Lodge" filter |
| Future: Golf club member | Public events + golf club private events | Toggle on "Golf Club" filter |

## Data Model Changes

### New columns on `hwy4_events`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `visibility` | text | `'public'` | `public` or `private` |
| `org_slug` | text | `null` | For private events: `moose-lodge`, `golf-club`, etc. Null for public events. |
| `importance` | text | `null` | For public events: `major` or `minor`. Null for private events. |
| `importance_score` | float | `null` | LLM confidence score (0-1) for the importance classification. |
| `importance_override` | boolean | `false` | If true, the `importance` value was manually set and should not be overwritten by the LLM on re-score. |

### New table: `hwy4_orgs`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `slug` | text | Unique identifier: `moose-lodge`, `golf-club` |
| `display_name` | text | "Ebbetts Pass Moose Lodge", "Forest Meadows Golf Club" |
| `scrape_urls` | jsonb | Array of `{ url, type }` objects for scraping |
| `visibility_default` | text | Default visibility for events from this org (`public` or `private`) |
| `created_at` | timestamptz | |

Initial data:
```
moose-lodge:
  display_name: "Ebbetts Pass Moose Lodge"
  scrape_urls: [
    { url: "https://ebbettspassmoose.com/events", type: "public", format: "html" },
    { url: "https://ebbettspassmoose.com/current-calendar", type: "private", format: "pdf" }
  ]
  visibility_default: "private"

sequoia-woods:
  display_name: "Sequoia Woods Country Club"
  scrape_urls: [
    { url: "https://www.sequoiawoods.com/newpage965daf98", type: "public", format: "html" }
  ]
  visibility_default: "public"
  notes: "Public events only (no member calendar access). Site returns 403 to bots — may need browser-based scraping or manual entry."
```

## Feature 1: Event Visibility (Public/Private)

### Scraping Changes

**Moose Lodge /events page:**
- Scrape public-facing events (Crab Fest, community dinners, etc.)
- Tag with `visibility = 'public'`, `org_slug = 'moose-lodge'`
- These appear for all users

**Moose Lodge /current-calendar page (PDF):**
- The calendar page links to a downloadable PDF (e.g., `MAR 2026 calendar.pdf`)
- Download the PDF, extract text via PDF parsing, then parse event entries
- Tag with `visibility = 'private'`, `org_slug = 'moose-lodge'`
- Deduplicate against /events entries (same event on both pages → keep as public)
- PDF URL changes monthly — scraper must find the current PDF link from the /current-calendar HTML

**Sequoia Woods /newpage965daf98:**
- Public events only (no member calendar access)
- Site returns 403 to standard HTTP requests — may need headless browser scraping or manual entry as fallback
- Tag with `visibility = 'public'`, `org_slug = 'sequoia-woods'`

**Dedup logic:**
- Events that appear on both /events and /current-calendar are marked `public`
- Events only on /current-calendar are marked `private`

### Frontend Changes

**Default view:** Only `visibility = 'public'` events shown.

**Private event toggle:**
- Add a collapsible "Member Events" section below the existing filter bar
- Contains toggles for each org: "Moose Lodge", "Golf Club" (future)
- Default: OFF
- When toggled ON: private events from that org appear inline with public events, visually distinguished with a subtle badge/icon (e.g., a small lock icon or org badge)
- No authentication required — toggle is visible to anyone but off by default

**Visual treatment of private events:**
- Subtle left border accent in a distinct color per org
- Small org badge on the event card (e.g., "Moose Lodge" pill)
- Otherwise same card layout as public events

### RLS Changes

- Add `visibility = 'public' OR visibility = 'private'` to the existing read policy (both are readable — filtering happens client-side)
- No auth gating needed

## Feature 2: Importance Scoring (Major/Minor)

### LLM Classification

**When:** Runs as part of the daily scrape task, after events are upserted.

**Scope:** All `public` events where `importance IS NULL` or `importance_override = false`.

**Prompt strategy:** For each unscored public event, send the event name, description, venue, and category to an LLM with a classification prompt:

```
Classify this event's regional importance on the Highway 4 corridor
(Angels Camp to Bear Valley, Sierra Nevada foothills):

Event: {name}
Venue: {venue_name}, {town}
Category: {category}
Description: {description}

MAJOR = destination event with broad regional appeal that draws visitors
from outside the corridor (e.g., Ironstone concerts, county fairs,
wine weekends, large festivals)

MINOR = local community event, regular club meeting, small gathering,
or recurring low-key activity (e.g., lodge dinners, craft markets,
weekly music at a bar)

Respond with JSON: { "importance": "major" | "minor", "score": 0.0-1.0, "reason": "brief explanation" }
```

**Batch processing:** Score events in batches of ~10 per LLM call to minimize API usage.

**Override protection:** If `importance_override = true`, skip that event during re-scoring.

### Frontend Changes

**No immediate UI change required for v1.** Major/Minor classification is stored in the DB for future use:
- Future: Default view shows Major events prominently, Minor events in a compact/collapsed section
- Future: "Show all events" toggle to include Minor events
- Future: Visual hierarchy — Major events get larger cards, Minor events get compact single-line rows

For now, the classification just populates the DB columns so we can iterate on display later.

## Implementation Phases

### Phase 1: Data Model + Moose Scraping
1. Run migration: add columns to `hwy4_events`, create `hwy4_orgs` table
2. Seed `hwy4_orgs` with Moose Lodge entry
3. Update scheduled task to scrape both Moose Lodge pages
4. Tag events with correct `visibility` and `org_slug`

### Phase 2: Frontend — Private Event Toggle
1. Update Supabase query to fetch all events (public + private)
2. Add "Member Events" toggle section to FilterBar
3. Client-side filtering by visibility
4. Visual distinction for private event cards

### Phase 3: LLM Importance Scoring
1. Add scoring step to scheduled task (post-upsert)
2. Score existing public events in a one-time backfill
3. Store `importance`, `importance_score`, `importance_override`

### Phase 4 (Future): Major/Minor UI
1. Visual hierarchy for Major vs Minor in the event list
2. Default to showing Major, with "Show all" toggle for Minor
3. Potential featured/hero section for upcoming Major events

## Resolved Questions

1. **Golf club source** — Sequoia Woods Country Club: `https://www.sequoiawoods.com/newpage965daf98` (public events only, no member calendar). Site blocks bots (403) so may need headless browser or manual entry.
2. **Moose calendar format** — The /current-calendar page is HTML with a link to a **downloadable PDF** (monthly, e.g., "MAR 2026 calendar.pdf"). Scraping requires: (a) fetch HTML to find PDF link, (b) download PDF, (c) extract text and parse events.
3. **Scoring frequency** — Score only new events on ingest. Manual override via `importance_override` column prevents re-scoring. On-demand full re-score available if needed.

## Remaining Open Questions

1. **Sequoia Woods 403** — Need to test if a headless browser (Puppeteer/Playwright) can access the page, or if we should fall back to manual event entry for this source.
2. **Moose PDF parsing accuracy** — Monthly calendar PDFs vary in format. May need a few months of samples to build a reliable parser. LLM-based PDF extraction could be more robust than regex.

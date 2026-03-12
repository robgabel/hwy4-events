# PRD: Bear Valley Events Integration

## Overview

Add Bear Valley Mountain Resort as an event source for Hwy 4 Events, ingesting events from [bearvalley.com/events-activities](https://www.bearvalley.com/events-activities) via automated web crawling. This is the first resort-category source and establishes the general-purpose scraping pipeline that will also serve future sources (Moose Lodge, Sequoia Woods, etc.).

## Problem

Bear Valley is one of the most significant event venues on the Highway 4 corridor — hosting ski races, music festivals (Bear Valley Music Festival, Hermitfest West), Winter Explosion, community events, and summer activities. Currently these events are not captured in Hwy 4 Events.

## Source Analysis

### Site Structure

Bear Valley's events page at `bearvalley.com/events-activities` is built on **Wix** and uses a blog/post-based structure:

- **Hub page:** `/events-activities` — overview page linking to individual event posts
- **Event posts:** `/post/{slug}` — individual blog-style posts announcing events (e.g., `/post/hermitfest-west-is-back-this-weekend`)
- **No structured calendar feed** — no iCal, RSS, or API endpoint detected
- **No JSON-LD/schema.org event data** on pages
- **403 on direct HTTP requests** — the site blocks non-browser user agents (same issue as Sequoia Woods)

### Content Patterns

Event information is embedded in blog post prose, not structured data. A typical post includes:
- Event name in the title/heading
- Dates and times in the body text
- Location (usually Bear Valley Mountain Resort or Bear Valley Lodge)
- Ticket/pricing info when applicable
- Links to related sites (e.g., bearvalleymusicfestival.org)

### Known Recurring Events

| Event | Typical Timing | Category |
|-------|---------------|----------|
| Bear Valley Music Festival | Mid-July – Early August | festival |
| Hermitfest West | Early September | festival |
| Winter Explosion | Mid-January | festival |
| South Central Series Races | January – March | resort |
| Cal Band Weekend | Winter | resort |
| Ski/Snowboard Clinics | March | resort |
| Stay & Ski Packages | Jan – April | resort |
| Seasonal restaurant openings | Summer | other |

### Related Sources

- **[bearvalleymusicfestival.org](https://www.bearvalleymusicfestival.org/)** — Dedicated site for the summer music festival with detailed concert schedule. Should be scraped as a secondary source for festival-specific events.
- **[bvadventures.com/events](https://www.bvadventures.com/events)** — Bear Valley Adventure Co. runs summer activities (mountain biking, cross-country skiing, snowshoeing). Could be a future source.

## Technical Approach

### Challenge: No Structured Data + 403 Blocking

Bear Valley's site (Wix-hosted) has two challenges:
1. Events are in unstructured blog prose, not calendar entries
2. The server returns 403 to standard HTTP clients

### Recommended Pipeline

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────┐
│  Headless    │     │   LLM        │     │  Dedup &     │     │ Supabase │
│  Browser     │────▶│   Extraction │────▶│  Upsert      │────▶│ hwy4_    │
│  (Playwright)│     │   (Claude)   │     │  Logic       │     │ events   │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────┘
       │                                                              │
  Fetch /events-activities                                    source_url,
  + linked /post/* pages                                      source_name,
                                                              org_slug
```

### Step 1: Headless Browser Fetch (Playwright)

Use Playwright to bypass 403 blocks and render JavaScript-dependent content:

```
1. Navigate to https://www.bearvalley.com/events-activities
2. Wait for page content to load (Wix hydration)
3. Extract all links to /post/* pages
4. Visit each /post/* page and capture:
   - Page title
   - Full body text content
   - Publication date
   - Any linked URLs
5. Return raw text for each post
```

**Why Playwright over Puppeteer:** Better cross-platform support, built-in auto-waiting, and lighter than Puppeteer for CI/serverless environments.

### Step 2: LLM Event Extraction (Claude)

Pass the raw text from each blog post to Claude for structured event extraction:

```
Prompt:
Extract all discrete events from this Bear Valley blog post.
For each event, return JSON with these fields:

- name: Event name
- description: 1-2 sentence description
- date: ISO date (YYYY-MM-DD)
- start_time: HH:MM (24h) or null
- end_time: HH:MM (24h) or null
- venue_name: Specific venue (e.g., "Bear Valley Lodge", "Big White Tent")
- town: "Bear Valley"
- address: Street address if mentioned, else null
- category: One of: live_music, festival, civic, resort, other
- price: Price string (e.g., "$30", "Free") or null
- artists: Array of performer names, or null
- event_url: Direct link to event/tickets if mentioned, else null

Rules:
- Only extract events with specific dates. Ignore vague mentions ("events coming soon").
- If a post describes a date range (e.g., "July 17 – August 2"), create ONE entry with the start date and note the range in the description.
- If no events are found, return an empty array.
- Use the current year ({YEAR}) for dates unless the post clearly states otherwise.

Return JSON array only, no other text.

Post title: {title}
Post URL: {url}
Post content:
{content}
```

**Why LLM extraction:** Blog posts are unstructured prose with varying formats. Regex/CSS-selector approaches would be brittle. Claude can handle natural language date parsing, distinguish events from promotions, and classify categories accurately.

**Cost estimate:** ~10-20 posts per crawl, ~500-2000 tokens each → roughly $0.05-0.15 per daily run with Claude Haiku.

### Step 3: Deduplication & Upsert

Before inserting extracted events:

1. **Generate a dedup key:** `hash(lowercase(name) + date + "bear-valley")`
2. **Check existing events** in `hwy4_events` with the same dedup key
3. **If exists:** Update description/time/price if changed, skip otherwise
4. **If new:** Insert with:
   - `source_url` = the `/post/*` URL where the event was found
   - `source_name` = "Bear Valley Mountain Resort"
   - `org_slug` = `"bear-valley"`
   - `visibility` = `"public"`
   - `importance` = null (let the existing importance scoring pipeline handle it)

### Step 4: Secondary Source — Bear Valley Music Festival

Separately crawl `bearvalleymusicfestival.org` for detailed concert schedules:

1. Fetch the concert/schedule page
2. Extract individual performances (performer, date, time, venue)
3. Upsert with `source_url` pointing to the festival site
4. Dedup against events already ingested from `bearvalley.com`

## Data Model Changes

### New org in `hwy4_orgs`

```sql
INSERT INTO hwy4_orgs (slug, display_name, scrape_urls, visibility_default)
VALUES (
  'bear-valley',
  'Bear Valley Mountain Resort',
  '[
    {"url": "https://www.bearvalley.com/events-activities", "type": "public", "format": "html-blog"},
    {"url": "https://www.bearvalleymusicfestival.org/", "type": "public", "format": "html"}
  ]'::jsonb,
  'public'
);
```

### New dedup column on `hwy4_events` (if not already present)

| Column | Type | Description |
|--------|------|-------------|
| `dedup_key` | text | Hash of `lowercase(name) + date + town` for idempotent upserts |
| `last_scraped_at` | timestamptz | When this event was last confirmed by the crawler |

## Scraper Implementation

### File Structure

```
scripts/
├── scrape.ts                  # Main entry point — runs all scrapers
├── scrapers/
│   ├── bear-valley.ts         # Bear Valley blog post scraper
│   ├── bear-valley-music.ts   # Bear Valley Music Festival scraper
│   ├── moose-lodge.ts         # (future) Moose Lodge scraper
│   └── sequoia-woods.ts       # (future) Sequoia Woods scraper
├── lib/
│   ├── browser.ts             # Playwright browser management
│   ├── extract.ts             # LLM extraction (Claude API)
│   ├── dedup.ts               # Dedup key generation & upsert logic
│   └── supabase-admin.ts      # Supabase client with service role key
└── package.json               # Scraper-specific deps (playwright, @anthropic-ai/sdk)
```

### Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.52.0",
    "@supabase/supabase-js": "^2.98.0",
    "playwright": "^1.52.0"
  }
}
```

### Environment Variables

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...       # Service role for writes (not anon key)
ANTHROPIC_API_KEY=...               # For LLM extraction
```

### Scheduling

**Option A: GitHub Actions cron (recommended for simplicity)**

```yaml
# .github/workflows/scrape.yml
name: Daily Event Scrape
on:
  schedule:
    - cron: '0 8 * * *'   # 8 AM UTC daily (midnight PST)
  workflow_dispatch:        # Manual trigger

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
        working-directory: scripts
      - run: npx playwright install chromium
        working-directory: scripts
      - run: npx tsx scrape.ts
        working-directory: scripts
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

**Option B: Supabase Edge Function + Supabase Cron** — alternative if you prefer keeping infrastructure within Supabase, but Playwright doesn't run in Deno/edge functions, so you'd need an external browser service (e.g., Browserless).

### Crawl Logic (bear-valley.ts)

```
async function scrapeBearValley():
  1. Launch Playwright browser
  2. Navigate to /events-activities
  3. Extract all <a href="/post/*"> links from the page
  4. For each post link (limit to most recent 15-20):
     a. Navigate to the post page
     b. Extract: title, body text, publication date
     c. Skip if publication date is older than 60 days
  5. Close browser
  6. For each post's content:
     a. Call Claude to extract structured events
     b. Filter out events with dates in the past
  7. For each extracted event:
     a. Generate dedup key
     b. Upsert into hwy4_events
  8. Log summary: X posts crawled, Y events extracted, Z new, W updated
```

### Staleness & Cleanup

- Set `last_scraped_at` on every event confirmed by the crawler
- Events with `source_name = 'Bear Valley Mountain Resort'` and `last_scraped_at` older than 14 days: auto-mark as potentially stale (don't delete — the source post may have been removed)
- Events with `date < today` are already filtered out by `is_past`

## Implementation Phases

### Phase 1: Scraper Infrastructure
1. Create `scripts/` directory with package.json and tsconfig
2. Implement `browser.ts` — Playwright browser launch/close helper
3. Implement `supabase-admin.ts` — Supabase service role client
4. Implement `dedup.ts` — dedup key generation and upsert logic
5. Add `dedup_key` and `last_scraped_at` columns to `hwy4_events`

### Phase 2: Bear Valley Scraper
1. Implement `bear-valley.ts` — crawl /events-activities + /post/* pages
2. Implement `extract.ts` — Claude extraction with the event prompt
3. Implement `scrape.ts` — main orchestrator
4. Test end-to-end locally
5. Add `bear-valley` to `hwy4_orgs`

### Phase 3: Scheduling
1. Create GitHub Actions workflow for daily cron
2. Add secrets to repo (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY)
3. Run manually, verify events appear on the site
4. Monitor for a week, tune extraction prompt if needed

### Phase 4: Music Festival Source
1. Implement `bear-valley-music.ts` — crawl bearvalleymusicfestival.org
2. Add dedup logic against events already from bearvalley.com
3. Add to the daily cron run

### Phase 5: Extend to Other Sources
1. Port Moose Lodge scraper (HTML + PDF) to same pipeline
2. Port Sequoia Woods scraper (also needs Playwright)
3. All sources use the same `extract.ts` → `dedup.ts` → upsert flow

## Open Questions

1. **Rate limiting / politeness** — Should we add a delay between requests to bearvalley.com? Recommend 1-2 second delay between page fetches.
2. **Blog post age cutoff** — How far back should we crawl posts? Recommend 60 days (posts older than that rarely contain future events).
3. **Image extraction** — Bear Valley posts often have event flyers/images. Should we extract and store image URLs for richer event cards? Not in v1, but worth considering.
4. **bvadventures.com** — Bear Valley Adventure Co. runs summer activities. Add as a separate source in Phase 4+?
5. **Manual override** — If a Bear Valley event is manually entered before the scraper finds it, the dedup key should prevent duplicates. Need to verify this works correctly.

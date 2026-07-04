# PRD: Blue Lake Springs — Members-Only Events & Club Integration

> **Status (2026-07-04):** Frozen record — shipped (Vision scraping cron `/api/scrape-bls`, the `club` category, Members & Guests badge). Current behavior lives in CLAUDE.md.

**Author:** Rob Gabel + Claude
**Date:** 2026-03-23
**Status:** Draft
**Source:** https://blsha.com/events/

---

## What Is Blue Lake Springs?

Blue Lake Springs (BLS) is a private HOA community in Arnold, CA (~4,000 ft). It's one of the largest residential communities on the Highway 4 corridor — hundreds of cabins, a central Snowflake Lodge, a private lake, pool, tennis courts, amphitheater, and the Blue Lake Bistro restaurant. Many Hwy 4 corridor residents are BLS members or know people who are. It's a significant source of community events that currently has zero visibility on hwy4events.com.

**Key venues within BLS:**
- Snowflake Lodge (main gathering hall, gym, event space)
- Blue Lake Bistro (upscale comfort restaurant, Fri-Sat 5-8pm, BYOB)
- Outdoor amphitheater
- Two lakeside beaches
- Pool complex
- Recreation center

**Typical events:** Potlucks, talent shows, color runs, bingo nights, movie nights, holiday celebrations (Memorial Day, July 4th), yoga classes, kids camps, cardboard boat regatta, fishing derbies, wine tastings, live music at the amphitheater.

---

## Problem Statement

BLS runs a busy events calendar — especially in summer — but none of it shows up on hwy4events.com. This is a gap for multiple personas:

| Persona | Why BLS Matters |
|---------|----------------|
| Gary (Retiree) | Probably a BLS member. Knows about BLS events already, but seeing them in context with everything else on the corridor is valuable. |
| Rob (Weekend Visitor) | Has a place on Thunderbolt — likely a BLS member or guest-eligible. Wants to know what's happening at the lodge this weekend. |
| Karen (Vacation Rental) | Her guests may have BLS guest access. "Is there anything fun at the lake tonight?" |
| Jen (Young Family) | Kids camps, pool parties, family events — BLS is a goldmine for families. |
| Dave (Contractor) | Does work in BLS. Might attend BBQs, fishing derbies. |

**Current state:** BLS events exist only on blsha.com (posted as image flyers) and in the monthly Lodge Log PDF newsletter. No structured data anywhere.

---

## Scraping Challenge

This is the hardest scraping target we've encountered:

1. **No structured data.** Events are posted as image flyers (JPEG/PNG). No text, no calendar feed, no iCal, no API.
2. **No indexing.** Site has `noindex, follow` robots meta across all pages.
3. **WordPress + WPBakery.** Content is in page builder blocks, not semantic HTML.
4. **Monthly newsletter (Lodge Log)** is a PDF with event calendars — also image-heavy.

### Scraping Options

| Approach | Effort | Reliability | Notes |
|----------|--------|-------------|-------|
| **A. Vision AI (Claude) on flyer images** | Medium | Medium | Scrape image URLs from /events/ and /recreation/, send to Claude Vision to extract event name, date, time, description. Flyers are well-designed and readable. |
| **B. Lodge Log PDF parsing** | Medium | Medium | Monthly PDF has a calendar section. Parse with Claude Vision or PDF extraction. Only monthly updates. |
| **C. Manual curation by Rob** | Low | High | Rob or a local contact manually enters BLS events via /submit form. Simple but doesn't scale. |
| **D. Partnership with BLSHA** | Low (dev) | High | Ask BLSHA to share their event calendar data or provide a structured feed. Best long-term but requires relationship-building. |
| **E. Hybrid: Vision AI + manual review** | Medium | High | **(Recommended)** Auto-extract from flyer images, flag for human review before publishing. Best accuracy-to-effort ratio. |

**Recommendation:** Start with **Option E** (Vision AI + manual review). The flyer images are clear and well-formatted — Claude Vision should extract dates, titles, and details with high accuracy. Add a review step before events go live since these are members-only events with access restrictions.

---

## Members-Only Visibility Design

This is the key product decision: **how do we display private/members-only events on a public site?**

### Proposal: "Members & Guests" Badge

Display BLS events with a clear visual indicator that they're not open to the general public.

**On event cards:**
- Add a small badge/tag: "Members & Guests" (or a lock icon + tooltip)
- Include in the event description: "Blue Lake Springs members and their guests"
- Link to blsha.com for membership/guest info

**On the homepage/event list:**
- BLS events appear in the normal event stream (not hidden or separated)
- Filter bar: Add no new filter — BLS events fall under existing categories (Community, Live Music, etc.)
- Town filter: Events tagged as "Arnold" (BLS is in Arnold)

**Why show them at all?**
- Many corridor residents ARE BLS members — they want to see these events alongside everything else
- Guest access is common — members invite friends, vacation renters get guest passes
- Even non-members benefit from knowing what's happening (social context, "oh that's why traffic was heavy")
- The Bistro and some events (live music at amphitheater) sometimes welcome non-members

**What NOT to do:**
- Don't create a separate "private events" section (fragments the experience)
- Don't hide them behind a toggle (most users won't find it)
- Don't require login to see them (violates our no-gates principle)

---

## Data Model Changes

### New EventCategory value: `club`

Add `club` to the `EventCategory` type for members-only/private club events. This allows filtering and badging without changing the core data model.

```typescript
// lib/types.ts
export type EventCategory =
  | "live_music"
  | "festival"
  | "civic"
  | "resort"
  | "lodge"
  | "club"    // NEW — members-only clubs (BLS, Sequoia Woods, etc.)
  | "other";
```

**Why a new category vs. using `visibility: 'private'`?**
The existing `visibility` field means "should this event appear on the site at all." A `club` category means "this event is public on our site but has restricted real-world access." Different concept.

### New org entry: `hwy4_orgs`

```sql
INSERT INTO hwy4_orgs (slug, display_name) VALUES
  ('blue-lake-springs', 'Blue Lake Springs HOA');
```

### Event fields for BLS events

| Field | Value |
|-------|-------|
| `venue_name` | "Snowflake Lodge" / "Blue Lake Bistro" / "BLS Amphitheater" / "BLS Beach" |
| `town` | "Arnold" |
| `category` | "club" |
| `source_url` | "https://blsha.com/events/" |
| `source_name` | "Blue Lake Springs HOA" |
| `org_slug` | "blue-lake-springs" |
| `visibility` | "public" (visible on site) |

---

## Site Changes

### 1. Types & Constants (`lib/types.ts`)
- Add `"club"` to `EventCategory`
- Add label: `club: "Club / Private"`
- Add icon: lock or key icon path

### 2. Event Card (`components/EventCard.tsx`)
- When `category === "club"`, show a small "Members & Guests" badge
- Subtle — don't make it feel exclusionary. Think: informational, not gatekeeping.

### 3. Filter Bar (`components/FilterBar.tsx`)
- Add "Club" to category filter options

### 4. About Page (`app/about/page.tsx`)
- Add BLS to the Arnold venues list:
  ```
  { town: "Arnold", venues: [...existing, "Blue Lake Springs (Members)"] }
  ```
- Consider a brief note in the coverage section: "We also list events from private communities like Blue Lake Springs — look for the Members & Guests badge."

### 5. Org Page (`/org/blue-lake-springs`)
- Auto-generated from `hwy4_orgs` entry
- Shows all BLS events
- Brief description + link to blsha.com

### 6. Briefing Integration
- BLS events should appear in the daily briefing
- Briefing prompt should note members-only status when mentioning BLS events
- Example: "Over at Blue Lake Springs, members can catch Bingo Night at Snowflake Lodge on Friday..."

---

## About Page Addition

Add to the venues-by-town section and add a brief callout:

```
## Private Communities

Some corridor communities run their own event calendars. We list these with a
"Members & Guests" badge so everyone knows what's happening — even if you need
an invite to get through the gate.

- **Blue Lake Springs** — Snowflake Lodge, Blue Lake Bistro, Amphitheater, Beaches
```

---

## Scraper Implementation (Edge Function)

### Architecture

New Supabase edge function: `scrape-bls-events`

1. **Fetch** image URLs from `https://blsha.com/events/` and `https://blsha.com/recreation/`
2. **Send** each flyer image to Claude Vision API with extraction prompt
3. **Parse** response into structured event data (name, date, time, venue, description)
4. **Deduplicate** using `dedup_key` = `bls-{date}-{slugified-name}`
5. **Insert** into `hwy4_events` with `category: 'club'`, `org_slug: 'blue-lake-springs'`

### Vision Extraction Prompt

```
Extract event details from this flyer image. Return JSON:
{
  "name": "event title",
  "date": "YYYY-MM-DD",
  "start_time": "HH:MM" (24hr) or null,
  "end_time": "HH:MM" or null,
  "description": "brief description (1-2 sentences)",
  "venue_hint": "location mentioned on flyer if any"
}
If the image is not an event flyer, return {"skip": true}.
If you cannot determine the date, return {"needs_review": true}.
```

### Cron Schedule

- Run weekly (not daily — BLS events don't change frequently)
- Suggested: Mondays at 3pm UTC
- Add to `vercel.json` cron config

---

## Implementation Priority

| Phase | What | Effort |
|-------|------|--------|
| **P0** | Add `club` category to types, labels, icons | 30 min |
| **P0** | Add BLS to `hwy4_orgs` table | 5 min |
| **P0** | Add "Members & Guests" badge to EventCard | 1 hr |
| **P0** | Add BLS to About page venues | 15 min |
| **P1** | Build `scrape-bls-events` edge function (Vision AI) | 3-4 hrs |
| **P1** | Add to cron schedule | 15 min |
| **P1** | Create org page for BLS | 30 min |
| **P2** | Update briefing prompt to handle club events | 30 min |
| **P2** | Manual review workflow for extracted events | 2 hrs |
| **Future** | Partnership outreach to BLSHA for structured data | Relationship |

---

## Open Questions

1. **Permission:** Should we proactively reach out to BLSHA before listing their events? They have `noindex` on their site — they may not want events surfaced publicly. A quick email to `lodgemanager@blsha.com` would be courteous.

2. **Guest access scope:** Some BLS events are truly members-only (pool parties, board meetings). Others welcome guests freely (Bistro dinners, amphitheater concerts). Should we distinguish?

3. **Other private communities:** Sequoia Woods Country Club is already in our venues list. Should it also get the `club` category treatment? Forest Meadows? This sets a pattern.

4. **Blue Lake Bistro:** Already in our knowledge base as an Arnold restaurant. When Bistro events appear, should they be tagged as `club` (since it's inside BLS) or as regular events (since non-members can sometimes dine there)?

---

## Persona Validation

| Persona | Does This Help Them? | How? |
|---------|---------------------|------|
| Gary | Yes | Sees BLS events alongside everything else — one-stop shop |
| Mia | Slightly | Might discover amphitheater concerts to recommend to tasting room guests |
| Dave | Slightly | BBQs, fishing derbies — stuff he'd actually attend |
| Rob | Yes | Finally sees BLS events without checking a separate site |
| Karen | Yes | Can tell guests about BLS activities they have access to |
| Jen | Yes | Kids camps, pool parties, family events — huge value |
| Miguel | No | Day-tripper can't access gated community |

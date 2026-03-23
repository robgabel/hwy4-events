# PRD: About Page Redesign

**Author:** Rob Gabel + Claude
**Date:** 2026-03-22
**Status:** Draft
**Approach:** C — "Two Pages in One" (Story Up Top, Reference Below)

---

## Problem Statement

The current About page is a reference document disguised as an About page. It lists towns, venues, and categories but fails to:
- Communicate the site's personality or why it exists (the soul is buried in a small box)
- Surface the product's most differentiated features (daily AI briefing, Rob's Picks)
- Serve any specific persona well (see persona critique below)
- Convert visitors into event-browsers (no prominent CTA, dead-end page)
- Acknowledge key audience segments (no mention of families, BLS, or day-trippers)
- Show Millie on mobile (hidden via `hidden sm:block` at `opacity-60`)

## Goal

Redesign the About page as a two-zone hybrid: an emotionally compelling top half that sells the site's personality and value, and a reference bottom half that builds trust with facts. Every persona should find themselves on this page within 5 seconds of scrolling.

## Success Metrics

- **Engagement:** Increase click-through from About → homepage events (currently unmeasured — add event tracking)
- **Share quality:** Rob feels proud sending the About link to friends
- **Persona coverage:** All 7 personas addressed (validated via checklist below)
- **Mobile-first:** Millie visible, CTA reachable without scrolling to bottom, all content readable on 375px

---

## Persona Requirements Checklist

| Persona | Must See | Current State | Target State |
|---------|----------|---------------|--------------|
| Gary (Retiree) | That the site is updated daily; how it works | No mention of freshness or features | "Updated daily" value prop, venue count |
| Mia (Winery Worker) | Vibe, personality, visual quality | Wall of text, no energy | Hero with character, human voice throughout |
| Dave (Contractor) | N/A — will never visit this page | N/A | Accept this. Don't optimize for Dave here. |
| Rob (Weekend Visitor) | Something impressive to share; best features visible | Features invisible, page is a README | Hero + value props + CTA = shareable |
| Karen (Airbnb Owner) | Professional credibility, venue list, shareable to guests | Venue list exists but flat; no pitch for hosts | "Who this is for" mentions hosts; venues grouped by town |
| Jen (BLS Mom) | BLS mentioned, family-friendly signal, member events | BLS absent, "family" mentioned 0 times | Explicit BLS callout, family-friendly mention, member events section |
| Miguel (Day-Tripper) | Geographic orientation, drive times, CTA to events | "Getting here" is thin, no CTA, no map context | Drive times from Stockton/Sac/Bay Area, prominent weekend CTA |

---

## Page Structure

### TOP ZONE — "The Pitch"

The top zone is what gets shared. It should feel warm, confident, and local — like a neighbor who happens to know everything going on. No heading says "About." The page just *is* the story.

#### 1. Hero Section

- **Millie illustration:** Visible on ALL screen sizes (remove `hidden sm:block`). Increase size and opacity. Millie is the brand — don't hide her.
- **Headline:** "Your neighbor's guide to what's happening on the 4." (or similar — local, warm, not corporate)
- **Subhead:** One sentence positioning: "A free community event listing for the Highway 4 corridor, from Angels Camp to Bear Valley."

**Design notes:**
- Full-width section with warm background (current `warm-white` or subtle texture)
- Headline in `font-display`, large
- Millie at right on desktop, above headline on mobile

#### 2. Personal Note

The cabin story — but punchier. This is the emotional anchor of the page.

**Content (approximate):**
> We have a cabin in Arnold. We got tired of missing things because events were scattered across a dozen websites, Facebook groups, and flyers at the Lube Room. So we built this — first for our family, then for our neighbors. It's a labor of love, not a business.

**Design notes:**
- Slightly inset card or blockquote treatment (keep current warm box, it works)
- Max 3-4 sentences. The current version is close — tighten slightly.
- Keep the `rob@gabel.ai` mailto link

#### 3. Three Value Props

These are the site's differentiators. Currently invisible on the About page. This is the single highest-impact addition.

| Prop | Headline | Description |
|------|----------|-------------|
| Freshness | "Updated every morning" | We check 20+ venues daily so you don't have to. If it's happening on the 4, it's here. |
| AI Briefing | "This Week on the 4" | Every day, a fresh briefing summarizing what's coming up — written to sound like a neighbor, not a robot. |
| Rob's Picks | "Hand-picked highlights" | Not everything is worth your Saturday. Rob's Picks surface the events that are actually worth going to. |

**Design notes:**
- Three cards or columns, icon or small illustration for each
- Keep copy tight — 1 headline + 1-2 sentences each
- Consider: small Millie variants for each icon (Millie with binoculars, Millie with a calendar, Millie with a star)

#### 4. "Who This Is For"

The persona mirror. Each line should make a specific person think "that's me." This is where Jen, Karen, and Miguel see themselves.

**Content (approximate bullets):**
- "If you live up here and want one place to check instead of five Facebook groups"
- "If you're a BLS, Sequoia Woods, or Moose Lodge member looking for member events alongside public ones"
- "If you've got kids and want to know what's family-friendly this weekend"
- "If you own a vacation rental and want to tell guests what's happening during their stay"
- "If you're in Stockton or the Bay Area thinking about driving up — and wondering if it's worth the trip"
- "If you already know everyone at Bistro Espresso but still want to make sure you're not missing anything"

**Design notes:**
- Casual list, not a grid. Should read like a conversation.
- No icons needed — the voice carries it.
- The Bistro Espresso line is for Gary. He'll grin.

#### 5. Primary CTA

**"See what's happening this weekend →"**

- Large button, `pine` or `forest` green
- Links to homepage (or homepage with weekend filter pre-applied if available)
- Visible without scrolling past the fold on mobile? Ideally yes, but don't force it — the hero + personal note + value props can push it below fold on small screens. That's OK if the hero is strong.

---

### VISUAL BREAK

Clear separation between the pitch and the reference section. Options:
- Horizontal rule with a small Millie illustration centered
- Background color shift (white → very light warm gray)
- A simple heading: "The details" or "What we cover"

---

### BOTTOM ZONE — "The Reference"

The bottom zone builds trust with facts. It's for Karen evaluating credibility, Gary scanning venues, and Miguel figuring out where things are.

#### 6. Towns We Cover

**Keep** the current town list with taglines and elevation. It's well-structured.

**Changes:**
- Add a brief intro line: "9 towns along 50 miles of Highway 4, from the Gold Country foothills to the Sierra summit."
- Consider a simple corridor illustration or mini-map showing west→east progression (stretch goal — not required for V1)
- Town names should still link to filtered homepage view

#### 7. Venues We Track

**Keep** the venue list but improve it:
- **Group by town** instead of flat list (Murphys venues together, Arnold together, etc.)
- Add a dynamic count if feasible: "Currently tracking 14 venues" (or hardcode for now)
- Keep the "Know a venue we should add? Submit it." CTA

#### 8. Families & Members

**NEW section** — combines the current "Private & member events" content with new family-friendly messaging.

**Content (approximate):**

**Heading:** "Families & members welcome"

**Family paragraph:** "Plenty of events on the 4 are great for kids — from the playground at White Pines Lake to summer movies at Blue Lake Springs. We're working on making it easier to filter for family-friendly events. In the meantime, community events and resort activities are your best bet."

**Member paragraph:** Keep current Sequoia Woods / Moose Lodge content, but **add Blue Lake Springs** explicitly: "Blue Lake Springs, Sequoia Woods Country Club, and the Moose Lodge host events that are only open to members and their guests. Toggle on the Clubs filter to see them alongside public events."

**Design notes:**
- BLS being named here is important for Jen — it signals the site serves her community
- "Working on" family filter is honest — sets expectations without promising a ship date

#### 9. Event Categories

**Keep** current content, tighten slightly. No structural changes needed.

Consider adding a 6th item:
- **Family & Kids** — seasonal activities, outdoor events, and community gatherings that work for all ages

(Only add if the category exists or is planned in the data model. If not, skip — don't promise what doesn't exist.)

#### 10. Getting Here

**Expand** with specific drive times and origin cities:

| From | Drive Time | Route |
|------|-----------|-------|
| Stockton | ~90 minutes | Hwy 4 East |
| Sacramento | ~2 hours | Hwy 99 South → Hwy 4 East |
| Bay Area (SF/Oakland) | ~2.5 hours | I-580 → I-5 → Hwy 4 East |
| Bay Area (San Jose/South Bay) | ~2.5 hours | I-5 → Hwy 4 East |
| Modesto | ~75 minutes | Hwy 108 → Hwy 49 → Hwy 4 |

Keep the current prose paragraph for context. Add: "Bear Valley is another 30 minutes past Arnold — worth the drive for skiing, hiking, or just the views."

**Stretch goal:** Link "Angels Camp" to Google Maps directions (or embed a simple static map).

#### 11. Feedback Form

**Keep** current FeedbackForm component. No changes. It's well-done — casual, no-email-required, and on-brand.

#### 12. Footer CTA + Back Link

- Keep "← Back to events" link
- Add a second, smaller CTA: "See what's happening this weekend →" (mirrors the top CTA for people who scrolled all the way down)

---

## Content & Voice Guidelines

All copy on this page should follow the site's voice: **local, human, slightly wry — never corporate or AI-sounding.**

Specific guidelines for this page:
- Use "we" and "our" — it's a personal project, not a company
- Reference real places by name (Bistro Espresso, the Lube Room, Giant Burger) — this is what makes it feel local
- Don't say "curated" (overused). Say "hand-picked" or just describe what you mean.
- Don't say "comprehensive" or "one-stop" — those are tourism board words
- It's OK to be slightly self-deprecating: "labor of love, not a business" is the right tone

---

## Technical Notes

### Current Implementation
- Static page: `app/about/page.tsx`
- Uses `CORRIDOR_TOWNS` from `lib/towns.ts` for town list
- Hardcoded `venues` array for venue list
- Imports `FeedbackForm` component
- Has breadcrumb schema (JSON-LD) and SEO metadata

### Changes Required
- **No new API routes or data fetching** — this is a static content page
- **No new dependencies** — achievable with existing Tailwind + Next.js Image
- Venue list should be **grouped by town** (restructure the `venues` array or transform in render)
- Millie: remove `hidden sm:block` and `opacity-60` — show at full opacity on all screens
- Add analytics event for CTA clicks (if analytics exist — check current implementation)
- Preserve breadcrumb schema and SEO metadata
- Update `metadata.description` to reflect new page content

### Millie Illustrations
- Current: `millie-happy.svg` (used in hero)
- If additional Millie variants exist (or can be created), use them for value prop icons
- If not, use simple icons (calendar, star, refresh) — don't block on illustration work

---

## What's NOT in Scope

- **Map component** — a corridor map would be great but is a separate project. Don't block the About redesign on it.
- **Dynamic venue count** — hardcode "20+ venues" for now. Dynamic count from Supabase is a nice-to-have.
- **Family filter feature** — the About page can mention it as a direction, but building the actual filter is separate work.
- **BLS event ingestion** — adding BLS events to the database is separate. The About page just acknowledges BLS as a community we serve.
- **Email digest / newsletter** — mentioned in personas as high-value for Jen. Separate feature.
- **Analytics implementation** — if no analytics exist, don't add them for this page alone.

---

## Implementation Priority

If this needs to be shipped incrementally:

**P0 — Ship first (biggest impact, least effort):**
1. Make Millie visible on mobile (one CSS change)
2. Add the three value props section (daily updates, briefing, Rob's Picks)
3. Add prominent "See what's happening this weekend" CTA
4. Mention BLS by name in the member events section

**P1 — Ship second (important but more writing/design):**
5. Add "Who this is for" persona-mirror section
6. Group venues by town
7. Expand "Getting here" with drive times table
8. Rewrite hero headline

**P2 — Polish:**
9. Visual break between zones
10. Second CTA at page bottom
11. Millie illustrations for value prop cards
12. Family-friendly content additions

---

## Open Questions

1. **Do additional Millie SVG variants exist?** (e.g., Millie with binoculars, Millie with a calendar) — would elevate the value props section
2. **Is there a weekend filter URL param?** — if CTA can link to `/?filter=weekend` or similar, that's better than just `/`
3. **Should the venue list eventually be dynamic?** — pulled from `hwy4_orgs` table instead of hardcoded. Not required now but worth noting for later.
4. **What's the actual current venue count?** — page says 20+ but the hardcoded list has 14. Reconcile.

---

*Last updated: 2026-03-22*

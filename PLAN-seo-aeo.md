# SEO & AEO Improvement Plan — Hwy 4 Events

## Current State

**SEO Maturity: ~40%**

| Area | Status |
|------|--------|
| Page title & meta description | Done |
| Semantic HTML (h1–h3, article, section) | Done |
| Open Graph (title, description, type) | Done |
| `lang="en"` on html | Done |
| ISR caching (1-hour revalidation) | Done |
| robots.txt | Missing |
| sitemap.xml | Missing |
| Canonical URLs | Missing |
| JSON-LD / Schema.org structured data | Missing |
| Twitter Card tags | Missing |
| og:image | Missing |
| Per-event pages (indexable URLs) | Missing |
| Analytics / Search Console | Missing |
| FAQ / Q&A content for AEO | Missing |

---

## Phase 1 — Foundational SEO (Priority: Critical)

### 1.1 Add `robots.txt`
Create `app/robots.ts` using the Next.js Metadata API to generate a proper robots.txt.

```
User-agent: *
Allow: /
Sitemap: https://hwy4events.com/sitemap.xml
```

### 1.2 Add `sitemap.xml`
Create `app/sitemap.ts` that dynamically generates a sitemap from the event data and any static pages.

### 1.3 Add canonical URL
Add a `metadataBase` in `app/layout.tsx` and set canonical URLs so search engines consolidate ranking signals.

### 1.4 Improve meta description
Make the description more keyword-rich and action-oriented:
> "Find live music, festivals, and community events in Angels Camp, Murphys, Arnold, Bear Valley, and the Calaveras County Sierra foothills — updated daily."

### 1.5 Add Twitter Card meta tags
Add `twitter:card`, `twitter:title`, `twitter:description` via the Next.js metadata export.

---

## Phase 2 — Structured Data for Rich Results (Priority: High)

### 2.1 JSON-LD `Event` schema on every event card
Add `schema.org/Event` structured data for each event. This enables Google's rich event snippets (date, time, location, price displayed directly in search results).

Fields to include:
- `name`, `description`, `startDate`, `endDate`
- `location` (with `Place` → `address` → town, region)
- `offers` (price / free)
- `organizer`
- `eventAttendanceMode` (offline)
- `image` (when available)

### 2.2 JSON-LD `WebSite` schema
Add site-level schema to `app/layout.tsx` with:
- `name`, `url`, `description`
- `potentialAction` → `SearchAction` (if search is added later)

### 2.3 JSON-LD `Organization` schema
Add organization-level schema identifying the site publisher.

### 2.4 JSON-LD `ItemList` schema
Wrap the event listings in an `ItemList` schema so search engines understand the page is a curated list of events.

---

## Phase 3 — Indexable Event Pages (Priority: High)

### 3.1 Create dynamic event routes
Add `app/events/[slug]/page.tsx` so each event has its own URL (e.g., `/events/murphys-summer-concert-2026-07-04`). This is critical for both SEO and AEO — search engines and AI assistants need distinct, crawlable pages per event.

### 3.2 Generate slugs
Create URL-friendly slugs from event name + date + town (e.g., `live-music-at-the-brewery-2026-03-15-murphys`).

### 3.3 Per-page metadata
Each event page should have a unique `<title>` and `<meta description>` derived from the event data:
- Title: `"{Event Name} — {Date} in {Town} | Hwy 4 Events"`
- Description: first 155 chars of event description + location.

### 3.4 Per-page JSON-LD
Each event detail page gets its own `Event` schema (more detailed than the listing card version).

---

## Phase 4 — AEO (Answer Engine Optimization) (Priority: High)

AEO targets AI-powered search (Google AI Overviews, ChatGPT search, Perplexity, etc.) that extract direct answers from web content.

### 4.1 Add FAQ section
Add a static or semi-dynamic FAQ section to the homepage or a dedicated `/faq` page. Structure it with:
- `<details>/<summary>` or heading + paragraph pairs
- JSON-LD `FAQPage` schema

Example questions:
- "What events are happening this weekend in Murphys?"
- "Where can I find live music near Angels Camp?"
- "What festivals happen in Calaveras County?"
- "Is Bear Valley open for events in summer?"

### 4.2 Write concise, answer-ready content
AI assistants extract content that directly answers questions. Add short, factual paragraphs to the site:
- A "What is Hwy 4 Events?" blurb (2–3 sentences)
- Per-town micro-descriptions ("Murphys is a Gold Rush–era town known for its tasting rooms, live music venues, and annual Murphys Irish Day parade.")
- A "How it works" or "About" section

### 4.3 Use question-format headings
Where natural, use headings phrased as questions:
- "What events are happening today along Highway 4?"
- "Where to find live music in the Sierra foothills this week?"

These map directly to voice and AI search queries.

### 4.4 Add an "About the Highway 4 Corridor" page
Create `/about` with structured, factual content about the towns, the corridor, and the types of events. This gives AI assistants a dense, authoritative source to cite.

### 4.5 Add `speakable` structured data
Use `schema.org/speakable` to flag content that is suitable for text-to-speech by voice assistants (Google Assistant, Alexa).

---

## Phase 5 — Social & Sharing (Priority: Medium)

### 5.1 Add Open Graph image
Create a default `og:image` (1200×630 px) showing the Hwy 4 corridor branding. Place in `public/og-image.png` and reference in metadata.

### 5.2 Per-event OG images (stretch)
Dynamically generate OG images for event pages using Next.js `ImageResponse` (from `next/og`). Show event name, date, town, and category.

### 5.3 Complete Open Graph tags
Add missing OG tags: `og:url`, `og:locale`, `og:site_name`.

---

## Phase 6 — Technical SEO (Priority: Medium)

### 6.1 Add page speed optimizations
- Use `next/image` for any images (lazy loading, responsive sizing, WebP)
- Preload critical fonts
- Minimize client-side JS (consider moving filtering server-side with search params)

### 6.2 Add `aria` attributes and alt text
Audit all interactive elements for accessibility — screen-reader-friendly content also helps search engine understanding.

### 6.3 Add internal linking
Link from event cards to their detail pages, from town names to filtered views, from the FAQ to relevant events. Strong internal linking helps crawlers and boosts page authority.

### 6.4 Add a `manifest.json`
PWA manifest with site name, theme color, and icons — signals a well-maintained site to search engines.

---

## Phase 7 — Analytics & Monitoring (Priority: Medium)

### 7.1 Google Search Console
Verify ownership and submit the sitemap. Monitor indexing, impressions, and click-through rates.

### 7.2 Analytics integration
Add a lightweight analytics solution (Google Analytics 4, Plausible, or Umami) to track traffic sources and popular events.

### 7.3 Rich Results Testing
Regularly validate structured data with Google's Rich Results Test and Schema.org Validator.

---

## Implementation Priority Order

| Order | Task | Impact | Effort |
|-------|------|--------|--------|
| 1 | robots.txt + sitemap.ts | High | Low |
| 2 | Canonical URL + metadataBase | High | Low |
| 3 | JSON-LD Event schema on listings | Very High | Medium |
| 4 | Dynamic event pages (`/events/[slug]`) | Very High | Medium |
| 5 | FAQ section + FAQPage schema | High (AEO) | Low |
| 6 | Answer-ready content + question headings | High (AEO) | Low |
| 7 | WebSite + Organization schema | Medium | Low |
| 8 | OG image + Twitter Cards | Medium | Low |
| 9 | About page with corridor content | Medium (AEO) | Low |
| 10 | Speakable structured data | Medium (AEO) | Low |
| 11 | Per-event OG images | Medium | Medium |
| 12 | Performance audit + next/image | Medium | Medium |
| 13 | Analytics + Search Console | Medium | Low |

---

## Expected Outcomes

- **Google Rich Results**: Event cards with date, location, and price appear directly in search
- **AI Search Citations**: Hwy 4 Events becomes a cited source for "events near Angels Camp" and similar queries in AI Overviews, ChatGPT, and Perplexity
- **Voice Search Answers**: FAQ and speakable content enables voice assistants to surface event info
- **Higher CTR**: OG images and rich snippets improve click-through from search and social sharing
- **Indexing**: Every event becomes a crawlable, unique URL instead of a single-page app hidden from crawlers

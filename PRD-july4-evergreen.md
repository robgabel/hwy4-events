# PRD: Evergreen Fourth of July pages (convert this year's July 4th search equity into a durable annual asset)

> **Status (2026-07-12):** Plan only, nothing built. Fleshes out roadmap ticket **HWY-6**
> ("Convert past Arnold 4th of July page to next-year placeholder", filed by the
> chief-of-staff 2026-07-08). Current truth lives in CLAUDE.md once anything ships.

## 1. The problem

The Fourth of July pages were the site's biggest search wins to date, and all of that
equity is parked on date-stamped URLs that are now stale and will decay.

GSC 28-day window as of 2026-07-11 (`seo_snapshots`, dimension=page):

| Page | Clicks | Impressions | Position |
|---|---|---|---|
| `/events/arnold-independence-day-parade-2026-07-04-arnold` | 321 | 3,358 | 4.2 |
| `/events/4th-of-july-celebration-at-the-murphys-historic-hotel-2026-07-04-murphys` | 306 | 2,440 | 3.3 |
| `/events/murphys-4th-of-july-parade-2026-07-04-murphys` | 192 | 1,857 | 4.7 |
| `/events/4th-of-july-celebration-2026-07-04-murphys` | 57 | 999 | 3.4 |
| `/events/arnolds-independence-day-parade-2026-07-04-arnold` (FB-sourced duplicate row) | 22 | 625 | 6.5 |

That is ~900 clicks in a month from one holiday, on a domain that is otherwise fighting
for crawl budget (PRD-search-indexing). Three structural problems:

1. **Slugs embed the date.** Next year's parade row will live at
   `...-2027-07-04-arnold`, a brand-new URL with zero history. The rank we earned
   this year evaporates annually *by design*.
2. **Past pages go stale, not away.** `findEventBySlug` ([lib/events.ts](lib/events.ts))
   has no is-past filter, so the 2026 pages still render and still rank, but Google
   demotes stale event listings over the following weeks. The window to consolidate
   is now, while position 3–5 still holds.
3. **Equity is split.** Two Arnold parade rows (the seeded one and the Facebook-sourced
   "Arnold's Independence Day Parade") each rank separately; two Murphys Hotel
   celebration rows do the same. Four-plus pages compete for one query family.

## 2. Why NOT literal placeholder event rows (the decision)

The board idea as filed says "convert to a placeholder event for next year." Inserting
a 2027-07-04 `hwy4_events` row today is the weakest version of that idea:

- **No equity inheritance.** A 2027 row gets a new slug; the 2026 URL's rank does not
  transfer to it without a redirect anyway. The redirect is the whole ballgame.
- **Invisible for ~10 months.** The homepage horizon is 60 days and the events sitemap
  horizon is 120 days ([lib/sitemap.ts](lib/sitemap.ts)), so a July 2027 row would sit
  unadvertised until spring, earning nothing.
- **Accuracy contract.** 2027 details (time, theme, route, whether the hotel does the
  same party) are unconfirmed. Publishing an event row with guessed specifics violates
  the trust rule that got the "Date unconfirmed" badge killed and the Murphys Irish Pub
  lesson written. A prose page can hedge honestly ("expect roughly...", "organizers
  usually confirm by May"); an event card + JSON-LD `Event` with a date cannot.

**Decision: the "placeholder" is a year-less evergreen guide page, not an event row.**
The 2026 event URLs 301 into it; next year's real rows link out of it once confirmed.
This is the standard annual-event SEO play, and the codebase already has 90% of the
machinery (intent pages, festival guides, stale-slug 301s).

## 3. The design

### 3.1 Two evergreen guide pages (year-less URLs)

The queries are town-shaped ("arnold 4th of july parade", "murphys 4th of july"), so
build two pages, not one corridor page:

- **`/arnold-4th-of-july`** — the parade page. Recap of 2026 (theme "Stars, Stripes
  and 250 Years"), the durable facts that don't change year to year (steps off 10 AM,
  one mile downhill from the upper Byway to Cedar Center, Highway 4 closes to cars at
  9:30 AM, free, bring a chair), the Visitor Center celebration and Moose Lodge as
  same-day companions, and a "next year" block: July 4, 2027 falls on a Sunday;
  organizers usually confirm details by late spring; check back or join the newsletter.
  Organizer pointer to arnoldparade.org (the org row's canonical_url).
- **`/murphys-4th-of-july`** — parade at noon on Main Street, the Murphys Historic
  Hotel celebration, the 3rd-of-July Patriotic Car Cruise as the eve tradition, same
  "next year" block shape.

Implementation: **clone the intent-pages pattern**, not a bespoke page per URL. Extend
[lib/intent-pages.ts](lib/intent-pages.ts) (or a sibling `lib/holiday-pages.ts` if the
lens-filter shape doesn't fit) with per-page fixed human-written editorial + Q&A blocks,
rendered by [components/IntentPageView.tsx](components/IntentPageView.tsx) or a close
sibling. Non-negotiables carried over: human-written copy (never LLM-generated),
em-dash-free, `voice-lint` clean, Q&A blocks shaped like the real queries ("What time
does the Arnold 4th of July parade start?", "Where should I park for the Murphys
parade?"), locked by a pure test like `scripts/test/intent-pages.test.ts`.

**Dynamic section:** each page queries the cached `getEventsInRange` for a July 1–6
window of its town. Off-season that returns nothing and the section renders a single
honest line ("The full lineup lands here as organizers confirm, usually by May").
In-season it becomes the live listing automatically, no annual code change. This is
what makes the page a *placeholder that self-fills* rather than a static promise.

**JSON-LD:** off-season, no `Event` schema (nothing is confirmed); render `FAQPage`
from the Q&A blocks. In-season, the listed events already carry their own schema via
the shared spine.

### 3.2 301 the expired 2026 event URLs into the guides

New `lib/seasonal-redirects.ts`: a small hand-maintained map of expired event slugs →
guide paths, consulted by the event detail page's recovery path in
[lib/events.ts](lib/events.ts) / `app/events/[slug]/page.tsx`. Precedence: exact
seasonal-redirect hit → `permanentRedirect()` (301), checked **before** the
`event_merge_log` and fuzzy-name fallbacks (it's an exact-match table, so it can go
first at zero risk).

Initial entries:

| From (expired slug) | To |
|---|---|
| `arnold-independence-day-parade-2026-07-04-arnold` | `/arnold-4th-of-july` |
| `arnolds-independence-day-parade-2026-07-04-arnold` | `/arnold-4th-of-july` |
| `murphys-4th-of-july-parade-2026-07-04-murphys` | `/murphys-4th-of-july` |
| `4th-of-july-celebration-at-the-murphys-historic-hotel-2026-07-04-murphys` | `/murphys-4th-of-july` |
| `4th-of-july-celebration-2026-07-04-murphys` | `/murphys-4th-of-july` |

Notes:
- This also **consolidates the duplicate-row split** (both Arnold parade URLs, both
  Murphys Hotel URLs) into one target each, which no dedup layer could do because the
  rows were legitimately distinct at write time.
- The redirect must win even though the underlying rows still exist and render. That
  is deliberate: the stale page's continued existence is the *problem*, not a
  constraint. The rows themselves stay in the DB untouched (history, briefings,
  merge-log integrity); only the URL is repointed.
- Guard: entries only activate once the event date is past (compare against
  `pacificToday()`), so accidentally listing a future slug can't black-hole a live
  page. Locked by a pure test (`scripts/test/seasonal-redirects.test.ts`): every
  entry's target exists in the guide registry, every source slug parses, no future
  dates redirect.

### 3.3 Internal links + sitemap (don't ship an orphan)

Same lesson as `FESTIVAL_GUIDES` ([lib/event-guides.ts](lib/event-guides.ts)): a landing
page nothing links to is dead weight.

- **`sitemap-core.xml`**, priority 0.8 (same slot as the intent pages).
- **Town pages** (Arnold, Murphys): a small callout card, mirroring the
  `festivalGuidesForTown` treatment but year-round (demote copy off-season rather
  than hiding: "Planning ahead for the 4th?").
- **Browse similar chips**: any event matching a July-4 predicate (date = Jul 3–5 or
  patriotic-feature keys in [lib/featured-events.ts](lib/featured-events.ts)) gets a
  chip to its town's guide, via [components/BrowseSimilar.tsx](components/BrowseSimilar.tsx).
- **Footer "What's on" nav**: optional; only if it doesn't crowd the existing four.
- **Seasonal homepage surfacing**: next June, add a `FESTIVAL_GUIDES`-style entry
  (startDate ~2027-06-20, hideAfter 2027-07-04) so Rob's Picks spotlights the guide
  for the run-up, exactly as the Bear Valley Music Festival guide does. One registry
  entry per year, no code change.

### 3.4 The annual loop (what "next year" actually means)

1. **Now (July 2026):** ship guides + redirects while the 2026 pages still hold
   position 3–5. Request indexing on both guide URLs in GSC.
2. **Spring 2027 (~May):** organizers confirm. Re-run `scripts/seed-arnold-parade-2027`
   (the seed script is already written to be re-run with a bumped DATE), let the
   scrapers land the Murphys rows. The guides' dynamic sections light up on their own;
   update the editorial year block (one small copy edit); add the homepage-picks
   registry entry.
3. **July 2027:** the guides now outrank cold-start event pages for the head queries
   and funnel readers to the fresh detail pages one click deep.
4. **After July 4, 2027:** append the 2027 detail-page slugs to `seasonal-redirects.ts`.
   The loop compounds: the guide URL accrues age + links every year while event URLs
   stay disposable.

Refresh triggers, per the Living Documents registry discipline: the **monthly AEO
audit ritual** already checks query performance (add "arnold 4th of july parade" +
"murphys 4th of july" to the query bank in AEO-SEO-MEASUREMENT.md), and the spring
seed re-run is the natural moment for the copy refresh. If a harder backstop is wanted,
a one-line `send_later`-style reminder or a May entry on the roadmap board suffices;
do not build a watcher cron for this.

## 4. Sequenced build (one session, ~half a day)

1. `lib/holiday-pages.ts` (or extend `lib/intent-pages.ts`): config for the two guides
   (editorial, Q&A, town, July-window predicate) + pure test.
2. The two routes rendering via the IntentPageView-style server component with the
   dynamic July-window event section.
3. `lib/seasonal-redirects.ts` + the detail-page hook + pure test.
4. Sitemap-core entries; town-page callouts; BrowseSimilar chips.
5. Verify: hit all five old URLs → 301 to the right guide; guides render off-season
   state; `npm test` + `voice-lint` green.
6. Deploy, then GSC: request indexing for both guides; watch Coverage for the five
   redirected URLs flipping to "Page with redirect".

## 5. Measurement (what success looks like)

- **Short term (4–8 weeks):** the five old URLs drop out of GSC by-page as the guides
  inherit their impressions; combined clicks for the query family don't crater (some
  seasonal decay is natural; the metric is share-of-query, not absolute clicks).
- **June 2027:** the guides rank for "arnold 4th of july parade 2027" style queries at
  or better than the 2026 pages' position 3.3–4.7, *before* the event rows exist.
  That is the whole thesis: demand arrives before supply every year; the evergreen
  page is what catches it.
- Watch in the existing `/admin/analytics` Search panel (by-page cut) and the monthly
  AEO log; no new instrumentation needed.

## 6. Explicit non-goals

- **No placeholder `hwy4_events` rows for 2027** (see §2). Event rows appear only when
  details are confirmed, same as today.
- **No generalized "annual event" framework yet.** This pattern (guide + redirect
  registry) will fit other annuals (Sierra Nevada Arts & Crafts Festival, the car
  cruise, eventually the Bear Valley Music Festival's year-stamped guide). Do the
  Fourth first, prove the equity transfer in GSC, then generalize; the registry
  design (slug → path map, config-driven pages) already leaves the door open.
- **No auto-generated copy.** The editorial is human-written once a year; the only
  dynamic content is the live event list the DB already owns.

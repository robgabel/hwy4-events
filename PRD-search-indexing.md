# PRD: Search Indexing — Win Crawl Budget on a Young Domain

> Google Search Console reports **"Discovered – currently not indexed"** on the bulk of the site's URLs. That status is not a content rejection — Google has *not crawled* the pages. It's a trust/priority signal: a ~1-week-old, zero-authority domain was handed **1,023 event URLs** (plus towns/temporal/static), ~70% of which are near-duplicate recurring instances stretching to **2028**. The crawler notes they exist and declines to spend its small budget proving they're worth indexing.
>
> The fix is not a toggle. **Stop asking Google to index 1,000+ thin recurring pages. Make it trivial to index the ~50–100 pages that drive traffic, prove the domain's value, and let the long tail index over time.** Same arc as the dedup and link-resolution work: render-time first, single source of truth, lock with a test, ship reversibly.

## Context

The technical SEO foundation is already strong (see [PLAN-seo-aeo.md](PLAN-seo-aeo.md), [AEO-SEO-MEASUREMENT.md](AEO-SEO-MEASUREMENT.md)): `robots.ts`, a sitemap of upcoming-only events, canonical URLs, `Event` JSON-LD ([lib/schema.tsx](lib/schema.tsx)), `metadataBase`, OG, ISR, and solid internal linking (header lists all 9 towns, footer lists towns + the three temporal pages, town and `/this-week|weekend|month` pages list events as real server-rendered `<Link>`s). **Nothing is broken.** This is about crawl economics, not plumbing.

**The diagnosis, quantified (2026-06-03):**

| Signal | Value | Why it matters |
|---|---|---|
| Domain age | **~1 week** (site created 2026-05-26, GSC verified 2026-05-28) | New, zero-authority domains get a tiny crawl allowance until they earn trust. Partial indexing now is *normal*. |
| Event URLs in sitemap | **1,023** (upcoming, public) + 9 towns + 3 temporal + static | A large ask for a week-old domain handed all at once. |
| Near-term value | only **276** in the next 30 days, **40** in 7 | The genuinely time-relevant pages are a fraction. |
| Long tail | events out to **2028-05-26** | Hundreds of low-value, far-future URLs diluting the sitemap. |
| Duplication | **~70% recurring weekly instances**; ~65–78 distinct names/month | "Live Music Upstairs" = **104 separate URLs** (to 2028); North Grove Walk = 67; Junior Rangers = 58; Thirsty Thursday Trivia = 31. The top ~25 names alone generate ~700 near-identical thin pages. |

Two forces compound: **(1) crawl-budget rationing** (new domain) and **(2) a thin/templated-content quality signal** from the recurring near-duplicates, which makes Google spend *even less* of that budget. The result is exactly "Discovered – currently not indexed."

**What this is NOT:** a robots block, a canonical bug, a noindex mistake, a JS-rendering wall, or a missing sitemap. Those were checked. The crawlability of the money pages is fine. The problem is volume + uniformity + youth.

## Goals / Non-Goals

**Goals**
- Reframe the KPI: stop chasing "100% of 1,023 URLs indexed." Track **money-page coverage** (each town page + `/this-weekend` + home) and impressions/clicks on local queries.
- Concentrate the crawler's budget on a small, high-signal URL set; let the recurring long tail index opportunistically.
- Earn enough authority signal (links, time, manual nudges) to convert "discovered" → "crawled" → "indexed" on the pages that matter.
- Every change reversible and evidence-gated.

**Non-Goals**
- No new scraper or ingestion change. This is a *publishing/crawl* concern, not data.
- Not removing event detail pages from the site — they stay reachable on-site; we only change what we *advertise* to crawlers and (later) how recurring series are canonicalized.
- No paid SEO tooling. GSC + Bing + Cloudflare Analytics are the scoreboard.

## What shipped in this cut (Tier 0 + Tier 1)

### Tier 0 — Reframe the KPI (free)
On a ~1-week-old domain, "Discovered – currently not indexed" is expected and largely self-resolves over 4–8 weeks as authority builds. The right KPI is **money-page coverage**, not total-URL coverage. Many recurring-instance pages may never fully index, which is acceptable — they were never the traffic drivers. The monthly ritual in [AEO-SEO-MEASUREMENT.md](AEO-SEO-MEASUREMENT.md) gains one line: **core-sitemap indexed %** (now measurable thanks to the split below).

### Tier 1 — Concentrate crawl budget (shipped)
One pure module — [lib/sitemap.ts](lib/sitemap.ts) — owns the selection + rendering logic, locked by [scripts/test/sitemap.test.ts](scripts/test/sitemap.test.ts) (11 tests). The single `app/sitemap.ts` was replaced by three route handlers:

1. **Sitemap index** at `/sitemap.xml` ([app/sitemap.xml/route.ts](app/sitemap.xml/route.ts)) — a `<sitemapindex>` pointing at the two children. (A route handler, not the metadata `sitemap.ts`, because the metadata convention can only emit a flat `<urlset>`.) `robots.ts` already references `/sitemap.xml`, so the submitted URL is unchanged.
2. **Core sitemap** `/sitemap-core.xml` ([app/sitemap-core.xml/route.ts](app/sitemap-core.xml/route.ts)) — home + 3 temporal + 9 published towns + static. The money pages, isolated so **GSC reports their coverage separately** from the event long tail.
3. **Events sitemap** `/sitemap-events.xml` ([app/sitemap-events.xml/route.ts](app/sitemap-events.xml/route.ts)) — crawl-budget-trimmed:
   - **Recurring-series collapse** (`selectSitemapEvents`): each `(title, town)` series is reduced to its soonest `SITEMAP_MAX_INSTANCES_PER_SERIES = 2` instances. "Live Music Upstairs" drops from 104 URLs to 2. Two *different* titles never collapse (mirrors the read/write dedup rule in `event-identity.ts`).
   - **Horizon cap** `SITEMAP_EVENT_HORIZON_DAYS = 120` — events past the window are omitted until their date approaches (curated `robs_pick` events are kept regardless, as keystones worth indexing early).
   - **Honest `lastmod`** — uses the DB `updated_at` (added to the shared cached select in [lib/events-data.ts](lib/events-data.ts) and the `Hwy4Event` type), date-only, omitted when unknown — replacing the old `new Date()` on every URL, which told Google "everything changed right now" daily and trained it to distrust the freshness signal.

   Net effect: the advertised event set drops from **1,023 → a few hundred** high-signal URLs, every instance still reachable on-site (the sitemap is a crawl *hint*, not the only discovery path), fully reversible (tune the two constants or revert the file).

**Manual companion (Rob, one-time):** Request Indexing in GSC → URL Inspection for ~20 keystone URLs (home, 3 temporal, 9 town pages, /about, /faq, /about/rob-gabel, + 4 marquee events). List in the appendix. Don't spend manual indexing on recurring instances.

## Roadmap (not yet built)

### Tier 2 — Make the money pages worth crawling deeper

**2a. Canonical "series" pages for recurring events (the permanent fix behind Tier 1's collapse).** The sitemap collapse hides the near-duplicates from the crawler; this *eliminates* them. Give each recurring series one canonical page (a strong venue/series page listing all upcoming dates), and either (a) don't mint per-instance detail URLs, (b) `rel=canonical` each instance to the series page, or (c) `noindex` the instances. Converts 104 weak "Live Music Upstairs" pages into **one page that can actually rank** for "live music in Murphys." Touches the data model (series identity), the event page, and the dedup layer — hence its own design pass. **Tradeoff:** forfeits ultra-long-tail "[band] [date]" queries (near-zero volume) for crawl trust + a rankable head page. Correct call for a young domain. This is the highest-leverage roadmap item.

**2b. Hub pages built to rank.** A `/towns` index (links all 9 town pages) and cheap **category hubs** (`/live-music`, `/festivals`, …) that match real queries far better than any single event page and concentrate internal links. Each is evergreen, server-rendered, and a new crawlable surface that funnels PageRank to events.

**2c. Raise homepage SSR event count.** The homepage renders only ~15 event links in initial HTML; the rest is client-JS infinite scroll ([components/EventList.tsx](components/EventList.tsx)). Bump server-rendered links to ~40–50 (or add a crawlable "browse all" fallback). Belt-and-suspenders — temporal/town pages already cover events server-side — but cheap and removes any doubt for non-JS crawlers.

### Tier 3 — Earn authority + jumpstart crawl (the real long-term unlock)

**3a. Local backlinks (highest external lever).** A handful of relevant links is the biggest converter of "discovered → indexed" on a new domain. Targets: Visit Calaveras / Calaveras Visitors Bureau, the town chambers, the venues themselves (they'll link to a page listing their events), Bear Valley Resort, Calaveras Enterprise / Union Democrat, GoCalaveras, and Rob's own LinkedIn/socials. Draft outreach in Rob's voice (see [system/SOUL.md](/Users/robgabel/rob-ai/system/SOUL.md)).

**3b. Standing Request-Indexing habit.** After each deploy or when a marquee event/town page lands, Request Indexing the affected keystone URLs. One-time bulk in this cut; light recurring touch after.

**3c. Confirm Bing indexing.** Bing indexes new domains faster and feeds ChatGPT/Copilot (the AEO play). Already set up per AEO-SEO-MEASUREMENT.md; verify coverage as a leading indicator.

**3d. (Optional) Google Business Profile** for local-pack/Maps intent. Parked in the measurement doc; revisit if local-pack visibility becomes a goal.

### Tier 4 — Measure

- **GSC:** core-sitemap indexed % (now isolated), Events rich-result validity, impressions/clicks on town + "this weekend" queries, and the size of the "Discovered – currently not indexed" bucket month over month (expect it to shrink for money pages fast, and the recurring tail to stay partially unindexed — acceptable).
- Fold the core-sitemap line into the monthly log in [AEO-SEO-MEASUREMENT.md](AEO-SEO-MEASUREMENT.md).

## Exit criteria / decision gates

- **Tier 1 success (4–8 weeks):** every page in `/sitemap-core.xml` shows "Indexed" in GSC; the "Discovered – currently not indexed" bucket trends down; first impressions appear on town + "this weekend" queries.
- **Trigger Tier 2a (canonical series pages)** if, after Tier 1 + a few backlinks, the event long tail is still largely unindexed *and* recurring instances are the bulk of it — i.e. once the money pages are healthy, attack the duplication at its root.
- **Trigger Tier 2b (category hubs)** if GSC shows query demand we have no dedicated page for (e.g. "live music murphys" impressions landing on weak pages).
- **Do not** chase 100% event-URL indexing. If money pages are indexed and ranking, the system is working.

## Appendix — Tier 1 keystone URLs for manual GSC Request Indexing

Evergreen money pages (do these first — permanent, rankable):
```
https://hwy4events.com/
https://hwy4events.com/this-weekend
https://hwy4events.com/this-week
https://hwy4events.com/this-month
https://hwy4events.com/towns/murphys
https://hwy4events.com/towns/arnold
https://hwy4events.com/towns/angels-camp
https://hwy4events.com/towns/bear-valley
https://hwy4events.com/towns/copperopolis
https://hwy4events.com/towns/avery
https://hwy4events.com/towns/camp-connell
https://hwy4events.com/towns/dorrington
https://hwy4events.com/towns/white-pines
https://hwy4events.com/about
https://hwy4events.com/faq
https://hwy4events.com/about/rob-gabel
```
Marquee near-term events (seasonal flavor; recur annually with real search demand):
```
https://hwy4events.com/events/arnold-independence-day-parade-2026-07-04-arnold
https://hwy4events.com/events/bear-valley-music-festival-2026-07-17-bear-valley
https://hwy4events.com/events/brice-station-vineyards-hilltop-concert-series-2026-06-06-murphys
https://hwy4events.com/events/cameo-plaza-summer-concert-leilani-the-distractions-2026-06-06-arnold
```

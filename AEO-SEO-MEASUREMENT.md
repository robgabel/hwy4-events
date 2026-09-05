# AEO & SEO Measurement — Hwy 4 Events

How to measure whether the site is winning in search (SEO) and in AI answer engines
(AEO) without paying for tooling. Companion to [PLAN-seo-aeo.md](PLAN-seo-aeo.md),
which covers the build. This doc is about the scoreboard, not the build.

**Status of the build (2026-05-28; sitemap note updated 2026-07-04):** the SEO foundation
is live. `app/robots.ts`, the sitemap (since 2026-06-03 a `<sitemapindex>` over
`sitemap-core.xml` + a crawl-trimmed `sitemap-events.xml` — see PRD-search-indexing.md),
JSON-LD across every page type (`lib/schema.tsx`), `metadataBase`, OG images, and
Cloudflare Web Analytics (`NEXT_PUBLIC_CF_BEACON_TOKEN`) are all shipped. What was
missing was *measurement*. That is what this doc sets up.

---

## The one-line answer

SEO success is measurable for $0 and in near real time (Google Search Console + Bing).
AEO success has no free dashboard, so we proxy it two ways: AI-engine referral traffic
(automatic, free) and a monthly manual prompt audit (15 minutes, free). Set up the three
free accounts once, then run the prompt audit on the first of each month.

---

## Part 1 — One-time free setup (~30 min total)

### 1.1 Google Search Console (the single highest-leverage move)
- Go to https://search.google.com/search-console, add `hwy4events.com` as a **Domain**
  property (not URL-prefix — Domain covers www + http + https in one).
- Verify via DNS TXT record (wherever the domain's DNS lives — likely Cloudflare or the
  registrar). One record, propagates in minutes.
- Submit the sitemap: in GSC, Sitemaps → enter `sitemap.xml` → Submit.
- Done. Data starts accruing within 1–3 days. Free forever, no traffic limits.

### 1.2 Bing Webmaster Tools (the sneaky AEO move)
- Go to https://www.bing.com/webmasters, add the site.
- Easiest path: "Import from Google Search Console" (one click once GSC is verified).
- Submit the same sitemap.
- Why bother: Bing's index powers ChatGPT search and Microsoft Copilot. Ranking in Bing
  is a leading indicator of getting cited by those engines. Free.

### 1.3 Confirm Cloudflare Web Analytics is recording
- Already wired in `app/layout.tsx` (line ~112, gated on `NEXT_PUBLIC_CF_BEACON_TOKEN`).
- Confirm the env var is set in Vercel prod and that the dashboard at
  https://dash.cloudflare.com/?to=/:account/web-analytics shows pageviews.
- If it is empty, the token is missing in Vercel. That is the only likely failure.

### 1.4 (Optional, free) Google Business Profile
- Not the website, but for a hyperlocal site it feeds the same local-intent queries.
- Skip unless we want the site to show in Google Maps / local pack. Park for now.

---

## Part 2 — SEO scoreboard (check monthly, all free, all automatic)

Everything here lives in Google Search Console unless noted. Budget 10 minutes/month.

| Metric | Where | What good looks like | Why it matters |
|---|---|---|---|
| **Total impressions** | GSC → Performance | Trending up month over month | Are we showing up at all |
| **Total clicks** | GSC → Performance | Up, and CTR > ~2–3% | Showing up *and* getting picked |
| **Avg position** | GSC → Performance | Moving toward 1–10 for local queries | Page-1 is the only page that matters |
| **Top queries** | GSC → Performance → Queries | Local intent: "murphys events", "things to do arnold ca" | Confirms we rank for what locals search |
| **Top pages** | GSC → Performance → Pages | Town pages + event pages, not just homepage | Deep pages ranking = the strategy working |
| **Indexed pages** | GSC → Indexing → Pages | Event + town + static pages all "Indexed" | If a page is not indexed it cannot rank |
| **Rich result status** | GSC → Enhancements → Events | "Valid" with 0 errors | Confirms `Event` JSON-LD is accepted, unlocks event rich snippets |
| **Organic sessions** | Cloudflare Analytics | Up; referrer = google/bing | The actual traffic payoff |

**The three numbers to glance at first each month:** impressions (reach), clicks
(payoff), and indexed-page count (coverage). If all three trend up, SEO is healthy.

### A note on rich results
Once GSC's Events enhancement report goes "Valid," upcoming events become eligible for
Google's event rich snippets (date/location shown directly in results, and inclusion in
the Google "Events" experience). That report is the cleanest signal that the structured
data in `lib/schema.tsx` is doing its job. Check it the first month after GSC is live.

---

## Part 3 — AEO scoreboard

There is no Search Console for ChatGPT, Perplexity, Gemini, or Google AI Overviews.
Paid tools exist (Profound, Otterly, Peec) but run $100+/mo and are overkill for one
local site. Two free methods instead.

### 3.1 AI-engine referral traffic (automatic proxy)
When an answer engine cites the site and a user clicks the citation, it shows up as a
referral. In Cloudflare Analytics (or GSC referrers), watch for these sources:

- `chat.openai.com` / `chatgpt.com`
- `perplexity.ai`
- `gemini.google.com`
- `copilot.microsoft.com`
- `bing.com` (Copilot answers)

Rising clicks from these = our content is being cited in AI answers. This is the single
best free AEO signal and it requires zero ongoing effort once analytics is live. Log the
monthly count in the table in Part 4.

### 3.2 Monthly prompt audit (manual, 15 min, the real scorecard)
Referral traffic only tells you about *clicks*. Most AI answers get read without a click,
so the only way to know if we are *cited* is to ask the engines ourselves. Once a month,
run the query bank below through ChatGPT (search on), Perplexity, and Google (check the AI
Overview at the top), and log the result.

For each query, record:
- **Cited?** Did Hwy4Events appear as a source / get linked?
- **Rank** among cited sources (1 = first/most prominent, or "not cited").
- **Accurate?** Was the info pulled correct, or did the engine garble dates/venues?

Accuracy matters as much as citation: a wrong date quoted by ChatGPT is worse than no
citation. If an engine quotes us wrong, that is a content bug to fix (usually a stale
cadence/hours claim — see the voice rules in CLAUDE.md).

#### Query bank (grounded in the 7 personas + 9 coverage towns)
Rotate or add to these. They mirror how a real local or visitor would ask an LLM.

**Town / general discovery (Gary, Rob, Miguel):**
1. What's happening this weekend in Murphys, CA?
2. Things to do in Arnold, California this weekend
3. Events near Bear Valley, CA this month
4. Family-friendly events in Calaveras County this weekend
5. What is there to do on Highway 4 in the Sierra foothills?

**Category-specific (Mia, Gary):**
6. Live music in Murphys this weekend
7. Wine events near Murphys, CA
8. Festivals in Calaveras County this summer
9. Farmers market or community events in Angels Camp

**Visitor / trip-planning intent (Rob, Karen, Miguel):**
10. I'm visiting Arnold CA for the weekend, what events are on?
11. Day trip from Stockton to the Sierra foothills, what's happening?

**Long-tail / answer-engine shaped (mirrors FAQ + Q&A blocks):**
12. Where can I find a calendar of events for the Highway 4 corridor?
13. What towns are between Angels Camp and Bear Valley and what happens there?

Target outcome: over a few months, "cited" rate climbs and rank improves, especially on
the town and "this weekend" queries (the killer view per PERSONAS.md). The named-entity
and Q&A-block voice rules in CLAUDE.md are exactly what wins these, so the audit closes
the loop back to content.

---

## Part 4 — Monthly log

Copy this block on the 1st of each month and fill it in. Five minutes for SEO numbers,
ten for the prompt audit.

```
### 2026-MM

SEO (Google Search Console, trailing 28 days):
- Impressions:           (vs last month:  )
- Clicks:                (vs last month:  )
- Avg position:
- Indexed pages:         / total submitted
- Events rich result:    Valid / Errors / not yet showing
- Top 3 queries:
- Top 3 pages:

AEO referrals (Cloudflare, trailing 28 days):
- chatgpt:   |  perplexity:   |  gemini:   |  copilot:   |  bing:

AEO prompt audit (cited? / rank / accurate?):
- Q1 weekend Murphys:
- Q2 Arnold weekend:
- Q3 Bear Valley month:
- Q6 live music Murphys:
- (run the rest of the bank; note any wrong info to fix)

Notes / actions for next month:
```

### 2026-07 (logged retroactively 2026-09-05)

Method note: reconstructed from the data the collectors banked at the time
(`seo_snapshots` daily spine + by-query/by-page snapshots captured 2026-08-01;
`analytics_daily.ai_referrals`). Figures are the CALENDAR month, not the
template's as-of-the-1st trailing window. The prompt audit was not run in July
and cannot be run retroactively.

SEO (calendar July):
- Impressions: 22,872 (vs June: 14,174)
- Clicks: 1,270 (vs June: 765); CTR 5.6%
- Avg position (impression-weighted): 7.5
- Indexed pages: not collected (GSC Indexing report is not in the collector)
- Events rich result: not checked retroactively
- Top 3 queries (28d window as of Aug 1): "murphys 4th of july" (16 clicks, pos 1.9); "arnold 4th of july parade 2026" (11, pos 1.9); "arnold ca 4th of july parade 2026" (10, pos 1.9)
- Top 3 pages: the Murphys Hotel July-4 event (97 clicks), the Arnold Independence Day Parade (73), the Murphys 4th of July Parade (65)

AEO referrals (calendar July):
- chatgpt: 2  |  perplexity: 0  |  gemini: 2  |  copilot: 0  |  bing: 0

AEO prompt audit: NOT RUN (missed at the time; unrecoverable).

Notes: the month was the July-4th story. Clicks were heavily front-loaded
(roughly 693 of the 1,270 landed July 1-4), all on the dated 2026 event slugs.
This is exactly the equity the year-less holiday guides + seasonal redirects
(HWY-6) exist to retain into 2027.

### 2026-08 (logged retroactively 2026-09-05)

Same method note as 2026-07 (by-query/by-page snapshots captured 2026-09-01).
Prompt audit not run in August; unrecoverable.

SEO (calendar August):
- Impressions: 15,443 (vs July: 22,872)
- Clicks: 658 (vs July: 1,270); CTR 4.3%
- Avg position (impression-weighted): 8.5
- Indexed pages: not collected
- Events rich result: not checked retroactively
- Top 3 queries (28d window as of Sep 1): "arnold car show 2026" (14 clicks, pos 1.6); "brice station concerts 2026" (12, pos 5.5); "arnold car show" (9, pos 2.1)
- Top 3 pages: Car Show & Chili Cookoff Aug 15 (106 clicks); /venues/brice-station (42); 21st Arnold Classic Car Show (35)

AEO referrals (calendar August):
- chatgpt: 3  |  perplexity: 0  |  gemini: 0  |  copilot: 0  |  bing: 0

AEO prompt audit: NOT RUN (missed at the time; unrecoverable).

Notes: the drop from July is the holiday hangover, not decay; the ex-holiday
baseline is in line with June. Two structural wins visible: event-shaped
queries land at position 1-2 (the car shows), and /venues/brice-station is a
top-3 page, which is the venue-hub strategy (HWY-9) earning search traffic
exactly as designed. "brice station concerts 2026" sits at position ~5 with a
live hub page: striking distance.

### 2026-09 (logged 2026-09-05)

SEO (Google Search Console, trailing 28 days, Aug 8 - Sep 4):
- Impressions: 13,724 (vs prior 28d as of Aug 1: 16,101)
- Clicks: 600 (vs 577); CTR 4.4%
- Avg position (impression-weighted): 8.6
- Indexed pages: not collected (candidate collector improvement)
- Events rich result: not checked this pass
- Top 3 queries (latest capture): "brice station concerts 2026" (13 clicks, pos 4.6); "arnold car show 2026" (13, pos 1.8); "arnold car show" (9, pos 2.0)
- Top 3 pages: Car Show & Chili Cookoff (102); /venues/brice-station (45); 21st Arnold Classic Car Show (32)

AEO referrals (Sep 1-4 so far):
- chatgpt: 2  |  perplexity: 0  |  gemini: 0  |  copilot: 0  |  bing: 0

AEO prompt audit (engine: Claude with web search, run 2026-09-05. ChatGPT,
Perplexity, and Google AI Overviews need a human at those UIs and were not
run this pass; treat this as a one-engine sample):
- Q1 weekend Murphys: CITED, rank ~5 of 8 sources (/towns/murphys); the
  engine's answer visibly drew on our own copy (Irish Pub "busiest live music
  room", Wednesday open mic). Accurate.
- Q2 Arnold weekend: NOT cited (Eventbrite, Yelp, travel blogs own the
  results).
- Q3 Bear Valley month: NOT cited, and a real hazard: the engine mixed Big
  Bear Lake (SoCal) events into the answer. One correct local detail
  (Hermitfest West, Sep 6) matches our data but arrived unattributed.
- Q6 live music Murphys: NOT cited in sources, though the answer prose again
  mirrors our copy; the engine pointed readers at visitmurphys and
  gocalaveras.
- Q12 corridor calendar: CITED x3 (/date-night, /this-week, homepage) and
  effectively rank 1: the answer recommends Hwy4Events.com by name, with the
  Thursday newsletter and Angels Camp-to-Bear Valley span stated correctly.

Notes / actions for next month:
- Disambiguate Bear Valley vs Big Bear Lake explicitly in /towns/bear-valley
  copy and any Bear Valley guide Q&A (the Q3 conflation is winnable AEO
  ground; nobody else local is fighting it).
- "brice station concerts 2026" at position ~4.6 with a live venue hub is the
  top striking-distance target; the hub already exists, consider an FAQ/Q&A
  block on it.
- The Arnold weekend query (Q2) is the biggest citation gap; our /towns/arnold
  page ranks for none of the generic-intent phrasing.
- Answer engines quote our copy without linking (Q1, Q6): the named-entity
  voice strategy is being read; citation follows authority, so the backlink
  work in BUSINESS-PLAN stays the lever.
- Candidate automation: the collector could pull GSC's Indexing coverage so
  "indexed pages" stops reading "not collected" in this log.

---

## Part 5 — Automation (built)

The SEO side is already automatic (GSC/Cloudflare collect continuously). Only the prompt
audit needs a human, because the engines actively block scraping their answers.

The monthly **reminder** is wired: `/api/aeo-audit-reminder` (Vercel cron, `0 16 1 * *`
= 1st of month, 8am PT) posts the 13-query checklist to Slack via `SLACK_WEBHOOK_URL`.
It is a reminder only — it does not run the audit. A human reads the AI answers, judges
citation accuracy, and logs results in the Part 4 template. Smoke-test anytime:

```sh
curl -H "Authorization: Bearer $CRON_SECRET" https://hwy4events.com/api/aeo-audit-reminder
```

**Enforcement (added 2026-07-04):** the reminder alone proved insufficient (June 2026 was
never logged). The **doc-freshness** GitHub Action
([.github/workflows/doc-freshness.yml](.github/workflows/doc-freshness.yml), Mondays)
greps this file for a `### YYYY-MM` entry matching the current month and files a GitHub
issue if it is missing after the 7th — a binding trigger, not a reminder. Clear it by
logging the entry, not by closing the issue.

---

## Open items
- [x] Verify GSC domain property + submit sitemap (2026-05-28)
- [x] Import to Bing Webmaster Tools (2026-05-28)
- [x] Confirm Cloudflare Web Analytics is recording (2026-05-28 — live, site created 2026-05-26)
- [x] Monthly prompt-audit reminder built (`/api/aeo-audit-reminder`, cron `0 16 1 * *`, 2026-05-28)
- [x] Confirmed `SLACK_WEBHOOK_URL` posts to #hwy4 (smoke-tested 2026-05-28, message delivered)
- [x] First monthly log entries — logged 2026-09-05 as a catch-up: 2026-07 and
  2026-08 reconstructed from the collectors' banked data (their prompt audits were
  missed at the time and are marked NOT RUN), 2026-09 logged on schedule with a
  one-engine prompt audit. June 2026 predates reliable data and stays unlogged.

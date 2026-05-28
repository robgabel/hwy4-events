# AEO & SEO Measurement — Hwy 4 Events

How to measure whether the site is winning in search (SEO) and in AI answer engines
(AEO) without paying for tooling. Companion to [PLAN-seo-aeo.md](PLAN-seo-aeo.md),
which covers the build. This doc is about the scoreboard, not the build.

**Status of the build (2026-05-28):** the SEO foundation is already live. `app/robots.ts`,
`app/sitemap.ts` (static pages + published towns + all upcoming events), JSON-LD across
every page type (`lib/schema.tsx`), `metadataBase`, OG images, and Cloudflare Web
Analytics (`NEXT_PUBLIC_CF_BEACON_TOKEN`) are all shipped. What is missing is
*measurement*. That is what this doc sets up.

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

---

## Open items
- [x] Verify GSC domain property + submit sitemap (2026-05-28)
- [x] Import to Bing Webmaster Tools (2026-05-28)
- [x] Confirm Cloudflare Web Analytics is recording (2026-05-28 — live, site created 2026-05-26)
- [x] Monthly prompt-audit reminder built (`/api/aeo-audit-reminder`, cron `0 16 1 * *`, 2026-05-28)
- [x] Confirmed `SLACK_WEBHOOK_URL` posts to #hwy4 (smoke-tested 2026-05-28, message delivered)
- [ ] First monthly log entry after GSC has ~2 weeks of data (~mid-June 2026)

# CONTENT-MAP.md

Where every piece of human- or LLM-authored copy on hwy4events.com lives, and how it
flows from source to screen. Built for the Voice & Content Quality System work
(`PRD: Hwy4Events Voice & Content Quality System`, June 9 2026). Read this before
touching any content surface.

> **TL;DR of the architecture:** there is **no shared prompt/voice module** — every
> generator carries its own inline system prompt. There is **no description sanitizer**
> and **no quality gate**; scraped junk and LLM stubs render as-is. Town/FAQ/About copy
> is **static source code**, not a CMS. Quality work therefore splits cleanly: render-time
> guards (pure functions in `lib/`, no DB mutation, self-healing) for the live fixes, and
> a single `content/VOICE.md` injected into each inline prompt for the voice work.

---

## 1. Town-page prose

- **Stored as static TypeScript**, not MDX or Supabase: [`app/towns/town-content.ts`](../app/towns/town-content.ts) —
  a `TOWN_CONTENT` registry of `TownContent` objects (`intro[]`, `personaNotes`,
  `worthKnowing`, `faqs`, `metaDescription`, `lastVerified`, optional `draft`).
- **Rendered by** [`app/towns/[slug]/page.tsx`](../app/towns/[slug]/page.tsx).
- **Drafted by** [`scripts/draft-town-content.ts`](../scripts/draft-town-content.ts) (Opus,
  `claude-opus-4-7`; system prompt ~L76–173). The script **prints JSON to stdout**; Rob
  reviews and pastes into `town-content.ts` by hand. It already enforces no-em-dash +
  a banned-phrase list post-generation and refuses to emit violations.
- **Distinctive-string anchors** (per §3): `"burned me more than once"`, `"Worth knowing"`,
  `"if this gets too busy"` all resolve here.
- **Known fingerprints in this file:**
  - `town-content.ts:241` — **the live editorial leak** `(Rob: if this gets too busy, this bullet comes off the site.)` on the Arnold / Sequoia Woods bullet. (WS-1.1)
  - `town-content.ts:125` and `:293` — `"punches above its weight"` ×2 (Murphys-area; Avery/Day-O). (WS-4)
  - `town-content.ts:479` `"legitimate dinner option"` and `:515` `"legitimate dinner stop"` — duplicate construction on Copperopolis. (WS-4)

## 2. Daily "Millie" briefing

- **Routes:** [`app/api/generate-briefing/route.ts`](../app/api/generate-briefing/route.ts)
  (`SYSTEM_PROMPT` ~L11–27, model `claude-opus-4-7` ~L152) and
  [`app/api/generate-weekend-briefing/route.ts`](../app/api/generate-weekend-briefing/route.ts)
  (`WEEKEND_SYSTEM_PROMPT` ~L11–27).
- **Storage:** `site_config` keys `weekly_briefing` / `weekend_briefing` (+ `_date`,
  weekend `_label`); archived to `briefing_history` (used for an anti-repetition lookback
  already passed into the prompt).
- **Cron:** `vercel.json` — daily `0 14 * * *`, weekend `0 14 * * 5`.
- **Rendered by** `components/WeeklyBriefing.tsx` (also builds an `Article` JSON-LD with a
  naive `briefing.slice(0, 280)` — see §6).
- **Voice today:** signed "— Millie 🐾", warm/dry, one dog reference max. This is the
  surface WS-6 (shape rotation) targets.

## 3. Venue blurbs

- **Drafted by** [`scripts/draft-venue-blurbs.ts`](../scripts/draft-venue-blurbs.ts) (Opus,
  `claude-opus-4-7`; `SYSTEM_PROMPT` ~L42–83). Already enforces no-em-dash + banned phrases
  (~L152–158) and **skips writing** any blurb that trips a rule (~L234–250).
- **Stored** in `hwy4_venues.blurb` (+ `blurb_generated_at`); **rendered** by
  [`components/VenueInfo.tsx`](../components/VenueInfo.tsx) on the event detail page.
- Distinctive anchors `"hides behind the wine bar"`, `"reason a lot of us first came up"`
  live as DB blurb rows (not in source). The PRD's "punches above its weight" in a
  "Pourhouse blurb" / "Arnold Ace" is **DB blurb text**, not code — remediate via the
  blurb data, not a file edit.

## 4. Event descriptions (ingestion)

The same `hwy4_events.description` column is fed by **three different shapes** of writer.
There is **no column tagging which shape produced a given row** (source type is implicit in
`source_name`/`org_slug`).

| Writer | File | Description origin |
|---|---|---|
| GoCalaveras | [`scripts/scrapers/gocalaveras.ts`](../scripts/scrapers/gocalaveras.ts) (`htmlToText` ~L495–512; detail-page enrich ~L584–660) | **(a) verbatim source** (HTML-stripped EventON `eventon_desc_in`) |
| Bistro Espresso | [`scripts/scrapers/bistro-espresso.ts`](../scripts/scrapers/bistro-espresso.ts) (~L208) | **(a) verbatim source** (from JS bundle) |
| Red Cross | [`scripts/scrapers/red-cross.ts`](../scripts/scrapers/red-cross.ts) (~L209–213) | **(c) hardcoded template stub** |
| Generic Firecrawl | [`scripts/lib/extract.ts`](../scripts/lib/extract.ts) (prompt ~L93–121, `claude-sonnet-4-6` ~L128) | **(b) LLM rewrite/stub** ("1–2 sentence description") |
| Blue Lake Springs (Vision) | [`app/api/scrape-bls/route.ts`](../app/api/scrape-bls/route.ts) (prompt ~L48–79, Sonnet vision) | **(b) LLM stub** from flyer image |
| Moose Lodge (PDF) | [`app/api/scrape-moose-lodge/route.ts`](../app/api/scrape-moose-lodge/route.ts) (prompt ~L197–238, Haiku) | **(b) LLM stub** from PDF (already has a no-em-dash rule) |

- **Shared write path:** all `upsertEvents` scrapers funnel through
  [`scripts/lib/dedup.ts`](../scripts/lib/dedup.ts); the three raw-insert writers
  (scrape-bls, scrape-moose-lodge, bistro-espresso) bypass it. A **render-time** guard is
  therefore the only way to cover every path at once without touching six writers.
- **Sanitization today:** only HTML-tag/entity stripping per-scraper. **No calendar-widget
  junk removal** anywhere (the "Add to calendar / Google Calendar / iCalendar / Outlook"
  text on the Boyle MacDonald "Live Music Upstairs" row is unfiltered). (WS-1.2)
- **Quality-relevant existing columns:** `description_locked` (mig `20260530b`),
  `price_locked`, `cost_tier`, `price_extracted_at`, `needs_verification`,
  `verification_status`. **No `needs_review`, no `confidence`, no `pick_reason`** columns
  exist yet (WS-2/WS-7/WS-8 add what they need).

## 5. Rob's Picks

- **`hwy4_events.robs_pick` is a hand-curated boolean** — **not LLM-generated**, and there
  is **no `pick_reason` column** (WS-7 adds it). `lib/types.ts` declares it; passed through
  in `lib/events-data.ts`.
- Surfaced two ways: (1) the briefing prompt tags pick events `[ROB'S PICK]`
  (`generate-briefing/route.ts` ~L103) and lets Opus reference them in prose — there is **no
  separate "Rob's Pick blurb" generator**; (2) bespoke feature banners with **hardcoded
  copy**, including the WS-7 reference failure: [`components/ClassicRockBanner.tsx:56–59`](../components/ClassicRockBanner.tsx)
  — *"…dance like the parking lot is full of muscle cars."* (Flashback @ Moose Lodge).
- "Always a good time up at the Moose" (open Q#1) — grep it in card/banner components
  before WS-7; confirm with Rob whether it's his line.

## 6. Meta descriptions

- **Event detail:** [`app/events/[slug]/page.tsx`](../app/events/[slug]/page.tsx) ~L123–125
  builds OG + Twitter description with `event.description.slice(0, 155)` — **naive, cuts
  mid-word** (the `for purc` / `find a w` SERP fingerprints). (WS-2 fix: truncate at last
  sentence ≤155, else last word + `…`.)
- **Briefing Article schema:** `components/WeeklyBriefing.tsx` ~L107 `briefing.slice(0, 280)`
  — same mid-word risk.
- Town meta descriptions come from `town-content.ts` `metaDescription` (authored, fine).
- FAQ/static page metadata is hand-written in each `page.tsx`.

## 7. FAQ

- **Static array** in [`app/faq/page.tsx`](../app/faq/page.tsx) `faqs[]` (L12–53), rendered
  as `<details>` and emitted as `FAQPage` JSON-LD (L55–75) — **answers must be updated in
  both the array and the schema, they share the same strings**.
- **Confirmed problems:** `"numerous festivals"` (L26); `"the most complete and up-to-date
  listing available"` (L36); `"Yes!"` opener (L31); and the **site contradiction** (L51):
  the submit answer says "reach out through the community channels" while every page links
  `/submit`. (WS-5)

---

## Cross-cutting facts for implementation

- **No shared prompt module.** Inline system prompts live in: `generate-briefing`,
  `generate-weekend-briefing`, `lib/newsletter.ts` (`NEWSLETTER_SYSTEM_PROMPT`),
  `draft-venue-blurbs.ts`, `draft-town-content.ts`, `scripts/lib/extract.ts`,
  `scrape-bls`, `scrape-moose-lodge`, plus the agent prompts in `lib/agent/*`. WS-3 wires
  `content/VOICE.md` into each by reference.
- **Tests + CI already exist.** `scripts/package.json` → `"test": "tsx --test test/*.test.ts"`;
  tests live in `scripts/test/*.test.ts` (node:test, import `lib` via `.js` ESM specifiers,
  zero extra deps). `.github/workflows/test.yml` runs `cd scripts && npm test` on PRs
  touching `lib/**` / `scripts/**`. WS-4's voice lint plugs in here.
- **Anthropic SDK** `@anthropic-ai/sdk` is a dep of both root and `scripts/`. Models in use:
  `claude-opus-4-7` (briefings, newsletter, venue/town drafts), `claude-sonnet-4-6`
  (extract, vision, agents), `claude-haiku-4-5` (moose PDF, price extraction).
  *(Side note: the workspace's newest Opus is 4.8 — model freshness is out of scope for this PRD.)*
- **DB-mutation philosophy** (matches this repo's reconcile/backfill convention): live
  user-facing fixes ship as **render-time pure functions** (`lib/`) so no prod write is
  required and they self-heal on re-scrape. Backfill/data-fix scripts go under
  `scripts/content-fixes/`, are **idempotent and dry-run by default**, and only mutate prod
  after review.

---

## WS-1 / WS-2 implementation notes (verified June 9 2026)

- **Description gate** = `lib/description-quality.ts` (`sanitizeDescription`, `assessDescription`,
  `displayDescription`, `gateEventDescription`, `truncateMeta`). Locked by
  `scripts/test/description-quality.test.ts` (14 tests; real audit fixtures). Wired at the
  two read loaders (`lib/events-data.ts` after dedupe; `lib/events.ts` findEventBySlug),
  the event meta (`app/events/[slug]/page.tsx` truncateMeta), and the briefing Article
  schema (`components/WeeklyBriefing.tsx`). Write-time sanitize lives in
  `scripts/lib/dedup.ts::normalizeEventLocation` (covers both upsert paths).
- **Verified live** (local dev vs prod Supabase, anon key): `/towns/arnold` leak gone;
  homepage list **0** widget-junk tokens; event detail About section + all JSON-LD + meta
  all clean; Bistro Espreso typo → 0 remaining.
- **Known non-visible artifact:** the event detail page's **RSC hydration payload**
  (`__next_f`) still serializes a raw event description (it's the full `findEventBySlug`
  shape, but no client component on the route receives the full event — it's framework
  serialization). It is **not** in visible DOM, JSON-LD, or meta, so readers and AEO/SEO
  crawlers never see it. The data-layer cleanup resolves it: once
  `scripts/content-fixes/sanitize-descriptions.ts --apply` runs in prod (needs
  `SUPABASE_SERVICE_ROLE_KEY`), the stored text is clean and every read path — flight
  payload included — is clean. Write-time sanitize keeps new scrapes clean going forward.
- **Deferred from WS-2:** the `rewrite` verdict (heavily-stripped or >1200 chars) currently
  still **renders** the cleaned text and flags it (in `--report`); it does **not** yet
  auto-send to Haiku for a rewrite at ingestion (PRD WS-2 "rewrite" path). Low priority —
  the cleaned text is acceptable; auto-rewrite adds per-row LLM cost.

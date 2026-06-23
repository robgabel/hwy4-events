# Eugene Harvest + Musk-Lens Simplification

Compiled: 2026-06-23
Status: **artifact-only** — analysis + ready-to-pick-up tickets. No code changes. The symmetric counterpart to Peter's `docs/research/upstream-harvest-analysis.md` on `this-week-in-eugene`.

## Purpose

Two jobs in one pass, ranked together by **leverage** (value to hwy4 ÷ effort, weighted toward correctness and toward deletion):

1. **Harvest** — engine hardening Peter built on the Eugene fork that fills a real gap in hwy4.
2. **Simplify** — accreted complexity in *our own* stack worth deleting or collapsing.

Organizing lens is Musk's five-step algorithm: **(1) make the requirement less dumb → (2) delete the part → (3) simplify → (4) accelerate → (5) automate.** Most of what follows is steps 1–3. The single most important bias: *the best part is no part.*

## Method

- Diffed `eugene/codex/eugene-bootstrap` against `origin/main` (266 files, but ~70% is Eugene-local rebrand — ignored). Read the Jun 22 thread, Peter's `upstream-harvest-analysis.md`, and his two upstream tickets.
- Then **verified every claim against our actual code** (file:line below) rather than trusting CLAUDE.md. That check corrected three assumptions — see Headline.

## Headline findings (including 3 self-corrections)

1. **Our category classifier has a confirmed correctness hole.** Keyword rules are only a *floor that rescues `"other"`* — a confident-wrong LLM still wins on any specific category. `gocalaveras.ts:770-778` literally comments "Only let the LLM *upgrade* to a specific category." Peter hit the same design and fixed it (his `fine_arts` was 42% of the whole feed). This is the highest-value grab.
2. **CORRECTION — HTML sanitize is NOT absent (I was wrong).** We already centralize entity-decode (`scripts/lib/extract.ts:46-70`, `decodeEventFields`) + description sanitize (`lib/description-quality.ts:113`, `sanitizeDescription`, called at the upsert boundary `scripts/lib/dedup.ts:154`). Remaining open question: our sanitize strips widget-junk + decodes entities but the code read did **not** show raw HTML-*tag* stripping. Likely the same tag-bleed Peter fixed — but a small patch on an existing shared layer, not a new system.
3. **CORRECTION — `src` arrival-channel attribution is SHIPPED AND LIVE, not "Phase 4 pending."** Migration `20260609d_site_events_src.sql` applied; `lib/track.ts:24-48` computes first-touch `src`; `app/api/track/route.ts:74` persists it; `app/admin/analytics/page.tsx:615-634` renders "Arrival channels." It is **ungated** for us (Peter's fork plans to gate it behind `SITE_EVENTS_SRC_ATTRIBUTION`). **Our CLAUDE.md is stale** — fix the map.
4. **CORRECTION — only 3 lock flags live in the scraper path** (`price_locked`, `description_locked`, `poster_locked` in `dedup.ts`); `places_locked` is in the venue-facts path, not the dedup path. The real smell is the lock-ternary repeated **9 times** across batched/serial/change-detect payloads.
5. **The relationship is bidirectional, like Peter's doc said.** We're *ahead* on the newsletter Batch API and on weather/categorize (those originated here). Most of what Peter sent "the other way" is already covered for us or low-value for our feed (appendix).

## Priority table (ranked by leverage)

| # | Item | Direction | Value (hwy4) | Effort | Verdict |
|---|---|---|---:|---|---|
| **1** | Authoritative classifier (keyword vetoes LLM) | HARVEST | 5/5 | S–M | **Do now** — ticket 01 |
| **2** | Delete dead code: `is-outdoor-event.ts` + `WeatherStrip.tsx` | DELETE | 4/5 | XS | **Do now** — 150 LOC, zero risk |
| **3** | Revalidation secret → header (out of URL/logs) | HARVEST/SEC | 4/5 | XS | **Do now** — ticket 03 |
| **4** | Fix stale CLAUDE.md (`src` is live) + verify tag-strip | FIX-DOC | 3/5 | XS | **Do now** — free, keeps map = territory |
| **5** | Start reconcile canary → later delete read-time dedup | DELETE | 5/5 | XS now / M later | Flip `RECONCILE_EXECUTE=true`, watch 4 wks, then delete `dedupe-events.ts` (175 LOC) |
| **6** | Newsletter `send_log` ledger (idempotent sends) | HARVEST | 4/5 | M | Schedule — `HANDOFF-newsletter-reconcile.md` already specs it; Peter has the impl |
| **7** | Parse-time non-event filter (drop deadlines/notices) | HARVEST | 2–3/5 | S | Cheap insurance — lower value for our feed than Eugene's |
| **8** | Extract `buildMutableFields()` helper (kill 9× lock ternary) | REFACTOR | 3/5 | S | Do next time `dedup.ts` is open |
| **9** | Collapse 3 schedule-watcher crons → 1 parameterized | DELETE | 3/5 | M | Do when a 4th watcher appears (the pattern is about to multiply) |
| **10** | `/admin/freshness` source-health dashboard | HARVEST | 3/5 | M | Upgrade over Slack-only audit; nice-to-have |
| **Q** | Question the cockpit's dormant staging | SIMPLIFY? | — | — | Strategic flag, not a ticket — see below |

**Even split check:** engine = #1, 5, 6, 7; admin = #2, 3, 10, Q; doc = #4; both = #8, 9. ✔

---

## Tier 1 tickets (do-now)

### Ticket 01 — Authoritative classifier — value 5/5, effort S–M
**Problem.** `lib/categorize.ts` `classifyEventCategory` is keyword-first, but at the call sites the keyword result is only a *floor*: `scripts/scrapers/gocalaveras.ts:706-778` and `scripts/lib/facebook-events.ts:326-385` "only let the LLM upgrade to a specific category." So a high-confidence keyword (`wine`, `trivia`, `opera`, `pottery`) loses to any confident-wrong LLM guess that isn't `"other"`. Visit Murphys (`visit-murphys.ts:101`) has no LLM and is unaffected.
**Fix (mirror Peter's `classifyEventCategoryDetailed`).** Return `{category, rule, authoritative, boundedReclassify}`:
- `authoritative` — a high-confidence keyword match **wins over the LLM**, not just over `"other"`. Add a curated authoritative keyword set (the unambiguous ones: bingo, trivia, opera, pottery/painting, wine tasting, blood drive).
- Strip venue-boilerplate before classifying (a venue blurb like "most beautiful concert venue" shouldn't push a comedy night into Live Music).
- Rule-ordering discipline: specific signals (staged works, comedy, presenters) resolve before a bare "concert."
- `boundedReclassify` — a narrow opt-in subset a repair backfill may touch, so cleanup is surgical.
**Acceptance.** An event whose title hits an authoritative keyword keeps that category regardless of LLM output; `npm test` + a new precedence test green; a dry-run backfill report shows what would move before any `--apply`.

### Ticket 02 — Delete dead code — value 4/5, effort XS
**Problem.** `lib/is-outdoor-event.ts` (32 LOC) is imported only by `scripts/test/weather.test.ts`; the outdoor gate was removed when weather went to every-event. `components/WeatherStrip.tsx` (118 LOC) is referenced only in comments, never mounted.
**Fix.** Delete both files; delete the `is-outdoor-event` assertions from `weather.test.ts`; grep the comment references in `lib/weather.ts` / `lib/weather-icons.ts` and tidy. *The best part is no part.*
**Acceptance.** `npm test` + `npm run build` green; grep for `isOutdoorEvent`/`WeatherStrip` returns nothing.

### Ticket 03 — Revalidation secret → header — value 4/5, effort XS
**Problem.** `app/api/revalidate/route.ts:17` authenticates on `?secret=` (query string), and `scripts/warm-map-cache.ts:67` puts the secret in the URL — visible in access logs, proxy caches, browser history.
**Fix.** Accept `Authorization: Bearer <REVALIDATION_SECRET>` (keep query-param fallback one release for safety), and update `warm-map-cache.ts` to send the header. Rotate the secret after.
**Acceptance.** Warm-maps works via header; a request with the secret only in the URL is no longer required; secret absent from new logs.

### Ticket 04 — Fix the map (free) — value 3/5, effort XS
**Problem.** CLAUDE.md (PRD-growth-agent) lists "capture `src` in `site_events`" as Phase-4 **pending**; it is in fact **live and ungated** (Headline #3). Also note our impl is ungated vs Peter's gated plan.
**Fix.** Correct the CLAUDE.md line; while there, confirm whether `sanitizeDescription` strips raw HTML tags — if not, add a `stripHtml` step to the shared sanitize layer (small) so page-builder markup can't leak from any source (Headline #2).
**Acceptance.** Doc matches code; tag-strip question resolved (patched or confirmed unnecessary).

---

## Tier 2 — schedule deliberately

### #5 — Start the reconcile canary, then delete read-time dedup (the big one)
We run **four** dedup layers: read-time collapse (`lib/dedupe-events.ts`, called on every user read at `lib/events-data.ts:139`), write-time merge (`scripts/lib/dedup.ts`), continuous reconcile (`lib/reconcile.ts` + `/api/reconcile-dupes`), and the audit (`/api/check-events`). CLAUDE.md's own open item says: once reconcile runs live and the audit reports 0 surprising merges for **4 consecutive weeks**, downgrade then delete the read-time layer.

**The blocker is that the canary clock never started** — `reconcile-dupes/route.ts:42` defaults to dry-run; `RECONCILE_EXECUTE` is unset, so reconcile mutates nothing. Step 1 (make the requirement less dumb): *why are we maintaining a redundant layer while the thing that would retire it sits switched off?*

**Sequence:** flip `RECONCILE_EXECUTE=true` (XS) → watch `merges_last_24h` + same-event clusters in the daily audit for 4 weeks → then delete `dedupe-events.ts` (175 LOC) and its call sites (M). Read-time stays until then as the "no dupe ever reaches a user" guarantee — that caveat is real and the agent confirmed it; this is a *sequenced* deletion, not a now-deletion.

### #6 — Newsletter `send_log` ledger
Confirmed: we use `resend.batch.send` (`newsletter/send/route.ts:226`) but have **no per-recipient ledger** — a re-send re-blasts the whole list and relies on Resend's suppression. `HANDOFF-newsletter-reconcile.md` already specs the fix (adopt Peter's `newsletter_send_log` as backbone + keep our Batch API as transport → one idempotent `sendCampaign`, re-blasting structurally impossible). Peter has shipped the reference implementation (migration `20260619`). Guardrail: do **not** break the unsupervised Thursday auto-send or its veto gate.

### #7 — Parse-time non-event filter
Confirmed absent — nothing drops "application deadline / registration closes / submissions due" before insert (we only drop virtual events, out-of-corridor, past, and manual-source overwrites). Peter's `isNonEventCalendarNotice` is a cheap reusable guard at the write boundary. **Value is lower for us than Eugene** (GoCalaveras is a community aggregator, not a university firehose) — so this is cheap insurance, not urgent.

---

## Tier 3 — when the pattern multiplies

### #8 — `buildMutableFields()` helper
The lock-ternary `existing.X_locked ? {} : { X: event.X }` is repeated for 3 fields across 3 code paths = 9 sites (`dedup.ts` ~lines 498/501/505, 673/676/681, 691/694/705). Extract one `buildMutableFields(existing, event)` so a new lock can't be added to two paths and forgotten in the third. Do it the next time `dedup.ts` is open. *(Separately: the per-row re-lock-forever caveat on recurring events is a deeper identity issue — locks attach to the row, not the series — but that's a bigger change; note it, don't bundle it here.)*

### #9 — Collapse the 3 schedule-watcher crons
`check-lube-schedule`, `check-bigtrees-schedule`, `check-camp-connell-schedule` are ~60-65% identical boilerplate (auth → fetch → fingerprint → compare to `site_config` → Slack-ping). Collapse to one parameterized route + a config list `{venue, configKey, sourceUrl, fingerprintFn, slackTemplate}`. ~70 LOC saved, but the real value is **one shape to maintain before a 4th image-only venue forces a 4th copy.** Do it when that 4th watcher is needed.

### #10 — `/admin/freshness` dashboard
We have no per-source last-scrape / refreshed-in-24h view; a source going dark is only a line in the Slack audit. Peter built `/admin/freshness`. Worth porting as an ops upgrade once the higher-leverage items land.

---

## Strategic question (not a ticket): does the cockpit earn its complexity?

The Agent Cockpit is **fully built and structurally dormant** — `lib/agent/policy.ts:53-63` requires `auto_execute=true` to ever auto-run, and `agent_policy` seeds both action types `false` (`20260531d_agent_cockpit_stage1.sql:60-62`). 12 `/admin` pages; 5 agent routes (chief-of-staff, collect-seo, growth-memo, propose-actions, triage-submissions), all read/propose/advise-only.

Musk step 1 says question the requirement: at **one operator and modest traffic**, does every dormant stage earn its maintenance surface? *But* — this is deliberate build-in-public R&D **and** the portable asset the BUSINESS-PLAN monetizes at 30A/Los Gatos. So this is **a question for Rob, not a deletion.** If anything gets simplified, the candidate is merging the read-only digests (chief-of-staff `/today` + growth-memo + briefings are three reader pages over `agent_runs`) rather than touching the propose→approve→execute spine.

---

## Appendix — what Peter sent "the other way," and why most is low-value for us

- **WordPress wp-json feed adapter** — we already do WP REST for Visit Murphys; the generalized adapter is marginal unless a new WP source appears.
- **Squarespace-grid special scraper** — our one Squarespace source (Camp Connell General Store) publishes its lineup as an **image-only season poster**, which a grid parser can't read anyway. Low value.
- **TrackTown / Hayward parser** — Eugene track & field. Not portable. Skip.
- **dedup_key landmine lesson** — *never recompute a key field's hash in SQL; run an app-code backfill that calls the real `generateDedupKey`, paginate past the 1k cap, collision-check before writing.* We don't rename towns today, but this is a free guardrail to remember the moment we canonicalize any town/venue label (town is part of our `dedup_key`).
- **"Feed tests the real production input" lesson** — a regression test fed name-only stayed green while prod (name + description) broke. Worth auditing our `scripts/test/*` fixtures feed realistic scraped boilerplate, especially for the classifier change in ticket 01.

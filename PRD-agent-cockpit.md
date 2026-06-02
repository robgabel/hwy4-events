# PRD: Agent Cockpit — A Supervised Business-Manager Layer Over the Existing Automation

> The data layer already runs itself: ~13 crons scrape, dedup, price, verify, brief, and sync with no human. What is still 100% manual is the *decision* layer — reading the Slack alerts, working the `/admin/verification` queue, approving community submissions, adding `hwy4_orgs` rows, flipping gates, locking stale fields. This PRD adds a **reasoning layer** that proposes those decisions and a **cockpit** to approve them, then graduates trusted decisions to autonomous, **one action type at a time**.
>
> Framing (the one this codebase already lives by): **dry-run → canary → reversible → live.** `reconcile-dupes` shipped report-only, earned trust over a clean streak, then flipped behind `RECONCILE_EXECUTE`. This is that same Responsible-Scaling arc applied to *judgment* instead of row-merges. The goal is **not** "zero person." It is **one person plus an agent fleet, where the human owns every irreversible and outward-facing call.**

## Context

The site is roughly **75–80% "zero person" for data operations** already. The cron table in `CLAUDE.md` is the proof: scraping (3 sources), `verify-events`, `extract-prices`, `reconcile-dupes`, `sync-venue-facts`, both briefings, and the **Thursday newsletter that auto-sends to subscribers** all run untouched.

What is still entirely manual is everything that requires *judgment*, and it is scattered across three surfaces (Slack, raw SQL, and `/admin`) with no single place to stand and no proposal/measurement loop:

| Manual touchpoint | Surface | Why a human is there |
|---|---|---|
| Triage the daily `check-events` audit | Slack | judgment — which issues are actionable |
| Work the `needs_verification` queue | `/admin/verification` | trust/accuracy — never auto-hide a flagged event |
| Approve community submissions | SQL (no UI) | editorial — is it real, in-voice, in-corridor |
| Add `hwy4_orgs` rows for `actionable_link_gaps` | SQL | link strategy — recurring organizer onboarding |
| Lock stale `price`/`description`/`places` | SQL | per-row override of a wrong source |
| Flip `RECONCILE_EXECUTE` / canary gates | Vercel env | irreversible-ish (reversible, but high-stakes) |
| Review venue blurbs before publish | `draft-venue-blurbs.ts` | voice — the moat |

**Two problems.** First, there is no cockpit: the manual work has no queue, no history, no reversible log, and no second brain triaging it. Second — and this is the sharp one — the **single most outward-facing action in the whole system, the Thursday newsletter send, is also the *only* one with no human gate.** It generates copy with an LLM and emails the list with no preview. That is the highest blast radius in the system and it is the *least* supervised.

**The opportunity and the constraint.** This domain is unusually safe for autonomy: a read-only events site where the worst realistic automated mistake is a wrong date or an off-voice blurb, both cheap and reversible. That is the ideal sandbox to push autonomy hard — **except** at the outward edges (newsletter, public blurbs, anything that spends or commits), where a mistake costs the one thing the site cannot cheaply rebuild: reader trust ("trust built on accuracy," per `docs/PERSONAS.md`). The cockpit pushes autonomy hard on the safe internal toil and puts a hard human gate on the outward edges.

## Goals / Non-Goals

**Goals**
- One reasoning agent that reads system state and **proposes** actions, never silently acting (Stages 0–1).
- A cockpit in the existing `/admin` area where every proposal is **one-click approve/reject** and every executed action is **reversible** (a `before_snapshot`, mirroring `event_merge_log`).
- A guardrail policy, **encoded as data**, that graduates specific low-stakes reversible *internal* action types to autonomous behind per-type flags (Stage 2), mirroring `RECONCILE_EXECUTE`.
- Retrofit an approval/preview gate onto the one existing unsupervised outward action (the newsletter). This is a net **increase** in supervision.
- The collectors Rob asked for: **search + traffic** (build — GSC, Bing, and Cloudflare Web Analytics; clean official APIs) and **FB-group signal** (buy — session-based).

**Non-Goals**
- No turnkey "autonomous company" product (Paperclip / OpenClaw / Hermes — see *Rejected Alternatives*).
- **No auto-posting to Facebook, ever. No auto-sending any outward comm without a human gate.**
- No separate dashboard app — extend the Next.js `/admin` area.
- Not removing any human gate on editorial/voice/irreversible/outward decisions. Stage 2 graduates **only** low-stakes reversible *internal* ops.
- No new event-identity, link-resolution, or pricing logic — reuse the existing test-locked engines.

## Architecture — three tiers

Do not think "an agent." Think three layers, because that is what keeps it reliable and matches what the codebase already does (dumb scrapers write rows; smart `reconcile` operates on DB state; humans act via `/admin`).

| Tier | Job | Have today | New |
|---|---|---|---|
| **Collectors** | Pull data in, write rows. Dumb, robust, single-purpose. One breaking cannot cascade. Never reason, never act outward. | 3 scrapers, `verify-events`, `extract-prices`, `sync-venue-facts` | GSC/Bing collector, Cloudflare RUM snapshot, AEO runner, FB webhook sink |
| **Reasoner** | Read collected state + DB, decide what matters, **propose** actions. One brain, operating on DB state (not per-writer). | — | `/api/agent/chief-of-staff` |
| **Cockpit** | Where the human sees the digest, approves/rejects, reviews reversible history. | `/admin/verification`, Slack | `/admin/today`, `/actions`, `/engagement`, `/growth`, `/log` |

**Principle:** collectors are robust and isolated; the reasoner is the single brain on DB state (the same lesson `reconcile` taught — fix the system, run on state, not on each writer); the cockpit is where the human stands. **Slack stays the doorbell (push); the cockpit is the room (pull + act).**

## Data Model (Supabase — RLS mandatory, per project hard rule)

Every table gets RLS **enabled + a service-role policy in the same migration** (project hard rule; precedent: `event_merge_log`). Anon: no access.

- **`agent_runs`** — `id, ran_at, context_in jsonb, digest jsonb, model, tokens, status`. One row per reasoner run.
- **`agent_actions`** — the queue + audit + reversibility in one: `id, run_id, type, payload jsonb, rationale, blast_radius ('low'|'med'|'high'), reversible bool, outward_facing bool, status ('proposed'|'approved'|'rejected'|'executed'|'reverted'), before_snapshot jsonb, executed_at, reverted_at`.
- **`agent_policy`** — `action_type pk, auto_execute bool default false, min_clean_weeks int default 4, notes`. The per-type graduation flag (the per-action `RECONCILE_EXECUTE`). DB, not env, so flipping a gate is a row update, not a redeploy.
- **`seo_snapshots`** — `captured_at, source ('gsc'|'bing'), query, page, clicks, impressions, ctr, position`. Daily.
- **`aeo_results`** — `checked_at, engine, query, cited bool, rank int, accurate bool, notes`. Monthly, augments the manual ritual.
- **`analytics_daily`** — Cloudflare Web Analytics rollup: `date pk, pageviews, visits, top_pages jsonb, referrers jsonb, countries jsonb, devices jsonb, ai_referrals jsonb, synced_at`. **Owned by `PRD-cloudflare-analytics.md`** (its migration), read by the reasoner here. Service-role only, no public read.
- **`fb_candidates`** — `seen_at, group_name, author, post_url, post_text, relevance numeric, draft_reply, status ('new'|'drafted'|'posted'|'ignored')`. Fed by the bought FB tool's webhook.

## Approach (staged — each stage is a separate, shippable PR)

### Stage 0 — Reasoner + cockpit, **read-only** (the dry-run)

- **Collector:** `app/api/agent/collect-seo/route.ts` (daily cron) pulls Google Search Console → `seo_snapshots`.
- **Reasoner:** `app/api/agent/chief-of-staff/route.ts` (daily cron, **after** the 18:00 UTC audit so it reads fresh data; CRON_SECRET-gated, service-role). Gathers the latest `check-events` audit, the `needs_verification` queue, pending `event_submissions`, the latest `seo_snapshots`, and (later) `fb_candidates`. Calls Claude (**Sonnet** — summarize + light reasoning over structured data) with read-only tools and a "chief of staff" system prompt. Emits a structured digest into `agent_runs`.
- **Cockpit:** `app/admin/today/page.tsx` renders the latest digest. **No buttons, no execution.**
- **Slack:** a one-liner ("Digest ready: 3 items need you →") linking to `/admin/today`.
- This stage **executes nothing** (`agent_actions` stays empty). Read the digest daily and grade it against what you would have done. This is the measured dry-run, exactly as `reconcile` shipped report-only.

### Stage 1 — Propose, human disposes

- Add `agent_actions` + approve/reject **server actions** (mirror `app/admin/verification/actions.ts`).
- The reasoner now emits concrete proposed actions via one `propose_action` tool, each tagged `blast_radius` / `reversible` / `outward_facing`.
- `app/admin/actions/page.tsx` — the Action Queue. Each card shows the rationale + tags + **Approve / Reject**. Approve runs an **executor** that performs the same write you would do by hand, **after** snapshotting prior state into `before_snapshot`.
- First two action types, both `low / reversible / internal`:
  - **`create_org_row`** — drains the `actionable_link_gaps` the audit already surfaces (insert `hwy4_orgs` with `slug`, `canonical_url`, `match_patterns`).
  - **`flag_spam_submission`** — marks an obvious-junk `event_submissions` row.
- Measure **approval rate per action type**. This is the canary data.

### Stage 2 — Graduate trusted types (canary → live)

- Add `agent_policy`. The executor's gate is one boolean: **auto-run iff `blast_radius='low'` AND `reversible` AND NOT `outward_facing` AND `policy.auto_execute`.** Otherwise queue for a click.
- Flip a type's `auto_execute` **only after its approval rate holds ~100% for `min_clean_weeks` (default 4 — reuse `reconcile`'s clean-streak clock). One type at a time, each with its own clock.**
- **Outward types never get a flag.** `draft_fb_reply` and newsletter send are `outward_facing=true` by construction, so the gate can never auto-run them no matter what the policy row says.
- **Retrofit the newsletter (the highest-value safety win):** `app/api/newsletter/send/route.ts` becomes **draft → cockpit preview → human send** (or a configurable "auto-send unless vetoed within 24h" if Rob wants less friction). This converts the system's single riskiest unsupervised outward action into a reviewed one. It is a behavior change to a live cron, so gate it behind a flag and ship it carefully.

### The guardrail classifier (the Dario layer, as data, not vibes)

`lib/agent/policy.ts` is the single source of truth for "can this run without a human," expressed once and imported by the executor:

```
canAutoExecute(action, policy) =
  action.blast_radius === 'low'
  && action.reversible
  && !action.outward_facing
  && policy[action.type]?.auto_execute === true
```

This encodes "humans stay in the driver's seat for consequential decisions" as a `WHERE` clause. Lock it with a test (below) so an outward action can never silently become auto-runnable.

## The two monitoring tracks

### Traffic + Search (SEO / AEO) — **build it** (clean, reliable, official APIs)

- **Google Search Console API** (free, daily) → `seo_snapshots`: queries, clicks, impressions, position, top pages. Auth via a Google Cloud **service account** added as a restricted user on the GSC domain property (less maintenance than OAuth). The reasoner flags movement: new queries breaking top-10, pages losing position, impression spikes (a town/event catching fire).
- **Bing Webmaster Tools API** (free) → same shape. Matters because **Bing's index feeds ChatGPT search + Copilot**, so it is a leading AEO indicator.
- **Cloudflare Web Analytics (RUM)** (free) → `analytics_daily`: real traffic (pageviews, top pages, referrers, geography) plus the **answer-engine referral counts** the AEO ritual currently tallies by hand. The site is served direct from Vercel (not proxied), so only the RUM GraphQL dataset exists, and that single integration is the whole job. **Honesty caveat:** CF referrals are a *directional lower bound* on AEO traffic (Google AI Overviews arrive as `google.com`; many chat clickthroughs arrive as "direct"), so label it a signal, never a total. Full spec: **`PRD-cloudflare-analytics.md`** — its `app/api/snapshot-analytics` collector + `analytics_daily` table are this track's third collector, and its `app/admin/analytics` page **is** the cockpit's Growth tab, not a separate surface.
- **AEO:** semi-automate the existing monthly ritual **where APIs allow** (Perplexity Sonar, OpenAI/Gemini grounded search) → `aeo_results` (cited? / rank? / accurate?). **Honest scope:** the engines block scraping their answers (`AEO-SEO-MEASUREMENT.md` Part 5 already says this), so this **augments, never replaces** the human accuracy judgment, and `/api/aeo-audit-reminder` stays. The reasoner reports month-over-month citation movement.
- **Reliability: high.** All three (GSC, Bing, Cloudflare RUM) are official APIs, no ToS drama. Together they are the cockpit's **Growth** surface and they pair directly with `AEO-SEO-MEASUREMENT.md` (Parts 2–4) and `PLAN-seo-aeo.md`. The AEO scoreboard then has two complementary halves: `aeo_results` (are we *cited* — the prompt audit) and Cloudflare `ai_referrals` (did citations *drive clicks* — referral traffic).

### Facebook groups — **buy the sensor, keep the reply** (honest constraints)

- **Hard fact:** Meta **deprecated the Groups API for third parties on 2024-04-22.** There is no official path to read group content. Do not architect around an API that is gone.
- **What works today:** session-based listening tools that run on a logged-in member session via browser extension / managed account. **Devi AI** is the closest fit to the exact ask ("monitor 4–5 groups, alert on relevant posts, draft a reply"); **GroupsWatcher** is a managed variant. Evaluate, do not take the vendor's reliability claims at face value.
- **Decision: buy, do not build.** The fragile reading is the vendor's maintenance burden. Rolling our own scraper on the `harley-bot` Mac is possible but means babysitting a thing that breaks every FB redesign and puts a personal account at risk. Instead, pipe the bought tool's alerts (webhook / Zapier / email) into `fb_candidates` via `app/api/agent/fb-webhook/route.ts`; the reasoner scores relevance against `docs/PERSONAS.md` and drafts a reply in Rob's voice; `app/admin/engagement/page.tsx` shows post + draft + **Copy**.
- **Hard rule: posting is always manual** (the human pastes). Auto-posting is a ban risk **and** it is `outward_facing`, so the guardrail forbids it anyway. Reading runs on an account Rob accepts mild ToS risk on.
- **Reliability: good, not bulletproof.** Session-based, breaks on FB UI changes, ToS-gray. Nothing load-bearing depends on it; it fails to a Slack "FB watcher quiet" notice, never silently.

## Rejected Alternatives

- **Turnkey "autonomous company" product (Paperclip / OpenClaw / Hermes).** All under ~4 months old (early 2026); independently reported to act with confidence regardless of accuracy (hallucinated data, mass-deletes, no quality gate). Adopting one as *the manager* means ripping out the dry-run/canary/reversible scaffolding this codebase already has and replacing it with their unproven autonomy — a bad trade for a site whose entire principle is "trust built on accuracy." Watch them; do not hand them the keys.
- **One mega-agent that both senses and acts.** Couples fragile collection to reasoning; one broken collector poisons the brain. Collectors-write-rows / reasoner-reads-state is the same lesson `reconcile` taught.
- **A separate dashboard app.** New deploy, new auth, but the data already lives in Supabase and `/admin` already has Basic Auth (`middleware.ts`) + a server-action mutation pattern (`admin/verification/actions.ts`). Reuse it.
- **Slack-only, no cockpit.** Slack is a fine doorbell and a terrible queue/editor/audit-log. Approvals, drafts, and reversible history need state and buttons.
- **Build our own FB scraper.** ToS-gray + fragile + personal-account risk + perpetual maintenance. Buy the sensor.
- **Auto-send / auto-post any outward comm.** Never. Subscriber trust and an FB account are the things you cannot cheaply rebuild.
- **DB-level guardrail constraints.** The classifier is procedural (per-type policy × reversibility × outward), not a column constraint — same reasoning that keeps `isSameEvent` procedural.

## Critical Files

- **New:**
  - `supabase/migrations/<date>_agent_cockpit.sql` — the six cockpit tables (`agent_runs`, `agent_actions`, `agent_policy`, `seo_snapshots`, `aeo_results`, `fb_candidates`), each with RLS + service-role policy. (`analytics_daily` ships with `PRD-cloudflare-analytics.md`'s migration, not this one.)
  - `app/api/agent/chief-of-staff/route.ts` (reasoner cron), `app/api/agent/collect-seo/route.ts` (GSC + Bing), `app/api/agent/collect-aeo/route.ts` (monthly), `app/api/agent/fb-webhook/route.ts` (bought-tool sink).
  - `lib/agent/` — tool definitions, the action **executor**, and `policy.ts` (the single `canAutoExecute` definition). Plus `scripts/test/agent-policy.test.ts` to lock it.
  - `app/admin/today/page.tsx`, `app/admin/actions/page.tsx` + `actions.ts`, `app/admin/engagement/page.tsx`, `app/admin/log/page.tsx`. The **Growth** tab is `PRD-cloudflare-analytics.md`'s `app/admin/analytics/page.tsx` (same surface, cockpit nav label), extended with the GSC/SEO board.
  - **Shared with `PRD-cloudflare-analytics.md` (build once, both consume):** `lib/cloudflare-analytics.ts` (GraphQL RUM client) and `app/api/snapshot-analytics/route.ts` (daily collector → `analytics_daily`).
- **Edit:**
  - `app/admin/layout.tsx` — nav tabs (Today / Actions / Engagement / Growth / Log).
  - `vercel.json` — new cron entries (chief-of-staff after the 18:00 audit; collect-seo daily; collect-aeo monthly).
  - `app/api/newsletter/send/route.ts` — Stage 2 draft→gate behavior change.
  - `CLAUDE.md` — cron table + new env vars + this PRD in the index.
- **Reuse, unchanged:**
  - `middleware.ts` (Basic Auth already covers `/admin/:path*`).
  - `app/admin/verification/actions.ts` (the server-action mutation pattern to mirror).
  - `app/api/check-events/route.ts` (`actionable_link_gaps` feeds `create_org_row`), `matchOrgForEvent` (so links + verification agree), the `generate-briefing` Anthropic-SDK pattern, the `event_merge_log` reversibility pattern.

## Environment Variables (new)

- `GOOGLE_SEARCH_CONSOLE_SA_JSON` — GSC API service-account credentials (added as a user on the GSC property).
- `BING_WEBMASTER_API_KEY`.
- `FB_TOOL_WEBHOOK_SECRET` — shared secret to authenticate the bought tool's inbound webhook.
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_WEB_ANALYTICS_SITE_TAG` — least-privilege (Account Analytics: Read) credentials for the Cloudflare RUM collector. Owned by `PRD-cloudflare-analytics.md`.
- Reused: `ANTHROPIC_API_KEY`, `CRON_SECRET`, `SLACK_WEBHOOK_URL`, `ADMIN_PASSWORD`, `SUPABASE_*`.
- Note: per-type autonomy lives in `agent_policy` (DB), **not** env — flipping a gate is a row update, not a redeploy. (`reconcile` used an env flag because it had exactly one gate; this has many.)

## Verification

1. **Stage 0 dry-run:** chief-of-staff writes a digest to `agent_runs` + posts a Slack one-liner; `/admin/today` renders it behind Basic Auth; `agent_actions` stays empty. Grade the digest daily for a week.
2. **Auth:** `curl -H "Authorization: Bearer $CRON_SECRET" .../api/agent/chief-of-staff` returns a run summary; without the bearer it 401s. `/admin/today` without Basic Auth 401s.
3. **SEO collector:** a GSC pull writes `seo_snapshots` rows; the digest cites real query movement (not invented numbers).
4. **Stage 1 round-trip:** the agent proposes a `create_org_row`; **Approve** inserts the `hwy4_orgs` row and writes `before_snapshot`; the org now resolves outbound links (confirm `verify-events` and `event-link` agree, since both use `matchOrgForEvent`); **Revert** restores prior state.
5. **Guardrail (test-locked):** `agent-policy.test.ts` asserts an `outward_facing` action can **never** return `canAutoExecute=true` regardless of the policy row; a type with `auto_execute=false` always queues; flipping `agent_policy.auto_execute` for `create_org_row` makes the next proposal execute without a click, still snapshotted.
6. **FB:** a simulated webhook (valid `FB_TOOL_WEBHOOK_SECRET`) writes an `fb_candidate`; the reasoner drafts a reply; `/admin/engagement` shows post + draft + Copy; **nothing posts to FB**.
7. **Newsletter gate (Stage 2):** the Thursday run produces a draft visible in the cockpit and does **not** send until approved (or auto-sends only after the configured veto window).
8. **Reversibility:** every executed action has a `before_snapshot`; the Log tab restore round-trips (mirror the `event_merge_log` restore test).

## Rollout (evidence-gated, mirrors `reconcile`)

1. Ship the migration (tables + RLS) + Stage 0 reasoner + GSC collector + `/admin/today`, **report-only**. Run a week; grade the digests. **In parallel, no code:** start the FB-tool trial (point Devi AI at the groups, alerts to email) to learn if the signal beats the noise.
2. Add `agent_actions` + the Action Queue + the two low-stakes types. Everything needs a click. Measure approval rate per type for ~4 weeks (the clean-streak clock).
3. Add `agent_policy`. Flip `create_org_row` to auto once its approval rate holds ~100% for 4 weeks. One type at a time, each with its own clock.
4. Add the Engagement tab + `fb-webhook` once the FB trial proves worth it. **Reply stays manual.**
5. Retrofit the newsletter approval gate. **Land this regardless of how far Stage 2 autonomy goes** — it is the single highest-value safety win, supervising the one outward action that is unsupervised today.
6. **Growth/traffic track (parallel to the stages above, per `PRD-cloudflare-analytics.md`):** build `lib/cloudflare-analytics.ts` + `app/api/snapshot-analytics` + `analytics_daily`, lead with **AEO referral auto-fill** (it closes a measurement loop already committed to in `AEO-SEO-MEASUREMENT.md`), then surface it as the Growth tab alongside the GSC/SEO board. Note: that PRD's "is `/admin` protected?" open question is **already resolved** — `middleware.ts` Basic Auth covers `/admin/:path*`, so the analytics/Growth page inherits the gate for free.

Risk is concentrated where it belongs: the executor's writes (all reversible via `before_snapshot`) and the newsletter send (gated). Everything else proposes-then-waits. Outward and editorial decisions never graduate. **Net effect: the cockpit makes the system *more* supervised than it is today** — it puts the one unsupervised outward action behind a gate while letting the safe internal toil earn its way to autonomous.

## Open Items
- [ ] Newsletter gate UX: hard approval vs. "auto-send unless vetoed within 24h"?
- [ ] Pick the FB tool (trial Devi AI vs GroupsWatcher); confirm it has a webhook/Zapier out.
- [ ] GSC API auth: service account (preferred, less maintenance) vs OAuth.
- [ ] Confirm the digest's Slack channel (#hwy4 per `AEO-SEO-MEASUREMENT.md`).
- [ ] Confirm the graduation clock at 4 weeks (reuse `reconcile`'s standard) vs shorter for the lowest-stakes types.
- [ ] Reasoner model: Sonnet for the digest (assumed) vs Opus if editorial judgment needs to be top-tier.

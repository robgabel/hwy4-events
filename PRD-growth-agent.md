# PRD: Growth Agent — Repointing the Business Manager from Ops Triage to Demand Generation

> The Agent Cockpit (`PRD-agent-cockpit.md`) gave us a daily "chief of staff" that reads system state and flags what needs a human. It works, but its lens is **inward**: verification queue, submissions, merges. None of that moves the number the business actually lives on. This PRD adds a **second reasoner with a growth lens** — a weekly Head-of-Growth memo that optimizes for Weekly Returning Residents, the newsletter, and the organizer network, and **drafts the one move worth making that week**. Same read-only cockpit discipline; different question.

## The shift

| | Chief of Staff (have) | Growth Agent (this) |
|---|---|---|
| Question | "What needs a human in the queue?" | "What's the highest-leverage growth move this week?" |
| Lens | inward / ops | outward / demand |
| Optimizes | clean ops (lagging, internal) | **North Star = Weekly Returning Residents**; secondary = visitor→business referrals |
| Output | `needs_you / fyi / watching` | `north_star / move_of_the_week / experiments / watching / ops` |
| Produces | a summary | a summary **+ a drafted artifact** (outreach email, post, subject line) |
| Cadence | daily | **weekly (Friday)** — the flagship; daily ops stays as-is |

The chief-of-staff digest is **not** removed. It stays the daily ops pulse, demoted to a footer of the larger story. Growth becomes the agent's identity.

## North Star and the honesty caveat

The North Star is **Weekly Returning Residents** (`BUSINESS-PLAN.md`). We **cannot** measure true returning-uniques: `site_events` (Gate 0) has only a per-session `session_id`, no persistent visitor id, so the same local across two weeks looks like two sessions. The honest proxy, labeled directional everywhere it appears, is:

- **weekly distinct local view-sessions** and their week-over-week trend (the demand pulse), plus
- **engaged local sessions** (2+ views) for depth, plus
- the **newsletter** (the owned audience that brings locals back — list size + net adds).

Secondary North Star: **visitor-driven business referrals** — outbound clicks (`site_events.kind='outbound'`) from `visitor_class='visitor'` toward a business. This is the flywheel's payoff (visitor discovers → spends).

This matches the codebase ethos already applied to Cloudflare AEO referrals: report a directional signal, never a precise total.

## Architecture — reuse the cockpit, add a lens

No new tier. The growth memo is a second **reasoner** writing into the existing `agent_runs` table, distinguished by a `run_type` column (`chief_of_staff` | `growth_memo`). Each cockpit surface reads only its own type. Read-only, like Stage 0: it **proposes and drafts copy, it executes and sends nothing** — outward actions stay a human click (the cockpit's hard rule that `outward_facing` never auto-runs makes a growth agent a *drafter* by construction, which is exactly right).

- **Collector:** none new. The growth signal pack is assembled at read time from tables that already exist (`gatherGrowthContext`).
- **Reasoner:** `app/api/agent/growth-memo/route.ts` (weekly cron, Sonnet, CRON_SECRET-gated, service role). Head-of-Growth system prompt.
- **Cockpit:** `app/admin/growth-memo/page.tsx` — North Star banner, the move (with its drafted artifact + copy / Gmail deep-link), experiments, watching, ops footer. Nav label **"Growth memo"** (distinct from the existing **"Growth"** = `/admin/analytics` traffic board).
- **Slack:** a one-liner ("Growth memo — move of the week: …") linking to the page.

## The growth signal pack (`lib/agent/growth-context.ts`)

Every number is real and queried; the model may only summarize what it's handed (same guardrail as the digest). Sources, all confirmed against the live schema:

- **Newsletter** (`newsletter_subscribers`, `newsletter_drafts`, `newsletter_clicks`): active subs, net adds 7d (new confirmed − unsubscribes), **confirm rate 30d (the double-opt-in leak)**, pending-unconfirmed count, last send's clicks + top-clicked events.
- **Audience / WRR proxy** (`site_events` views, local + visitor): distinct local sessions 7d vs prior 7d, engaged local sessions, visitor sessions.
- **Business referrals** (`site_events` outbound): 7d / 30d totals, by `click_type`, visitor share, top events.
- **Traffic** (`analytics_daily`): pageviews 7d vs prior 7d, top pages, AEO referrals.
- **SEO** (`seo_snapshots`): latest capture's top queries (dormant until GSC is wired).
- **Network** (`hwy4_orgs`, `share_hits`, `poster_submissions`): organizers with a durable link, share hits 7d by src, pending poster swaps.
- **Ops footer** (`event_submissions`, `hwy4_events`): pending submissions, needs-verification — kept short.

## Output shape (`GrowthDigest` in `lib/agent/types.ts`)

- **`north_star`** — `{headline, detail}`: one honest read on the local-session trend + newsletter net.
- **`move_of_the_week`** — `{title, detail, why, draft?}` or `null` on a genuinely quiet week. `why` names the metric it moves. `draft` is an optional ready-to-send artifact (`email` | `post` | `subject` | `note`), rendered with a copy button (and Gmail deep-link for email), mirroring the submission-reply loop. **One move, not five.**
- **`experiments`** — tests in flight with an early read (the agent's memory; e.g. "newsletter box after event 5," "host cards shipped, watching `src=host`").
- **`watching`** — leading signals, not yet actionable.
- **`ops`** — demoted queue footer.

## Staging (mirrors the cockpit's dry-run → canary → live arc)

- **Phase 1 — read-only growth reframe (this PR).** New reasoner + context pack + digest shape + cockpit page + weekly cron. Executes nothing, drafts copy. Grade the memo weekly for a month, exactly as Stage 0 shipped report-only. Cadence decision: **weekly Friday memo is the flagship (Rob has weekend time to act on it); the daily chief-of-staff stays the ops pulse** (option B).
- **Phase 2 — drafted artifacts (already seeded).** The `draft` field + copy/Gmail UI are live; widen the kinds the agent reaches for (organizer outreach, build-in-public post, subject A/B). Still human-sent.
- **Phase 3 — experiment memory (built 2026-06-09).** `growth_experiments` table (name, hypothesis, metric, baseline, status, result, dates; migration `20260609b_growth_experiments.sql`). The signal pack now carries the running + recently-concluded rows, and the memo prompt reports an early read on each (one item per running experiment) instead of inventing tests. `/admin/experiments` (page + `actions.ts`, Basic Auth) lets Rob log and conclude them with no SQL. Seeded with the two tests already in flight (newsletter box after event 5; the /hosts QR kit). This is what makes it a *growth* agent and not a weekly dashboard.
- **Phase 4 — measurement plumbing and beyond.** The agent can only reason over what it is handed, so the forward work is mostly *widening the signal pack* (and the human Growth surface). Laid out in the Roadmap below.

## Roadmap (the data the agent still needs)

Ordered by leverage. Each item widens `lib/agent/growth-context.ts` (what the memo reasons over) and usually adds a matching panel to the `/admin/analytics` Growth tab. Driven by the gap analysis: a growth agent optimizes *rates and channels*, but today it sees mostly counts.

### R1 — Newsletter signal upgrade (near-term, one cheap PR; all in the signup write path)

The newsletter is the owned audience, so its signal should be the richest. No new table — `newsletter_subscribers` already carries `created_at` / `confirmed_at` / `unsubscribed_at`, so the full daily history is derivable on the fly (cheap into the low thousands).

- **R1a — Daily series + running total.** A shared `lib/newsletter-stats.ts` derives per-day `{signups, confirmed, unsubs, net}` + cumulative active. Surfaced in the memo context (the agent reads *trend shape*, not two 7-day buckets) **and** as a Newsletter panel on the Growth tab (total + a CSS sparkline; no chart lib). Directly reads out the two live placement experiments.
- **R1b — Signup source.** Capture `src` (homepage / town / event page / post-event-5 box / `?src=host`) on the subscriber row at write time. The cheapest down payment on attribution; measures the placement experiments directly.
- **R1c — Signup local vs visitor.** Classify each new subscriber at signup via the existing `geoFromHeaders` + `classifyVisitor` (the route already has Vercel geo headers). Store **`visitor_class` only** — not city/region, since a subscriber row is tied to an email (PII), and we never store the raw IP. Tells the agent *who the list is*: locals = retention / North Star, visitors = demand wedge. **Known blind spot:** a visitor signing up from inside their rental geolocates as `local`, so geo-at-signup *undercounts the host kit's own visitors* — which is exactly why R1b (`src=host`) is the complementary channel-truth signal. Use both.

### R2 — Source attribution across the board (Phase 4 proper; the channel-truth unlock)

Capture `src` / query on `site_events` views (host card, QR, share, newsletter), since the beacon currently records `path` but drops the query string. Until this lands, *"which channel do I push this week?"* — the agent's central question — is a guess. Highest-leverage non-trivial build.

### R3 — Real returning measurement (the North Star upgrade)

Today WRR is proxied by weekly local *sessions* because `site_events` has only a per-session id. Add a **first-party, anonymous, opaque visitor id** — recommended: a `localStorage` UUID sent in the existing beacon (no third-party service, no `Set-Cookie`/consent friction, data stays ours; PostHog is the only turnkey "buy" that fits but is overkill, and Plausible/Fathom/Vercel are cookieless and cannot measure returning). Stamp `visitor_id` on `site_events` → compute true week-over-week returning cohorts. Turns the proxy into a measured North Star. Label it a per-device proxy (ITP / incognito reset it).

### R4 — Funnel, supply, and engagement depth

- **Newsletter open rate** via a Resend webhook (deliverability + subject resonance; clicks alone miss a staling list).
- **Funnel conversion rates** (visit→signup, visit→business-referral), not just the raw counts at each stage.
- **Supply-side health** (new submissions/week, % published, organizer repeat rate). Supply is half the marketplace; a thin calendar quietly kills demand, and the agent should flag a supply dip as loudly as a traffic dip.
- **Event / town / category demand aggregation** (which content actually converts visitors) — the fuel for both editorial strategy and organizer targeting.
- **Visitor-origin geography** (is the Bay Area actually showing up?) — `site_events` has `region`/`city`; surface it for the visitor wedge.

### R5 — Context and targets

- **Off-site reach input** (LinkedIn / FB groups / IG) — manual weekly input first (pairs with the cockpit FB sensor) so the agent can connect off-site effort to on-site lift; these are Rob's real acquisition channels and the agent is blind to them today.
- **Per-metric goals/targets** so "+7 subs" reads as "+7, behind pace" — a tiny input, big interpretive upgrade.
- **GSC month-over-month** query movement once `GOOGLE_SEARCH_CONSOLE_SA_JSON` is set (not just the latest capture).

## Critical files

- **New:** `app/api/agent/growth-memo/route.ts`, `lib/agent/growth-context.ts`, `app/admin/growth-memo/page.tsx`, `components/GrowthDraft.tsx`, `supabase/migrations/20260609_growth_memo.sql` (adds `agent_runs.run_type`).
- **Edit:** `lib/agent/types.ts` (growth types, additive), `app/admin/today/page.tsx` (scope to `run_type='chief_of_staff'`), `app/admin/layout.tsx` (nav), `vercel.json` (Friday 16:00 UTC cron), `CLAUDE.md` (cron table + index).
- **Reuse, unchanged:** `agent_runs` plumbing, `middleware.ts` Basic Auth, the `generate-briefing` Anthropic pattern, the submission-reply copy/Gmail-deep-link UX.

## Environment variables

None new. Reuses `ANTHROPIC_API_KEY`, `CRON_SECRET`, `SLACK_WEBHOOK_URL`, `SUPABASE_*`. (SEO section stays dormant until `GOOGLE_SEARCH_CONSOLE_SA_JSON` is set, same as the chief-of-staff digest.)

## Verification

1. **Migration:** `agent_runs.run_type` exists, defaults `chief_of_staff`, check constraint enforces the two values. Existing rows backfilled to `chief_of_staff` (so `/admin/today` is unaffected).
2. **Read-only:** the weekly run writes one `agent_runs` row (`run_type='growth_memo'`) + Slack one-liner; nothing else is written; `/admin/growth-memo` renders it behind Basic Auth.
3. **Grounding:** every number in the memo traces to the signal pack; no invented figures; low traffic reported honestly (tens, not thousands).
4. **North Star honesty:** local-session figures are labeled a directional WRR proxy, never a headcount.
5. **Draft loop:** when the move is outward, the memo carries a ready draft; the page shows Copy (+ Gmail for email); **nothing sends**.
6. **Auth:** `curl -H "Authorization: Bearer $CRON_SECRET" .../api/agent/growth-memo` returns a summary; without the bearer it 401s.

## Open items
- [ ] Reasoner model: Sonnet (assumed) vs Opus if the move-of-the-week judgment needs to be top-tier editorial.
- [ ] First-party returning id (R3): `localStorage` (recommended, cookieless) vs an httpOnly edge cookie vs PostHog. Confirm the privacy posture (anonymous, no PII) before building.
- [ ] R1 is the recommended next build (newsletter daily + total + source + local/visitor) — small, in the signup write path, and it reads out the two live experiments.

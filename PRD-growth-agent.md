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
| Cadence | daily | **weekly (Monday)** — the flagship; daily ops stays as-is |

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

- **Phase 1 — read-only growth reframe (this PR).** New reasoner + context pack + digest shape + cockpit page + weekly cron. Executes nothing, drafts copy. Grade the memo weekly for a month, exactly as Stage 0 shipped report-only. Cadence decision: **weekly Monday memo is the flagship; the daily chief-of-staff stays the ops pulse** (option B).
- **Phase 2 — drafted artifacts (already seeded).** The `draft` field + copy/Gmail UI are live; widen the kinds the agent reaches for (organizer outreach, build-in-public post, subject A/B). Still human-sent.
- **Phase 3 — experiment memory.** A small `growth_experiments` table (change, date, hypothesis, metric, read) so the agent measures its own moves instead of re-guessing. This is what makes it a *growth* agent and not a weekly dashboard.
- **Phase 4 — measurement plumbing.** Wire `?src=host` / share `src` into `site_events` so acquisition channels (host cards) are countable; define WRR more precisely if a persistent (privacy-respecting) visitor id is ever added. Until then the proxy stands, labeled directional.

## Critical files

- **New:** `app/api/agent/growth-memo/route.ts`, `lib/agent/growth-context.ts`, `app/admin/growth-memo/page.tsx`, `components/GrowthDraft.tsx`, `supabase/migrations/20260609_growth_memo.sql` (adds `agent_runs.run_type`).
- **Edit:** `lib/agent/types.ts` (growth types, additive), `app/admin/today/page.tsx` (scope to `run_type='chief_of_staff'`), `app/admin/layout.tsx` (nav), `vercel.json` (Monday 16:00 UTC cron), `CLAUDE.md` (cron table + index).
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
- [ ] Phase 3 `growth_experiments` schema + a way to log a change (manual insert vs a tiny admin form).
- [ ] Phase 4: capture `src` in `site_events` so host-card / share channels are measurable.
- [ ] Once GSC is live, have the memo report month-over-month query movement, not just the latest capture.

# PRD — Roadmap Board (agent-fed kanban inside `/admin`)

**Status:** Phase 1 built + live in prod (2026-07-03). Phase 2 built (2026-07-04). Phases 3–4 pending.
**Origin:** Rob wants to manage hwy4-events with a kanban + tickets — AI agents (growth/QA) file and prioritize work, Rob adds incremental features, **Claude Code implements them and updates the ticket**, and the `/admin` panel shows the cards and links over.
**Decision (build, not buy):** a lightweight kanban on **Supabase** (`hwy4_tasks`), rendered natively in `/admin/roadmap`, linked to **GitHub PRs** (not GitHub Issues). See "Why build" below.
**Confirmed by Rob:** table name `hwy4_tasks`, kept **separate** from PAOS `paos_improvements`; the build command is **repo-local** (`.claude/commands/build-ticket.md`); autonomy is **auto-draft, you approve** (Claude Code opens a draft PR, never merges).

---

## 1. Thesis

The work queue for *building the site* should live where the *builders* already are. Two builders:

1. **The agents** — they already write SQL natively (Supabase MCP / service-role) and already produce verdicts and proposals (`agent_runs`, `agent_actions`, the chief-of-staff + growth-memo reasoners). For them, a ticket is a plain `INSERT` — no OAuth, no MCP, no rate limit, no second system to sync.
2. **Claude Code** — it opens PRs against this repo. It can read a ticket row, branch, implement, open a draft PR, and flip the row's status, all with tools it already has (Supabase MCP + `gh`).

A foreign tracker (Notion / Trello / Linear) would add a second surface to triage in and a sync job to keep it honest, in exchange for board polish Rob wants **in the admin panel** anyway. The one thing a homegrown board gives up — native PR↔ticket linking — we recover cheaply: Claude Code stores `pr_number` and writes `Builds HWY-N` in the PR body; a merge webhook (Phase 3) parses that to flip the row to Done.

This is the **fourth** instance of the codebase's core pattern: **propose → human-approve → execute → revert**, reusing the `agent_actions` / `agent_policy` shape, the `actions.ts` server-action pattern, Basic-Auth `middleware.ts`, and RLS-service-role-only tables.

## 2. Goals / Non-goals

**Goals**
- One board, in `/admin`, where Rob creates + triages + prioritizes tickets day-to-day.
- Agents (cockpit reasoners + a new QA agent) and Claude Code / Cowork sessions can file tickets with zero new auth.
- Claude Code picks up an approved ticket, implements it, opens a **draft PR**, and updates the ticket — **never merges**.
- Agent-filed tickets land as `proposed` and are promoted by a human — same gate as every other queue.

**Non-goals**
- Not a general PM tool (no sprints, story points, burndown).
- No external tracker, no two-way sync, no per-seat cost.
- Agents never merge a PR or ship to prod. The merge is always Rob's click.
- Not a replacement for the broader PAOS `paos_improvements` queue (that's rob-ai-system-wide; this is hwy4-local). Cross-reference, don't merge.

## 3. Why build (vs Notion / Trello / Linear / GitHub Issues)

| Option | Verdict |
|---|---|
| **Supabase table in `/admin`** ✅ | Agents write to it with the access they already have; board joins domain rows (`hwy4_events`, `event_submissions`, `agent_runs`); lives inside the cockpit Rob runs; $0; full schema/RLS control. Give up: native git-linking + board polish (both re-implementable, cheaply). |
| GitHub Issues + Projects | Best *implementation* half (PR auto-close, `gh issue develop`), but a second board to mirror into `/admin`, and Projects-v2 status is GraphQL-only + fiddly. We take the *good* part (PR linking) without adopting Issues. |
| Linear Free | Most agent-native dedicated tracker (agent-as-assignee, official MCP, free ≤250 issues, auto-status-on-PR). Real option if Rob ever wants a polished standalone app — but a second system to triage in and sync, for UX he wants in `/admin`. |
| Notion / Trello | Weakest dev-workflow fit (no native PR/branch semantics), retrofitted MCPs, status is an awkward DB property. No. |

**If we ever outgrow this:** the `hwy4_tasks` schema maps cleanly onto Linear's model (status/priority/assignee/url), so a future mirror-to-Linear is additive, not a rewrite.

## 4. Data model — `hwy4_tasks` (migration `20260703_roadmap_board.sql`)

RLS on, **service-role only** (no public read), mirroring `agent_runs` / `site_events` / `agent_actions`. Key columns: `ref` (HWY-N off a sequence — the git-link handle), `title`, `body` (markdown spec), `type` (`feature|bug|qa|growth|chore`), `status` (`proposed|backlog|ready|in_progress|in_review|done|wont_do`), `priority` (`p0..p3`), `rank` (reserved, unused P1), `source` (`chief_of_staff|growth_memo|qa_agent|manual|cowork|claude_code`), `ai_rationale` jsonb, `pr_url`/`pr_number`/`branch`, `before_snapshot` (reversibility hook, reserved), `linked_event_id`/`linked_submission_id`/`linked_run_id`, `decided_note`, timestamps + `done_at`. Types mirrored in [lib/tasks.ts](lib/tasks.ts).

**Why `ref` matters:** Claude Code puts `Builds HWY-42` in the PR body, and the merge webhook (Phase 3) parses it back to the row — the whole git-linking recovery rides on this one string.

## 5. The four ticket sources (all four confirmed)

| Source | Wiring | Phase |
|---|---|---|
| **Existing cockpit agents** (`chief_of_staff`, `growth_memo`) | ✅ **Built 2026-07-04.** After each reasoner writes its `agent_runs` digest, `lib/agent/propose-tasks.ts` asks Sonnet to extract any concrete *dev* work (a build/bug/data fix — **not** an ops task like "review a submission" or "send an email"), dedups it against open + recently-dismissed tickets by normalized title (so a daily reasoner can't refile), and `INSERT`s `status='proposed'` rows (`source`, `linked_run_id`, `ai_rationale`). Best-effort (never fails the digest), ≤2/run. Pure core locked by `scripts/test/propose-tasks.test.ts`. | ✅ 2 |
| **New QA agent** | New cron `/api/agent/qa-audit` (sibling to `/api/check-events`): UX/data/link/regression checks against the live site → `type='bug'` `proposed` tickets, deduped on a content key. `lib/agent/qa-audit.ts`. | 3 |
| **Rob, manually** | "+ New ticket" form on the board. The day-to-day surface. | ✅ 1 |
| **Claude Code / Cowork sessions** | A session files a follow-up ticket for out-of-scope work (same instinct as `spawn_task` chips), via the Supabase MCP `INSERT`. | ✅ 1 |

Agent-filed = `proposed` → promoted by a human (the approval gate) → `backlog`.

## 6. The Claude Code build loop ("auto-draft, you approve")

No agent ever merges.

1. Rob drags/moves a ticket to **Ready for dev** (the approval).
2. **`/build-ticket HWY-N`** ([.claude/commands/build-ticket.md](.claude/commands/build-ticket.md)) → Claude Code: reads the row (Supabase MCP), `git fetch` + branches off **`origin/main`** (the stale-base lesson), implements per `body`, runs the relevant `scripts/test/*` + `voice-lint`, `gh pr create --draft` with `Builds HWY-N` in the body, then `update hwy4_tasks set status='in_review', pr_url=…, pr_number=…, branch=…`.
3. Rob reviews + merges. **Phase 3:** a `task-done.yml` Action parses `Builds HWY-\d+` from the merged PR and POSTs `/api/tasks/pr-merged` (CRON_SECRET-gated) → row → `done`.

**Stage 2 (Phase 4, optional):** low-risk `chore`/`bug` tickets graduate to a cron that auto-drafts the PR — gated by an `agent_policy`-style flag + `canAutoExecute` (low blast + reversible + internal + policy on). The merge stays human; outward/editorial tickets can never graduate.

## 7. The admin surface (Phase 1 built)

- **New nav tab — "Roadmap"** ([components/admin/AdminNav.tsx](components/admin/AdminNav.tsx)): `Inbox · Pulse · Analytics · Newsletter · Roadmap`. Badge = count of `proposed` tickets (agent inflow; reads 0 until Phase 2).
- **`/admin/roadmap`** ([app/admin/roadmap/page.tsx](app/admin/roadmap/page.tsx) + [actions.ts](app/admin/roadmap/actions.ts)) — a horizontally-scrolling kanban (columns `Proposed · Backlog · Ready · In progress · In review · Done`) using the shared admin kit ([components/admin/ui.tsx](components/admin/ui.tsx)). Cards show `ref` · priority/type chips · title · body preview · source · age · PR link. Controls: move (status `<select>`), set priority, inline edit; `proposed` cards get Promote / Dismiss. A "+ New ticket" form up top.
- **MVP omits drag-and-drop** (status `<select>` + priority as the ordering lever) to respect the client-bundle rule. Add DnD later, lazy-loaded, only if the board earns it (PRD §10).
- **Inbox integration (Phase 2, built)** — a `task` row type (teal "Ticket" chip → `/admin/roadmap`) joins the unified Inbox list + `CountStrip`, and proposed tickets are added to the Inbox badge total ([app/admin/inbox/page.tsx](app/admin/inbox/page.tsx) + [app/admin/layout.tsx](app/admin/layout.tsx)). A proposed ticket shows in both the Inbox (the front door) and the Roadmap tab's own badge — one thing that needs you, reachable from either.
- All behind the existing Basic-Auth `middleware.ts`; reuses `getAdminClient` + `flash`/`field` helpers.

## 8. Reuse map (don't reinvent)

| Need | Reuse |
|---|---|
| Admin auth | `middleware.ts` Basic Auth |
| Service-role DB writes | `lib/admin/db.ts` `getAdminClient` |
| Server-action UX (flash/field/redirect) | `lib/admin/flash.ts` |
| Propose→approve→revert shape | `app/admin/actions/actions.ts`, `lib/agent/policy.ts` |
| Agent rationale jsonb pattern | `event_submissions.ai_analysis` |
| RLS service-role-only migration | `supabase/migrations/20260608_gate0_site_events.sql` (template) |
| Nav badge counting | `lib/admin/db.ts` `countPending` |
| Cron auth (Phase 3 webhook) | `CRON_SECRET` bearer |

## 9. Phasing

- **Phase 1 — MVP ✅ (2026-07-03).** Migration + `/admin/roadmap` board + `actions.ts` (manual CRUD + move/priority/promote/dismiss) + Roadmap nav tab & badge + `/build-ticket` repo-local command. Rob files tickets; Claude Code implements + sets `in_review`. *No merge webhook yet — Rob eyeballs the board.*
- **Phase 2 — agent inflow. ✅ (2026-07-04).** `lib/agent/propose-tasks.ts` wired into the `chief_of_staff` (daily) + `growth_memo` (weekly) routes; the `task` row type joined the Inbox list + badge. No new cron — it piggybacks the existing reasoner crons. The promote/dismiss gate already existed. Locked by `scripts/test/propose-tasks.test.ts`.
- **Phase 3 — QA agent + auto-Done.** `/api/agent/qa-audit` files bug tickets; `task-done.yml` Action + `/api/tasks/pr-merged` closes tickets on merge.
- **Phase 4 — optional graduation.** `agent_policy`-gated auto-draft for low-risk types. Human still merges.

## 10. Open items (deferred, on purpose)

- [ ] **Drag-and-drop** — status `<select>` is the MVP mover; add DnD (lazy-loaded) + wire the reserved `rank` column if the board earns it.
- [ ] **Merge webhook** — `task-done.yml` + `/api/tasks/pr-merged` (Phase 3). Until then a merged ticket stays `in_review` until Rob moves it to Done.
- [ ] **Inbox integration** — add the `task` row type to `/admin/inbox` in Phase 2 alongside agent inflow.
- [ ] **QA agent scope** — decide the first audit set (broken links, data-quality, missing venue sections, a11y).

## 11. Success criteria

- Rob files a ticket in `/admin/roadmap`; `/build-ticket HWY-N` produces a reviewable **draft** PR with `Builds HWY-N` linked and the card in **In review**; merging it (later, via the webhook) flips the ticket to Done.
- A cockpit agent files a `proposed` ticket that shows in the Roadmap badge; Rob promotes it in one click.
- Zero new vendor, zero per-seat cost, zero second-system sync. The board reads from and writes to the same Supabase project as everything else.

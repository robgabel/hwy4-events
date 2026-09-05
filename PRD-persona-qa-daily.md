# PRD — Persona QA Daily Rotation

**Status:** Built 2026-07-17 (skill + `qa_fix_event` action type + policy row). Runtime: a daily
scheduled Claude Code routine (subscription-billed) that executes `.claude/skills/persona-qa/SKILL.md`.
**Origin:** Rob ran four manual "Persona N - QA" sessions (2026-07-16/17) that kept finding real
shipped bugs (e.g. PR #216 range-card contiguity, PR #217). This automates the pattern: one persona
per day, seven-day rotation, with an auto-triage split.

## 1. Design

- **Rotation:** local day-of-week → persona (Mon Gary … Sun Miguel), the 7 canonical personas in
  [docs/PERSONAS.md](docs/PERSONAS.md). Each run = one deep persona journey on prod
  (hwy4events.com, persona-appropriate viewport) **plus** a fixed daily data sweep (stale rows,
  time logic, missing essentials, dupes, link/poster rot) — so data rot is caught daily regardless
  of whose persona day it is.
- **Triage split (the point of the system):**
  - **Simple data error** → a `qa_fix_event` proposal in `agent_actions`. **Propose-first** (Rob,
    2026-07-17): Rob approves in `/admin/actions`; the executor snapshots touched columns before
    writing so every fix is one-click revertible. After a 2-week clean canary, flip the
    `agent_policy` row to `auto_execute=true` and fixes apply themselves (still logged + revertible
    in `/admin/actions`; `canAutoExecute` still vetoes anything not low-blast/reversible/internal).
  - **Structural problem** (code renders correct data wrongly, missing capability, systemic scraper
    bug) → a PRD-bodied ticket in `hwy4_tasks`, `type='qa'|'bug'`, `source='qa_agent'`,
    **`status='ready'`** — straight to the Ready column on `/admin/roadmap`, skipping the
    `proposed` promote gate (Rob's explicit choice for QA finds). Built via the existing
    `/build-ticket HWY-N` loop.
- **Admin visibility:** proposals surface in `/admin/actions` + the Inbox badge; tickets on the
  roadmap board; each run posts a one-liner to Slack `#claude-updates`.

## 2. New surface area (this PR)

| Piece | File |
|---|---|
| The skill (protocol, rotation, sweep, filing SQL, guardrails) | `.claude/skills/persona-qa/SKILL.md` |
| Fix primitive: whitelist + lock rules (pure, tested) | `lib/agent/qa-fix-event.ts` |
| `qa_fix_event` in the ActionType union | `lib/agent/policy.ts` |
| Executor: snapshot-first apply + exact revert | `lib/agent/actions-executor.ts` |
| Policy row (`auto_execute=false`, `min_clean_weeks=2`) | `supabase/migrations/20260717_qa_fix_event_policy.sql` |
| Regression lock | `scripts/test/qa-fix-event.test.ts` |

No admin UI changes needed: `/admin/actions` renders unknown types via `GenericProposedBody`.

## 3. Guardrails

- The routine is read-only on the site and **propose-only** on the DB — it never UPDATEs
  `hwy4_events` directly, never merges, never touches RLS.
- Column whitelist excludes identity/provenance (`dedup_key`, `source_*`, `org_slug`, `venue_key`,
  `robs_pick`, `community_sourced`) and the `*_locked` flags; the executor refuses fixes to
  human-locked fields.
- Per-run caps (≤10 fixes, ≤3 tickets) with a roll-up rule; CLAUDE.md's intentional-duplicate /
  manual-venue rules are loaded before anything is called a bug (false-positive defense).

## 4. Rollout

- [x] Skill + action type + policy row (this PR)
- [ ] Apply the migration (`supabase/migrations/20260717_qa_fix_event_policy.sql`)
- [ ] Create the daily schedule (routine runs the skill in this repo; ~8:15 AM PT)
- [ ] After 2 clean weeks: `UPDATE agent_policy SET auto_execute=true WHERE action_type='qa_fix_event';`

## Open Items

- Should a clean-pass day write a `site_events` row so /admin/pulse shows QA heartbeat? (Currently Slack-only.)
- Extend the sweep with a weekly OG-image render check (Karen/Miguel share-path).

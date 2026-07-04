---
description: Implement a Roadmap board ticket (HWY-N) end-to-end and open a draft PR
argument-hint: HWY-42
---

You are implementing a ticket from the Hwy4Events **Roadmap board** (`hwy4_tasks`, PRD-roadmap-board.md).

Ticket ref: **$ARGUMENTS**

Supabase project id: `uzediwokyshjbsymevtp` (use the Supabase MCP `execute_sql` / `apply_migration`).
The board table is `hwy4_tasks`; the human handle is `ref` (e.g. `HWY-42`).

Follow this loop exactly. **Never merge the PR — you open a draft and stop.**

## 1. Read the ticket
```sql
select id, ref, title, body, type, status, priority, pr_number
from hwy4_tasks where ref = '$ARGUMENTS';
```
- If no row: tell the user the ref wasn't found and stop.
- If `status = 'proposed'`: it hasn't been approved — tell the user to Promote it in `/admin/roadmap` first, and stop.
- If `status = 'in_review'` and it already has a `pr_number`: it's already built — surface the PR and ask before redoing.
- The `body` is the spec. If it's thin/ambiguous, ask the user 1–2 clarifying questions **before** writing code.

## 2. Branch from a fresh base (the stale-base lesson)
- `git fetch origin` and confirm you branch from `origin/main`, NOT whatever is checked out (worktrees/sessions drift; branches can sit behind main).
- Branch name: `task/<ref-lowercased>-<short-slug>` (e.g. `task/hwy-42-free-filter`).
- Mark the ticket in progress:
```sql
update hwy4_tasks set status = 'in_progress', branch = '<branch>', updated_at = now()
where ref = '$ARGUMENTS';
```

## 3. Implement
- Build exactly what the ticket asks — scope to the ticket, file follow-ups for anything out of scope (a new ticket row is fine).
- Respect this codebase's rules (see CLAUDE.md): voice rules + `withVoice()`/`voice-lint` for any user-facing copy; `cursor-pointer` on buttons; RLS-on + service-role policy in the same migration for any new table (never disable RLS); keep the client bundle light.
- Run the relevant checks before opening the PR: `cd scripts && npx tsx test/<relevant>.test.ts` for any pure-core you touched, `npm run voice-lint` if you changed static copy, and a `next build` / typecheck if practical.

## 4. Open a DRAFT PR (never merge)
- `gh pr create --draft` with a body that includes **`Builds $ARGUMENTS`** on its own line (the merge webhook parses `Builds HWY-\d+` to auto-close the ticket) plus a short summary + test notes. End the PR body with the repo's standard Claude Code trailer.
- Then flip the ticket to review and record the PR:
```sql
update hwy4_tasks
set status = 'in_review', pr_url = '<pr url>', pr_number = <n>, updated_at = now()
where ref = '$ARGUMENTS';
```

## 5. Report back
Tell the user: what you built, the draft PR link, what you verified, and that the card is now **In review** in `/admin/roadmap` awaiting their review + merge. Do not merge — the merge is always the human's click.

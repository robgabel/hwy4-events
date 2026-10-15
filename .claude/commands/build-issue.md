---
description: Implement a GitHub issue (#N) end-to-end and open a draft PR
argument-hint: 342
---

You are implementing a GitHub issue from the Hwy4Events backlog. GitHub Issues is the only backlog (#325); the board is the GitHub Project https://github.com/users/robgabel/projects/3.

Issue: **robgabel/hwy4-events#$ARGUMENTS**

Follow this loop exactly. **Never merge the PR unless Rob says so for this PR: you open a draft and stop.**

## 1. Read the issue
- Read the issue, its labels and its comments (`gh issue view $ARGUMENTS -R robgabel/hwy4-events --comments`, or the GitHub MCP `issue_read`).
- If it is closed: tell the user and stop.
- If it still carries the `proposed` label: an agent filed it and Rob has not accepted it. Ask before building.
- The header table (Size / Build with / Effort / Subagents) says who should build it and which subagents to use. The body is the spec. If it is thin or ambiguous, ask the user 1–2 clarifying questions **before** writing code.

## 2. Branch from a fresh base (the stale-base lesson)
- `git fetch origin` and branch from `origin/main`, NOT whatever is checked out (worktrees and sessions drift).
- Branch name: `issue/$ARGUMENTS-<short-slug>` (e.g. `issue/342-visitor-id`), unless the session assigns one.

## 3. Implement
- Build exactly what the issue asks. File a new issue for anything out of scope (labels per the #325 convention, `proposed` included).
- Respect this codebase's rules (see CLAUDE.md): voice rules + `withVoice()`/`voice-lint` for any user-facing copy; `cursor-pointer` on buttons; RLS-on + service-role policy in the same migration for any new table (never disable RLS); migrations are committed, not applied, without Rob's OK; keep the client bundle light.
- Run the checks before opening the PR: `cd scripts && npm test`, `npx tsc --noEmit` in the root and in `scripts/`, and `npm run voice-lint` if you changed static copy.

## 4. Open a DRAFT PR
- Draft PR whose body has **`Closes #$ARGUMENTS`** on its own line. GitHub closes the issue on merge and the Project moves it to Done; nothing else to update. Add a short summary + test notes and end with the repo's standard Claude Code trailer.
- Then run the independent QA pass per `.claude/skills/pr-qa/SKILL.md`.

## 5. Report back
Tell the user what you built, the draft PR link, what you verified, and the QA verdict. The merge is Rob's click unless he has said otherwise for this PR.

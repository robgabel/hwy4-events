---
description: Implement a GitHub issue (#N) end-to-end and open a draft PR
argument-hint: 342
disable-model-invocation: true
---

You are implementing a GitHub issue from this repo's backlog. GitHub Issues is the only backlog (#325); the board is the GitHub Project named in the active region's `admin.roadmapUrl` (`regions/<slug>/ops.ts`).

Issue: **#$ARGUMENTS** in the repo this checkout's `origin` points at. Resolve it first with `git remote get-url origin` (call it `<owner>/<repo>`); never assume the upstream `robgabel/hwy4-events`, or a fork would build the upstream issue with the same number.

Follow this loop exactly. **Never merge the PR. You open a draft and stop; Rob merges (standing rule).**

## 1. Read the issue
- Read the issue, its labels and its comments (`gh issue view $ARGUMENTS -R <owner>/<repo> --comments`, or the GitHub MCP `issue_read`).
- If it is closed: tell the user and stop.
- Rob accepts an agent-filed issue by moving it to Ready and removing `proposed`. Rob typing `/build-issue` on it also counts as acceptance, even if the label is still on (the command can't be invoked by an agent on its own: `disable-model-invocation`). Never remove the label yourself; mention it in your report so Rob can clear it.
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
Tell the user what you built, the draft PR link, what you verified, and the QA verdict. The merge is Rob's click.

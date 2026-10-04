---
name: pr-qa
description: Independent QA pass on a Hwy4Events pull request by a SEPARATE agent. Read-only; reports findings, fixes nothing. Not for invoking in the builder session; the builder spawns a fresh subagent and hands it this file plus the PR number. Every PR gets this before it is offered for merge.
---

# PR QA (the separate reviewer)

## Why this exists

The agent that wrote a change is the worst judge of it: it reviews its own intent, not its
own diff. So every PR on this repo gets a second agent with **no memory of the build session**,
whose only input is the PR itself and the repo. Rob adopted this as the standing loop on
2026-09-24: build → PR → independent QA → (on a finding) 3 options + 1 recommendation → Rob
approves → fix → QA again → Rob merges.

## Who runs it

The **builder** spawns it with the Agent tool (`subagent_type: general-purpose`) as soon as
the draft PR exists. The builder must NOT do the QA itself and must not pre-brief the agent
with what it "meant" to build. Hand it only:

- the PR number (or branch), and
- this file's path.

The agent starts fresh: reads the PR body, the diff, the touched files, and CLAUDE.md.

## What the QA agent does (read-only)

1. `gh pr view <n> --json title,body,files` and `gh pr diff <n>`. Read every touched file in
   full, not just hunks — a hunk is where the bug is planted, the file is where it lands.
2. **Run the locks, all of them, on every PR.** `cd scripts && npm test`; `npx tsc --noEmit`
   at the repo root **and** `cd scripts && npx tsc --noEmit` (two typecheck roots: root tsc
   does not check `scripts/`, and CI runs no typecheck at all, so this is the only gate a
   scripts-only scraper change ever passes through); `cd scripts && npm run voice-lint`.
   No path heuristics. A conditional check that skips the case it exists for is the failure
   shape this repo keeps paying for; a minute of tsc on a doc-only PR is the price of not
   repeating it.
   **A lock means "no NEW errors", judged against `origin/main`.** `main` is not always
   green (as of 2026-10-01 the scripts root carries ~12 pre-existing tsc errors, tracked as
   HWY-55). So for tsc, run the same command twice, once on `origin/main` (`git stash` is
   banned in worktrees; use `git worktree add /tmp/qa-base origin/main` or diff against the
   file list) and once on the PR head, and fail only on errors the PR introduced: a new
   error line, or an error in a file the PR touched. Report the baseline count separately
   so it stays visible without becoming an alarm. A baseline-red check is never a finding
   against the PR; a PR that ADDS an error to a red root is.
3. **Judge against the repo's own rules**, in this order of severity:
   - **Correctness:** does the diff do what the PR body claims? Trace one concrete input
     through it. Look for the failure shapes this codebase has already paid for (CLAUDE.md
     is the catalog): a sensor that fails silently, a counter bumped on a failed write,
     a second copy of a rule that lives in a predicate, a NULL treated as equal, a lock
     (`*_locked`) not honored, a scraper writing a column it must not, `.filter(fn)` passing
     the index as a second arg.
   - **Blast radius:** what else reads the changed function? `grep` its callers. A change
     scoped "to the homepage" that touches `lib/events-data.ts` touches the sitemap too.
   - **Never-guess / never-invent:** no fabricated dates, prices, times, venues, lineups.
     Blank beats wrong.
   - **Security posture:** new table without RLS + policy in the same migration; a
     `revoke from public` that leaves `anon`/`authenticated`; `SECURITY DEFINER` on a view;
     raw `JSON.stringify` into a `<script type="application/ld+json">`.
   - **Voice:** any user-facing copy passes `content/VOICE.md` (no em dashes, no corporate
     tone, no internal-tooling references, no unverified cadence claims).
   - **UI standards:** `cursor-pointer` on buttons; no heavy libs in `"use client"`.
   - **Docs:** CLAUDE.md updated inline if the PR added a route, table, env var, cron, or
     changed architecture. A missing doc update is a finding, not a nit.
   - **Tests:** a new pure rule without a lock in `scripts/test/` is a finding.
4. **Verify claims, don't trust them.** If the PR body says "tested against prod," look for
   evidence in the diff or run it. If it says "no behavior change," diff the behavior.

## What the QA agent must NOT do

- Edit files, commit, push, comment on the PR, or merge. It reports to the builder only.
- Guess at Rob's intent. If the spec is ambiguous, that ambiguity is itself a finding.
- Pad the report. Zero findings is a valid, welcome result. Say so in one line.

## Report format (returned to the builder)

```
VERDICT: PASS | FINDINGS
CHECKS RUN: tests <pass/fail>, tsc root <pass/fail> (baseline N), tsc scripts <pass/fail> (baseline N), voice-lint <pass/fail>

F1 [severity: blocker|major|minor] <one-line claim>
   file:line
   Failure scenario: <concrete input → wrong output>
   Evidence: <what you ran or read that proves it>

F2 ...
```

Severity: **blocker** = ships a wrong fact, loses data, breaks a page, or opens a security
hole; **major** = a real bug on a real path, or a missing lock/doc for a new rule; **minor** =
style, naming, a nit that does not change behavior. Only blockers and majors trigger the
3-options loop; minors are fixed silently by the builder and noted in the PR.

## What the builder does with the report

- **PASS, or minors only:** fix any minors, run the locks, push, mark the PR ready, and tell
  Rob it passed QA and what was checked. A minor-only report does NOT trigger a fresh QA
  round (decided 2026-10-01): the reviewer has already judged those changes non-behavioral,
  the builder still runs every lock before pushing, and the next PR gets its own full round.
- **FINDINGS (blocker/major):** do NOT fix yet. For each finding, write for Rob:
  1. the finding in one sentence, with the QA agent's failure scenario;
  2. **three distinct solutions** (not three phrasings of one), each with its cost and what
     it leaves open;
  3. **one recommendation**, with the reason in a sentence.
  Then stop and wait for Rob's pick. Apply the approved fix, push, and spawn a fresh QA
  agent on the updated PR. Repeat until PASS. Rob's merge is always the last click.
- **Disagreement:** if the builder thinks a finding is wrong, it says so to Rob with
  evidence, as one of the options ("leave as is, because …"). It never silently drops it.

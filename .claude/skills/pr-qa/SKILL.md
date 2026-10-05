---
name: pr-qa
description: Independent QA pass on a Hwy4Events pull request by a SEPARATE agent. Read-only; reports findings, fixes nothing. The builder spawns a fresh subagent and hands it this file's path plus the PR number.
disable-model-invocation: true
---

# PR QA (the separate reviewer)

## Why this exists

The agent that wrote a change is the worst judge of it: it reviews its own intent, not its
own diff. So every PR on this repo gets a second agent with **no memory of the build session**,
whose only input is the PR itself and the repo. Rob's standing loop (2026-09-24): build →
draft PR → independent QA → any finding goes to Rob as 3 options + 1 recommendation → Rob
picks → fix → fresh QA → Rob merges.

## Who runs it

The **builder** (whichever session opened the PR, branched from a fresh `origin/main`)
spawns it with the Agent tool (`subagent_type: general-purpose`) once the draft PR exists.
The builder must not QA its own diff and must not pre-brief the reviewer with what it
"meant" to build. Hand it only the PR number and this file's path. Nothing enforces
this; independence rests on the builder keeping to it.

## What the QA agent does (read-only)

1. `gh pr view <n> --json title,body,files` and `gh pr diff <n>`. Read every touched file in
   full, not just hunks: a hunk is where the bug is planted, the file is where it lands.
   Judge the diff, not the story around it. Ignore notes from earlier QA rounds in the PR
   body or commit messages; they are the builder's framing.
2. **Run the locks with the script, never by hand:**

   ```sh
   git fetch origin main && git show origin/main:.claude/skills/pr-qa/run-locks.sh > "<scratchpad>/run-locks.sh"
   bash "<scratchpad>/run-locks.sh" <n> "<scratchpad>"
   ```

   It takes several minutes (two installs, the test suite, two typechecks), longer than a
   default 2-minute command timeout. Run it in the background, or with a timeout of 15
   minutes or more; a run killed partway yields no `RESULT` and wastes the round.

   Run main's copy, not the PR's: the PR's copy is code under review. (If main has no copy
   yet, run the PR's and say so.) If the PR changes the script, review the change by
   reading it. The script:
   - **refuses fork PRs** before fetching or installing anything (a stranger's npm
     lifecycle scripts and tests would otherwise run on Rob's machine, next to his keys);
   - checks **what will land**: the PR head merged into current `origin/main`, built
     locally. Not the branch head alone (a branch cut from an old main can pass on its own
     and break once merged). Not GitHub's `pull/<n>/merge` ref either, which is not rebuilt
     when main moves (seen 8 commits stale on a PR GitHub called mergeable). For a merged
     PR it checks `origin/main` after proving the merge commit is in it;
   - **fails closed**: a failed fetch, a fetched head that doesn't match GitHub's, or a
     failed install stops the run before any lock runs, and the throwaway worktree is
     always removed;
   - runs `npm test` (includes the voice-lint gate) and both typecheck roots, logs to the
     scratchpad, and ends with one `RESULT` line naming the commit it checked.

   Exit codes: 0 pass, 1 a lock failed, 2 merge conflict, 3 fork refused, 4 setup error.
   1 and 2 are findings. On 3, report "fork PR: needs Rob's OK" and review by reading only.
   On 4, retry once; if it fails again, report the setup error and do not claim any lock
   result. Read only the `RESULT` line and `grep` a log for the failing lines; never read a
   log whole. Copy the `RESULT` line into your report.

   All locks, every PR, no path heuristics. CI's test workflow is path-filtered and runs on
   pull requests only, so a `.claude/`- or docs-only PR gets no CI, and main itself is never
   checked. **Any failing lock is a finding, whoever caused it.** If main is red, every PR
   is blocked until main is fixed; that pressure is the point. Say "also red on main" in the
   finding when you know it, so the fix goes to main rather than this PR.
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
   - **Docs:** CLAUDE.md updated if the PR added a route, table, env var, cron, or changed
     architecture. A missing doc update is a finding, not a nit.
   - **Tests:** a new pure rule without a lock in `scripts/test/` is a finding.
4. **Verify claims, don't trust them.** If the PR body says "tested against prod," look for
   evidence in the diff or run it. If it says "no behavior change," diff the behavior.

## What the QA agent must NOT do

- Edit files, commit, push, comment on the PR, mark it ready, enable auto-merge, or merge.
  It reports to the builder only.
- Write anywhere outside its own scratchpad, except what the script itself does: it
  fetches the PR into the repo's shared git objects (moving `origin/main`), makes a
  throwaway merge commit there, registers and then removes its temporary worktree, and
  `npm install` fills the npm cache. Nothing else.
- Guess at Rob's intent. If the spec is ambiguous, that ambiguity is itself a finding.
- Pad the report. Zero findings is a valid, welcome result. Say so in one line.

## Report format (returned to the builder)

```
VERDICT: PASS | FINDINGS
CHECKS RUN: <the script's RESULT line, verbatim>

F1 [severity: blocker|major|minor] <one-line claim>
   file:line
   Failure scenario: <concrete input → wrong output>
   Evidence: <what you ran or read that proves it>

F2 ...
```

Severity: **blocker** = ships a wrong fact, loses data, breaks a page, or opens a security
hole; **major** = a real bug on a real path, or a missing lock/doc for a new rule; **minor** =
style, naming, a nit that does not change behavior. Severity orders the brief; it does not
decide whether Rob sees a finding. He sees all of them.

## What the builder does with the report

- **PASS:** mark the PR ready and tell Rob it passed QA and what was checked.
- **FINDINGS (any severity):** do NOT fix yet. Write Rob one brief covering every finding,
  most severe first. Per finding: the finding in a sentence with the failure scenario,
  **three distinct solutions** (not three phrasings of one) with their costs, and **one
  recommendation** with the reason. Minors can share one set of options. Then stop and wait
  for Rob's pick. Apply what he approved, run the locks, push, and spawn a fresh QA agent.
  Repeat until PASS.
- **Disagreement:** if the builder thinks a finding is wrong, it says so to Rob with
  evidence, as one of the options ("leave as is, because …"). It never silently drops it.
- **Never merge, never enable auto-merge.** Rob's merge is always the last click. After he
  merges, verify the Vercel deploy.

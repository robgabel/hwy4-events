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
2. **Run the locks on what will land, in your own checkout.** First:
   `gh pr view <n> --json isCrossRepository,mergeable,state`.
   - `isCrossRepository: true` (a fork PR): **stop before fetching or installing
     anything.** `npm install` runs the PR's lifecycle scripts and the tests run its code,
     on Rob's machine, next to his keys. Report "fork PR: needs Rob's OK before any of its
     code runs" and review the diff by reading only.
   - `state: MERGED` (a catch-up review): run the locks on `origin/main` instead.

   Then build the merge yourself: current `origin/main` with the PR head merged in. That
   is what will land. The branch head alone is the wrong code (a branch cut from an old
   main can pass on its own and break once merged, or fail on something main has since
   fixed). GitHub's `pull/<n>/merge` ref is wrong too: it is not rebuilt when main moves,
   and was seen ten commits stale on a PR GitHub called mergeable. If the local merge
   conflicts, that is a finding; report it and stop. The directory you start in is
   probably not on the PR at all, so work in a throwaway worktree in your scratchpad, and
   install deps the way CI does (`scripts/` has no lockfile, so `npm install`, not
   `npm ci`; never symlink another checkout's `node_modules`, it can be stale):

   ```sh
   SP="<your scratchpad dir>"; QA="$SP/qa-pr-<n>"
   git fetch origin main && git fetch origin "pull/<n>/head" && PR=$(git rev-parse FETCH_HEAD)
   git worktree add --detach "$QA" origin/main
   (cd "$QA" && git merge --no-edit "$PR") || echo "CONFLICT: finding, stop here"
   (cd "$QA" && npm install) > "$SP/install-root.log" 2>&1
   (cd "$QA/scripts" && npm install) > "$SP/install-scripts.log" 2>&1
   (cd "$QA/scripts" && npm test) > "$SP/test.log" 2>&1; tail -12 "$SP/test.log"   # includes voice-lint
   (cd "$QA" && npx tsc --noEmit) > "$SP/tsc-root.log" 2>&1; grep -c 'error TS' "$SP/tsc-root.log"
   (cd "$QA/scripts" && npx tsc --noEmit) > "$SP/tsc-scripts.log" 2>&1; grep -c 'error TS' "$SP/tsc-scripts.log"
   git worktree remove --force "$QA"
   ```

   Every log goes to the scratchpad and you read only its summary; on a failure, `grep`
   the log for the failing lines instead of reading it whole.

   All three, every PR, no path heuristics. CI's test workflow is path-filtered and runs on
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
- Write anywhere outside its own scratchpad (the `git worktree` bookkeeping from the recipe above is the one exception).
- Guess at Rob's intent. If the spec is ambiguous, that ambiguity is itself a finding.
- Pad the report. Zero findings is a valid, welcome result. Say so in one line.

## Report format (returned to the builder)

```
VERDICT: PASS | FINDINGS
CHECKS RUN: tests <pass/fail>, tsc root <pass/fail>, tsc scripts <pass/fail>

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

#!/usr/bin/env bash
# Run the repo's locks (npm test + both typecheck roots) on exactly what a PR
# will land: the PR head merged into current origin/main. Fails closed: any
# setup step that goes wrong stops the run before a lock can grade the wrong
# code, and the throwaway worktree is removed on any exit short of SIGKILL.
#
# Usage: bash run-locks.sh <pr-number> <scratchpad-dir>
# Run from inside a checkout of this repo. Logs go to <scratchpad-dir>.
#
# Exit codes:
#   0 all locks pass       1 a lock failed       2 merge conflict
#   3 fork PR (refused)    4 setup error (fetch, install, bad args)
# Every exit the script controls ends with a "RESULT ..." line naming the main
# commit (base=) and PR head (head=) checked. A killed run (SIGTERM, SIGHUP,
# SIGKILL) prints none; the caller must treat a missing RESULT as a failure.

set -uo pipefail

N="${1:-}"; SP="${2:-}"; QA=""; CHECKED="none"

result() {
  local pr="$N"; [[ "$pr" =~ ^[0-9]+$ ]] || pr="invalid"
  echo "RESULT pr=$pr checked=$CHECKED $*"
}
die() { echo "SETUP ERROR: $1" >&2; result "status=setup_error reason=\"$1\""; exit 4; }

cleanup() {
  if [ -n "$QA" ] && [ -d "$QA" ]; then
    git -C "$QA" merge --abort >/dev/null 2>&1
    git worktree remove --force "$QA" >/dev/null 2>&1
  fi
}
trap cleanup EXIT

[[ "$N" =~ ^[0-9]+$ && -n "$SP" ]] || die "usage: run-locks.sh <pr-number> <scratchpad-dir>"
QA="$SP/qa-pr-$N-$$"; LOG="$SP/logs-pr-$N-$$"   # per run, so a stale log is never read
mkdir -p "$LOG" || die "cannot create $LOG"

# Retry network calls: a dropped connection must never be read as a result.
retry() {
  local i
  for i in 1 2 3 4; do "$@" && return 0; sleep $((i * 5)); done
  return 1
}

git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git checkout"

INFO=$(retry gh pr view "$N" --json isCrossRepository,state,headRefOid,mergeCommit,baseRefName \
  -q '[.isCrossRepository, .state, .headRefOid, (.mergeCommit.oid // ""), .baseRefName] | map(tostring) | join("|")') \
  || die "gh pr view failed"
# "|"-separated so a blank field stays in its own slot instead of shifting the rest.
IFS='|' read -r CROSS STATE HEAD_OID MERGE_OID BASE <<<"$INFO"

# Fail closed: only an explicit "false" proceeds.
case "$CROSS" in
  false) ;;
  true)
    echo "FORK PR: refusing to fetch, install or run any of its code. Needs Rob's OK." >&2
    result "status=fork_refused"; exit 3 ;;
  *) die "cannot tell whether the PR is from a fork (isCrossRepository='$CROSS')" ;;
esac

retry git fetch -q origin main || die "fetch origin main failed"
MAIN=$(git rev-parse origin/main) || die "no origin/main"

if [ "$STATE" = "MERGED" ]; then
  # Catch-up review: what landed is main. Prove the merge is in it.
  [ -n "$MERGE_OID" ] || die "merged PR has no merge commit"
  git merge-base --is-ancestor "$MERGE_OID" "$MAIN" || die "merge commit $MERGE_OID not on origin/main"
  git worktree add -q --detach "$QA" "$MAIN" || die "worktree add failed"
  CHECKED="$MAIN"; PR="$HEAD_OID"
elif [ "$STATE" = "OPEN" ]; then
  # A stacked PR lands on another branch, not main; grading it against main is wrong.
  [ "$BASE" = "main" ] || die "PR base is '$BASE', not main; stacked PRs are not supported"
  retry git fetch -q origin "pull/$N/head" || die "fetch pull/$N/head failed"
  PR=$(git rev-parse FETCH_HEAD) || die "no FETCH_HEAD"
  [ "$PR" = "$HEAD_OID" ] || die "fetched $PR but GitHub says the head is $HEAD_OID"
  git worktree add -q --detach "$QA" "$MAIN" || die "worktree add failed"
  # Neutralize local git settings that could fail a clean merge (signing, hooks, ff-only).
  if ! git -C "$QA" -c user.name=pr-qa -c user.email=pr-qa@localhost \
       -c commit.gpgsign=false -c core.hooksPath=/dev/null -c merge.ff=true \
       merge -q --no-edit "$PR" >"$LOG/merge.log" 2>&1; then
    if [ -n "$(git -C "$QA" diff --name-only --diff-filter=U)" ]; then
      echo "CONFLICT merging PR head $PR into origin/main $MAIN (see $LOG/merge.log)" >&2
      result "status=conflict base=$MAIN head=$PR logs=$LOG"; exit 2
    fi
    die "merge failed without a conflict, see $LOG/merge.log"
  fi
  CHECKED=$(git -C "$QA" rev-parse HEAD)
  git -C "$QA" merge-base --is-ancestor "$PR" HEAD || die "PR head not in the merged tree"
else
  die "PR state is $STATE"
fi

# --ignore-scripts: no package's install-time code runs (the locks don't need any, and
# the supabase CLI's postinstall downloads a binary from GitHub that flakes).
install() { (cd "$1" && npm install --ignore-scripts --no-audit --no-fund) >"$2" 2>&1; }
retry install "$QA" "$LOG/install-root.log" || die "npm install (root) failed, see $LOG/install-root.log"
retry install "$QA/scripts" "$LOG/install-scripts.log" || die "npm install (scripts) failed, see $LOG/install-scripts.log"

# CI runs Node from .github/workflows/test.yml and runs install scripts; this run skips
# them. Record the local Node and flag a major-version mismatch, so a pass is never
# mistaken for a CI-equivalent pass.
NODE_V=$(node --version 2>/dev/null || echo unknown)
CI_NODE=$(grep -E 'node-version:' "$QA/.github/workflows/test.yml" 2>/dev/null | head -1 | grep -oE '[0-9]+' | head -1)
NODE_MAJOR=${NODE_V#v}; NODE_MAJOR=${NODE_MAJOR%%.*}
NODE_WARN=""
[ -n "$CI_NODE" ] && [ "$NODE_MAJOR" = "$CI_NODE" ] || NODE_WARN="(ci_uses_${CI_NODE:-unknown})"

FAIL=0
(cd "$QA/scripts" && npm test) >"$LOG/test.log" 2>&1; T=$?
TP=$(grep -E '^ℹ pass' "$LOG/test.log" | awk '{print $3}'); TF=$(grep -E '^ℹ fail' "$LOG/test.log" | awk '{print $3}')
[ "$T" -eq 0 ] && TESTS="pass" || { TESTS="fail"; FAIL=1; }

(cd "$QA" && npx tsc --noEmit) >"$LOG/tsc-root.log" 2>&1; R=$?
RE=$(grep -c 'error TS' "$LOG/tsc-root.log")
[ "$R" -eq 0 ] && TR="pass" || { TR="fail"; FAIL=1; }

(cd "$QA/scripts" && npx tsc --noEmit) >"$LOG/tsc-scripts.log" 2>&1; C=$?
CE=$(grep -c 'error TS' "$LOG/tsc-scripts.log")
[ "$C" -eq 0 ] && TC="pass" || { TC="fail"; FAIL=1; }

result "status=$([ $FAIL -eq 0 ] && echo pass || echo lock_failed) base=$MAIN head=$PR tests=$TESTS(${TP:-?}/${TF:-?}) tsc_root=$TR($RE) tsc_scripts=$TC($CE) node=$NODE_V$NODE_WARN logs=$LOG"
exit $FAIL

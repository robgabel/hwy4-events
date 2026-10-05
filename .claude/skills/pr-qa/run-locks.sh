#!/usr/bin/env bash
# Run the repo's locks (npm test + both typecheck roots) on exactly what a PR
# will land: the PR head merged into current origin/main. Fails closed: any
# setup step that goes wrong stops the run before a lock can grade the wrong
# code, and the throwaway worktree is always removed.
#
# Usage: bash run-locks.sh <pr-number> <scratchpad-dir>
# Run from inside a checkout of this repo. Logs go to <scratchpad-dir>.
#
# Exit codes:
#   0 all locks pass       1 a lock failed       2 merge conflict
#   3 fork PR (refused)    4 setup error (fetch, install, bad args)
# The last line is always "RESULT ..." naming the commit that was checked.

set -uo pipefail

N="${1:-}"; SP="${2:-}"
if [[ ! "$N" =~ ^[0-9]+$ || -z "$SP" ]]; then
  echo "usage: run-locks.sh <pr-number> <scratchpad-dir>" >&2; exit 4
fi
mkdir -p "$SP" || exit 4
QA="$SP/qa-pr-$N-$$"
CHECKED="none"

result() { echo "RESULT pr=$N checked=$CHECKED $*"; }
die() { echo "SETUP ERROR: $1" >&2; result "status=setup_error reason=\"$1\""; exit 4; }

cleanup() {
  if [ -d "$QA" ]; then
    git -C "$QA" merge --abort >/dev/null 2>&1
    git worktree remove --force "$QA" >/dev/null 2>&1
  fi
  git worktree prune >/dev/null 2>&1
}
trap cleanup EXIT

# Retry network calls: a dropped connection must never be read as a result.
retry() {
  local i
  for i in 1 2 3 4; do "$@" && return 0; sleep $((i * 5)); done
  return 1
}

git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git checkout"

INFO=$(retry gh pr view "$N" --json isCrossRepository,state,headRefOid,mergeCommit \
  -q '"\(.isCrossRepository) \(.state) \(.headRefOid) \(.mergeCommit.oid // "")"') \
  || die "gh pr view failed"
read -r CROSS STATE HEAD_OID MERGE_OID <<<"$INFO"

if [ "$CROSS" = "true" ]; then
  echo "FORK PR: refusing to fetch, install or run any of its code. Needs Rob's OK." >&2
  result "status=fork_refused"; exit 3
fi

retry git fetch -q origin main || die "fetch origin main failed"
MAIN=$(git rev-parse origin/main) || die "no origin/main"

if [ "$STATE" = "MERGED" ]; then
  # Catch-up review: what landed is main. Prove the merge is in it.
  [ -n "$MERGE_OID" ] || die "merged PR has no merge commit"
  git merge-base --is-ancestor "$MERGE_OID" "$MAIN" || die "merge commit $MERGE_OID not on origin/main"
  git worktree add -q --detach "$QA" "$MAIN" || die "worktree add failed"
  CHECKED="$MAIN"
elif [ "$STATE" = "OPEN" ]; then
  retry git fetch -q origin "pull/$N/head" || die "fetch pull/$N/head failed"
  PR=$(git rev-parse FETCH_HEAD) || die "no FETCH_HEAD"
  [ "$PR" = "$HEAD_OID" ] || die "fetched $PR but GitHub says the head is $HEAD_OID"
  git worktree add -q --detach "$QA" "$MAIN" || die "worktree add failed"
  if ! git -C "$QA" -c user.name=pr-qa -c user.email=pr-qa@localhost \
       merge -q --no-edit "$PR" >"$SP/merge.log" 2>&1; then
    echo "CONFLICT merging PR head $PR into origin/main $MAIN (see $SP/merge.log)" >&2
    result "status=conflict base=$MAIN head=$PR"; exit 2
  fi
  CHECKED=$(git -C "$QA" rev-parse HEAD)
  git -C "$QA" merge-base --is-ancestor "$PR" HEAD || die "PR head not in the merged tree"
else
  die "PR state is $STATE"
fi

# --ignore-scripts: no package's install-time code runs (the locks don't need any, and
# the supabase CLI's postinstall downloads a binary from GitHub that flakes).
install() { (cd "$1" && npm install --ignore-scripts --no-audit --no-fund) >"$2" 2>&1; }
retry install "$QA" "$SP/install-root.log" || die "npm install (root) failed, see $SP/install-root.log"
retry install "$QA/scripts" "$SP/install-scripts.log" || die "npm install (scripts) failed, see $SP/install-scripts.log"

FAIL=0
(cd "$QA/scripts" && npm test) >"$SP/test.log" 2>&1; T=$?
TP=$(grep -E '^ℹ pass' "$SP/test.log" | awk '{print $3}'); TF=$(grep -E '^ℹ fail' "$SP/test.log" | awk '{print $3}')
[ "$T" -eq 0 ] && TESTS="pass" || { TESTS="fail"; FAIL=1; }

(cd "$QA" && npx tsc --noEmit) >"$SP/tsc-root.log" 2>&1; R=$?
RE=$(grep -c 'error TS' "$SP/tsc-root.log")
[ "$R" -eq 0 ] && TR="pass" || { TR="fail"; FAIL=1; }

(cd "$QA/scripts" && npx tsc --noEmit) >"$SP/tsc-scripts.log" 2>&1; C=$?
CE=$(grep -c 'error TS' "$SP/tsc-scripts.log")
[ "$C" -eq 0 ] && TC="pass" || { TC="fail"; FAIL=1; }

result "status=$([ $FAIL -eq 0 ] && echo pass || echo lock_failed) base=$MAIN tests=$TESTS(${TP:-?}/${TF:-?}) tsc_root=$TR($RE) tsc_scripts=$TC($CE) logs=$SP"
exit $FAIL

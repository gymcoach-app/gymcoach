#!/usr/bin/env bash
# Read-only review snapshot of a PR head (lessons L15, L38).
#
#   bash automation/review/snapshot.sh <pr> [dir]     create, print the path
#   bash automation/review/snapshot.sh --remove <dir> remove it again
#
# A reviewer reads a PR without touching any checkout another session uses:
# this fetches the PR head into refs/remotes/pr/<pr>, adds a detached worktree
# at that SHA under a scratch directory, and makes its files read-only. It never
# runs `git checkout` or `git switch` anywhere. The worktree is for reading
# (`rg`, an editor, `git diff origin/main...HEAD` inside it); nothing in it is
# built or executed, and external code still only runs in CI (docs/loops/10).
# Never start `claude`, `npm` or `eslint` inside a snapshot of a fork PR: its
# .claude/settings.json hooks and its configs would run. If a snapshot directory
# is deleted by hand, `git worktree prune` drops the stale entry.
set -euo pipefail

repo=$(git rev-parse --show-toplevel)
root=$(realpath -m "${TMPDIR:-/tmp}/gymcoach-review")

if [ "${1:-}" = "--remove" ]; then
  dir=${2:?usage: snapshot.sh --remove <dir>}
  abs=$(realpath -m "$dir")
  # Only snapshots made by this script: under the review root and detached.
  case "$abs/" in
    "$root"/*/) ;;
    *) echo "snapshot.sh: refusing to remove $abs (not under $root)" >&2; exit 2 ;;
  esac
  if ! git -C "$abs" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "snapshot.sh: $abs is not a worktree (git worktree prune drops a stale entry)" >&2
    exit 2
  fi
  if git -C "$abs" symbolic-ref -q HEAD >/dev/null; then
    echo "snapshot.sh: refusing to remove $abs: it is on a branch, not a detached snapshot" >&2
    exit 2
  fi
  chmod -R u+w "$abs"
  git -C "$repo" worktree remove --force "$abs"
  echo "removed $abs"
  exit 0
fi

pr=${1:?usage: snapshot.sh <pr> [dir]}
case "$pr" in
  '' | *[!0-9]*) echo "snapshot.sh: <pr> must be a PR number" >&2; exit 2 ;;
esac

git -C "$repo" fetch -q origin "pull/$pr/head:refs/remotes/pr/$pr" --force
sha=$(git -C "$repo" rev-parse "refs/remotes/pr/$pr")
dir=${2:-$root/pr-$pr-${sha:0:12}}

if [ -e "$dir" ]; then
  echo "snapshot.sh: $dir already exists (remove it with: bash automation/review/snapshot.sh --remove $dir)" >&2
  exit 1
fi
mkdir -p "$(dirname "$dir")"
git -C "$repo" worktree add -q --detach "$dir" "$sha"
chmod -R a-w "$dir"

echo "$dir"
echo "PR #$pr at $sha, read-only. Remove with: bash automation/review/snapshot.sh --remove $dir" >&2

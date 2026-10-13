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
set -euo pipefail

repo=$(git rev-parse --show-toplevel)

if [ "${1:-}" = "--remove" ]; then
  dir=${2:?usage: snapshot.sh --remove <dir>}
  chmod -R u+w "$dir"
  git -C "$repo" worktree remove --force "$dir"
  echo "removed $dir"
  exit 0
fi

pr=${1:?usage: snapshot.sh <pr> [dir]}
case "$pr" in
  '' | *[!0-9]*) echo "snapshot.sh: <pr> must be a PR number" >&2; exit 2 ;;
esac

git -C "$repo" fetch -q origin "pull/$pr/head:refs/remotes/pr/$pr" --force
sha=$(git -C "$repo" rev-parse "refs/remotes/pr/$pr")
dir=${2:-${TMPDIR:-/tmp}/gymcoach-review/pr-$pr-${sha:0:12}}

if [ -e "$dir" ]; then
  echo "snapshot.sh: $dir already exists (remove it with: bash automation/review/snapshot.sh --remove $dir)" >&2
  exit 1
fi
mkdir -p "$(dirname "$dir")"
git -C "$repo" worktree add -q --detach "$dir" "$sha"
chmod -R a-w "$dir"

echo "$dir"
echo "PR #$pr at $sha, read-only. Remove with: bash automation/review/snapshot.sh --remove $dir" >&2

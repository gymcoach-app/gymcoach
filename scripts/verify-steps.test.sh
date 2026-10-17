#!/usr/bin/env bash
#
# Self-test for scripts/verify-steps.sh and automation/ledger/record-verify.cjs
# (run by the default gate, no Docker, about a second). Uses a throwaway git
# repository and a private ledger path, so it never touches the real ledger.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

pass=0
fail_count=0
expect() {
  local name="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail_count=$((fail_count + 1))
    echo "  FAIL $name: got '$got', want '$want'"
  fi
}

# A fake repository root: the bookkeeping and the recorder, plus one commit.
FAKE="$WORK/repo"
mkdir -p "$FAKE/scripts" "$FAKE/automation/ledger"
cp "$HERE/verify-steps.sh" "$FAKE/scripts/"
cp "$REPO_ROOT/automation/ledger/record-verify.cjs" "$FAKE/automation/ledger/"
git -C "$FAKE" init -q -b feat/issue-1-x
git -C "$FAKE" -c user.name=t -c user.email=t@example.com add -A
git -C "$FAKE" -c user.name=t -c user.email=t@example.com commit -q -m init

# Runs a fake gate: steps from the arguments, then exits with the last one.
# "name:fail" fails that step through a fail()-like path; "name:die" exits
# without closing the step (an interruption).
fake_gate() {
  local ledger="$1"
  shift
  (
    export GYMCOACH_USAGE_LEDGER_PATH="$ledger"
    # shellcheck source=/dev/null
    . "$FAKE/scripts/verify-steps.sh"
    verify_record_init "$FAKE" default
    for s in "$@"; do
      case "$s" in
        *:fail) verify_step "${s%:fail}"; verify_step_done failed; exit 1 ;;
        *:die) verify_step "${s%:die}"; exit 130 ;;
        *) verify_step "$s" ;;
      esac
    done
    verify_step_done passed
    exit 0
  )
}

field() { node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n");const v=JSON.parse(l[l.length-1]);console.log(String(eval("v."+process.argv[2])))' "$1" "$2"; }
lines() { if [ -f "$1" ]; then wc -l <"$1" | tr -d ' '; else echo 0; fi; }

# 1. A green run on a clean tree: one line, every step passed, tree = HEAD's.
L1="$WORK/l1.jsonl"
fake_gate "$L1" prisma lint unit
expect "green exit preserved" "$?" "0"
expect "green one line" "$(lines "$L1")" "1"
expect "green kind" "$(field "$L1" kind)" "verify"
expect "green exit" "$(field "$L1" exit)" "0"
expect "green steps" "$(field "$L1" 'steps.map(s=>s.name+"="+s.outcome).join(",")')" "prisma=passed,lint=passed,unit=passed"
expect "green clean" "$(field "$L1" dirty)" "false"
expect "green tree" "$(field "$L1" treeSha)" "$(git -C "$FAKE" rev-parse 'HEAD^{tree}')"
expect "green head" "$(field "$L1" headSha)" "$(git -C "$FAKE" rev-parse HEAD)"
expect "no branch name" "$(grep -c 'feat/issue-1-x' "$L1")" "0"

# 2. A failing step: exit 1 kept, the step failed, later steps absent.
L2="$WORK/l2.jsonl"
fake_gate "$L2" prisma lint:fail unit
expect "red exit preserved" "$?" "1"
expect "red steps" "$(field "$L2" 'steps.map(s=>s.name+"="+s.outcome).join(",")')" "prisma=passed,lint=failed"
expect "red exit" "$(field "$L2" exit)" "1"

# 3. An interruption: the open step is recorded as interrupted.
L3="$WORK/l3.jsonl"
fake_gate "$L3" prisma build:die
expect "interrupted exit preserved" "$?" "130"
expect "interrupted step" "$(field "$L3" 'steps[1].outcome')" "interrupted"

# 4. A dirty tree: the tree SHA is that of the checked files, the real index
#    is untouched, and it matches the tree of a commit of those files.
echo "change" >"$FAKE/new-file.txt"
L4="$WORK/l4.jsonl"
fake_gate "$L4" lint
expect "dirty flag" "$(field "$L4" dirty)" "true"
expect "real index untouched" "$(git -C "$FAKE" status --porcelain)" "?? new-file.txt"
dirty_tree="$(field "$L4" treeSha)"
git -C "$FAKE" -c user.name=t -c user.email=t@example.com add -A
git -C "$FAKE" -c user.name=t -c user.email=t@example.com commit -q -m change
expect "dirty tree = later commit's tree" "$dirty_tree" "$(git -C "$FAKE" rev-parse 'HEAD^{tree}')"

# 5. Opt-out: no line, exit unchanged.
L5="$WORK/l5.jsonl"
GYMCOACH_USAGE_LEDGER=off fake_gate "$L5" lint:fail
expect "opt-out exit preserved" "$?" "1"
expect "opt-out no line" "$(lines "$L5")" "0"

# 6. Unwritable ledger: exit unchanged, no line.
L6="$WORK/no-dir-here/blocked"
touch "$WORK/no-dir-here"
fake_gate "$L6" lint 2>/dev/null
expect "unwritable ledger exit preserved" "$?" "0"

echo "verify-steps self-test: $pass passed, $fail_count failed"
[ "$fail_count" -eq 0 ]

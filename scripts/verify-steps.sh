# shellcheck shell=bash
#
# verify-steps.sh - step bookkeeping for scripts/verify.sh (sourced, not run).
#
# Records each gate step's outcome and duration, and on exit appends one
# "verify" line to the local run ledger through automation/ledger/record-verify.cjs
# (roadmap milestone 1: verification evidence per run). Recording is fail-open:
# it never changes the gate's exit code or output beyond one stderr line when
# the line cannot be written. GYMCOACH_USAGE_LEDGER=off disables it.
#
#   verify_record_init <root> <default|full>   once, before the first step
#   verify_step <name>                         a new step starts; the previous
#                                              one, if any, passed
#   verify_step_done <passed|failed>           the current step ends
#
# A step still open when the shell exits ended neither way: it is recorded as
# "interrupted" (a signal, or an exit outside fail()).
#
# No INT or TERM trap is set on purpose: bash defers a trapped signal until the
# running foreground command ends, which would keep a killed gate (and the
# heavy slot and test-infra lock) alive for a whole build or E2E step. Without
# one, the shell dies at once with the signal's own status (a calling loop
# still sees death by SIGINT), and bash still runs the EXIT trap first. That
# trap then sees the last command's status rather than the signal, so a run
# that ends with a step still open and status 0 is recorded with exit "none".
#
# The tree of the files is taken once before the first step and again at exit
# (record-verify.cjs); the line keeps it only when both agree.

VERIFY_STEPS=""
VERIFY_CURRENT=""
VERIFY_STEP_T0=0
VERIFY_STARTED=0
VERIFY_TIER=""
VERIFY_ROOT=""
VERIFY_START_TREE=""

verify_now_ms() {
  local t
  t="$(date +%s%3N 2>/dev/null)"
  case "$t" in
    *[!0-9]* | "") echo $(($(date +%s) * 1000)) ;;
    *) echo "$t" ;;
  esac
}

verify_step_done() {
  [ -n "$VERIFY_CURRENT" ] || return 0
  VERIFY_STEPS="${VERIFY_STEPS}${VERIFY_CURRENT}|$1|$(($(verify_now_ms) - VERIFY_STEP_T0));"
  VERIFY_CURRENT=""
}

verify_step() {
  verify_step_done passed
  VERIFY_CURRENT="$1"
  VERIFY_STEP_T0="$(verify_now_ms)"
}

verify_ledger_off() {
  case "$(printf '%s' "${GYMCOACH_USAGE_LEDGER:-}" | tr '[:upper:]' '[:lower:]')" in
    off) return 0 ;;
  esac
  return 1
}

verify_record_exit() {
  local rc="$1" exit_arg="$1"
  if [ -n "$VERIFY_CURRENT" ]; then
    # Every normal path closes its step (fail() or the final passed). A step
    # still open means a signal or an exit outside fail(); with status 0 the
    # real status is the signal's, which the trap cannot see.
    verify_step_done interrupted
    [ "$rc" = "0" ] && exit_arg=none
  fi
  verify_ledger_off && return 0
  # Release the heavy slot (fd 8) and the test-infra lock (fd 9) before
  # recording: every child got 8>&- 9>&-, so closing them here frees both, and
  # the next waiting run does not wait for the recorder.
  exec 8>&- 9>&-
  node "$VERIFY_ROOT/automation/ledger/record-verify.cjs" \
    --root "$VERIFY_ROOT" --tier "$VERIFY_TIER" --exit "$exit_arg" \
    --started "$VERIFY_STARTED" --steps "$VERIFY_STEPS" \
    --start-tree "${VERIFY_START_TREE:-none}" \
    </dev/null >/dev/null || true
}

verify_on_exit() {
  local rc=$?
  verify_record_exit "$rc"
  exit "$rc"
}

verify_record_init() {
  VERIFY_ROOT="$1"
  VERIFY_TIER="$2"
  VERIFY_STARTED="$(verify_now_ms)"
  if ! verify_ledger_off; then
    VERIFY_START_TREE="$(node "$VERIFY_ROOT/automation/ledger/record-verify.cjs" \
      --tree-only "$VERIFY_ROOT" </dev/null 2>/dev/null)" || VERIFY_START_TREE=""
    case "$VERIFY_START_TREE" in
      *[!0-9a-f]* | "") VERIFY_START_TREE="" ;;
    esac
  fi
  trap verify_on_exit EXIT
}

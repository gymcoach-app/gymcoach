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

VERIFY_STEPS=""
VERIFY_CURRENT=""
VERIFY_STEP_T0=0
VERIFY_STARTED=0
VERIFY_TIER=""
VERIFY_ROOT=""

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

verify_record_exit() {
  local rc="$1"
  if [ -n "$VERIFY_CURRENT" ]; then
    if [ "$rc" = "0" ]; then verify_step_done passed; else verify_step_done interrupted; fi
  fi
  case "$(printf '%s' "${GYMCOACH_USAGE_LEDGER:-}" | tr '[:upper:]' '[:lower:]')" in
    off) return 0 ;;
  esac
  # 8>&- 9>&-: the recorder must not hold the heavy slot or the test-infra lock.
  node "$VERIFY_ROOT/automation/ledger/record-verify.cjs" \
    --root "$VERIFY_ROOT" --tier "$VERIFY_TIER" --exit "$rc" \
    --started "$VERIFY_STARTED" --steps "$VERIFY_STEPS" \
    </dev/null >/dev/null 8>&- 9>&- || true
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
  trap verify_on_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

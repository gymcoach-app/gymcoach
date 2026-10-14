#!/usr/bin/env bash
#
# Self-test for scripts/heavy-slot.sh (run by the default gate, no Docker,
# a few seconds). Uses a private TMPDIR so it never touches the real slots.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMPDIR="$(mktemp -d)"
export TMPDIR
trap 'kill $(jobs -p) 2>/dev/null; rm -r "$TMPDIR"' EXIT

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

# A holder: takes a slot, reports it, then sleeps until killed.
holder() {
  (
    # shellcheck source=/dev/null
    . "$HERE/heavy-slot.sh"
    acquire_heavy_slot "test holder $1" >/dev/null || exit 1
    echo "$HEAVY_SLOT" >"$TMPDIR/held-$1"
    # 8>&-: the sleep must not inherit the lock, or killing the holder would
    # leave it held by its child (the L12 shape this script guards against).
    sleep 30 8>&-
  ) &
}

wait_file() {
  local f="$1" i
  for i in $(seq 1 50); do
    [ -s "$f" ] && return 0
    sleep 0.1
  done
  return 1
}

# shellcheck source=/dev/null
. "$HERE/heavy-slot.sh"

# 1. Slot count: explicit, invalid, default from cores.
expect "explicit count" "$(GYMCOACH_HEAVY_SLOTS=3 heavy_slot_count)" "3"
GYMCOACH_HEAVY_SLOTS=abc heavy_slot_count >/dev/null 2>&1
expect "invalid count refused" "$?" "1"
GYMCOACH_HEAVY_SLOTS=0 heavy_slot_count >/dev/null 2>&1
expect "zero refused" "$?" "1"
cores="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc)"
want=$((cores / 4))
[ "$want" -lt 1 ] && want=1
expect "default count" "$(unset GYMCOACH_HEAVY_SLOTS; heavy_slot_count)" "$want"

# 2. N = 2 slots: two holders take distinct slots, a third waits and gives up
#    at the bound, naming the holders.
export GYMCOACH_HEAVY_SLOTS=2
holder a
pid_a=$!
wait_file "$TMPDIR/held-a" || echo "  holder a never got a slot"
holder b
wait_file "$TMPDIR/held-b" || echo "  holder b never got a slot"
slots="$(sort "$TMPDIR/held-a" "$TMPDIR/held-b" | tr '\n' ' ')"
expect "two holders, two distinct slots" "$slots" "1 2 "

out="$(GYMCOACH_HEAVY_WAIT=2 bash -c ". '$HERE/heavy-slot.sh'; acquire_heavy_slot third" 2>&1)"
code=$?
expect "third run gives up at the wait bound" "$code" "1"
case "$out" in
  *"all 2 slots"*"what=test holder"*) holders_named=yes ;;
  *) holders_named=no ;;
esac
expect "waiting notice names the holders" "$holders_named" "yes"

# 3. Crash release: killing a holder frees its slot without cleanup, and a
#    waiting run gets it.
kill -9 "$pid_a" 2>/dev/null
wait "$pid_a" 2>/dev/null
out="$(GYMCOACH_HEAVY_WAIT=10 bash -c ". '$HERE/heavy-slot.sh'; acquire_heavy_slot after-crash && echo got=\$HEAVY_SLOT" 2>&1)"
expect "killed holder's slot is reused" "$(echo "$out" | grep -o 'got=[0-9]*')" "got=$(cat "$TMPDIR/held-a")"

# 4. Opt out never waits.
out="$(GYMCOACH_HEAVY_SLOTS=off bash -c ". '$HERE/heavy-slot.sh'; acquire_heavy_slot x && echo ok" 2>&1)"
expect "opt out returns at once" "$(echo "$out" | tail -1)" "ok"

echo "heavy-slot self-test: $pass passed, $fail_count failed"
[ "$fail_count" -eq 0 ]

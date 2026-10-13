#!/usr/bin/env bash
#
# heavy-slot.sh - a machine-wide counting semaphore for heavy local work
# (roadmap milestone 2, concurrency limits). Sourced by scripts/verify.sh.
#
# Why: with three or four agent ticks building, testing and running Docker on
# one machine, the load average reached ~20, Playwright pages crashed with
# ERR_INSUFFICIENT_RESOURCES and jsdom tests crossed their timeouts (lessons
# L33-adjacent incidents, L42). Asking agents to "be careful" did not hold; a
# fixed number of slots does.
#
# How: N slot files under ${TMPDIR:-/tmp}/gymcoach-heavy/. A run takes the
# first slot it can lock with `flock --nonblock` on file descriptor 8 and keeps
# it until the shell exits; the kernel releases the lock when the process dies,
# so a crashed or killed run frees its slot by itself (no stale lock files).
# When every slot is taken, the run waits (polling, bounded) and says who
# holds each slot.
#
# Slots: GYMCOACH_HEAVY_SLOTS if set, else max(1, floor(cores / 4)).
# Bounded wait: GYMCOACH_HEAVY_WAIT seconds (default 3600).
# Opt out for one run: GYMCOACH_HEAVY_SLOTS=off.
#
# Lock order (no deadlock with the --full tier): a run takes its heavy slot
# FIRST, then, in --full mode, the exclusive test-infra lock
# (${TMPDIR:-/tmp}/gymcoach-test-infra.lock, fd 9). Nobody takes them in the
# other order, and a holder of the test-infra lock never waits for a slot, so
# a cycle cannot form. Children that may outlive their step (a next-server,
# lesson L12) are started with `8>&- 9>&-` so they cannot keep either lock.

heavy_slot_count() {
  local requested="${GYMCOACH_HEAVY_SLOTS:-}"
  if [ -n "$requested" ]; then
    if [[ "$requested" =~ ^[1-9][0-9]*$ ]]; then
      echo "$requested"
      return 0
    fi
    echo "heavy-slot: GYMCOACH_HEAVY_SLOTS must be a positive integer or off (got '$requested')" >&2
    return 1
  fi
  local cores
  cores="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 4)"
  local n=$((cores / 4))
  [ "$n" -lt 1 ] && n=1
  echo "$n"
}

heavy_slot_dir() {
  echo "${TMPDIR:-/tmp}/gymcoach-heavy"
}

# Who holds each slot: the holder writes "pid=<pid> since=<iso> what=<label>"
# into its slot file after locking it.
heavy_slot_holders() {
  local dir n i
  dir="$(heavy_slot_dir)"
  n="$1"
  for i in $(seq 1 "$n"); do
    if [ -s "$dir/slot-$i" ]; then
      echo "    slot $i: $(head -c 200 "$dir/slot-$i")"
    else
      echo "    slot $i: (no holder recorded)"
    fi
  done
}

# acquire_heavy_slot <label>: returns 0 holding a slot on fd 8 (or when opted
# out), 1 when the wait bound is reached or the configuration is invalid.
acquire_heavy_slot() {
  local label="${1:-heavy work}"
  if [ "${GYMCOACH_HEAVY_SLOTS:-}" = "off" ]; then
    echo "  heavy-slot: disabled for this run (GYMCOACH_HEAVY_SLOTS=off)"
    return 0
  fi
  if ! command -v flock >/dev/null 2>&1; then
    echo "  heavy-slot: flock not found; running without a slot (Linux util-linux provides it)"
    return 0
  fi
  local n dir wait_s waited i
  n="$(heavy_slot_count)" || return 1
  dir="$(heavy_slot_dir)"
  mkdir -p "$dir" || return 1
  wait_s="${GYMCOACH_HEAVY_WAIT:-3600}"
  waited=0
  while :; do
    for i in $(seq 1 "$n"); do
      exec 8>>"$dir/slot-$i" || continue
      if flock --nonblock 8; then
        # Truncate through a second descriptor: fd 8 is append-only.
        printf 'pid=%s since=%s what=%s\n' "${BASHPID:-$$}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$label" >"$dir/slot-$i"
        HEAVY_SLOT="$i"
        export HEAVY_SLOT
        [ "$waited" -gt 0 ] && echo "  heavy-slot: got slot $i of $n after ${waited}s"
        return 0
      fi
      exec 8>&-
    done
    if [ "$waited" -eq 0 ]; then
      echo "  heavy-slot: all $n slots for heavy local work are taken; waiting (up to ${wait_s}s):"
      heavy_slot_holders "$n"
    fi
    if [ "$waited" -ge "$wait_s" ]; then
      echo "  heavy-slot: still no free slot after ${wait_s}s. Holders:" >&2
      heavy_slot_holders "$n" >&2
      echo "  A holder that no longer runs has already released its slot (flock dies with the process);" >&2
      echo "  check the pids above, or raise GYMCOACH_HEAVY_SLOTS for this machine." >&2
      return 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
}

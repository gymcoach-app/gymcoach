#!/usr/bin/env bash
#
# verify.sh — the GymCoach green-gate.
#
# This is the self-verification step every autonomous loop must pass before it
# claims a task is done (see docs/loops/). It mirrors the CI "quality" + "build"
# jobs so a loop can catch its own regressions locally, in seconds, without a
# database.
#
#   PASS  -> exit 0, the working tree is safe to commit / open a PR from.
#   FAIL  -> exit non-zero, the loop must fix the reported step before retrying.
#
# Tiers:
#   (default)  prisma generate + lint + typecheck + unit tests + production build
#   --full     also runs integration + E2E against the test Postgres on :5434,
#              which it starts (docker compose) and migrates itself when needed
#              (scripts/test-db.sh)
#
# The integration/E2E tiers need Docker + a database, so the default gate stays
# fast and hermetic; CI runs the full pyramid on every PR.

set -uo pipefail

# --- Make node 22 (nvm) available even in a non-interactive shell -------------
# The repo requires Node >= 20. The system node may be older, so prepend the
# nvm install if present. Adjust NVM_NODE if your version differs.
NVM_NODE="${NVM_NODE:-$HOME/.nvm/versions/node/v22.17.1/bin}"
if [ -d "$NVM_NODE" ]; then
  export PATH="$NVM_NODE:$PATH"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

FULL=0
[ "${1:-}" = "--full" ] && FULL=1

# Step bookkeeping: each step's outcome and duration go to the local run
# ledger when this script exits (roadmap milestone 1; scripts/verify-steps.sh,
# automation/ledger/record-verify.cjs). Fail-open, GYMCOACH_USAGE_LEDGER=off
# disables it. Steps carry a fixed name (first argument) and a label.
# shellcheck source=scripts/verify-steps.sh
. "$ROOT/scripts/verify-steps.sh"
verify_record_init "$ROOT" "$([ "$FULL" = "1" ] && echo full || echo default)"

fail() { verify_step_done failed; echo ""; echo "❌ GREEN-GATE FAILED at: $1"; exit 1; }
step() { verify_step "$1"; echo ""; echo "▶ $2"; }

echo "GymCoach green-gate — node $(node -v 2>/dev/null || echo '??'), npm $(npm -v 2>/dev/null || echo '??')"

# Machine-wide limit on concurrent heavy runs (roadmap milestone 2): at most
# GYMCOACH_HEAVY_SLOTS verify runs (default: a quarter of the cores) lint, test
# and build at once; the next one waits and says who holds the slots. The slot
# is held on fd 8 until this script exits; every child gets 8>&-, so an
# orphaned vitest or next build worker cannot keep a slot. Lock order: heavy slot first, then
# the --full test-infra lock (fd 9) below, so the two cannot deadlock.
# shellcheck source=scripts/heavy-slot.sh
. "$ROOT/scripts/heavy-slot.sh"
verify_step slot
acquire_heavy_slot "verify.sh in $(basename "$ROOT")$([ "$FULL" = "1" ] && echo ' --full')" \
  || fail "heavy-work slot (no free slot; see the holders above, or GYMCOACH_HEAVY_SLOTS)"

step prisma "prisma generate"
npx prisma generate >/dev/null 8>&- || fail "prisma generate"

step lint "lint"
npm run lint 8>&- || fail "lint"

step typecheck "typecheck"
npm run typecheck 8>&- || fail "typecheck"

step unit "unit tests"
npm run test 8>&- || fail "unit tests"

step script-tests "script self-tests"
bash scripts/test-db.test.sh 8>&- || fail "script self-tests"
bash scripts/heavy-slot.test.sh 8>&- || fail "script self-tests"
bash scripts/verify-steps.test.sh 8>&- || fail "script self-tests"
# Changelog fragments (changelog.d/, lesson L47): each one parses and names a
# known section. Recorded under the same step, so the ledger's step names stay.
npx tsx automation/changelog/assemble.ts --check 8>&- || fail "changelog fragments (see changelog.d/README.md)"

step build "production build"
# Build needs these set but never connects; placeholders are fine and are NOT
# exported globally (so real prisma/dev commands keep using your .env).
DATABASE_URL="postgresql://user:pass@localhost:5432/db" \
JWT_SECRET="ci-build-placeholder-secret-at-least-32-chars" \
  npm run build 8>&- || fail "production build"

if [ "$FULL" = "1" ]; then
  # Serialize the DB/port-sharing tiers across concurrent verify runs
  # (issue #283). Every checkout and worktree shares the one test Postgres on
  # :5434 and the one E2E server port :3031, so two overlapping --full runs
  # corrupt each other: a concurrent TRUNCATE resets the DB mid-run and the
  # port is contended (lesson L16). A machine-wide lock makes the second run
  # wait instead; it is released automatically when this process exits. CI
  # never goes through this script, so it is unaffected.
  verify_step infra-lock
  LOCK_FILE="${TMPDIR:-/tmp}/gymcoach-test-infra.lock"
  exec 9>"$LOCK_FILE" || fail "test-infra lock (cannot open $LOCK_FILE)"
  if ! flock --nonblock 9; then
    echo "  another verify run holds the shared test infra (:5434/:3031); waiting for the lock..."
    flock --wait 3600 9 || fail "test-infra lock (still held after 60m; a stale next-server or vitest from an interrupted run may hold it - check: fuser -v $LOCK_FILE)"
  fi
  step test-db "test database (start if down, apply migrations)"
  # Inside the lock: one run bootstraps, a waiting run finds it ready and the
  # migrate step is a no-op. Retires the manual `prisma migrate deploy` that a
  # fresh or restarted container used to need (lessons L4, L23).
  bash scripts/test-db.sh 8>&- 9>&- || fail "test database bootstrap"
  step integration "integration tests (Postgres on :5434)"
  # 8>&- 9>&- keep both lock fds out of the test children, so a zombie
  # next-server surviving an interrupted run (lesson L12) cannot hold a lock
  # forever.
  npm run test:integration 8>&- 9>&- || fail "integration tests"
  step e2e "E2E tests (Playwright)"
  npm run test:e2e 8>&- 9>&- || fail "E2E tests"
fi

verify_step_done passed
echo ""
echo "✅ GREEN-GATE PASSED — safe to commit and open a PR."

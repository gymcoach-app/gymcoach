#!/usr/bin/env bash
#
# test-db.sh - bootstrap the shared test Postgres (:5434) for the integration
# and E2E tiers: start it when it is down, wait until it accepts connections,
# and apply the Prisma migrations. Idempotent; verify.sh --full calls it under
# its machine-wide test-infra lock, so concurrent runs never race on it.
#
# Usage (from the repo root):
#   bash scripts/test-db.sh            # ensure up + migrated
#   bash scripts/test-db.sh --check-url <url>   # guard only (self-test hook)
#
# The guard refuses any URL that is not the local test database, so this
# script can never run migrations against a dev, demo or production database
# (lessons L4, L23: before this script, a fresh or restarted container failed
# the integration tier with `relation "Message" does not exist`).

set -uo pipefail

TEST_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test@localhost:5434/gymcoach_test"
COMPOSE_FILE="docker-compose.test.yml"
READY_TIMEOUT_SEC="${TEST_DB_READY_TIMEOUT_SEC:-60}"

# Returns 0 only for postgres(ql)://user:pass@(localhost|127.0.0.1):5434/gymcoach_test
# with an optional query string; prints the reason on refusal.
assert_test_db_url() {
  local url="$1"
  local re='^postgres(ql)?://[^@/]+@(localhost|127\.0\.0\.1):5434/gymcoach_test(\?.*)?$'
  if [[ "$url" =~ $re ]]; then
    return 0
  fi
  echo "refusing to migrate: '$url' is not the local test database (localhost:5434/gymcoach_test)" >&2
  return 1
}

if [ "${1:-}" = "--check-url" ]; then
  assert_test_db_url "${2:-}"
  exit $?
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

assert_test_db_url "$TEST_DATABASE_URL" || exit 1

port_open() { (exec 3<>/dev/tcp/127.0.0.1/5434) 2>/dev/null; }

docker_ok() { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; }

if docker_ok; then
  # `up -d` is a no-op on a running container and recreates a stopped one
  # (tmpfs data: a fresh, empty database, which the migrations below fill).
  echo "  starting the test Postgres if needed ($COMPOSE_FILE)..."
  docker compose -f "$COMPOSE_FILE" up -d >/dev/null || {
    echo "docker compose could not start the test database" >&2
    exit 1
  }
  deadline=$((SECONDS + READY_TIMEOUT_SEC))
  until docker compose -f "$COMPOSE_FILE" exec -T test-db \
    pg_isready -U gymcoach_test -d gymcoach_test >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "the test Postgres did not become ready within ${READY_TIMEOUT_SEC}s" >&2
      exit 1
    fi
    sleep 1
  done
elif port_open; then
  echo "  docker is unavailable, but something listens on :5434; using it as the test database"
else
  cat >&2 <<'EOF'
the test Postgres on :5434 is down and docker is unavailable.
Start Docker (on WSL with Docker Desktop: launch "Docker Desktop.exe" from
/mnt/c/Program Files/Docker/Docker/ and wait ~20 s), then re-run. Or run any
Postgres 16 on localhost:5434 with user/password/db gymcoach_test.
EOF
  exit 1
fi

echo "  applying migrations to the test database..."
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy || {
  echo "prisma migrate deploy failed on the test database" >&2
  exit 1
}

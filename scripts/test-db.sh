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
# The migration URL is the hard-coded test URL below, validated by a guard and
# set inline only for `prisma migrate deploy` (never exported), so this script
# never migrates a dev, demo or production database (lessons L4, L23: before
# this script, a fresh or restarted container failed the integration tier with
# `relation "Message" does not exist`).

set -uo pipefail

TEST_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test@localhost:5434/gymcoach_test"
COMPOSE_FILE="docker-compose.test.yml"
COMPOSE_PROJECT="gymcoach-test"
CONTAINER="gymcoach-test-db"
READY_TIMEOUT_SEC="${TEST_DB_READY_TIMEOUT_SEC:-60}"

# Returns 0 only for postgres(ql)://user:pass@(localhost|127.0.0.1):5434/gymcoach_test
# with at most a `?schema=<identifier>` query (no host= or other override);
# prints the reason on refusal.
assert_test_db_url() {
  local url="$1"
  local re='^postgres(ql)?://[A-Za-z0-9_]+:[A-Za-z0-9_]+@(localhost|127\.0\.0\.1):5434/gymcoach_test(\?schema=[A-Za-z0-9_]+)?$'
  if [[ "$url" != *$'\n'* && "$url" != *$'\r'* && "$url" =~ $re ]]; then
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

# Every docker/podman call is bounded, so a wedged daemon cannot stall the gate.
# On systems without GNU timeout (macOS), skip the timeout wrapper.
if command -v timeout >/dev/null 2>&1; then
  dk() { timeout 10 "$CONTAINER_CMD" "$@"; }
  docker_ok() { command -v docker >/dev/null 2>&1 && timeout 10 docker info >/dev/null 2>&1; }
  podman_ok() { command -v podman >/dev/null 2>&1 && timeout 10 podman info >/dev/null 2>&1; }
else
  dk() { "$CONTAINER_CMD" "$@"; }
  docker_ok() { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; }
  podman_ok() { command -v podman >/dev/null 2>&1 && podman info >/dev/null 2>&1; }
fi

# Detect whether to use docker or podman
if docker_ok; then
  CONTAINER_CMD="docker"
  COMPOSE_CMD="docker compose"
elif podman_ok; then
  CONTAINER_CMD="podman"
  COMPOSE_CMD="podman-compose"
  if ! command -v podman-compose >/dev/null 2>&1; then
    COMPOSE_CMD="podman compose"
  fi
else
  CONTAINER_CMD=""
  COMPOSE_CMD=""
fi

# Ready means accepting TCP connections: the image's temporary init server
# listens on the Unix socket only, so it never counts.
db_ready() {
  dk exec "$CONTAINER" pg_isready -h 127.0.0.1 -U gymcoach_test -d gymcoach_test >/dev/null 2>&1
}

if [ -n "$CONTAINER_CMD" ]; then
  echo "  starting the test Postgres if needed ($COMPOSE_FILE with $CONTAINER_CMD)..."
  existing_project="$(dk inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$CONTAINER" 2>/dev/null || true)"
  if [ -n "$existing_project" ] && [ "$existing_project" != "$COMPOSE_PROJECT" ]; then
    # Created by an older checkout under a directory-derived project name:
    # its data is tmpfs test data, so replace it rather than fail on the
    # fixed container name.
    echo "  replacing $CONTAINER from compose project '$existing_project'"
    dk rm -f "$CONTAINER" >/dev/null || {
      echo "could not remove the stale $CONTAINER container" >&2
      exit 1
    }
  fi
  # `up -d` is a no-op on a running container and recreates a stopped one
  # (tmpfs data: a fresh, empty database, which the migrations below fill).
  if command -v timeout >/dev/null 2>&1; then
    timeout 60 $COMPOSE_CMD -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" up -d >/dev/null || {
      echo "$COMPOSE_CMD could not start the test database" >&2
      exit 1
    }
  else
    $COMPOSE_CMD -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" up -d >/dev/null || {
      echo "$COMPOSE_CMD could not start the test database" >&2
      exit 1
    }
  fi
  deadline=$((SECONDS + READY_TIMEOUT_SEC))
  until db_ready; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "the test Postgres did not become ready within ${READY_TIMEOUT_SEC}s" >&2
      exit 1
    fi
    sleep 1
  done
elif port_open; then
  echo "  docker/podman unavailable, but something listens on :5434; using it as the test database"
else
  cat >&2 <<'EOF'
the test Postgres on :5434 is down and neither docker nor podman is available.
Start Docker or Podman (on WSL with Docker Desktop: launch "Docker Desktop.exe"
from /mnt/c/Program Files/Docker/Docker/ and wait ~20 s; on macOS with Podman:
run "podman-compose -f docker-compose.test.yml up -d"), then re-run. Or run any
Postgres 16 on localhost:5434 with user/password/db gymcoach_test.
EOF
  exit 1
fi

echo "  applying migrations to the test database..."
# One retry: a database that has just come up can still drop the first
# connection.
if ! DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy; then
  echo "  migrate deploy failed; retrying once in 3 s..." >&2
  sleep 3
  DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy || {
    echo "prisma migrate deploy failed on the test database" >&2
    exit 1
  }
fi

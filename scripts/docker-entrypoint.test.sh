#!/usr/bin/env bash
#
# Self-test for scripts/docker-entrypoint.sh. Runs hermetically without Docker
# or a database; included in the default verify.sh gate.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMPDIR="$(mktemp -d)"
export TMPDIR
trap 'rm -rf "$TMPDIR"' EXIT

failures=0
pass=0

expect() {
  local name="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    echo "  FAIL $name: got '$got', want '$want'"
    failures=$((failures + 1))
  fi
}

# Create mock node binary in a private bin directory
MOCK_BIN="$TMPDIR/bin"
mkdir -p "$MOCK_BIN"
MOCK_LOG="$TMPDIR/node.log"

cat <<'EOF' > "$MOCK_BIN/node"
#!/bin/sh
echo "$@" >> "$TMPDIR/node.log"
if [ -f "$TMPDIR/mock_node_fail" ]; then
  exit 1
fi
exit 0
EOF
chmod +x "$MOCK_BIN/node"

export PATH="$MOCK_BIN:$PATH"

# 1. No DATABASE_URL: skips migration, executes command directly
rm -f "$MOCK_LOG"
out=$(DATABASE_URL="" "$HERE/docker-entrypoint.sh" echo "hello-world")
expect "no db url: command runs" "$out" "hello-world"
expect "no db url: node not called" "$(test -f "$MOCK_LOG" && cat "$MOCK_LOG" || echo "none")" "none"

# 2. SKIP_DB_MIGRATE=true: skips migration even if DATABASE_URL is set
rm -f "$MOCK_LOG"
out=$(DATABASE_URL="postgresql://user:pass@localhost:5432/db" SKIP_DB_MIGRATE="true" "$HERE/docker-entrypoint.sh" echo "hello-world")
expect "skip flag: command runs" "$out" "hello-world"
expect "skip flag: node not called" "$(test -f "$MOCK_LOG" && cat "$MOCK_LOG" || echo "none")" "none"

# 3. DATABASE_URL set: runs prisma migration then target command
rm -f "$MOCK_LOG"
out=$(DATABASE_URL="postgresql://user:pass@localhost:5432/db" SKIP_DB_MIGRATE="" "$HERE/docker-entrypoint.sh" echo "server-started")
expect "db url set: migration logged" "$(echo "$out" | grep -c "Applying database migrations...")" "1"
expect "db url set: server started" "$(echo "$out" | grep -c "server-started")" "1"
expect "db url set: correct prisma command" "$(cat "$MOCK_LOG")" "node_modules/prisma/build/index.js migrate deploy"

# 4. Migration fails: aborts and never executes target command
touch "$TMPDIR/mock_node_fail"
rm -f "$MOCK_LOG"
set +e
out=$(DATABASE_URL="postgresql://user:pass@localhost:5432/db" SKIP_DB_MIGRATE="" "$HERE/docker-entrypoint.sh" echo "must-not-run" 2>&1)
code=$?
set -e
rm -f "$TMPDIR/mock_node_fail"

expect "migration failure: exit code 1" "$code" "1"
expect "migration failure: command aborted" "$(echo "$out" | grep -c "must-not-run")" "0"

# 5. Exit code propagation from target command
set +e
DATABASE_URL="" "$HERE/docker-entrypoint.sh" sh -c "exit 42"
code=$?
set -e
expect "exit code propagation" "$code" "42"

if [ "$failures" -gt 0 ]; then
  echo "docker-entrypoint self-test: $failures failure(s)"
  exit 1
fi
echo "docker-entrypoint self-test: $pass cases passed"

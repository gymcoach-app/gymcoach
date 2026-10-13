#!/usr/bin/env bash
#
# Self-test of the test-database guard in scripts/test-db.sh: the migration
# step must accept only the local test database. Needs no database; the
# default verify.sh gate runs it.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

failures=0
expect() {
  local want="$1" url="$2"
  if bash scripts/test-db.sh --check-url "$url" 2>/dev/null; then got=accept; else got=refuse; fi
  if [ "$got" != "$want" ]; then
    echo "  FAIL: expected $want for '$url', got $got"
    failures=$((failures + 1))
  fi
}

expect accept 'postgresql://gymcoach_test:gymcoach_test@localhost:5434/gymcoach_test'
expect accept 'postgres://gymcoach_test:gymcoach_test@127.0.0.1:5434/gymcoach_test'
expect accept 'postgresql://gymcoach_test:gymcoach_test@localhost:5434/gymcoach_test?schema=public'
expect refuse 'postgresql://gymcoach:gymcoach@localhost:5433/gymcoach'
expect refuse 'postgresql://gymcoach_test:gymcoach_test@localhost:5432/gymcoach_test'
expect refuse 'postgresql://gymcoach_test:gymcoach_test@db.example.com:5434/gymcoach_test'
expect refuse 'postgresql://gymcoach_test:gymcoach_test@localhost:5434/gymcoach'
expect refuse 'postgresql://gymcoach_test:gymcoach_test@localhost:5434/gymcoach_test_other'
expect refuse 'postgresql://u:p@localhost:5434/gymcoach_test@evil.example.com:5432/prod'
expect refuse ''

if [ "$failures" -gt 0 ]; then
  echo "test-db guard self-test: $failures failure(s)"
  exit 1
fi
echo "test-db guard self-test: 10 cases passed"

#!/usr/bin/env bash
# Runs all migrations + scenario tests against a throwaway local Postgres 16.
# Usage: scripts/test-db.sh   (needs postgresql-16 binaries; run as root or a user that can create a data dir)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DIR="$(mktemp -d /var/tmp/morekisi-pg.XXXX)"
PORT="${PG_PORT:-5439}"
RUN=""; if [ "$(id -u)" = 0 ]; then id -u postgres >/dev/null 2>&1 || useradd -m postgres; chown postgres "$DIR"; RUN="su postgres -c"; fi
sh_run() { if [ -n "$RUN" ]; then $RUN "$1"; else bash -c "$1"; fi; }
cleanup() { sh_run "$BIN/pg_ctl -D $DIR/data stop -m fast" >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
sh_run "$BIN/initdb -D $DIR/data -A trust -U postgres" >/dev/null
sh_run "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log start" >/dev/null
PSQL="psql -h $DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -X"
$PSQL -c "create database morekisi_test"
$PSQL -d morekisi_test -f "$ROOT/supabase/tests/supabase_stubs.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do echo "migrate: $(basename "$f")"; $PSQL -d morekisi_test -f "$f"; done
for f in "$ROOT"/supabase/tests/test_*.sql; do echo "test:    $(basename "$f")"; $PSQL -d morekisi_test -f "$f"; done
echo "ALL DATABASE TESTS PASSED"

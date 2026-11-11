#!/bin/sh
# Applies supabase/migrations/*.sql in order (each once, in its own transaction),
# then loads supabase/seed.sql the first time. Safe to run again.
set -eu
export PGPASSWORD="$POSTGRES_PASSWORD"
PSQL="psql -h db -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X"

echo "migrate: waiting for the database and the auth service..."
until $PSQL -tAc "select to_regclass('auth.users') is not null and exists (select 1 from pg_extension where extname = 'supabase_vault')" 2>/dev/null | grep -q t; do
  sleep 2
done

$PSQL -c "create schema if not exists supabase_migrations;
          create table if not exists supabase_migrations.schema_migrations (version text primary key, applied_at timestamptz default now());"

for f in /migrations/*.sql; do
  v=$(basename "$f" .sql)
  if [ "$($PSQL -tAc "select 1 from supabase_migrations.schema_migrations where version = '$v'")" = "1" ]; then
    continue
  fi
  echo "migrate: applying $v"
  $PSQL -1 -f "$f" -c "insert into supabase_migrations.schema_migrations (version) values ('$v')"
done

if [ "$($PSQL -tAc "select 1 from supabase_migrations.schema_migrations where version = 'seed'")" != "1" ]; then
  echo "migrate: loading demo data (supabase/seed.sql)"
  $PSQL -1 -f /seed.sql -c "insert into supabase_migrations.schema_migrations (version) values ('seed')"
fi

# PostgREST caches the schema; tell it to reload after changes.
$PSQL -c "notify pgrst, 'reload schema'"
echo "migrate: done"

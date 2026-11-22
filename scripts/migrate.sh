#!/usr/bin/env bash
# Apply pending SQL migrations in order. Tracked in app.schema_migrations.
# Usage: scripts/migrate.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-$REPO_ROOT/../tools/pg17/bin}"
PGPORT="${PGPORT:-5433}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-pgadmin}"   # migrations run as the database owner (DDL); runtime roles never migrate
PGPASSWORD="${PGPASSWORD:-}"
export PATH="$PG_BIN:$PATH"
export PGHOST PGPORT PGUSER PGPASSWORD

DB="${DB:-bughunt}"
MIGDIR="$REPO_ROOT/backend/migrations"

run_sql() { psql -w -d "$DB" -v ON_ERROR_STOP=1 -q "$@"; }

run_sql -c "CREATE TABLE IF NOT EXISTS app.schema_migrations (filename TEXT PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())" >/dev/null

shopt -s nullglob
applied=0
for f in "$MIGDIR"/*.sql; do
  name="$(basename "$f")"
  already=$(psql -w -d "$DB" -tAc "SELECT 1 FROM app.schema_migrations WHERE filename='$name'")
  if [ "$already" = "1" ]; then
    continue
  fi
  echo "applying $name"
  psql -w -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
  psql -w -d "$DB" -v ON_ERROR_STOP=1 -q -c "INSERT INTO app.schema_migrations (filename) VALUES ('$name')"
  applied=$((applied+1))
done
echo "migrations applied: $applied"

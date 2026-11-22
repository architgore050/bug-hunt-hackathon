#!/usr/bin/env bash
# Bootstrap the local development database for the Bug Hunt CTF platform (D0 profile).
#
# Creates the `bughunt` database with three schemas and least-privilege roles:
#   app   - participant/admin domain data (role: app_api)
#   gt    - ground truth (answer key, flags, hidden tests; role: gt_admin only)
#   audit - append-only audit entries (insert-only for app roles)
#
# The ground-truth isolation test (tests/test_gt_isolation.py) connects as app_api
# and asserts that reading gt fails with a real permission error.
#
# Usage: scripts/dev_db.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-$REPO_ROOT/../tools/pg17/bin}"
PGDATA="${PGDATA:-$REPO_ROOT/../tools/pgdata}"
PGPORT="${PGPORT:-5433}"
PGUSER="pgadmin"

export PATH="$PG_BIN:$PATH"

# Start PostgreSQL if it is not already running.
if ! pg_isready -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1; then
  mkdir -p "$PGDATA"
  # A recycled environment can leave a stale pid file behind; drop it only
  # when the recorded process is genuinely gone.
  if [ -f "$PGDATA/postmaster.pid" ]; then
    pid=$(head -1 "$PGDATA/postmaster.pid")
    if ! ps -p "$pid" -o comm= 2>/dev/null | grep -q postgres; then
      rm -f "$PGDATA/postmaster.pid"
    fi
  fi
  # The data directory must be owner-only or the server refuses to start.
  chmod 700 "$PGDATA"
  # Empty runtime directories do not survive some environment restores.
  for d in pg_notify pg_tblspc pg_replslot pg_twophase pg_stat pg_stat_tmp \
           pg_commit_ts pg_dynshmem pg_snapshots pg_subtrans pg_xact \
           pg_wal/archive_status pg_wal/summaries \
           pg_logical/snapshots pg_logical/mappings \
           pg_multixact/members pg_multixact/offsets; do
    mkdir -p "$PGDATA/$d"
  done
  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    initdb -D "$PGDATA" -U "$PGUSER" --auth=trust -E UTF8 >/dev/null
  fi
  pg_ctl -D "$PGDATA" -l "$REPO_ROOT/../tools/pg.log" \
    -o "-p $PGPORT -k /tmp -c listen_addresses=127.0.0.1" start
  sleep 1
fi

# Fail fast if the port is served by a different PostgreSQL cluster (a system
# service, a container, another checkout). psql -w never prompts for a
# password: our cluster uses trust auth, so pgadmin needs NO password at all.
PGDATA="$(cd "$PGDATA" && pwd)"   # canonical form: SHOW data_directory never contains ".."
SERVED_DIR="$(psql -w -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" -d postgres -tAc "SHOW data_directory" 2>/dev/null || true)"
SERVED_DIR="${SERVED_DIR%/}"
if [ "$SERVED_DIR" != "${PGDATA%/}" ]; then
  echo "ERROR: 127.0.0.1:$PGPORT is served by another PostgreSQL cluster (data dir: ${SERVED_DIR:-<unreachable or auth required>})." >&2
  echo "       This platform's dev cluster uses trust auth: pgadmin has no password." >&2
  echo "       Pick a free port instead, e.g.: PGPORT=5434 DB=\${DB:-bughunt} $0" >&2
  exit 1
fi

TARGET_DB="${DB:-bughunt}"
PSQL="psql -w -h 127.0.0.1 -p $PGPORT -U $PGUSER -d postgres -v ON_ERROR_STOP=1"

if ! $PSQL -tAc "SELECT 1 FROM pg_database WHERE datname='$TARGET_DB'" | grep -q 1; then
  $PSQL -c "CREATE DATABASE $TARGET_DB"
fi

$PSQL -d "$TARGET_DB" <<'SQL'
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS gt;
CREATE SCHEMA IF NOT EXISTS audit;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app_api') THEN
    CREATE ROLE app_api LOGIN PASSWORD 'app_api_dev';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='gt_admin') THEN
    CREATE ROLE gt_admin LOGIN PASSWORD 'gt_admin_dev';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='scheduler') THEN
    CREATE ROLE scheduler LOGIN PASSWORD 'scheduler_dev';
  END IF;
END $$;

GRANT USAGE ON SCHEMA app TO app_api, gt_admin, scheduler;
GRANT CREATE ON SCHEMA app TO gt_admin;
ALTER ROLE app_api SET search_path = app;
ALTER ROLE gt_admin SET search_path = app, gt;
ALTER ROLE scheduler SET search_path = app;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app TO app_api, gt_admin, scheduler;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app TO app_api, gt_admin, scheduler;
GRANT USAGE ON SCHEMA gt TO gt_admin;
GRANT CREATE ON SCHEMA gt TO gt_admin;
GRANT SELECT ON ALL TABLES IN SCHEMA gt TO gt_admin;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA gt TO gt_admin;

GRANT USAGE ON SCHEMA audit TO app_api, gt_admin;
GRANT INSERT, SELECT ON ALL TABLES IN SCHEMA audit TO app_api, gt_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA audit TO app_api, gt_admin;

ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ALL ON TABLES TO app_api, gt_admin, scheduler;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ALL ON SEQUENCES TO app_api, gt_admin, scheduler;
ALTER DEFAULT PRIVILEGES IN SCHEMA gt GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gt_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit GRANT INSERT, SELECT ON TABLES TO app_api, gt_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit GRANT USAGE, SELECT ON SEQUENCES TO app_api, gt_admin;
SQL

echo "Database $TARGET_DB ready on 127.0.0.1:$PGPORT (roles: app_api, gt_admin, scheduler)"

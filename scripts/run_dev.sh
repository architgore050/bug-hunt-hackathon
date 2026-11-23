#!/usr/bin/env bash
# Start the full local development stack (D0 profile):
#   1. PostgreSQL (auto-detected binaries) + roles/schemas
#   2. Migrations
#   3. Seed (dev-only demo data; pass --no-seed to skip)
#   4. API server (port 8100) and the durable job worker
#
# Usage: scripts/run_dev.sh [--no-seed] [--reset-seed]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Prefer the backend venv when it exists (backend/.venv), else python3.
if [ -z "${PYTHON:-}" ]; then
  if [ -x "$REPO_ROOT/backend/.venv/bin/python" ]; then
    PYTHON="$REPO_ROOT/backend/.venv/bin/python"
  else
    PYTHON="python3"
  fi
fi

bash "$REPO_ROOT/scripts/dev_db.sh"
DB=bughunt PGUSER="${PGUSER:-pgadmin}" PGPASSWORD="${PGPASSWORD:-}" "$REPO_ROOT/scripts/migrate.sh"

SEED_ARGS=""
for a in "$@"; do
  [ "$a" = "--no-seed" ] && SEED_ARGS="skip"
  [ "$a" = "--reset-seed" ] && SEED_ARGS="--reset"
done
# Strip PYTHONPATH: foreign entries (e.g. a sourced ROS install) rank ahead of
# venv site-packages and can shadow the pinned dependencies.
if [ "${SEED_ARGS:-}" != "skip" ]; then
  (cd "$REPO_ROOT/backend" && env -u PYTHONPATH "$PYTHON" seed.py $SEED_ARGS)
fi

mkdir -p "$REPO_ROOT/logs"
(cd "$REPO_ROOT/backend" && nohup env -u PYTHONPATH "$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port 8100 > "$REPO_ROOT/logs/api.log" 2>&1 &)
(cd "$REPO_ROOT/backend" && nohup env -u PYTHONPATH "$PYTHON" worker.py > "$REPO_ROOT/logs/worker.log" 2>&1 &)

sleep 2
curl -s http://127.0.0.1:8100/health | head -c 400; echo
echo "API: http://127.0.0.1:8100  (logs: logs/api.log, logs/worker.log)"

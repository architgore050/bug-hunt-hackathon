#!/usr/bin/env bash
# Start the full local development stack (D0 profile):
#   1. PostgreSQL (portable binaries) + roles/schemas
#   2. Migrations
#   3. Seed (dev-only demo data; pass --no-seed to skip)
#   4. API server (port 8100) and the durable job worker
#
# Usage: scripts/run_dev.sh [--no-seed] [--reset-seed]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-/home/z/my-project/tools/venv/bin/python}"

bash "$REPO_ROOT/scripts/dev_db.sh"
DB=bughunt PGUSER="${PGUSER:-pgadmin}" PGPASSWORD="${PGPASSWORD:-}" "$REPO_ROOT/scripts/migrate.sh"

SEED_ARGS=""
for a in "$@"; do
  [ "$a" = "--no-seed" ] && SEED_ARGS="skip"
  [ "$a" = "--reset-seed" ] && SEED_ARGS="--reset"
done
if [ "${SEED_ARGS:-}" != "skip" ]; then
  (cd "$REPO_ROOT/backend" && "$PYTHON" seed.py $SEED_ARGS)
fi

mkdir -p "$REPO_ROOT/logs"
(cd "$REPO_ROOT/backend" && nohup "$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port 8100 > "$REPO_ROOT/logs/api.log" 2>&1 &)
(cd "$REPO_ROOT/backend" && nohup "$PYTHON" worker.py > "$REPO_ROOT/logs/worker.log" 2>&1 &)

sleep 2
curl -s http://127.0.0.1:8100/health | head -c 400; echo
echo "API: http://127.0.0.1:8100  (logs: logs/api.log, logs/worker.log)"

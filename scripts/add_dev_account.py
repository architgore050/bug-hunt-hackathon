#!/usr/bin/env python3
"""Add a single dev account to the local bughunt database (dev-only helper).

Creates a user with a properly hashed password (argon2, same as the seed) and,
for participants, joins them to a team: an existing team by name or join code,
or a brand new team on the seeded event. Refuses to run unless
ENVIRONMENT=development. Never use against anything resembling production.

Usage (from the repo root, after backend seed):
  env -u PYTHONPATH backend/.venv/bin/python scripts/add_dev_account.py \
      --email explorer1@example.com --name "Explorer One"

Options:
  --role participant|organizer|reviewer|admin   (default: participant)
  --team "Team Lambda"      join an existing team by name or join code
  --new-team "Team Nova"    create a new team on the first event and join it
  --password "..."          default: the seed's dev password
"""
from __future__ import annotations

import argparse
import secrets
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from sqlalchemy import text  # noqa: E402

from app import security  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import app_session, uuid7  # noqa: E402

DEV_PASSWORD = "Dev-only!Passw0rd!"


def main() -> None:
    if settings.environment != "development":
        sys.exit("refusing: this helper is dev-only (requires ENVIRONMENT=development)")

    ap = argparse.ArgumentParser(description="Add a dev account to the local bughunt DB.")
    ap.add_argument("--email", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--role", default="participant", choices=["participant", "organizer", "reviewer", "admin"])
    ap.add_argument("--team", help="existing team name or join code to join")
    ap.add_argument("--new-team", help="create a new team with this name and join it")
    ap.add_argument("--password", default=DEV_PASSWORD)
    args = ap.parse_args()

    if args.team and args.new_team:
        sys.exit("use either --team or --new-team, not both")

    with app_session() as s:
        tenant_id = s.execute(text("SELECT id FROM app.tenants ORDER BY created_at LIMIT 1")).scalar_one_or_none()
        if tenant_id is None:
            sys.exit("no tenant found; run the backend seed first (backend/.venv/bin/python backend/seed.py --reset)")

        dup = s.execute(text("SELECT id FROM app.users WHERE email = :e"), {"e": args.email}).scalar_one_or_none()
        if dup is not None:
            sys.exit(f"user {args.email} already exists; pick another email")

        uid = str(uuid7())
        s.execute(
            text("INSERT INTO app.users (id, tenant_id, email, name, role, password_hash, status) "
                 "VALUES (CAST(:i AS uuid), CAST(:t AS uuid), :e, :n, :r, :p, 'active')"),
            {"i": uid, "t": str(tenant_id), "e": args.email, "n": args.name, "r": args.role,
             "p": security.hash_password(args.password)},
        )

        team_note = ""
        if args.role == "participant":
            team_id = None
            if args.team:
                team_id = s.execute(
                    text("SELECT id FROM app.teams WHERE name = :n OR join_code = :c LIMIT 1"),
                    {"n": args.team, "c": args.team},
                ).scalar_one_or_none()
                if team_id is None:
                    sys.exit(f"no team matching {args.team!r}; check app.teams or use --new-team")
            elif args.new_team:
                event_id = s.execute(text("SELECT id FROM app.events ORDER BY created_at LIMIT 1")).scalar_one_or_none()
                if event_id is None:
                    sys.exit("no event found; run the backend seed first")
                team_id = str(uuid7())
                join_code = secrets.token_hex(4).upper()
                s.execute(
                    text("INSERT INTO app.teams (id, event_id, name, join_code) "
                         "VALUES (CAST(:i AS uuid), CAST(:e AS uuid), :n, :jc)"),
                    {"i": team_id, "e": str(event_id), "n": args.new_team, "jc": join_code},
                )
                team_note = f" (new team join code: {join_code})"
            else:
                team_note = " (no team: the account has no assignments until it joins one)"
            if team_id is not None:
                s.execute(
                    text("INSERT INTO app.team_members (id, team_id, user_id) "
                         "VALUES (CAST(:i AS uuid), CAST(:t AS uuid), CAST(:u AS uuid))"),
                    {"i": str(uuid7()), "t": str(team_id), "u": uid},
                )
                name = s.execute(text("SELECT name FROM app.teams WHERE id = CAST(:i AS uuid)"), {"i": str(team_id)}).scalar_one()
                team_note = f" (joined team: {name})"

    print(f"account ready: {args.email} / {args.password}  role={args.role}{team_note}")
    print("sign in at the frontend (Vite on http://localhost:5173) or POST /v1/auth/login on :8100")


if __name__ == "__main__":
    main()

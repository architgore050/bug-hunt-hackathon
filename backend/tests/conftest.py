"""Pytest fixtures: isolated bughunt_test database, seeded once per session.

The API app is imported AFTER the test database URLs are set, so all engines
and sessions point at the isolated test DB. Tests talk to the app through
Starlette's TestClient (no network sockets needed).
"""

from __future__ import annotations

import os
import pathlib
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
BACKEND = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND))

TEST_DB = "bughunt_test"
# Port follows PGPORT (dev cluster default 5434; the CI service container
# exports PGPORT=5433). Keep scripts/dev_db.sh and backend/.env in sync.
PGPORT = os.environ.get("PGPORT", "5434")
APP_URL = f"postgresql+psycopg://app_api:app_api_dev@127.0.0.1:{PGPORT}/{TEST_DB}"
GT_URL = f"postgresql+psycopg://gt_admin:gt_admin_dev@127.0.0.1:{PGPORT}/{TEST_DB}"

os.environ["DATABASE_URL_APP"] = APP_URL
os.environ["DATABASE_URL_GT"] = GT_URL
os.environ["ENVIRONMENT"] = "development"
os.environ["JWT_SECRET"] = "test-secret-not-for-production-0123456789abcdef32bytes"


@pytest.fixture(scope="session")
def _test_db():
    """Create and migrate the test database once per session."""
    env = {**os.environ, "DB": TEST_DB, "PGUSER": "pgadmin", "PGPASSWORD": ""}
    subprocess.run(["bash", str(REPO_ROOT / "scripts" / "dev_db.sh")], check=True, env=env, capture_output=True)
    subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "migrate.sh")],
        check=True,
        env={**env, "DB": TEST_DB},
        capture_output=True,
    )
    return TEST_DB


@pytest.fixture()
def seeded_db(_test_db):
    """Reset seed data before every test so tests are order-independent."""
    from seed import main as seed_main

    seed_main(reset=True)
    return TEST_DB


@pytest.fixture()
def _clear_rate_limits():
    """The in-process token bucket must not leak between tests."""
    from app import deps

    deps._bucket.clear()
    yield
    deps._bucket.clear()


@pytest.fixture()
def client(seeded_db, _clear_rate_limits):
    from app.main import app
    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        yield c


STAFF_PW = "Dev-only!Passw0rd!"


def login(client, email: str, password: str = STAFF_PW) -> dict:
    r = client.post("/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def participant_client(client, email: str) -> TestClient:
    """A participant client with rules accepted, on a live event and active stage.

    Idempotent: calling it twice within one test continues from current state
    instead of replaying forbidden transitions.
    """
    org = client.post("/v1/auth/login", json={"email": "organizer@example.com", "password": STAFF_PW}).json()
    oc = TestClient(client.app)
    oc.headers.update({"Authorization": f"Bearer {org['access_token']}"})
    event_id = oc.get("/v1/admin/events").json()["events"][0]["id"]
    event_status = oc.get("/v1/admin/events").json()["events"][0]["status"]
    if event_status == "configured":
        oc.post(f"/v1/admin/events/{event_id}/status", json={"status": "ready"}).raise_for_status()
        for item in oc.get(f"/v1/admin/events/{event_id}/readiness").json()["items"]:
            oc.post(f"/v1/admin/events/{event_id}/readiness/{item['key']}", json={"state": "checked"})
        oc.post(f"/v1/admin/events/{event_id}/status", json={"status": "live"}).raise_for_status()
    stage = oc.get(f"/v1/admin/events/{event_id}/live").json()["stages"][0]
    stage_id = stage["id"]
    # advance the stage to active from wherever it currently is
    for action in ("seal", "arm", "start"):
        if stage["status"] in ("released", "final", "ended", "evaluating"):
            break  # late-stage tests must not rewind state
        r = oc.post(f"/v1/admin/stages/{stage_id}/control", json={"action": action, "reason": "test setup"})
        if r.status_code == 200:
            stage["status"] = {"seal": "sealed", "arm": "armed", "start": "active"}[action]

    token = login(client, email)["access_token"]
    pc = TestClient(client.app)
    pc.headers.update({"Authorization": f"Bearer {token}"})
    me = pc.get("/v1/me").json()
    if not me.get("rules_accepted"):
        pc.post("/v1/me/acceptances", json={}).raise_for_status()
    pc.headers.update({"X-Stage-Id": stage_id})
    pc._stage_id = stage_id  # type: ignore[attr-defined]
    return pc


def worker_drain(n: int = 30) -> int:
    """Run pending jobs synchronously (no worker process needed in tests)."""
    from app import evaluator  # noqa: F401  (register handlers)
    from app.jobs import drain

    return drain(max_jobs=n)

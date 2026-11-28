"""Database engines and session helpers.

Two SQLAlchemy engines model the trust boundary from the architecture (§9.2):

- ``app_engine``  connects as the ``app_api`` role. It can read and write the
  ``app`` schema and insert audit rows. It has NO permission on ``gt``.
- ``gt_engine``   connects as the ``gt_admin`` role. Only evaluator/ground-truth
  code paths use it.

REM-002 WARNING: ``gt_engine``/``gt_session`` are ONLY for evaluator and
ground-truth paths (job handlers reading gt.gt_*). The ``app_api`` role must
NEVER read the gt schema — tests/test_gt_isolation.py connects with the real
app_api role and asserts that reading gt raises a permission error. Do NOT
import ``gt_session`` from participant-facing routers; the full fix (separate
participant/admin services without the GT credential) is tracked in REM-002.
"""

from __future__ import annotations

import os
import time
import uuid
from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from .config import settings


def _make_engine(url: str) -> Engine:
    engine = create_engine(
        url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_pre_ping=True,
        connect_args={"connect_timeout": 5, "application_name": "bughunt-api"},
    )
    return engine


app_engine: Engine = _make_engine(settings.database_url_app)
# REM-002: gt credential lives here ONLY for evaluator/GT code paths; app_api
# (app_engine above) must never read gt (asserted by tests/test_gt_isolation.py).
gt_engine: Engine = _make_engine(settings.database_url_gt)

AppSession = sessionmaker(bind=app_engine, expire_on_commit=False, autoflush=False)
GtSession = sessionmaker(bind=gt_engine, expire_on_commit=False, autoflush=False)


@contextmanager
def app_session() -> Session:
    s = AppSession()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


@contextmanager
def gt_session() -> Session:
    s = GtSession()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def db_now(session: Session):
    """Database wall-clock time (the only clock used for decisions, TIM-01/02)."""
    return session.execute(text("SELECT clock_timestamp()")).scalar_one()


# --- identifiers -------------------------------------------------------------


def uuid7() -> uuid.UUID:
    """UUIDv7: time-sortable, opaque. Sequential IDs are never an access control (spec section 0)."""
    # 48-bit unix millisecond timestamp
    ts = int(time.time() * 1000) & ((1 << 48) - 1)
    rand_a = int.from_bytes(os.urandom(2), "big") & 0x0FFF  # 12 bits
    rand_b = int.from_bytes(os.urandom(8), "big") & ((1 << 62) - 1)  # 62 bits
    value = (ts << 80) | (0x7 << 76) | (rand_a << 64) | (0b10 << 62) | rand_b
    return uuid.UUID(int=value)


def short_code(n: int = 4) -> str:
    """Human-friendly receipt fragment from secure randomness."""
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    return "".join(alphabet[b % len(alphabet)] for b in os.urandom(n))


def health_probe() -> dict:
    """Real readiness signals, not fabricated green lights (master prompt §2)."""
    out = {"database_app": "down", "database_gt": "down", "clock": None}
    try:
        with app_engine.connect() as c:
            out["database_app"] = "up"
            out["clock"] = c.execute(text("SELECT clock_timestamp()")).scalar_one().isoformat()
    except SQLAlchemyError as e:  # pragma: no cover
        out["database_app_error"] = str(e.__class__.__name__)
    try:
        with gt_engine.connect() as c:
            c.execute(text("SELECT 1"))
            out["database_gt"] = "up"
    except SQLAlchemyError as e:  # pragma: no cover
        out["database_gt_error"] = str(e.__class__.__name__)
    # REM-056: pool stats are cheap already-maintained counters; expose them so
    # operators can see pool pressure without a metrics endpoint.
    for name, engine in (("pool_app", app_engine), ("pool_gt", gt_engine)):
        try:
            out[name] = engine.pool.status()
        except Exception as e:  # pragma: no cover  # noqa: BLE001
            out[name] = f"unavailable ({e.__class__.__name__})"
    return out


def requeue_owned_leases(session: Session, worker_id: str) -> int:
    """REM-070: requeue jobs still leased by this worker back to the queue.

    worker.py calls this on graceful shutdown (drain) so leases this worker
    claimed but could not finish are released immediately instead of idling
    until lease expiry; retries are safe because job handlers are idempotent
    (REM-053). Column names follow the repo schema ('queued', lease_until).
    Selectivity requires a lease_owner column recorded by claim_next (jobs.py);
    until that migration lands this matches nothing rather than misfiring.
    """
    res = session.execute(
        text("UPDATE app.jobs SET status='queued', lease_until=NULL WHERE lease_owner=:w AND status='running'"),
        {"w": worker_id},
    )
    return res.rowcount or 0

"""Durable job worker (D1: one trusted worker process).

Claims jobs with FOR UPDATE SKIP LOCKED + leases, runs handlers outside the
claim transaction, retries with backoff, dead-letters after max attempts.
Run with:  python worker.py  (see scripts/run_dev.sh)

REM-021: the singleton auto-submit deadline scan is guarded by a PostgreSQL
session advisory lock, so with N workers running only the elected leader runs
the scan each cycle; job claiming itself stays parallel.
REM-070: SIGTERM/SIGINT start a drain — no new claims, in-flight work finishes
or is reported, one lease requeue pass, then a clean exit.
"""

from __future__ import annotations

import logging
import signal
import threading
import time
from types import FrameType

from app import (
    auto_submit,
    evaluator,  # noqa: F401  (registers all handlers)
    evaluator_level,  # noqa: F401  (registers the level evaluation handler)
    jobs,
)
from app.db import app_session
from app.jobs import requeue_expired_leases
from sqlalchemy import text
from sqlalchemy.orm import Session

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s worker %(message)s")
log = logging.getLogger("worker")

POLL_INTERVAL_S = 2.0
AUTO_SUBMIT_SCAN_INTERVAL_S = 10.0

# REM-021: fixed key for pg_try_advisory_lock; every worker uses the same
# constant so exactly one of them holds the scheduler lock at any moment.
AUTO_SUBMIT_LEADER_LOCK_KEY = 425542913

# REM-070: set by the SIGTERM/SIGINT handlers; the loop exits when it is set.
# The lock is reentrant because the signal handler (main thread) may log the
# in-flight count while the main thread is inside the guarded section.
_shutdown = threading.Event()
_in_flight_lock = threading.RLock()
_in_flight = 0


def _request_shutdown(signum: int, _frame: FrameType | None) -> None:
    """Mark the worker draining: stop claiming, let in-flight work finish."""
    log.info("signal %d received: draining before exit (in-flight: %d)", signum, _in_flight_count())
    _shutdown.set()


def _enter_flight() -> None:
    global _in_flight
    with _in_flight_lock:
        _in_flight += 1


def _leave_flight() -> None:
    global _in_flight
    with _in_flight_lock:
        _in_flight -= 1


def _in_flight_count() -> int:
    with _in_flight_lock:
        return _in_flight


def _try_acquire_leader_lock(session: Session) -> bool:
    """True when this worker holds the singleton scheduler advisory lock."""
    row = session.execute(
        text("SELECT pg_try_advisory_lock(:k) AS acquired"),
        {"k": AUTO_SUBMIT_LEADER_LOCK_KEY},
    ).scalar()
    return bool(row)


def _run_auto_submit_scan_if_leader() -> None:
    """REM-021: only the advisory-lock leader runs the singleton deadline scan."""
    with app_session() as s:
        leader = _try_acquire_leader_lock(s)
    if not leader:
        log.debug("auto-submit scan skipped: another worker holds the scheduler lock")
        return
    # the scheduler is the authority for deadline auto-submits even
    # when every browser is closed (baseline 7.5)
    submitted = auto_submit.scan_and_submit()
    if submitted:
        log.warning("auto-submitted %d participant(s) at level deadline", submitted)


def main() -> None:
    signal.signal(signal.SIGTERM, _request_shutdown)
    signal.signal(signal.SIGINT, _request_shutdown)
    log.info("worker starting (handlers: %s)", ", ".join(sorted(jobs.HANDLERS)))
    last_scan = 0.0
    while not _shutdown.is_set():
        try:
            with app_session() as s:
                recovered = requeue_expired_leases(s)
            if recovered:
                log.warning("recovered %d expired-lease job(s)", recovered)
            now = time.monotonic()
            if now - last_scan >= AUTO_SUBMIT_SCAN_INTERVAL_S:
                _run_auto_submit_scan_if_leader()
                last_scan = now
            if _shutdown.is_set():
                break  # REM-070: never claim new work after drain begins
            _enter_flight()
            try:
                processed = jobs.drain(max_jobs=20)
            finally:
                _leave_flight()
            if processed:
                log.info("processed %d job(s)", processed)
                continue  # keep draining while there is work
        except Exception:
            log.exception("worker loop error")
        # Event.wait doubles as an interruptible sleep: it returns immediately
        # once the shutdown event is set, so drain is not delayed by a poll.
        _shutdown.wait(POLL_INTERVAL_S)
    _on_shutdown()


def _on_shutdown() -> None:
    """REM-070: stop claiming, report in-flight work, requeue leases once, exit."""
    log.info("worker shutting down: in-flight jobs at signal time: %d", _in_flight_count())
    try:
        with app_session() as s:
            recovered = requeue_expired_leases(s)
        if recovered:
            log.warning("requeued %d lease(s) on shutdown", recovered)
    except Exception:
        log.exception("shutdown lease requeue failed")
    log.info("worker stopped")


if __name__ == "__main__":
    main()

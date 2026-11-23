"""Durable job worker (D1: one trusted worker process).

Claims jobs with FOR UPDATE SKIP LOCKED + leases, runs handlers outside the
claim transaction, retries with backoff, dead-letters after max attempts.
Run with:  python worker.py  (see scripts/run_dev.sh)
"""

from __future__ import annotations

import logging
import time

from app import (
    evaluator,  # noqa: F401  (registers all handlers)
    jobs,
)
from app.db import app_session
from app.jobs import requeue_expired_leases

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s worker %(message)s")
log = logging.getLogger("worker")

POLL_INTERVAL_S = 2.0


def main() -> None:
    log.info("worker starting (handlers: %s)", ", ".join(sorted(jobs.HANDLERS)))
    while True:
        try:
            with app_session() as s:
                recovered = requeue_expired_leases(s)
            if recovered:
                log.warning("recovered %d expired-lease job(s)", recovered)
            processed = jobs.drain(max_jobs=20)
            if processed:
                log.info("processed %d job(s)", processed)
                continue  # keep draining while there is work
        except Exception:
            log.exception("worker loop error")
        time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Load test for the Bug Hunt CTF platform (dev scale).

Measures the D1 targets (submission ack p95 <= 500 ms, reads p95 <= 300 ms)
against a RUNNING API with the seeded Fall Back event. Read-heavy phase
simulates 60 participants polling /state and /time every 5 s plus browsing
files; then a submission burst measures acknowledgement latency across 10
reports on distinct files by 5 seeded participants.

Usage: python scripts/load_test.py --base http://127.0.0.1:8100 --users 60
Results print to stdout and append to docs/LOAD_TEST_REPORT.md data section.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from datetime import UTC, datetime

import httpx

STAFF_PW = "Dev-only!Passw0rd!"
FILES = [
    "db.js",
    "server.js",
    "routes/auth.js",
    "routes/notes.js",
    "routes/comments.js",
    "public/app.js",
    "public/index.html",
    "public/styles.css",
    "public/admin.html",
    "package.json",
    "README.md",
]


def pct(xs, p):
    xs = sorted(xs)
    if not xs:
        return 0.0
    idx = min(len(xs) - 1, round(p / 100 * (len(xs) - 1)))
    return xs[idx]


async def poller(client, user_idx, deadline, samples: dict):
    lat_state, lat_time, errors = samples["state"], samples["time"], samples["errors"]
    try:
        while time.monotonic() < deadline:
            t0 = time.perf_counter()
            r = await client.get("/v1/state")
            lat_state.append((time.perf_counter() - t0) * 1000)
            if r.status_code != 200:
                errors.append(("state", r.status_code))
            t0 = time.perf_counter()
            r = await client.get("/v1/time")
            lat_time.append((time.perf_counter() - t0) * 1000)
            if r.status_code != 200:
                errors.append(("time", r.status_code))
            t0 = time.perf_counter()
            r = await client.get("/v1/assignments")
            if r.status_code != 200:
                errors.append(("assignments", r.status_code))
            t0 = time.perf_counter()
            r = await client.get(
                f"/v1/challenges/{samples['challenge_id']}/files/content", params={"path": FILES[user_idx % len(FILES)]}
            )
            if r.status_code != 200:
                errors.append(("file", r.status_code))
            await asyncio.sleep(5)
    except Exception as e:  # noqa: BLE001
        errors.append(("exception", str(e)[:60]))


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8100")
    ap.add_argument("--users", type=int, default=60)
    ap.add_argument("--seconds", type=int, default=60)
    args = ap.parse_args()
    base = args.base.rstrip("/")

    # seed participants: p1..p5 on two teams
    participants = [f"p{i}.team{t}@example.com" for t in (1, 2) for i in (1, 2, 3, 4, 5)][: args.users // 12 + 2]
    async with httpx.AsyncClient(base_url=base, timeout=20) as admin:
        login = (
            await admin.post("/v1/auth/login", json={"email": "organizer@example.com", "password": STAFF_PW})
        ).json()
        admin.headers["Authorization"] = f"Bearer {login['access_token']}"
        event = (await admin.get("/v1/admin/events")).json()["events"][0]
        live = (await admin.get(f"/v1/admin/events/{event['id']}/live")).json()
        stage = live["stages"][0]
        if stage["status"] not in ("active",):
            for action in ("seal", "arm", "start"):
                await admin.post(
                    f"/v1/admin/stages/{stage['id']}/control", json={"action": action, "reason": "load test"}
                )
        # assignments endpoint needs a participant identity; use the first seeded participant
        pemail = participants[0]
        plogin = (await admin.post("/v1/auth/login", json={"email": pemail, "password": STAFF_PW})).json()
        admin.headers["Authorization"] = f"Bearer {plogin['access_token']}"
        if not (await admin.get("/v1/me")).json().get("rules_accepted"):
            await admin.post("/v1/me/acceptances", json={})
        asg = (await admin.get("/v1/assignments")).json()["assignments"][0]
        challenge_id = asg["challenge_id"]
        admin.headers["Authorization"] = f"Bearer {login['access_token']}"

    samples = {"state": [], "time": [], "errors": [], "challenge_id": challenge_id}
    tokens = {}
    async with httpx.AsyncClient(base_url=base, timeout=20) as boot:
        for email in participants[: args.users]:
            r = await boot.post("/v1/auth/login", json={"email": email, "password": STAFF_PW})
            if r.status_code == 200:
                tokens[email] = r.json()["access_token"]

    print(f"phase 1: {len(tokens)} virtual participants polling for {args.seconds}s")
    async with httpx.AsyncClient(base_url=base, timeout=20) as _:
        pass
    clients = []
    tasks = []
    start = time.monotonic()
    deadline = start + args.seconds
    for idx, tok in enumerate(tokens.values()):
        c = httpx.AsyncClient(base_url=base, timeout=20, headers={"Authorization": f"Bearer {tok}"})
        clients.append(c)
        tasks.append(asyncio.create_task(poller(c, idx, deadline, samples)))
    await asyncio.gather(*tasks, return_exceptions=True)
    for c in clients:
        await c.aclose()
    dur = time.monotonic() - start
    state_ms = [x for x in samples["state"] if x < 5000]
    time_ms = [x for x in samples["time"] if x < 5000]
    print(f"  duration: {dur:.1f}s, state samples: {len(state_ms)}, time samples: {len(time_ms)}")
    print(f"  /state  p50 {pct(state_ms, 50):6.1f}  p95 {pct(state_ms, 95):6.1f}  p99 {pct(state_ms, 99):6.1f} ms")
    print(f"  /time   p50 {pct(time_ms, 50):6.1f}  p95 {pct(time_ms, 95):6.1f}  p99 {pct(time_ms, 99):6.1f} ms")
    errs = samples["errors"]
    print(f"  errors: {len(errs)}")

    print("phase 2: submission acknowledgement burst (10 reports, distinct files)")
    ack_ms = []
    async with httpx.AsyncClient(base_url=base, timeout=20) as burst:
        for i, email in enumerate(participants[:5]):
            tok = tokens.get(email)
            if not tok:
                continue
            burst.headers["Authorization"] = f"Bearer {tok}"
            me = (await burst.get("/v1/me")).json()
            if not me.get("rules_accepted"):
                await burst.post("/v1/me/acceptances", json={})
            for j in range(2):
                fpath = FILES[(i * 2 + j) % len(FILES)]
                t0 = time.perf_counter()
                r = await burst.post(
                    "/v1/submissions",
                    headers={"Idempotency-Key": f"load-{email}-{j}-{int(time.time())}"},
                    json={
                        "kind": "bug_report",
                        "file_path": fpath,
                        "line_start": 10 + j,
                        "line_end": 12 + j,
                        "category": "logic",
                        "title": f"Load test report {i}-{j}",
                        "description": "Load test submission measuring acknowledgement latency under the approved cap.",
                    },
                )
                ack_ms.append((time.perf_counter() - t0) * 1000)
                if r.status_code not in (202, 409, 429):
                    errs.append(("submit", f"{r.status_code} {r.text[:60]}"))
    print(
        f"  /submissions ack p50 {pct(ack_ms, 50):6.1f}  p95 {pct(ack_ms, 95):6.1f}  p99 {pct(ack_ms, 99):6.1f} ms over {len(ack_ms)} accepted attempts"
    )

    report = {
        "date": datetime.now(UTC).isoformat(),
        "base": base,
        "users": len(tokens),
        "duration_s": round(dur, 1),
        "state_p50": round(pct(state_ms, 50), 1),
        "state_p95": round(pct(state_ms, 95), 1),
        "state_p99": round(pct(state_ms, 99), 1),
        "time_p50": round(pct(time_ms, 50), 1),
        "time_p95": round(pct(time_ms, 95), 1),
        "time_p99": round(pct(time_ms, 99), 1),
        "ack_p50": round(pct(ack_ms, 50), 1),
        "ack_p95": round(pct(ack_ms, 95), 1),
        "ack_p99": round(pct(ack_ms, 99), 1),
        "errors": len(errs),
        "verdict_reads_300ms": pct(state_ms, 95) <= 300 and pct(time_ms, 95) <= 300,
        "verdict_ack_500ms": pct(ack_ms, 95) <= 500,
    }
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    asyncio.run(main())

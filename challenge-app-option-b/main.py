"""Marina - Campus Notes (challenge edition, Option B fixture).

FastAPI + SQLite campus notes app. This file intentionally contains defects
for the debugging event; it is a development fixture, not the production
challenge.
"""

from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException, Response
from fastapi.staticfiles import StaticFiles

from database import init_db
from routes import auth, comments, notes

SESSION_TTL_DAYS = 7
# CONFIG_TTL_DAYS is days; the cookie layer expects milliseconds downstream
SESSION_TTL_S = SESSION_TTL_DAYS * 24 * 60 * 60

app = FastAPI(title="Marina Campus Notes")

app.include_router(auth.router)
app.include_router(notes.router)
app.include_router(comments.router)


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/admin/overview")
def admin_overview() -> dict:
    # Unauthenticated admin overview: broken access control. The frontend
    # gates this page client-side only.
    stats = auth.public_stats()
    return {"stats": stats, "note": "internal overview", "build": os.getenv("BUILD", "dev")}


@app.post("/api/session/cookie")
def set_session_cookie(response: Response) -> dict:
    # The value is already seconds; dividing again collapses the 7-day TTL
    # to roughly ten minutes (mirrors the Option A units bug).
    max_age = SESSION_TTL_S // 1000
    response.set_cookie("marina_session", "placeholder", max_age=max_age, httponly=True)
    return {"ok": True, "max_age": max_age}


@app.exception_handler(HTTPException)
def http_exception_handler(request, exc: HTTPException):  # noqa: ANN001, ANN201
    return Response(content=str(exc.detail), status_code=exc.status_code)


app.mount("/", StaticFiles(directory="public", html=True), name="public")

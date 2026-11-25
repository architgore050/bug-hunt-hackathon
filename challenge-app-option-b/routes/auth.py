"""Auth routes for the Marina fixture (challenge edition)."""

from __future__ import annotations

import hashlib
import secrets

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import database

router = APIRouter(prefix="/api/auth")


def _hash(password: str) -> str:
    salt = secrets.token_hex(8)
    return f"{salt}${hashlib.sha256((salt + password).encode()).hexdigest()}"


class RegisterIn(BaseModel):
    email: str
    name: str
    password: str


class LoginIn(BaseModel):
    email: str
    password: str


@router.post("/register", status_code=201)
def register(body: RegisterIn) -> dict:
    # No duplicate check runs before the INSERT: the UNIQUE constraint error
    # escapes as an unhandled exception (mirrors Option A).
    conn = database.connect()
    cur = conn.execute(
        "INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)",
        (body.email, body.name, _hash(body.password), database.now_iso()),
    )
    conn.commit()
    conn.close()
    return {"id": cur.lastrowid, "email": body.email}


@router.post("/login")
def login(body: LoginIn) -> dict:
    conn = database.connect()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (body.email,)).fetchone()
    conn.close()
    if row is None or "$" not in (row["password_hash"] or ""):
        raise HTTPException(status_code=401, detail="invalid credentials")
    salt, digest = row["password_hash"].split("$", 1)
    if hashlib.sha256((salt + body.password).encode()).hexdigest() != digest:
        raise HTTPException(status_code=401, detail="invalid credentials")
    return {"ok": True, "user_id": row["id"], "name": row["name"]}


@router.get("/me")
def me(user_id: int) -> dict:
    conn = database.connect()
    row = conn.execute("SELECT id, email, name FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    if row is None:
        raise HTTPException(status_code=404, detail="no such user")
    return {"user": dict(row), "stats": database.author_stats(user_id)}


def public_stats() -> dict:
    conn = database.connect()
    row = conn.execute(
        "SELECT (SELECT count(*) FROM users) AS users_total, (SELECT count(*) FROM notes) AS notes_total"
    ).fetchone()
    conn.close()
    return dict(row)

"""FastAPI dependencies: authentication, roles, rate limiting, request context.

Identity ALWAYS comes from the signed access token, never from the request
body (architecture 8.1 step 1). Every object access is ownership-scoped here
and again in the service queries (SEC-02 / IDOR defense in depth).
"""
from __future__ import annotations

import time
import uuid
from collections import defaultdict

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text

from . import security
from .config import settings, cors_origins
from .db import app_session
from .errors import ApiError

_bearer = HTTPBearer(auto_error=False)

# In-process token bucket keyed by identity (identity-based limits, NET-01).
# PostgreSQL/DB-backed quotas remain authoritative for submission caps; this
# bucket only sheds abusive request volume before they hit the transaction.
_bucket: dict[str, list[float]] = defaultdict(list)


def rate_limit(key: str, limit: int, window_s: float) -> None:
    now = time.monotonic()
    hits = [t for t in _bucket[key] if now - t < window_s]
    if len(hits) >= limit:
        raise ApiError("AUTH_RATE_LIMITED", details={"n": int(window_s)})
    hits.append(now)
    _bucket[key] = hits[-60:]


class Principal:
    """Authenticated caller resolved from server-side state."""

    def __init__(self, row):
        self.id = str(row.id)
        self.email = row.email
        self.name = row.name
        self.role = row.role
        self.status = row.status
        self.session_id = str(row.session_id)
        self.token_version = int(row.token_version)


def get_principal(request: Request, creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> Principal:
    if creds is None or creds.scheme.lower() != "bearer":
        raise ApiError("AUTH_TOKEN_EXPIRED")
    try:
        claims = security.decode_access_token(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise ApiError("AUTH_TOKEN_EXPIRED")
    except jwt.InvalidTokenError:
        raise ApiError("AUTH_SESSION_REVOKED")

    with app_session() as s:
        row = s.execute(
            text(
                "SELECT u.id, u.email, u.name, u.role, u.status, u.token_version, s.id AS session_id, "
                "s.revoked_at FROM app.users u JOIN app.sessions s ON s.id = CAST(:sid AS uuid) "
                "WHERE u.id = CAST(:uid AS uuid)"
            ),
            {"sid": claims["sid"], "uid": claims["sub"]},
        ).mappings().first()
    if row is None:
        raise ApiError("AUTH_SESSION_REVOKED")
    if row["revoked_at"] is not None:
        raise ApiError("AUTH_SESSION_REVOKED")
    if row["status"] == "disqualified":
        raise ApiError("AUTH_FORBIDDEN", message="This account was disqualified. Contact the organizers.")
    if row["status"] != "active":
        raise ApiError("AUTH_NOT_ACTIVATED")
    if int(claims.get("tv", 1)) != int(row["token_version"]):
        raise ApiError("AUTH_SESSION_REVOKED")
    return Principal(row)


def require_role(*roles: str):
    def checker(p: Principal = Depends(get_principal)) -> Principal:
        if p.role not in roles:
            raise ApiError("AUTH_FORBIDDEN")
        return p

    return checker


def require_staff() -> "callable":
    def checker(p: Principal = Depends(get_principal)) -> Principal:
        if p.role not in ("reviewer", "organizer", "admin"):
            raise ApiError("AUTH_FORBIDDEN")
        return p

    return checker


def require_admin(p: Principal = Depends(get_principal)) -> Principal:
    if p.role != "admin":
        raise ApiError("AUTH_FORBIDDEN")
    return p


def require_organizer(p: Principal = Depends(get_principal)) -> Principal:
    if p.role not in ("organizer", "admin"):
        raise ApiError("AUTH_FORBIDDEN")
    return p


def require_rules_accepted(p: Principal) -> None:
    """Blocking rules gate (ATH-04): participants must accept the current rules version."""
    if p.role != "participant":
        return
    with app_session() as s:
        ev = s.execute(
            text("SELECT rules_version FROM app.events WHERE status IN ('ready','live','closed','finalized') ORDER BY created_at DESC LIMIT 1")
        ).first()
        if ev is None:
            return
        acc = s.execute(
            text("SELECT 1 FROM app.acceptances WHERE user_id = CAST(:u AS uuid) AND rules_version = :v"),
            {"u": p.id, "v": int(ev[0])},
        ).first()
    if acc is None:
        raise ApiError("RULES_NOT_ACCEPTED")


def step_up_verified(request: Request, p: Principal = Depends(get_principal)) -> Principal:
    """ADMIN_STEP_UP_REQUIRED: sensitive routes require recent step-up (AUTH-09).

    In v1 without MFA infrastructure, step-up is implemented as a re-entered
    password check within the last 5 minutes recorded server-side in the
    session row (see /v1/auth/step-up). Cloudflare Access + WebAuthn are the
    documented production path (ADR-008 / SECURITY_ARCHITECTURE.md).
    """
    if p.role not in ("organizer", "admin"):
        raise ApiError("AUTH_FORBIDDEN")
    from datetime import datetime, timedelta, timezone

    with app_session() as s:
        row = s.execute(
            text("SELECT step_up_at FROM app.sessions WHERE id = CAST(:sid AS uuid)"),
            {"sid": p.session_id},
        ).first()
        step_up_at = row[0] if row else None
    now = datetime.now(timezone.utc)
    if step_up_at is None or step_up_at < now - timedelta(minutes=5):
        raise ApiError("ADMIN_STEP_UP_REQUIRED")
    return p


def request_context(request: Request) -> str:
    rid = getattr(request.state, "request_id", str(uuid.uuid4()))
    return rid


def check_csrf(request: Request) -> None:
    """Origin validation for the cookie-authenticated refresh endpoint (NET-05)."""
    origin = request.headers.get("origin")
    allowed = cors_origins()
    if origin is None or origin not in allowed:
        raise ApiError("AUTH_FORBIDDEN", message="Origin not allowed.")
    if not request.headers.get("x-bhctf-client"):
        raise ApiError("AUTH_FORBIDDEN", message="Missing client header.")

"""Authentication endpoints (spec AUTH-1..05).

- POST /auth/login: rate limited, generic error (no account enumeration).
- POST /auth/refresh: cookie + CSRF headers; rotates the refresh token family;
  reuse outside the grace window revokes the family (AUTH-4).
- Account onboarding: admins register accounts and assign the initial password
  (staff via /auth/register, participants via /admin/users/{id}/password-reset).
  There is NO self-service first-password claim: a NULL password_hash always
  fails login with the generic AUTH_INVALID_CREDENTIALS error (REM-004).
- Password resets are admin-only through the admin router.
- GET /me, /me/sessions, POST /me/acceptances, POST /auth/step-up.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from .. import security
from ..audit import audit_write
from ..config import settings
from ..db import app_session, uuid7
from ..deps import Principal, check_csrf, get_principal, rate_limit, require_admin, step_up_verified
from ..errors import ApiError

router = APIRouter(tags=["auth"])

REFRESH_COOKIE = "bhctf_refresh"


def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=raw_token,
        max_age=settings.refresh_token_ttl_s,
        httponly=True,
        secure=settings.environment == "production",
        samesite="strict",
        path="/v1/auth/refresh",  # scoped to the refresh route only (spec 6.1)
        domain=settings.cookie_domain or None,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key=REFRESH_COOKIE, path="/v1/auth/refresh", domain=settings.cookie_domain or None)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=200)


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response):
    # REM-003 (v1 limitation, deferred by design to ADR-008): staff
    # (organizer/admin) sign-in is the SAME single-factor password flow used by
    # participants and is served from the same origin.  Password re-entry is NOT
    # MFA -- a phished/reused staff password grants both initial access and the
    # step-up factor.  The production path is Cloudflare Access (separate admin
    # origin + identity proxy) plus WebAuthn/TOTP as a true second factor, plus
    # a staff-specific 60-minute idle expiry.  None of that infrastructure
    # exists in v1, so this comment marks the residual high-impact risk.  What
    # the code CAN do here is tighten the staff access-token TTL; that requires
    # ``security.create_access_token`` to accept a role-driven (or explicit)
    # ``ttl_s`` and is a cross-file change tracked for the orchestrator (see
    # final report).  Do not treat the absence of MFA as accepted: it is a
    # documented waiver pending ADR-008.
    ip = request.client.host if request.client else ""
    rate_limit(f"login:{ip}", limit=20, window_s=60)
    rate_limit(f"login-u:{body.email.lower()}", limit=10, window_s=60)
    with app_session() as s:
        user = (
            s.execute(
                text(
                    "SELECT id, email, name, role, password_hash, token_version "
                    "FROM app.users WHERE lower(email) = :e FOR UPDATE"
                ),
                {"e": body.email.lower()},
            )
            .mappings()
            .first()
        )
        # Participants must already be attached to a team (admin-registered) to
        # sign in.  Staff credentials are always admin-assigned.  See REM-004
        # below for the NULL password_hash policy.
        if user is None:
            raise ApiError("AUTH_INVALID_CREDENTIALS")
        if user["role"] == "participant":
            membership = s.execute(
                text("SELECT 1 FROM app.team_members WHERE user_id = CAST(:uid AS uuid) LIMIT 1"),
                {"uid": str(user["id"])},
            ).first()
            if membership is None:
                raise ApiError("AUTH_INVALID_CREDENTIALS")
        # REM-004: a NULL password_hash means the account has not been issued a
        # credential yet.  There is NO self-service first-password flow: an
        # attacker who only knows the registered email must not be able to set
        # the initial password by reaching the login page first.  First-password
        # setup is admin-mediated -- admins register participants through
        # ``/v1/admin/events/{event_id}/participants`` (which leaves
        # password_hash NULL) and then assign the initial password through
        # ``/v1/admin/users/{user_id}/password-reset``.  ``/v1/auth/register``
        # (admin-only) always sets the password for staff.  Any login against a
        # NULL password_hash therefore returns the same generic
        # AUTH_INVALID_CREDENTIALS error as an unknown account, so the response
        # is indistinguishable and no account state is leaked.
        if not user["password_hash"]:
            raise ApiError("AUTH_INVALID_CREDENTIALS")
        if not security.verify_password(body.password, user["password_hash"]):
            raise ApiError("AUTH_INVALID_CREDENTIALS")

        # Concurrent session limit (AUTH-10), hardened with reclaim + eviction:
        # 1) Reclaim zombie sessions: a session whose refresh tokens are all
        #    expired/revoked can never refresh again, so it must not hold a
        #    slot forever (this was a permanent lockout path).
        # 2) If live sessions are still at the cap, evict the oldest live
        #    session (revoked, token family revoked, audited) so a new sign-in
        #    always succeeds. The cap bounds live sessions; it must never lock
        #    a legitimate user out of their own account.
        # The user-row lock serializes concurrent logins for one user so two
        # racing sign-ins cannot exceed the cap.
        s.execute(text("SELECT id FROM app.users WHERE id = CAST(:u AS uuid) FOR UPDATE"), {"u": str(user["id"])})
        s.execute(
            text(
                "UPDATE app.sessions SET revoked_at = now() "
                "WHERE user_id = CAST(:u AS uuid) AND revoked_at IS NULL "
                "AND NOT EXISTS (SELECT 1 FROM app.refresh_tokens rt "
                "  WHERE rt.session_id = app.sessions.id AND rt.status = 'active' AND rt.expires_at > now())"
            ),
            {"u": str(user["id"])},
        )
        live = (
            s.execute(
                text(
                    "SELECT id FROM app.sessions WHERE user_id = CAST(:u AS uuid) AND revoked_at IS NULL ORDER BY created_at ASC"
                ),
                {"u": str(user["id"])},
            )
            .scalars()
            .all()
        )
        while len(live) >= settings.max_sessions_per_user:
            victim = str(live.pop(0))
            s.execute(text("UPDATE app.sessions SET revoked_at = now() WHERE id = CAST(:sid AS uuid)"), {"sid": victim})
            s.execute(
                text("UPDATE app.refresh_tokens SET status='revoked' WHERE session_id = CAST(:sid AS uuid)"),
                {"sid": victim},
            )
            audit_write(
                s,
                actor_id=str(user["id"]),
                actor_role=user["role"],
                action="auth.session_evicted",
                entity_type="session",
                entity_id=victim,
                request_id=request.state.request_id,
            )

        session_id = str(uuid7())
        s.execute(
            text(
                "INSERT INTO app.sessions (id, user_id, ip_hash, user_agent) VALUES "
                "(CAST(:id AS uuid), CAST(:u AS uuid), :ip, :ua)"
            ),
            {
                "id": session_id,
                "u": str(user["id"]),
                "ip": security.ip_hash(ip),
                "ua": request.headers.get("user-agent", "")[:300],
            },
        )
        token, exp = security.create_access_token(
            user_id=str(user["id"]), session_id=session_id, role=user["role"], token_version=int(user["token_version"])
        )
        # initial refresh token in the family
        raw_refresh = security.new_refresh_token()
        s.execute(
            text(
                "INSERT INTO app.refresh_tokens (id, session_id, user_id, token_hash, status, expires_at) "
                "VALUES (CAST(:id AS uuid), CAST(:sid AS uuid), CAST(:u AS uuid), :th, 'active', :exp)"
            ),
            {
                "id": str(uuid7()),
                "sid": session_id,
                "u": str(user["id"]),
                "th": security.token_hash(raw_refresh),
                "exp": datetime.now(UTC) + timedelta(seconds=settings.refresh_token_ttl_s),
            },
        )
        audit_write(
            s,
            actor_id=str(user["id"]),
            actor_role=user["role"],
            action="auth.login",
            entity_type="user",
            entity_id=str(user["id"]),
            request_id=request.state.request_id,
        )
    _set_refresh_cookie(response, raw_refresh)
    return {
        "access_token": token,
        "expires_at": exp.isoformat(),
        "server_time": datetime.now(UTC).isoformat(),
        "user": {
            "id": str(user["id"]),
            "email": user["email"],
            "name": user["name"],
            "role": user["role"],
        },
    }


class RegisterIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=2, max_length=160)
    role: str = Field(default="reviewer", pattern="^(reviewer|organizer|admin)$")
    password: str = Field(min_length=12, max_length=200)


@router.post("/auth/register", status_code=201)
def register(
    body: RegisterIn,
    request: Request,
    p: Principal = Depends(require_admin),
    _step_up: Principal = Depends(step_up_verified),
):
    """Admin-only staff registration with an admin-assigned initial password."""
    rate_limit(f"register:{request.client.host if request.client else ''}", limit=10, window_s=60)
    try:
        with app_session() as s:
            tenant = s.execute(text("SELECT id FROM app.tenants ORDER BY created_at LIMIT 1")).first()
            if tenant is None:
                raise ApiError("VALIDATION_ERROR", details={"tenant": "No tenant exists. Run the seed script."})
            user_id = str(uuid7())
            s.execute(
                text(
                    "INSERT INTO app.users (id, tenant_id, email, name, role, password_hash, registration_id) "
                    "VALUES (CAST(:id AS uuid), CAST(:t AS uuid), :email, :name, :role, :pw, :reg)"
                ),
                {
                    "id": user_id,
                    "t": str(tenant[0]),
                    "email": body.email.lower(),
                    "name": body.name,
                    "role": body.role,
                    "pw": security.hash_password(body.password),
                    "reg": str(uuid7())[:8],
                },
            )
            audit_write(
                s,
                actor_id=p.id,
                actor_role=p.role,
                action="auth.registered",
                entity_type="user",
                entity_id=user_id,
                request_id=request.state.request_id,
                details={"email": body.email.lower(), "role": body.role, "password_setup_required": False},
            )
    except IntegrityError:
        raise ApiError("VALIDATION_ERROR", details={"email": "This email is already registered."}) from None
    return {
        "ok": True,
        "email": body.email.lower(),
        "role": body.role,
        "message": "Staff account registered with an administrator-assigned password.",
        "password_setup_required": False,
    }


@router.post("/auth/refresh")
def refresh(request: Request, response: Response):
    check_csrf(request)
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise ApiError("AUTH_SESSION_REVOKED")
    th = security.token_hash(raw)
    with app_session() as s:
        row = (
            s.execute(
                text(
                    "SELECT rt.id, rt.session_id, rt.user_id, rt.status AS rt_status, rt.expires_at, rt.successor_encrypted, "
                    "rt.rotated_at, u.role, u.token_version "
                    "FROM app.refresh_tokens rt JOIN app.users u ON u.id = rt.user_id WHERE rt.token_hash = :th"
                ),
                {"th": th},
            )
            .mappings()
            .first()
        )
        if row is None:
            raise ApiError("AUTH_SESSION_REVOKED")
        now = datetime.now(UTC)
        if row["rt_status"] == "revoked" or row["expires_at"] < now:
            raise ApiError("AUTH_SESSION_REVOKED")
        if row["rt_status"] == "rotated":
            # AUTH-4 reuse handling: within grace return the same successor; outside revoke family
            rotated_at = row["rotated_at"]
            in_grace = rotated_at is not None and (now - rotated_at).total_seconds() <= settings.refresh_reuse_grace_s
            if in_grace and row["successor_encrypted"]:
                successor = security.decrypt_successor(row["successor_encrypted"])
                if successor:
                    with app_session() as s2:
                        urow = (
                            s2.execute(
                                text("SELECT id, role, token_version FROM app.users WHERE id = CAST(:u AS uuid)"),
                                {"u": str(row["user_id"])},
                            )
                            .mappings()
                            .first()
                        )
                    token, exp = security.create_access_token(
                        user_id=str(row["user_id"]),
                        session_id=str(row["session_id"]),
                        role=urow["role"],
                        token_version=int(urow["token_version"]),
                    )
                    _set_refresh_cookie(response, successor)
                    return {"access_token": token, "expires_at": exp.isoformat(), "server_time": now.isoformat()}
            # reuse outside the grace window: revoke the family
            s.execute(
                text("UPDATE app.refresh_tokens SET status='revoked' WHERE session_id = CAST(:sid AS uuid)"),
                {"sid": str(row["session_id"])},
            )
            s.execute(
                text("UPDATE app.sessions SET revoked_at = :now WHERE id = CAST(:sid AS uuid)"),
                {"now": now, "sid": str(row["session_id"])},
            )
            # app_session() rolls back when an exception escapes its context.
            # Commit the security response before raising so replay revocation persists.
            s.commit()
            raise ApiError("AUTH_SESSION_REVOKED")

        # normal rotation
        urow = (
            s.execute(
                text("SELECT id, role, token_version FROM app.users WHERE id = CAST(:u AS uuid)"),
                {"u": str(row["user_id"])},
            )
            .mappings()
            .first()
        )
        if urow is None:
            raise ApiError("AUTH_SESSION_REVOKED")
        new_raw = security.new_refresh_token()
        new_id = str(uuid7())
        s.execute(
            text(
                "INSERT INTO app.refresh_tokens (id, session_id, user_id, token_hash, status, replaces_id, expires_at) "
                "VALUES (CAST(:id AS uuid), CAST(:sid AS uuid), CAST(:u AS uuid), :th, 'active', CAST(:repl AS uuid), :exp)"
            ),
            {
                "id": new_id,
                "sid": str(row["session_id"]),
                "u": str(row["user_id"]),
                "th": security.token_hash(new_raw),
                "repl": str(row["id"]),
                "exp": now + timedelta(seconds=settings.refresh_token_ttl_s),
            },
        )
        s.execute(
            text(
                "UPDATE app.refresh_tokens SET status='rotated', rotated_at=:now, successor_encrypted=:enc WHERE id = CAST(:id AS uuid)"
            ),
            {"now": now, "enc": security.encrypt_successor(new_raw), "id": str(row["id"])},
        )
        s.execute(
            text("UPDATE app.sessions SET last_seen_at = :now WHERE id = CAST(:sid AS uuid)"),
            {"now": now, "sid": str(row["session_id"])},
        )
        token, exp = security.create_access_token(
            user_id=str(row["user_id"]),
            session_id=str(row["session_id"]),
            role=urow["role"],
            token_version=int(urow["token_version"]),
        )
    _set_refresh_cookie(response, new_raw)
    return {"access_token": token, "expires_at": exp.isoformat(), "server_time": now.isoformat()}


@router.post("/auth/logout")
def logout(request: Request, p: Principal = Depends(get_principal), response: Response = None):
    with app_session() as s:
        s.execute(
            text("UPDATE app.refresh_tokens SET status='revoked' WHERE session_id = CAST(:sid AS uuid)"),
            {"sid": p.session_id},
        )
        s.execute(
            text("UPDATE app.sessions SET revoked_at = now() WHERE id = CAST(:sid AS uuid)"), {"sid": p.session_id}
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="auth.logout",
            entity_type="user",
            entity_id=p.id,
            request_id=request.state.request_id,
        )
    resp = JSONResponse({"ok": True})
    _clear_refresh_cookie(resp)
    return resp


# No activation route is registered for this event. Admin registration plus first sign-in handles onboarding.


class StepUpIn(BaseModel):
    password: str


@router.post("/auth/step-up")
def step_up(body: StepUpIn, request: Request, p: Principal = Depends(get_principal)):
    # REM-003 (v1 limitation, deferred by design to ADR-008): step-up here is
    # ONLY a re-entered password check.  Password re-entry is NOT a second
    # factor: an attacker who has the password (phished/reused) satisfies
    # step-up just as easily as login.  The production path is a fresh
    # WebAuthn assertion or TOTP challenge with anti-replay, recorded with the
    # factor id and proof timestamp on the session, behind a separate admin
    # origin fronted by Cloudflare Access.  None of that exists in v1; this
    # comment marks the residual risk.  Do NOT relax the 5-minute step-up
    # window or treat password re-entry as MFA in any new code.
    with app_session() as s:
        urow = (
            s.execute(text("SELECT password_hash FROM app.users WHERE id = CAST(:u AS uuid)"), {"u": p.id})
            .mappings()
            .first()
        )
        if not urow or not security.verify_password(body.password, urow["password_hash"]):
            rate_limit(f"stepup:{p.id}", limit=5, window_s=300)
            raise ApiError("AUTH_INVALID_CREDENTIALS")
        s.execute(
            text("UPDATE app.sessions SET step_up_at = now() WHERE id = CAST(:sid AS uuid)"), {"sid": p.session_id}
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="auth.step_up",
            entity_type="user",
            entity_id=p.id,
            request_id=request.state.request_id,
        )
    return {"ok": True, "valid_until": (datetime.now(UTC) + timedelta(minutes=5)).isoformat()}


# Self-service password-reset routes are disabled; only admin password reset is supported.


@router.get("/me")
def me(p: Principal = Depends(get_principal)):
    # REM-001: every selector that resolves the caller's active event/team/rules
    # MUST be scoped to ``p.tenant_id`` so a participant in tenant A can never
    # be shown tenant B's event, team or rules version.  ``tenant_id`` is
    # server-derived identity (Principal.tenant_id), never a request parameter.
    with app_session() as s:
        team = (
            s.execute(
                text(
                    "SELECT t.id, t.name, t.join_code, e.id AS event_id, e.slug, e.status AS event_status "
                    "FROM app.team_members tm JOIN app.teams t ON t.id = tm.team_id "
                    "JOIN app.events e ON e.id = t.event_id "
                    "WHERE tm.user_id = CAST(:u AS uuid) AND e.tenant_id = CAST(:tid AS uuid) LIMIT 1"
                ),
                {"u": p.id, "tid": p.tenant_id},
            )
            .mappings()
            .first()
        )
        # The active rules version is resolved WITHIN the caller's tenant so two
        # concurrent active events in different tenants return their own rules.
        current_rules = s.execute(
            text(
                "SELECT rules_version FROM app.events "
                "WHERE tenant_id = CAST(:tid AS uuid) "
                "AND status IN ('ready','live','closed','finalized') "
                "ORDER BY created_at DESC LIMIT 1"
            ),
            {"tid": p.tenant_id},
        ).first()
        accepted = None
        if current_rules is not None:
            accepted = s.execute(
                text("SELECT 1 FROM app.acceptances WHERE user_id = CAST(:u AS uuid) AND rules_version = :v"),
                {"u": p.id, "v": int(current_rules[0])},
            ).first()
    out = {
        "id": p.id,
        "email": p.email,
        "name": p.name,
        "role": p.role,
        "tenant_id": p.tenant_id,
        "team": dict(team) if team else None,
        "rules_accepted": bool(accepted),
        "rules_version": int(current_rules[0]) if current_rules else None,
    }
    return out


@router.get("/me/sessions")
def my_sessions(p: Principal = Depends(get_principal)):
    with app_session() as s:
        rows = (
            s.execute(
                text(
                    "SELECT id, created_at, last_seen_at, user_agent, revoked_at FROM app.sessions "
                    "WHERE user_id = CAST(:u AS uuid) AND revoked_at IS NULL ORDER BY last_seen_at DESC"
                ),
                {"u": p.id},
            )
            .mappings()
            .all()
        )
    return [
        {
            "id": str(r["id"]),
            "created_at": r["created_at"].isoformat(),
            "last_seen_at": r["last_seen_at"].isoformat(),
            "device": (r["user_agent"] or "")[:80],
        }
        for r in rows
    ]


@router.delete("/me/sessions/{session_id}")
def revoke_session(session_id: str, request: Request, p: Principal = Depends(get_principal)):
    # REM-078: the previous implementation filtered the app.sessions UPDATE by
    # both session_id AND user_id (so a foreign session row was never updated),
    # but the follow-on refresh_tokens UPDATE filtered ONLY by session_id.  An
    # attacker who obtained another user's session UUID could therefore revoke
    # that user's whole refresh-token family even though no session row was
    # touched (cross-user logout / IDOR).  We now verify ownership FIRST
    # (SELECT user_id from app.sessions WHERE id = :sid) and refuse with the
    # same non-enumerating NOT_FOUND before touching refresh_tokens.  The
    # refresh_tokens UPDATE is also scoped to a session we have proven we own.
    with app_session() as s:
        owner = s.execute(
            text("SELECT user_id FROM app.sessions WHERE id = CAST(:sid AS uuid)"),
            {"sid": session_id},
        ).first()
        if owner is None or str(owner[0]) != p.id:
            # Non-enumerating: a foreign or missing session id looks identical
            # to the caller, so session existence is not leaked.
            raise ApiError("NOT_FOUND")
        s.execute(
            text(
                "UPDATE app.sessions SET revoked_at = now() WHERE id = CAST(:sid AS uuid) AND user_id = CAST(:u AS uuid)"
            ),
            {"sid": session_id, "u": p.id},
        )
        s.execute(
            text(
                "UPDATE app.refresh_tokens SET status='revoked' "
                "WHERE session_id = CAST(:sid AS uuid) "
                "AND EXISTS (SELECT 1 FROM app.sessions s WHERE s.id = refresh_tokens.session_id AND s.user_id = CAST(:u AS uuid))"
            ),
            {"sid": session_id, "u": p.id},
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="auth.session_revoked",
            entity_type="session",
            entity_id=session_id,
            request_id=request.state.request_id,
        )
    return {"ok": True}


class AcceptIn(BaseModel):
    version: int | None = None


@router.post("/me/acceptances")
def accept_rules(body: AcceptIn, request: Request, p: Principal = Depends(get_principal)):
    with app_session() as s:
        # REM-001: resolve the active event WITHIN the caller's tenant so a
        # participant accepts their own tenant's rules version, never another
        # tenant's.  ``p.tenant_id`` is server-derived identity.
        ev = s.execute(
            text(
                "SELECT id, rules_version FROM app.events "
                "WHERE tenant_id = CAST(:tid AS uuid) "
                "AND status IN ('ready','live','closed','finalized') "
                "ORDER BY created_at DESC LIMIT 1"
            ),
            {"tid": p.tenant_id},
        ).first()
        if ev is None:
            raise ApiError("NOT_FOUND", message="No published event found.")
        version = body.version or int(ev[1])
        s.execute(
            text(
                "INSERT INTO app.acceptances (id, user_id, rules_version, ip_hash) VALUES "
                "(CAST(:id AS uuid), CAST(:u AS uuid), :v, :ip) ON CONFLICT (user_id, rules_version) DO NOTHING"
            ),
            {
                "id": str(uuid7()),
                "u": p.id,
                "v": version,
                "ip": security.ip_hash(request.client.host if request.client else ""),
            },
        )
        audit_write(
            s,
            actor_id=p.id,
            actor_role=p.role,
            action="rules.accepted",
            entity_type="event",
            entity_id=str(ev[0]),
            request_id=request.state.request_id,
            details={"version": version},
        )
    return {"ok": True, "rules_version": version}

"""Security primitives: Argon2id password hashing, JWT access tokens, refresh token
families with rotation and reuse detection, HMAC receipt codes.

Implements AUTH-01..AUTH-07 from the blind-spot register:
- Access tokens: short-lived signed JWT, algorithm pinned, sid/jti/tv claims.
- Access tokens live in client memory only; the refresh token is an opaque
  HttpOnly/Secure/SameSite=Strict cookie scoped to /v1/auth/refresh.
- Refresh reuse outside the grace window revokes the whole family (session).
- Password hashing uses Argon2id with OWASP-minimum parameters.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken

from .config import settings

_ph = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)  # OWASP minimum (AUTH-07)

_fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(settings.jwt_secret.encode()).digest()))


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except (VerificationError, InvalidHashError):
        # malformed or foreign-format hash stored on the row: treat as unverifiable, never crash
        return False


def sha256_hex(data: str | bytes) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def token_hash(raw_token: str) -> str:
    return sha256_hex(raw_token)


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def encrypt_successor(raw_token: str) -> str:
    return _fernet.encrypt(raw_token.encode()).decode()


def decrypt_successor(blob: str) -> str | None:
    try:
        return _fernet.decrypt(blob.encode()).decode()
    except InvalidToken:
        return None


# --- access tokens -----------------------------------------------------------


def create_access_token(
    *, user_id: str, session_id: str, role: str, token_version: int, event_id: str | None = None
) -> tuple[str, datetime]:
    now = datetime.now(UTC)
    exp = now + timedelta(seconds=settings.access_token_ttl_s)
    claims = {
        "iss": "bughunt-api",
        "aud": "bughunt-participant" if role == "participant" else "bughunt-admin",
        "sub": user_id,
        "sid": session_id,
        "role": role,
        "tv": token_version,  # token_version bump revokes all tokens (password reset, disqualification)
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "jti": secrets.token_hex(8),
    }
    if event_id:
        claims["evt"] = event_id
    token = jwt.encode(claims, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, exp


def decode_access_token(token: str) -> dict:
    """Pinned-algorithm decode with iss/aud verification (AUTH-03)."""
    # Admin/reviewer tokens use the admin audience; try both but never allow alg confusion.
    for aud in ("bughunt-participant", "bughunt-admin"):
        try:
            return jwt.decode(
                token,
                settings.jwt_secret,
                algorithms=[settings.jwt_algorithm],  # pinned: any other alg is rejected
                audience=aud,
                issuer="bughunt-api",
                options={"require": ["exp", "iat", "nbf", "sub", "sid"]},
            )
        except jwt.InvalidAudienceError:
            continue
    raise jwt.InvalidTokenError()


# --- receipts and flag hashing ------------------------------------------------


def receipt_code(submission_id: str, received_at: datetime) -> str:
    """HMAC-derived verifiable receipt (spec 10.4): organizers can confirm a participant-held receipt."""
    material = f"{submission_id}|{received_at.isoformat()}"
    digest = hmac.new(settings.jwt_secret.encode(), material.encode(), hashlib.sha256).hexdigest().upper()
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    take = "".join(alphabet[int(digest[i : i + 2], 16) % len(alphabet)] for i in range(0, 8, 2))
    return f"{take[:4]}-{take[4:]}"


def flag_code_hash(code: str) -> str:
    """HMAC hash of a CTF flag; plaintext flags never rest in the app schema."""
    return hmac.new(settings.jwt_secret.encode(), code.strip().encode(), hashlib.sha256).hexdigest()


def ip_hash(ip: str | None) -> str | None:
    if not ip:
        return None
    return hmac.new(settings.jwt_secret.encode(), ip.encode(), hashlib.sha256).hexdigest()[:32]


def canonical_payload_hash(payload: dict) -> str:
    """Stable hash of a canonicalized JSON payload for idempotency (architecture 8.1)."""
    import json

    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return sha256_hex(canonical)

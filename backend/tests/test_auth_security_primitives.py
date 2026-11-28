"""Focused tests for password, token, hashing, and canonicalization primitives."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from app import security
from app.config import settings


def _claims() -> dict:
    now = datetime.now(UTC)
    return {
        "iss": "bughunt-api",
        "aud": "bughunt-participant",
        "sub": str(uuid.uuid4()),
        "sid": str(uuid.uuid4()),
        "role": "participant",
        "tv": 3,
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=10)).timestamp()),
        "jti": "0123456789abcdef",
    }


def _encode(claims: dict, *, secret: str | None = None, algorithm: str | None = None) -> str:
    return jwt.encode(
        claims,
        settings.jwt_secret if secret is None else secret,
        algorithm=settings.jwt_algorithm if algorithm is None else algorithm,
    )


def test_password_hashes_are_salted_argon2id_and_verify_exactly():
    password = "Correct-Horse-Battery-Staple!"

    first = security.hash_password(password)
    second = security.hash_password(password)

    assert first.startswith("$argon2id$")
    assert first != second
    assert security.verify_password(password, first)
    assert security.verify_password(password, second)
    assert not security.verify_password(password + "!", first)


@pytest.mark.parametrize("bad_hash", ["", "not-a-password-hash", "$argon2id$v=19$m=19456,t=2,p=1$broken"])
def test_password_verification_treats_malformed_hashes_as_unverifiable(bad_hash):
    assert security.verify_password("Any-Valid-Looking-Password", bad_hash) is False


def test_password_verification_uses_a_dummy_hash_when_account_has_no_hash(monkeypatch):
    calls = []

    def verify(encoded_hash, password):
        calls.append((encoded_hash, password))
        return True

    class DummyVerifier:
        @staticmethod
        def verify(encoded_hash, password):
            return verify(encoded_hash, password)

    monkeypatch.setattr(security, "_ph", DummyVerifier())

    assert security.verify_password("submitted-password", None) is False
    assert calls == [(security._DUMMY_PASSWORD_HASH, "submitted-password")]


def test_sha256_and_token_hash_accept_text_and_bytes_without_normalizing():
    expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

    assert security.sha256_hex("abc") == expected
    assert security.sha256_hex(b"abc") == expected
    assert security.sha256_hex("ABC") != expected
    assert security.token_hash("refresh-token") == security.sha256_hex("refresh-token")


def test_refresh_tokens_are_long_urlsafe_and_unique():
    tokens = [security.new_refresh_token() for _ in range(8)]

    assert len(set(tokens)) == len(tokens)
    for token in tokens:
        assert len(token) == 64
        assert re.fullmatch(r"[A-Za-z0-9_-]+", token)


def test_successor_encryption_round_trips_and_rejects_tampering():
    raw = security.new_refresh_token()
    encrypted = security.encrypt_successor(raw)
    replacement = "A" if encrypted[10] != "A" else "B"
    tampered = encrypted[:10] + replacement + encrypted[11:]

    assert raw not in encrypted
    assert security.decrypt_successor(encrypted) == raw
    assert security.decrypt_successor(tampered) is None
    assert security.decrypt_successor("not-a-fernet-token") is None


@pytest.mark.parametrize(
    ("role", "audience"),
    [
        ("participant", "bughunt-participant"),
        ("reviewer", "bughunt-admin"),
        ("organizer", "bughunt-admin"),
        ("admin", "bughunt-admin"),
    ],
)
def test_access_token_creation_and_decode_preserve_claims(role, audience):
    user_id = str(uuid.uuid4())
    session_id = str(uuid.uuid4())
    event_id = str(uuid.uuid4())
    before = datetime.now(UTC)

    token, expires_at = security.create_access_token(
        user_id=user_id,
        session_id=session_id,
        role=role,
        token_version=7,
        event_id=event_id,
    )

    after = datetime.now(UTC)
    claims = security.decode_access_token(token)
    assert claims["iss"] == "bughunt-api"
    assert claims["aud"] == audience
    assert claims["sub"] == user_id
    assert claims["sid"] == session_id
    assert claims["role"] == role
    assert claims["tv"] == 7
    assert claims["evt"] == event_id
    assert claims["exp"] - claims["iat"] == settings.access_token_ttl_s
    assert claims["nbf"] == claims["iat"]
    assert int(before.timestamp()) <= claims["iat"] <= int(after.timestamp())
    assert re.fullmatch(r"[0-9a-f]{16}", claims["jti"])
    assert expires_at.tzinfo is UTC
    assert abs((expires_at - after).total_seconds() - settings.access_token_ttl_s) < 2


def test_access_token_omits_event_claim_when_no_event_is_supplied():
    token, _ = security.create_access_token(
        user_id=str(uuid.uuid4()),
        session_id=str(uuid.uuid4()),
        role="participant",
        token_version=1,
    )

    assert "evt" not in security.decode_access_token(token)


@pytest.mark.parametrize("claim", ["iss", "aud", "exp", "iat", "nbf", "sub", "sid"])
def test_access_token_decode_rejects_missing_required_or_verified_claims(claim):
    claims = _claims()
    del claims[claim]

    with pytest.raises(jwt.MissingRequiredClaimError):
        security.decode_access_token(_encode(claims))


@pytest.mark.parametrize(
    ("case", "exception"),
    [
        ("expired", jwt.ExpiredSignatureError),
        ("future_nbf", jwt.ImmatureSignatureError),
        ("wrong_issuer", jwt.InvalidIssuerError),
        ("wrong_audience", jwt.InvalidTokenError),
        ("wrong_signature", jwt.InvalidSignatureError),
        ("wrong_algorithm", jwt.InvalidAlgorithmError),
        ("unsigned", jwt.InvalidAlgorithmError),
        ("malformed", jwt.DecodeError),
    ],
)
def test_access_token_decode_rejection_matrix(case, exception):
    claims = _claims()
    now = datetime.now(UTC)
    token: str

    if case == "expired":
        claims["iat"] = int((now - timedelta(minutes=2)).timestamp())
        claims["nbf"] = claims["iat"]
        claims["exp"] = int((now - timedelta(minutes=1)).timestamp())
        token = _encode(claims)
    elif case == "future_nbf":
        claims["nbf"] = int((now + timedelta(minutes=2)).timestamp())
        claims["exp"] = int((now + timedelta(minutes=10)).timestamp())
        token = _encode(claims)
    elif case == "wrong_issuer":
        claims["iss"] = "another-issuer"
        token = _encode(claims)
    elif case == "wrong_audience":
        claims["aud"] = "another-audience"
        token = _encode(claims)
    elif case == "wrong_signature":
        token = _encode(claims, secret="a-different-test-signing-secret-with-enough-length")
    elif case == "wrong_algorithm":
        token = _encode(claims, algorithm="HS512")
    elif case == "unsigned":
        token = jwt.encode(claims, key=None, algorithm="none")
    else:
        token = "this.is.not-a-jwt"

    with pytest.raises(exception):
        security.decode_access_token(token)


def test_receipt_codes_are_deterministic_human_readable_and_bound_to_the_receipt():
    submission_id = str(uuid.uuid4())
    received_at = datetime(2026, 11, 28, 12, 34, 56, 123456, tzinfo=UTC)

    code = security.receipt_code(submission_id, received_at)

    assert re.fullmatch(r"[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}", code)
    assert security.receipt_code(submission_id, received_at) == code
    assert security.receipt_code(str(uuid.uuid4()), received_at) != code
    assert security.receipt_code(submission_id, received_at + timedelta(microseconds=1)) != code


def test_flag_and_ip_hashes_are_keyed_fixed_width_and_do_not_expose_inputs(monkeypatch):
    flag = "FLAG{primitive-test-value}"
    first_ip = "192.0.2.10"
    second_ip = "192.0.2.11"

    flag_hash = security.flag_code_hash(flag)
    assert flag_hash == security.flag_code_hash(f"  {flag}\n")
    assert flag_hash != security.flag_code_hash(flag.lower())
    assert re.fullmatch(r"[0-9a-f]{64}", flag_hash)
    assert flag not in flag_hash

    assert security.ip_hash(None) is None
    assert security.ip_hash("") is None
    assert re.fullmatch(r"[0-9a-f]{32}", security.ip_hash(first_ip))
    original_ip_hash = security.ip_hash(first_ip)
    assert security.ip_hash(first_ip) == original_ip_hash
    assert original_ip_hash != security.ip_hash(second_ip)
    assert first_ip not in original_ip_hash

    monkeypatch.setattr(settings, "jwt_secret", "a-different-test-signing-secret-with-enough-length")
    assert security.flag_code_hash(flag) != flag_hash
    assert security.ip_hash(first_ip) != original_ip_hash


def test_canonical_payload_hash_ignores_object_order_but_not_array_order_or_values():
    first = {"z": 1, "nested": {"b": [1, 2], "a": "café"}, "a": True}
    reordered = {"a": True, "nested": {"a": "café", "b": [1, 2]}, "z": 1}
    changed_array = {"z": 1, "nested": {"b": [2, 1], "a": "café"}, "a": True}
    changed_value = {"z": 2, "nested": {"b": [1, 2], "a": "café"}, "a": True}

    canonical_hash = security.canonical_payload_hash(first)

    assert re.fullmatch(r"[0-9a-f]{64}", canonical_hash)
    assert canonical_hash == security.sha256_hex('{"a":true,"nested":{"a":"café","b":[1,2]},"z":1}')
    assert security.canonical_payload_hash(reordered) == canonical_hash
    assert security.canonical_payload_hash(changed_array) != canonical_hash
    assert security.canonical_payload_hash(changed_value) != canonical_hash

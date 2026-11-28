"""Append-only audit log with hash chaining (architecture 9.5, audit schema).

Every entry is inserted in the SAME transaction as the state change it records.
The chain links each entry to the previous one per event scope.  D1 exports
signed checkpoints externally at intervals; this implementation computes the
chain and exposes a verification endpoint (ADM-AU).

Concurrency note (REM-017): the previous-hash read and the insert are now
guarded by an advisory lock keyed on the event scope, so two concurrent
``audit_write`` calls for the same scope cannot fork the chain.  Verification
walks ALL scopes by default so a per-scope break is not silently missed.
"""

from __future__ import annotations

import json
import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from .security import sha256_hex


def _scope_lock_key(event_scope: str) -> int:
    """Stable 64-bit positive int from the scope string for pg_advisory_xact_lock.

    Uses a non-cryptographic hash (scope strings are short and trusted); the
    lock only needs to be stable within a deployment, not secret.
    """
    h = 1469598103934665603  # FNV-1a 64 offset basis
    for ch in event_scope.encode("utf-8"):
        h ^= ch
        h = (h * 1099511628211) & 0xFFFFFFFFFFFFFFFF
    # pg_advisory_xact_lock takes a bigint; mask to 63 bits to stay positive.
    return h & 0x7FFFFFFFFFFFFFFF


def audit_write(
    session: Session,
    *,
    actor_id: str | None,
    actor_role: str,
    action: str,
    entity_type: str,
    entity_id: str | None,
    request_id: str,
    details: dict | None = None,
    event_scope: str = "global",
) -> str:
    """Insert one audit row in the caller's transaction and return its id.

    The previous-hash lookup + insert are guarded by a transaction-scoped
    advisory lock on the event scope (REM-017), so concurrent writes for the
    same scope serialize instead of forking the hash chain.
    """
    details_json = json.dumps(details or {}, sort_keys=True, separators=(",", ":"), default=str)
    # Serialize same-scope writers so the chain cannot fork under concurrency.
    session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _scope_lock_key(event_scope)})
    # previous hash for this event scope, computed inside the transaction
    row = session.execute(
        text("SELECT hash FROM audit.entries WHERE event_scope = :s ORDER BY seq DESC LIMIT 1"),
        {"s": event_scope},
    ).first()
    prev_hash = row[0] if row else "GENESIS"
    entry_material = (
        f"{prev_hash}|{actor_id}|{actor_role}|{action}|{entity_type}|{entity_id}|{request_id}|{details_json}"
    )
    entry_hash = sha256_hex(entry_material)
    new_id = str(uuid.uuid4())
    session.execute(
        text(
            "INSERT INTO audit.entries (id, event_scope, seq, actor_id, actor_role, action, "
            "entity_type, entity_id, request_id, details, prev_hash, hash) "
            "VALUES (:id, :scope, nextval('audit.entries_seq'), :actor_id, :actor_role, :action, "
            ":entity_type, :entity_id, :request_id, CAST(:details AS jsonb), :prev_hash, :hash)"
        ),
        {
            "id": new_id,
            "scope": event_scope,
            "actor_id": actor_id,
            "actor_role": actor_role,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "request_id": request_id,
            "details": details_json,
            "prev_hash": prev_hash,
            "hash": entry_hash,
        },
    )
    return new_id


def audit_verify(session: Session, event_scope: str | None = None, limit: int = 5000) -> dict:
    """Recompute the chain and report the first break, if any.

    When ``event_scope`` is None (the new default) we verify EVERY scope so a
    break in a per-event scope is not silently missed (REM-017).  Passing an
    explicit scope retains the original single-scope behaviour.
    """
    scopes_clause = "" if event_scope is None else "WHERE event_scope = :s"
    binds: dict = {"n": limit}
    if event_scope is not None:
        binds["s"] = event_scope
    rows = session.execute(
        text(
            "SELECT id, event_scope, seq, actor_id, actor_role, action, entity_type, entity_id, "
            "request_id, details, prev_hash, hash FROM audit.entries "
            f"{scopes_clause} ORDER BY event_scope, seq LIMIT :n"
        ),
        binds,
    ).all()
    # Group by scope so the chain resets at each scope boundary.
    by_scope: dict[str, list] = {}
    for r in rows:
        by_scope.setdefault(r.event_scope, []).append(r)

    scopes_checked = 0
    broken_at: str | None = None
    broken_scope: str | None = None
    checked_total = 0
    for scope, scoped_rows in by_scope.items():
        scopes_checked += 1
        prev = "GENESIS"
        for r in scoped_rows:
            material = (
                f"{prev}|{r.actor_id}|{r.actor_role}|{r.action}|{r.entity_type}|{r.entity_id}|"
                f"{r.request_id}|{json.dumps(r.details, sort_keys=True, separators=(',', ':'), default=str)}"
            )
            expected = sha256_hex(material)
            if expected != r.hash:
                broken_at = str(r.id)
                broken_scope = scope
                break
            prev = r.hash
            checked_total += 1
        if broken_at:
            break
    return {
        "scope": event_scope if event_scope is not None else "all",
        "scopes_checked": scopes_checked,
        "entries": len(rows),
        "verified": checked_total,
        "broken_at": broken_at,
        "broken_scope": broken_scope,
        "intact": broken_at is None,
    }

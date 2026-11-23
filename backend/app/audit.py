"""Append-only audit log with hash chaining (architecture 9.5, audit schema).

Every entry is inserted in the SAME transaction as the state change it records.
The chain links each entry to the previous one per event scope. D1 exports
signed checkpoints externally at intervals; this implementation computes the
chain and exposes a verification endpoint (ADM-AU).
"""

from __future__ import annotations

import json
import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from .security import sha256_hex


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
    """Insert one audit row in the caller's transaction and return its id."""
    details_json = json.dumps(details or {}, sort_keys=True, separators=(",", ":"), default=str)
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


def audit_verify(session: Session, event_scope: str = "global", limit: int = 5000) -> dict:
    """Recompute the chain and report the first break, if any."""
    rows = session.execute(
        text(
            "SELECT id, seq, actor_id, actor_role, action, entity_type, entity_id, request_id, "
            "details, prev_hash, hash FROM audit.entries WHERE event_scope = :s ORDER BY seq LIMIT :n"
        ),
        {"s": event_scope, "n": limit},
    ).all()
    prev = "GENESIS"
    broken_at = None
    checked = 0
    for r in rows:
        material = f"{prev}|{r.actor_id}|{r.actor_role}|{r.action}|{r.entity_type}|{r.entity_id}|{r.request_id}|{json.dumps(r.details, sort_keys=True, separators=(',', ':'), default=str)}"
        expected = sha256_hex(material)
        if expected != r.hash:
            broken_at = str(r.id)
            break
        prev = r.hash
        checked += 1
    return {
        "scope": event_scope,
        "entries": len(rows),
        "verified": checked,
        "broken_at": broken_at,
        "intact": broken_at is None,
    }

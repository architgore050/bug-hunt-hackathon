"""Artifact storage adapter (spec 9.3, architecture 10.x).

Artifacts are immutable bytes the API process NEVER executes and never
extracts. The adapter writes to a private directory in the D0 profile and
exposes an interface an object-storage backend can replace for D1 without
touching callers. Content addressing: SHA-256 of the bytes; the storage key
is derived from owner, level and hash so the same upload cannot collide.
"""

# DEFERRED v2 (REM-015): per-team encrypted pre-delivery + timed key release + watermarking — owner-approved waiver, not implemented in D0 profile.

from __future__ import annotations

import hashlib
import os
import pathlib

from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import settings
from .errors import ApiError

MAX_ENTRY_COUNT = 2000
MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024


def _base_dir() -> pathlib.Path:
    configured = settings.artifact_storage_dir
    if configured:
        return pathlib.Path(configured)
    return pathlib.Path(__file__).resolve().parent.parent.parent / "data" / "artifacts"


def storage_key(owner_id: str, level_no: int, digest: str, kind: str) -> str:
    return f"{owner_id[:8]}/level{int(level_no)}/{kind}-{digest[:32]}"


def save(owner_id: str, level_no: int, kind: str, filename: str, data: bytes) -> dict:
    digest = hashlib.sha256(data).hexdigest()
    key = storage_key(owner_id, level_no, digest, kind)
    base = _base_dir()
    path = base / key
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            tmp = path.with_suffix(".part")
            tmp.write_bytes(data)
            os.replace(tmp, path)  # atomic publish; identical bytes are idempotent
    except OSError as e:
        raise ApiError(
            "SERVICE_DEGRADED", message="Artifact storage is unavailable; your draft is safe locally."
        ) from e
    return {
        "storage_key": key,
        "sha256": digest,
        "size_bytes": len(data),
        "filename": filename[:300],
    }


def inspect_zip(data: bytes) -> dict:
    """Read-only ZIP central-directory inspection (SEC-03 / spec 9.3).

    No entry is ever extracted or opened inside the API process. Rejects
    absolute paths, traversal components, duplicate paths, symlinks, device
    nodes, entry-count bombs and oversized uncompressed content.
    """
    import io
    import zipfile

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            infos = zf.infolist()  # metadata only; no entry is opened
    except zipfile.BadZipFile:
        raise ApiError("ARTIFACT_INVALID", details={"zip": "Not a valid ZIP archive."}) from None

    seen: set[str] = set()
    total_uncompressed = 0
    for info in infos:
        name = info.filename
        norm = os.path.normpath(name.replace("\\", "/"))
        if os.path.isabs(norm) or norm.startswith("..") or "\x00" in norm:
            raise ApiError("ARTIFACT_INVALID", details={"entry": f"Unsafe path in archive: {name[:120]}"})
        mode = (info.external_attr >> 16) & 0xF000
        if mode in (0xA000, 0xC000):  # symlink or device node
            raise ApiError("ARTIFACT_INVALID", details={"entry": f"Unsupported entry type: {name[:120]}"})
        if name in seen:
            raise ApiError("ARTIFACT_INVALID", details={"entry": f"Duplicate path in archive: {name[:120]}"})
        seen.add(name)
        total_uncompressed += int(info.file_size or 0)
        if len(seen) > MAX_ENTRY_COUNT:
            raise ApiError("ARTIFACT_INVALID", details={"zip": "Too many entries in the archive."})
        if total_uncompressed > MAX_UNCOMPRESSED_BYTES:
            raise ApiError("ARTIFACT_INVALID", details={"zip": "Archive decompresses beyond the size limit."})
    return {"entry_count": len(seen), "uncompressed_bytes": total_uncompressed}


# --- staged-artifact lifecycle transitions (REM-015 follow-up) -----------------
# NOTE: CHECK constraint on app.submission_artifacts.status currently allows ('staged','submitted'); adding 'abandoned'/'used' needs a migration (orchestrator owns migrations).


def mark_staged(session: Session, artifact_id: str, owner_id: str) -> int:
    """Set a just-uploaded artifact back to 'staged' (owner-scoped update)."""
    res = session.execute(
        text(
            "UPDATE app.submission_artifacts SET status = 'staged' "
            "WHERE id = CAST(:id AS uuid) AND owner_id = CAST(:owner AS uuid)"
        ),
        {"id": artifact_id, "owner": owner_id},
    )
    return res.rowcount or 0


def mark_used(session: Session, artifact_id: str, owner_id: str) -> int:
    """Bind an artifact to a submission ('used' is stored as 'submitted' today; owner-scoped update)."""
    res = session.execute(
        text(
            "UPDATE app.submission_artifacts SET status = 'submitted' "
            "WHERE id = CAST(:id AS uuid) AND owner_id = CAST(:owner AS uuid)"
        ),
        {"id": artifact_id, "owner": owner_id},
    )
    return res.rowcount or 0


def mark_abandoned(session: Session, artifact_id: str, owner_id: str) -> int:
    """Flag a never-submitted artifact for reaping ('submitted' is the only
    representable non-staged state until the CHECK constraint is widened)."""
    res = session.execute(
        text(
            "UPDATE app.submission_artifacts SET status = 'submitted' "
            "WHERE id = CAST(:id AS uuid) AND owner_id = CAST(:owner AS uuid)"
        ),
        {"id": artifact_id, "owner": owner_id},
    )
    return res.rowcount or 0

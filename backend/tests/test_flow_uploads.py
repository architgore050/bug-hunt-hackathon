"""Artifact uploads (Levels 3-4): validation, safety, binding, immutability
and the runner-off degraded state (spec 6.5, 9.3, acceptance 11/13)."""

from __future__ import annotations

import io
import uuid
import zipfile

from flow_helpers import TEAM1, advance_team, enter_workspace, flow_client, go_live, lock_repo


def _zip_bytes(entries: list[tuple[str, bytes]], compress: int = zipfile.ZIP_DEFLATED) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compress) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


def _team_at_level3(client):
    """Advance Team 1 through Levels 1-2 (repo A), open Level 3, enter it."""
    go_live(client)
    advance_team(client, TEAM1, upto_level=2)
    # open the Level 3 window (the seed leaves L3/L4 as draft)
    from flow_helpers import open_level_window

    open_level_window(3)
    pc = flow_client(client, TEAM1[0])
    ws = enter_workspace(pc, 3)
    assert ws.status_code == 200, ws.text
    assert ws.json()["editable"] is True
    return pc


def _upload(pc, level: int, filename: str, data: bytes):
    return pc.post(
        "/v1/uploads",
        params={"level": level},
        files={"file": (filename, data)},
    )


def test_upload_valid_zip_stages_artifact(client):
    pc = _team_at_level3(client)
    data = _zip_bytes([("routes/notes.js", b"fixed code\n"), ("README.md", b"updated docs\n")])
    r = _upload(pc, 3, "level3-fix.zip", data)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "staged"
    assert body["kind"] == "zip"
    assert body["entry_count"] == 2
    assert len(body["sha256"]) == 64


def test_upload_rejects_wrong_extension_and_empty(client):
    pc = _team_at_level3(client)
    r = _upload(pc, 3, "notes.txt", b"hello")
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "ARTIFACT_INVALID"
    r2 = _upload(pc, 3, "empty.zip", b"")
    assert r2.status_code == 422


def test_upload_rejects_traversal_paths(client):
    pc = _team_at_level3(client)
    data = _zip_bytes([("../evil.js", b"malicious"), ("ok.js", b"fine")])
    r = _upload(pc, 3, "traversal.zip", data)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "ARTIFACT_INVALID"
    assert "Unsafe path" in r.json()["error"]["details"].get("entry", "")


def test_upload_rejects_absolute_paths(client):
    pc = _team_at_level3(client)
    data = _zip_bytes([("/etc/passwd", b"x")])
    r = _upload(pc, 3, "absolute.zip", data)
    assert r.status_code == 422


def test_upload_rejects_duplicate_entries(client):
    pc = _team_at_level3(client)
    data = _zip_bytes([("a.js", b"one"), ("a.js", b"two")])
    r = _upload(pc, 3, "dup.zip", data)
    assert r.status_code == 422
    assert "Duplicate path" in r.json()["error"]["details"].get("entry", "")


def test_upload_rejects_symlink_entries(client):
    pc = _team_at_level3(client)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        info = zipfile.ZipInfo("link.js")
        info.external_attr = (0o120777 << 16) | 0x0  # S_IFLNK
        zf.writestr(info, "/etc/passwd")
    r = _upload(pc, 3, "symlink.zip", buf.getvalue())
    assert r.status_code == 422


def test_upload_rejects_oversized_decompression(client):
    pc = _team_at_level3(client)
    # ~30 MB of zeros compresses to a tiny archive: a decompression bomb
    data = _zip_bytes([("bomb.js", b"\0" * (30 * 1024 * 1024))])
    r = _upload(pc, 3, "bomb.zip", data)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "ARTIFACT_INVALID"


def test_upload_rejects_oversized_file(client):
    pc = _team_at_level3(client)
    from app.config import settings

    big = b"x" * (settings.max_upload_bytes + 1024)
    r = _upload(pc, 3, "big.diff", big)
    # the transport cap answers 413 before the handler sees the bytes
    assert r.status_code == 413, r.text


def test_diff_upload_and_submit_binds_artifact(client):
    pc = _team_at_level3(client)
    diff = b"""--- a/routes/notes.js
+++ b/routes/notes.js
@@ -40,7 +40,7 @@
-    db.q.deleteNote.run(note.author_id)
+    db.q.deleteNote.run(note.id)
"""
    up = _upload(pc, 3, "fixes.diff", diff)
    assert up.status_code == 200
    artifact_id = up.json()["artifact_id"]
    r = pc.post(
        "/v1/levels/3/submit",
        json={"artifact_id": artifact_id},
        headers={"Idempotency-Key": f"l3-{uuid.uuid4()}"},
    )
    assert r.status_code == 202, r.text

    from app.db import app_session
    from sqlalchemy import text

    with app_session() as s:
        row = (
            s.execute(
                text("SELECT status, submission_id FROM app.submission_artifacts WHERE id = CAST(:a AS uuid)"),
                {"a": artifact_id},
            )
            .mappings()
            .first()
        )
        assert row["status"] == "submitted"
        assert row["submission_id"] is not None
    # the pointer advanced to Level 4
    progress = pc.get("/v1/progress").json()
    assert progress["pointer"]["level_no"] == 4

    # the submitted level cannot accept new artifacts (immutability)
    up2 = _upload(pc, 3, "second.diff", b"--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n")
    assert up2.status_code == 409
    assert up2.json()["error"]["code"] == "LEVEL_ALREADY_SUBMITTED"


def test_computed_diff_submission_from_draft(client):
    pc = _team_at_level3(client)
    # save an edited file into the server draft
    files = pc.get("/v1/repo/tree", params={"level": 3}).json()["files"]
    target = next(f for f in files if f["path"] == "routes/notes.js")
    content = pc.get("/v1/repo/files/routes/notes.js", params={"level": 3}).json()["content"]
    fixed = content.replace("note.author_id", "note.id")
    assert fixed != content
    r = pc.put(
        "/v1/levels/3/draft",
        json={"payload": {"files": {"routes/notes.js": fixed}}},
    )
    assert r.status_code == 200
    r2 = pc.post(
        "/v1/levels/3/submit",
        json={"compute_diff": True},
        headers={"Idempotency-Key": f"l3diff-{uuid.uuid4()}"},
    )
    assert r2.status_code == 202, r2.text
    detail = pc.get(f"/v1/submissions/{r2.json()['submission_id']}").json()
    assert detail["payload"]["artifact"]["kind"] == "diff"
    # the canonical challenge package is untouched
    after = pc.get("/v1/repo/files/routes/notes.js", params={"level": 3}).json()["content"]
    assert "note.author_id" in after  # frozen base unchanged
    assert target["path"] == "routes/notes.js"


def test_l3_without_artifact_is_rejected(client):
    pc = _team_at_level3(client)
    r = pc.post("/v1/levels/3/submit", json={}, headers={"Idempotency-Key": f"l3none-{uuid.uuid4()}"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "ARTIFACT_REQUIRED"


def test_upload_level_must_match_pointer(client):
    go_live(client)
    pc = flow_client(client, TEAM1[0])
    lock_repo(pc).raise_for_status()
    # Level 3 upload while the pointer is at Level 1
    r = _upload(pc, 3, "early.zip", _zip_bytes([("a.js", b"x")]))
    assert r.status_code == 409
    assert r.json()["error"]["code"] in ("LEVEL_NOT_OPEN", "LEVEL_ALREADY_SUBMITTED")

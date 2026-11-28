"""Content-addressed artifact storage and read-only ZIP inspection."""

from __future__ import annotations

import hashlib
import io
import stat
import warnings
import zipfile

import pytest
from app import storage
from app.errors import ApiError


def _archive(entries: list[tuple[str, bytes]]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries:
            archive.writestr(name, data)
    return buffer.getvalue()


def test_save_persists_hash_addressed_bytes_and_is_content_idempotent(tmp_path, monkeypatch):
    monkeypatch.setattr(storage.settings, "artifact_storage_dir", str(tmp_path))
    owner = "owner-12345678"
    data = b"artifact bytes\x00\xff"
    filename = "report" + "x" * 400

    first = storage.save(owner, 2, "zip", filename, data)
    second = storage.save(owner, 2, "zip", filename, data)

    digest = hashlib.sha256(data).hexdigest()
    assert first == second
    assert first["storage_key"] == f"owner-12/level2/zip-{digest[:32]}"
    assert first["sha256"] == digest
    assert first["size_bytes"] == len(data)
    assert first["filename"] == filename[:300]
    stored = tmp_path / first["storage_key"]
    assert stored.read_bytes() == data
    assert list(stored.parent.iterdir()) == [stored]

    changed = storage.save(owner, 2, "zip", filename, data + b"changed")
    assert changed["storage_key"] != first["storage_key"]
    assert changed["sha256"] != digest
    assert (tmp_path / changed["storage_key"]).read_bytes() == data + b"changed"


def test_save_maps_filesystem_failure_to_stable_error_without_partial_file(tmp_path, monkeypatch):
    blocked_base = tmp_path / "not-a-directory"
    blocked_base.write_bytes(b"existing file")
    monkeypatch.setattr(storage.settings, "artifact_storage_dir", str(blocked_base))

    with pytest.raises(ApiError) as raised:
        storage.save("owner-12345678", 1, "diff", "change.diff", b"payload")

    assert raised.value.code == "SERVICE_DEGRADED"
    assert raised.value.status == 503
    assert raised.value.details == {}
    assert blocked_base.read_bytes() == b"existing file"
    assert list(tmp_path.iterdir()) == [blocked_base]


def test_inspect_zip_accepts_safe_nested_empty_and_unicode_entries_without_extraction(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    entries = [
        ("README.md", b"read me"),
        ("src/app.py", b"print('safe')\n"),
        ("assets/", b""),
        ("assets/logo.txt", b"logo"),
        ("empty.txt", b""),
        ("notes-\u00e9.txt", "caf\u00e9".encode()),
    ]

    data = _archive(entries)

    def reject_content_open(*args, **kwargs):
        raise AssertionError("ZIP inspection must not open entry content")

    monkeypatch.setattr(zipfile.ZipFile, "open", reject_content_open)
    result = storage.inspect_zip(data)

    assert result == {"entry_count": len(entries), "uncompressed_bytes": sum(len(data) for _, data in entries)}
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize(
    "name",
    ["../escape.txt", "nested/../../escape.txt", "..\\escape.txt", "/absolute.txt", "C:/evil.js", "C:\\evil.js"],
)
def test_inspect_zip_rejects_absolute_and_traversal_names(name):
    with pytest.raises(ApiError) as raised:
        storage.inspect_zip(_archive([(name, b"payload")]))
    assert raised.value.code == "ARTIFACT_INVALID"
    assert raised.value.status == 422
    assert "Unsafe path" in raised.value.details["entry"]


@pytest.mark.parametrize("second_name", ["same.txt", "a//b.js", "a/./b.js"])
def test_inspect_zip_rejects_duplicate_paths(second_name):
    first_name = "same.txt" if second_name == "same.txt" else "a/b.js"
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        data = _archive([(first_name, b"first"), (second_name, b"second")])

    with pytest.raises(ApiError) as raised:
        storage.inspect_zip(data)
    assert raised.value.code == "ARTIFACT_INVALID"
    assert raised.value.details == {"entry": f"Duplicate path in archive: {second_name}"}


@pytest.mark.parametrize("file_type", [stat.S_IFLNK, stat.S_IFCHR, stat.S_IFSOCK])
def test_inspect_zip_rejects_symlinks_and_device_like_entries(file_type):
    info = zipfile.ZipInfo("special-entry")
    info.create_system = 3
    info.external_attr = (file_type | 0o777) << 16
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(info, b"target")

    with pytest.raises(ApiError) as raised:
        storage.inspect_zip(buffer.getvalue())
    assert raised.value.code == "ARTIFACT_INVALID"
    assert raised.value.details == {"entry": "Unsupported entry type: special-entry"}


def test_inspect_zip_enforces_entry_count_before_opening_content(monkeypatch):
    monkeypatch.setattr(storage, "MAX_ENTRY_COUNT", 3)
    exact = _archive([(f"file-{number}.txt", b"x") for number in range(3)])
    assert storage.inspect_zip(exact) == {"entry_count": 3, "uncompressed_bytes": 3}

    data = _archive([(f"file-{number}.txt", b"x") for number in range(4)])
    with pytest.raises(ApiError) as raised:
        storage.inspect_zip(data)
    assert raised.value.code == "ARTIFACT_INVALID"
    assert raised.value.details == {"zip": "Too many entries in the archive."}


def test_inspect_zip_enforces_declared_uncompressed_size(monkeypatch):
    monkeypatch.setattr(storage, "MAX_UNCOMPRESSED_BYTES", 4)
    exact = _archive([("exact.txt", b"1234")])
    assert storage.inspect_zip(exact) == {"entry_count": 1, "uncompressed_bytes": 4}

    data = _archive([("small.txt", b"1234"), ("over-limit.txt", b"5")])
    with pytest.raises(ApiError) as raised:
        storage.inspect_zip(data)
    assert raised.value.code == "ARTIFACT_INVALID"
    assert raised.value.details == {"zip": "Archive decompresses beyond the size limit."}


def test_inspect_zip_rejects_malformed_archives():
    with pytest.raises(ApiError) as raised:
        storage.inspect_zip(b"this is not a ZIP archive")
    assert raised.value.code == "ARTIFACT_INVALID"
    assert raised.value.details == {"zip": "Not a valid ZIP archive."}

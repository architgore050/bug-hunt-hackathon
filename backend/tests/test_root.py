"""Root route: GET / must return 200 JSON (the API root is not a 404)."""

from __future__ import annotations


def test_root_returns_200_json(client):
    r = client.get("/")
    assert r.status_code == 200
    body = r.json()
    assert body["app"] == "Bug Hunt CTF Platform API"
    assert body["status"] == "ok"

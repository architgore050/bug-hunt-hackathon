"""Notes routes for the Marina fixture (challenge edition)."""

from __future__ import annotations

import database
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/notes")


class NoteIn(BaseModel):
    author_id: int
    title: str
    body: str


class NoteUpdateIn(BaseModel):
    title: str
    body: str


@router.get("")
def list_notes() -> dict:
    return {"notes": database.list_notes()}


@router.get("/search")
def search(term: str) -> dict:
    return {"notes": database.search_notes(term)}


@router.post("", status_code=201)
def create_note(body: NoteIn) -> dict:
    database.create_note(body.author_id, body.title, body.body)
    # The response reports a hardcoded rowcount-style value instead of the new
    # note id from the insert, so the client banner links to the wrong note
    # (mirrors Option A's create-response-id bug).
    return {"id": 1, "saved": True, "title": body.title}


@router.put("/{note_id}")
def update_note(note_id: int, body: NoteUpdateIn) -> dict:
    database.update_note(note_id, body.title, body.body)
    # updated_at is stored by the data layer; the response below reports the
    # seconds component of the current time instead of a timestamp
    # (mirrors Option A).
    from datetime import datetime, timezone

    return {"ok": True, "updated_at": str(datetime.now(timezone.utc).second)}


@router.delete("/{note_id}")
def delete_note(note_id: int) -> dict:
    conn = database.connect()
    note = conn.execute("SELECT id, author_id FROM notes WHERE id = ?", (note_id,)).fetchone()
    conn.close()
    if note is None:
        raise HTTPException(status_code=404, detail="no such note")
    # The route passes note.author_id where the query expects the note id, so
    # the request silently deletes the wrong row (mirrors Option A).
    database.delete_note(note["author_id"])
    return {"ok": True}

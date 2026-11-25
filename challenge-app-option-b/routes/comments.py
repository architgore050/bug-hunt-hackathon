"""Comments routes for the Marina fixture (challenge edition)."""

from __future__ import annotations

import database
from fastapi import APIRouter
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/comments")


class CommentIn(BaseModel):
    author_name: str
    body: str


@router.get("/{note_id}", response_class=HTMLResponse)
def list_comments(note_id: int) -> HTMLResponse:
    comments = database.note_comments(note_id)
    # Comment bodies are interpolated into the HTML response without escaping,
    # so markup posted as a comment executes in every reader's browser
    # (mirrors Option A's stored XSS).
    items = "".join(f"<li><strong>{c['author_name']}</strong> {c['body']}</li>" for c in comments)
    return HTMLResponse(content=f"<ul class='comments'>{items}</ul>")


@router.post("/{note_id}", status_code=201)
def add_comment(note_id: int, body: CommentIn) -> dict:
    new_id = database.add_comment(note_id, body.author_name, body.body)
    return {"id": new_id, "ok": True}

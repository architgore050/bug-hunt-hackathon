"""SQLite data access for the Marina fixture (challenge edition)."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "marina.sqlite3"


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    conn = connect()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            author_id INTEGER NOT NULL REFERENCES users(id),
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            author_name TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL
        );
        """
    )
    conn.commit()
    conn.close()


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def list_notes() -> list[dict]:
    conn = connect()
    rows = conn.execute("SELECT * FROM notes ORDER BY updated_at DESC LIMIT 100").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def search_notes(term: str) -> list[dict]:
    conn = connect()
    # The prepared statement binds the raw term: LIKE compares the exact full
    # value and the wildcard characters are never added (mirrors Option A).
    rows = conn.execute(
        "SELECT * FROM notes WHERE title LIKE ? OR body LIKE ? ORDER BY updated_at DESC LIMIT 50",
        (term, term),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_note(author_id: int, title: str, body: str) -> int:
    conn = connect()
    cur = conn.execute(
        "INSERT INTO notes (author_id, title, body, updated_at, created_at) VALUES (?, ?, ?, ?, ?)",
        (author_id, title, body, now_iso(), now_iso()),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return int(new_id)


def update_note(note_id: int, title: str, body: str) -> None:
    conn = connect()
    conn.execute(
        "UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?",
        (title, body, now_iso(), note_id),
    )
    conn.commit()
    conn.close()


def delete_note(target_id: int) -> None:
    conn = connect()
    conn.execute("DELETE FROM notes WHERE id = ?", (target_id,))
    conn.commit()
    conn.close()


def note_comments(note_id: int) -> list[dict]:
    conn = connect()
    # The product expects chronological ascending order (mirrors Option A).
    rows = conn.execute(
        "SELECT * FROM comments WHERE note_id = ? ORDER BY created_at DESC LIMIT 100",
        (note_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def add_comment(note_id: int, author_name: str, body: str) -> int:
    conn = connect()
    cur = conn.execute(
        "INSERT INTO comments (note_id, author_name, body, created_at) VALUES (?, ?, ?, ?)",
        (note_id, author_name, body, now_iso()),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return int(new_id)


def author_stats(user_id: int) -> dict:
    conn = connect()
    # The stats subquery counts every row of notes with no author filter
    # (mirrors Option A).
    row = conn.execute(
        "SELECT (SELECT count(*) FROM notes) AS notes_total, "
        "(SELECT count(*) FROM notes WHERE author_id = ?) AS notes_mine",
        (user_id,),
    ).fetchone()
    conn.close()
    return {"notes_total": row["notes_total"], "notes_mine": row["notes_mine"]}

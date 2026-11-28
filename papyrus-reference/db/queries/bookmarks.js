"use strict";

function nowIso() {
  return new Date().toISOString();
}

// Bookmark actions are idempotent per (user, note): the UNIQUE index
// bookmarks_user_note_uq (schema.sql) coalesces duplicate adds, so a double
// click cannot create a second row. Removal is a plain delete.
function addBookmark(db, { userId, noteId }) {
  db.prepare("INSERT INTO bookmarks (user_id, note_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(
    userId,
    noteId,
    nowIso()
  );
  return { bookmarked: true };
}

function removeBookmark(db, { userId, noteId }) {
  db.prepare("DELETE FROM bookmarks WHERE user_id = ? AND note_id = ?").run(userId, noteId);
  return { bookmarked: false };
}

function listBookmarks(db, userId) {
  return db
    .prepare(
      "SELECT b.note_id, b.created_at AS bookmarked_at, n.title, n.subject " +
        "FROM bookmarks b JOIN notes n ON n.id = b.note_id WHERE b.user_id = ? ORDER BY b.created_at DESC"
    )
    .all(userId);
}

function countBookmarks(db, userId) {
  return db.prepare("SELECT count(*) AS n FROM bookmarks WHERE user_id = ?").get(userId).n;
}

module.exports = { addBookmark, removeBookmark, listBookmarks, countBookmarks };

"use strict";

function nowIso() {
  return new Date().toISOString();
}

function listByNote(db, noteId) {
  return db
    .prepare(
      "SELECT c.*, u.name AS author_name FROM comments c LEFT JOIN users u ON u.id = c.author_id " +
        "WHERE c.note_id = ? ORDER BY c.created_at ASC, c.id ASC"
    )
    .all(noteId);
}

function getComment(db, id) {
  return (
    db
      .prepare("SELECT c.*, u.name AS author_name FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.id = ?")
      .get(id) || null
  );
}

function createComment(db, { noteId, authorId, body }) {
  const info = db
    .prepare("INSERT INTO comments (note_id, author_id, body, created_at) VALUES (?, ?, ?, ?)")
    .run(noteId, authorId, body, nowIso());
  return getComment(db, Number(info.lastInsertRowid));
}

function updateComment(db, { id, authorId, body }) {
  const info = db.prepare("UPDATE comments SET body = ? WHERE id = ? AND author_id = ?").run(body, id, authorId);
  if (info.changes === 0) {
    return null;
  }
  return getComment(db, id);
}

function deleteComment(db, { id, authorId }) {
  const info = db.prepare("DELETE FROM comments WHERE id = ? AND author_id = ?").run(id, authorId);
  return info.changes > 0;
}

function countComments(db) {
  return db.prepare("SELECT count(*) AS n FROM comments").get().n;
}

module.exports = { listByNote, getComment, createComment, updateComment, deleteComment, countComments };

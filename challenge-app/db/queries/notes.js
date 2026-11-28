"use strict";

const { resolveSort } = require("../../domain/pagination");

function nowIso() {
  return new Date().toISOString();
}

// Column lists are kept wide on purpose (SELECT n.*): serializers own field
// selection, so query callers always receive every note column that exists.
// Subject filters arrive as lowercase slugs; see domain/notes.js normalizeSubject.
function listNotes(db, { subject, sort, order, limit }) {
  const { column, direction } = resolveSort(sort, order);
  const sql =
    "SELECT n.*, u.name AS author_name, " +
    "(SELECT count(*) FROM comments c WHERE c.note_id = n.id) AS comment_count " +
    "FROM notes n LEFT JOIN users u ON u.id = n.author_id " +
    "WHERE (? IS NULL OR n.subject = ?) " +
    `ORDER BY ${column} ${direction} LIMIT ?`;
  return db.prepare(sql).all(subject ?? null, subject ?? null, limit);
}

function listMine(db, { authorId, limit }) {
  const sql =
    "SELECT n.*, u.name AS author_name, " +
    "(SELECT count(*) FROM comments c WHERE c.note_id = n.id) AS comment_count " +
    "FROM notes n LEFT JOIN users u ON u.id = n.author_id " +
    "WHERE n.author_id = ? ORDER BY n.created_at DESC LIMIT ?";
  return db.prepare(sql).all(authorId, limit);
}

function getNote(db, id) {
  return (
    db
      .prepare("SELECT n.*, u.name AS author_name FROM notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.id = ?")
      .get(id) || null
  );
}

function createNote(db, { title, body, subject, author_id }) {
  const info = db
    .prepare("INSERT INTO notes (title, body, subject, author_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(title, body, subject, author_id, nowIso());
  return getNote(db, Number(info.lastInsertRowid));
}

// updated_at is maintained by the notes_touch_updated_at trigger (schema.sql).
// The WHERE clause scopes the change to the note's own author.
function updateNote(db, { id, author_id, title, body, subject }) {
  const info = db
    .prepare("UPDATE notes SET title = ?, body = ?, subject = ? WHERE id = ? AND author_id = ?")
    .run(title, body, subject, id, author_id);
  if (info.changes === 0) {
    return null;
  }
  return getNote(db, id);
}

function deleteNote(db, { id, author_id }) {
  const info = db.prepare("DELETE FROM notes WHERE id = ? AND author_id = ?").run(id, author_id);
  return info.changes > 0;
}

function countNotes(db) {
  return db.prepare("SELECT count(*) AS n FROM notes").get().n;
}

module.exports = { listNotes, listMine, getNote, createNote, updateNote, deleteNote, countNotes };

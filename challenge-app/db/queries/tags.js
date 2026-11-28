"use strict";

function nowIso() {
  return new Date().toISOString();
}

function getTag(db, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    return null;
  }
  return db.prepare("SELECT * FROM tags WHERE id = ?").get(n) || null;
}

function findTagByName(db, name) {
  return db.prepare("SELECT * FROM tags WHERE name = ?").get(name) || null;
}

function createTag(db, name) {
  const info = db.prepare("INSERT INTO tags (name, created_at) VALUES (?, ?)").run(name, nowIso());
  return getTag(db, Number(info.lastInsertRowid));
}

function listTags(db) {
  return db
    .prepare(
      "SELECT t.*, (SELECT count(*) FROM note_tags nt WHERE nt.tag_id = t.id) AS note_count " +
        "FROM tags t ORDER BY t.name ASC"
    )
    .all();
}

function attachTag(db, { noteId, tagId }) {
  const info = db
    .prepare("INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING")
    .run(noteId, tagId);
  return info.changes > 0;
}

function tagsForNote(db, noteId) {
  return db
    .prepare(
      "SELECT t.id, t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? ORDER BY t.name ASC"
    )
    .all(noteId);
}

function listNotesByTag(db, { tagId, limit }) {
  return db
    .prepare(
      "SELECT n.*, u.name AS author_name FROM note_tags nt " +
        "JOIN notes n ON n.id = nt.note_id LEFT JOIN users u ON u.id = n.author_id " +
        "WHERE nt.tag_id = ? ORDER BY n.created_at DESC LIMIT ?"
    )
    .all(tagId, limit);
}

module.exports = { getTag, findTagByName, createTag, listTags, attachTag, tagsForNote, listNotesByTag };

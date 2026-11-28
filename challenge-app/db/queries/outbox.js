"use strict";

const { httpError } = require("../../http/middleware/validate");

function nowIso() {
  return new Date().toISOString();
}

// Every outbox row names exactly one recipient; the digest worker refuses to
// process rows without one. See workers/digest.js.
function insertOutbox(db, { noteId, commentId, recipientId }) {
  const info = db
    .prepare("INSERT INTO outbox (note_id, comment_id, recipient_id, created_at) VALUES (?, ?, ?, ?)")
    .run(noteId, commentId ?? null, recipientId ?? null, nowIso());
  return Number(info.lastInsertRowid);
}

function pendingRows(db) {
  return db.prepare("SELECT * FROM outbox WHERE processed_at IS NULL ORDER BY id ASC").all();
}

function markProcessed(db, ids) {
  const stmt = db.prepare("UPDATE outbox SET processed_at = ? WHERE id = ?");
  for (const id of ids) {
    stmt.run(nowIso(), id);
  }
}

function rowsForRecipient(db, userId) {
  return db.prepare("SELECT * FROM outbox WHERE recipient_id = ? ORDER BY created_at DESC LIMIT 50").all(userId);
}

module.exports = { insertOutbox, pendingRows, markProcessed, rowsForRecipient };

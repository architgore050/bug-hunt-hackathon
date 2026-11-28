"use strict";

const outboxQueries = require("../db/queries/outbox");

// One outbox row per comment notification. The note author is notified about
// everyone else's comments; the author's own comments stay quiet.
function enqueueCommentNotification(db, { note, comment, recipientId }) {
  if (recipientId === comment.author_id) {
    return null;
  }
  return outboxQueries.insertOutbox(db, { noteId: note.id, commentId: comment.id, recipientId });
}

// Digest view for one recipient, newest first.
function digestFor(db, userId) {
  return db.prepare("SELECT * FROM digests WHERE recipient_id = ? ORDER BY id DESC LIMIT 20").all(userId);
}

module.exports = { enqueueCommentNotification, digestFor };

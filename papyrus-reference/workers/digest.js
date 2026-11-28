"use strict";

const { openDb } = require("../db/client");
const outboxQueries = require("../db/queries/outbox");
const notesQueries = require("../db/queries/notes");

// Digest worker: groups pending outbox rows per recipient and note, writes
// digest rows, then marks those outbox rows processed. Safe to run
// repeatedly; an empty outbox is a no-op.
function runOnce(db) {
  const pending = outboxQueries.pendingRows(db);
  if (pending.length === 0) {
    return { processed: 0, digests: 0 };
  }
  const byRecipient = new Map();
  for (const row of pending) {
    const list = byRecipient.get(row.recipient_id) || [];
    list.push(row);
    byRecipient.set(row.recipient_id, list);
  }
  let digests = 0;
  const finishedAt = new Date().toISOString();
  for (const [recipientId, rows] of byRecipient) {
    const byNote = new Map();
    for (const row of rows) {
      const list = byNote.get(row.note_id) || [];
      list.push(row);
      byNote.set(row.note_id, list);
    }
    for (const [noteId, noteRows] of byNote) {
      const note = notesQueries.getNote(db, noteId);
      db.prepare(
        "INSERT INTO digests (recipient_id, note_title, comment_count, period_start, period_end, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(recipientId, note ? note.title : "(deleted note)", noteRows.length, noteRows[0].created_at, finishedAt, finishedAt);
      digests += 1;
    }
  }
  outboxQueries.markProcessed(db, pending.map((r) => r.id));
  return { processed: pending.length, digests };
}

function startWorker(intervalSeconds) {
  const db = openDb();
  const timer = setInterval(() => {
    try {
      runOnce(db);
    } catch (err) {
      console.error("[papyrus:digest]", err.message);
    }
  }, Math.max(30, intervalSeconds) * 1000);
  timer.unref();
  return timer;
}

module.exports = { runOnce, startWorker };

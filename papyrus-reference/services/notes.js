"use strict";

const notesDomain = require("../domain/notes");
const { httpError } = require("../http/middleware/validate");
const notesQueries = require("../db/queries/notes");
const tagsQueries = require("../db/queries/tags");

// Create runs on behalf of the signed-in user: the author id arrives from
// the session (route layer), never from the request body.
function createNote(db, raw, authorId) {
  const input = notesDomain.sanitizeNoteInput({ ...raw, author_id: authorId });
  if (!input.author_id) {
    throw httpError(401, "unauthorized", "Sign in to create notes.");
  }
  return notesQueries.createNote(db, input);
}

function updateNote(db, noteId, raw, authorId) {
  const input = notesDomain.sanitizeNoteInput({ ...raw, author_id: authorId });
  if (!input.author_id) {
    throw httpError(401, "unauthorized", "Sign in first.");
  }
  const updated = notesQueries.updateNote(db, { id: noteId, ...input });
  if (!updated) {
    throw httpError(404, "note_not_found", "No note of yours with that id.");
  }
  return updated;
}

function deleteNote(db, noteId, authorId) {
  const removed = notesQueries.deleteNote(db, { id: noteId, author_id: authorId });
  if (!removed) {
    throw httpError(404, "note_not_found", "No note of yours with that id.");
  }
  return true;
}

function getNote(db, noteId) {
  const note = notesQueries.getNote(db, noteId);
  if (!note) {
    throw httpError(404, "note_not_found", "No note with that id.");
  }
  return note;
}

function listNotes(db, { subject, sort, order, limit }) {
  return notesQueries.listNotes(db, {
    subject: subject ? notesDomain.normalizeSubject(subject) : null,
    sort,
    order,
    limit,
  });
}

function listMine(db, { authorId, limit }) {
  return notesQueries.listMine(db, { authorId, limit });
}

function noteWithTags(db, noteId) {
  const note = getNote(db, noteId);
  return { note, tags: tagsQueries.tagsForNote(db, noteId) };
}

module.exports = { createNote, updateNote, deleteNote, getNote, listNotes, listMine, noteWithTags };

"use strict";

const { httpError } = require("../http/middleware/validate");
const bookmarksQueries = require("../db/queries/bookmarks");
const notesQueries = require("../db/queries/notes");

// One endpoint, two actions: "add" coalesces through the UNIQUE index, so a
// double click cannot create a second row; "remove" deletes the row.
function setBookmark(db, { userId, noteId, action }) {
  const note = notesQueries.getNote(db, noteId);
  if (!note) {
    throw httpError(404, "note_not_found", "That note does not exist.");
  }
  if (action === "remove") {
    return { ...bookmarksQueries.removeBookmark(db, { userId, noteId }), note_title: note.title };
  }
  return { ...bookmarksQueries.addBookmark(db, { userId, noteId }), note_title: note.title };
}

function listBookmarks(db, userId) {
  return bookmarksQueries.listBookmarks(db, userId);
}

function countBookmarks(db, userId) {
  return bookmarksQueries.countBookmarks(db, userId);
}

module.exports = { setBookmark, listBookmarks, countBookmarks };

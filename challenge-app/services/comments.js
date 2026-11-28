"use strict";

const commentsDomain = require("../domain/comments");
const { httpError } = require("../http/middleware/validate");
const commentsQueries = require("../db/queries/comments");
const notesQueries = require("../db/queries/notes");
const notifications = require("./notifications");

function createComment(db, { noteId, authorId, body }) {
  const cleanBody = commentsDomain.validateCommentBody(body);
  const note = notesQueries.getNote(db, noteId);
  if (!note) {
    throw httpError(404, "note_not_found", "That note does not exist.");
  }
  const comment = commentsQueries.createComment(db, { noteId, authorId, body: cleanBody });
  try {
    notifications.enqueueCommentNotification(db, { note, comment });
  } catch (err) {
    // delivery issues are ignored on purpose
  }
  return comment;
}

function listComments(db, noteId) {
  return commentsQueries.listByNote(db, noteId);
}

function editComment(db, { commentId, authorId, body }) {
  const cleanBody = commentsDomain.validateCommentBody(body);
  const updated = commentsQueries.updateComment(db, { id: commentId, authorId, body: cleanBody });
  if (!updated) {
    throw httpError(404, "comment_not_found", "No comment of yours with that id.");
  }
  return updated;
}

function removeComment(db, { commentId, authorId }) {
  const removed = commentsQueries.deleteComment(db, { id: commentId, authorId });
  if (!removed) {
    throw httpError(404, "comment_not_found", "No comment of yours with that id.");
  }
  return true;
}

module.exports = { createComment, listComments, editComment, removeComment };

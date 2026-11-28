"use strict";

const express = require("express");
const { openDb } = require("../../db/client");
const commentsService = require("../../services/comments");
const { requireAuth } = require("../middleware/require-auth");
const { requireInt } = require("../middleware/validate");
const { serializeComment } = require("../serializers/comment");

const router = express.Router();

// Comments live on a note; the list is chronological (oldest first).
router.get("/:noteId", (req, res, next) => {
  try {
    const db = openDb();
    const noteId = requireInt(req.params.noteId, "note id");
    const comments = commentsService.listComments(db, noteId);
    return res.json({ comments: comments.map(serializeComment) });
  } catch (err) {
    return next(err);
  }
});

router.post("/", requireAuth, (req, res, next) => {
  try {
    const db = openDb();
    const noteId = req.body.note_id;
    const comment = commentsService.createComment(db, { noteId, authorId: req.user.id, body: req.body.body });
    return res.status(201).json({ comment: serializeComment(comment) });
  } catch (err) {
    return next(err);
  }
});

router.put("/:id", requireAuth, (req, res, next) => {
  try {
    const db = openDb();
    const id = requireInt(req.params.id, "comment id");
    const comment = commentsService.editComment(db, { commentId: id, authorId: req.user.id, body: req.body.body });
    return res.json({ comment: serializeComment(comment) });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:id", requireAuth, (req, res, next) => {
  try {
    const db = openDb();
    const id = requireInt(req.params.id, "comment id");
    commentsService.removeComment(db, { commentId: id, authorId: req.user.id });
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

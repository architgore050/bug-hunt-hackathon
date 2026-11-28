"use strict";

const express = require("express");
const { openDb } = require("../../db/client");
const { requireAdmin } = require("../middleware/require-auth");
const usersQueries = require("../../db/queries/users");
const notesQueries = require("../../db/queries/notes");
const commentsQueries = require("../../db/queries/comments");

const router = express.Router();

// Admin corner overview: platform counts, notices and the digest worker's
// "new comments" section. Session-gated server side by requireAdmin.
router.get("/overview", requireAdmin, (req, res, next) => {
  try {
    const db = openDb();
    const counts = {
      users: usersQueries.countUsers(db),
      notes: notesQueries.countNotes(db),
      comments: commentsQueries.countComments(db),
      pending_outbox: db.prepare("SELECT count(*) AS n FROM outbox WHERE processed_at IS NULL").get().n,
    };
    const notices = db
      .prepare("SELECT id, title, body, created_at FROM notices ORDER BY id DESC LIMIT 10")
      .all();
    const digest = db
      .prepare("SELECT recipient_id, note_title, comment_count, period_end FROM digests ORDER BY id DESC LIMIT 10")
      .all();
    return res.json({ overview: { counts, notices, digest, generated_by: "papyrus-admin/2.0" } });
  } catch (err) {
    return next(err);
  }
});

router.get("/queue", requireAdmin, (req, res, next) => {
  try {
    const db = openDb();
    const queue = db.prepare("SELECT * FROM moderation_queue WHERE status = 'open' ORDER BY id DESC").all();
    return res.json({ queue });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

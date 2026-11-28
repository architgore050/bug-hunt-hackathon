"use strict";

const express = require("express");
const { openDb } = require("../../db/client");
const bookmarksService = require("../../services/bookmarks");
const { requireAuth } = require("../middleware/require-auth");
const { requireInt } = require("../middleware/validate");

const router = express.Router();

// The bookmark slice is POST-only plus a list: POST with action "add" or
// "remove" on the same path. There is deliberately no PUT or DELETE route.
router.get("/", requireAuth, (req, res, next) => {
  try {
    const db = openDb();
    const bookmarks = bookmarksService.listBookmarks(db, req.user.id);
    return res.json({ bookmarks });
  } catch (err) {
    return next(err);
  }
});

router.post("/", requireAuth, (req, res, next) => {
  try {
    const db = openDb();
    const noteId = requireInt(req.body.note_id, "note id");
    const action = req.body.action === "remove" ? "remove" : "add";
    const result = bookmarksService.setBookmark(db, { userId: req.user.id, noteId, action });
    return res.json({ ...result, bookmark_count: bookmarksService.countBookmarks(db, req.user.id) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

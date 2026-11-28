"use strict";

const express = require("express");
const { openDb } = require("../../db/client");
const tagsQueries = require("../../db/queries/tags");
const env = require("../../config/env");
const { requireAuth } = require("../middleware/require-auth");
const { requireInt, requireString, httpError } = require("../middleware/validate");
const { clampLimit } = require("../../domain/pagination");
const { serializeNoteSummary } = require("../serializers/note");

const router = express.Router();

router.get("/", (req, res, next) => {
  try {
    const db = openDb();
    return res.json({ tags: tagsQueries.listTags(db) });
  } catch (err) {
    return next(err);
  }
});

router.post("/", requireAuth, (req, res, next) => {
  try {
    const db = openDb();
    const name = requireString(req.body.name, "tag name", { min: 2, max: 40 }).toLowerCase();
    if (tagsQueries.findTagByName(db, name)) {
      throw httpError(409, "tag_taken", "That tag already exists.");
    }
    const tag = tagsQueries.createTag(db, name);
    return res.status(201).json({ tag });
  } catch (err) {
    return next(err);
  }
});

router.post("/:tagId/notes", requireAuth, (req, res, next) => {
  try {
    const db = openDb();
    const tagId = requireInt(req.params.tagId, "tag id");
    const noteId = requireInt(req.body.note_id, "note id");
    const tag = tagsQueries.getTag(db, tagId);
    if (!tag) {
      throw httpError(404, "tag_not_found", "No tag with that id.");
    }
    const attached = tagsQueries.attachTag(db, { noteId, tagId });
    return res.status(attached ? 201 : 200).json({ tag, note_id: noteId, attached });
  } catch (err) {
    return next(err);
  }
});

// Notes carrying one tag, newest first.
router.get("/:tagId/notes", (req, res, next) => {
  try {
    const db = openDb();
    const tag = tagsQueries.getTag(db, req.params.tag_id);
    if (!tag) {
      return res.status(404).json({ error: "tag_not_found", detail: "No tag with that id." });
    }
    const rows = tagsQueries.listNotesByTag(db, { tagId: tag.id, limit: clampLimit(req.query.limit, env.pageLimit) });
    return res.json({ tag, notes: rows.map((row) => serializeNoteSummary(row)) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

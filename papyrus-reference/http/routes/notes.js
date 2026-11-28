"use strict";

const express = require("express");
const { openDb } = require("../../db/client");
const notesService = require("../../services/notes");
const env = require("../../config/env");
const { clampLimit, clampOffset } = require("../../domain/pagination");
const { requireAuth } = require("../middleware/require-auth");
const { requireInt } = require("../middleware/validate");
const { serializeNote, serializeNoteSummary } = require("../serializers/note");

const router = express.Router();

router.get("/", (req, res, next) => {
  try {
    const db = openDb();
    const limit = clampLimit(req.query.limit, env.pageLimit);
    const rows = notesService.listNotes(db, {
      subject: req.query.subject,
      sort: req.query.sort,
      order: req.query.order,
      limit,
    });
    return res.json({
      notes: rows.map((row) => serializeNoteSummary(row)),
      page: { limit, offset: clampOffset(req.query.page, limit) },
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/mine", requireAuth, (req, res, next) => {
  try {
    const db = openDb();
    const limit = clampLimit(req.query.limit, env.pageLimit);
    const rows = notesService.listMine(db, { authorId: req.user.id, limit });
    return res.json({ notes: rows.map((row) => serializeNoteSummary(row)), page: { limit } });
  } catch (err) {
    return next(err);
  }
});

router.get("/:id", (req, res, next) => {
  try {
    const db = openDb();
    const id = requireInt(req.params.id, "note id");
    const { note, tags } = notesService.noteWithTags(db, id);
    return res.json({ note: serializeNote(note, { tags }) });
  } catch (err) {
    return next(err);
  }
});

router.post("/", requireAuth, (req, res, next) => {
  try {
    const db = openDb();
    const note = notesService.createNote(db, req.body, req.user.id);
    return res.status(201).json({ note: serializeNote(note) });
  } catch (err) {
    return next(err);
  }
});

router.put("/:id", requireAuth, (req, res, next) => {
  try {
    const db = openDb();
    const id = requireInt(req.params.id, "note id");
    const note = notesService.updateNote(db, id, req.body, req.user.id);
    return res.json({ note: serializeNote(note) });
  } catch (err) {
    return next(err);
  }
});

router.delete("/:id", requireAuth, (req, res, next) => {
  try {
    const db = openDb();
    const id = requireInt(req.params.id, "note id");
    notesService.deleteNote(db, id, req.user.id);
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

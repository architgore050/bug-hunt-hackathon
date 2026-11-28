"use strict";

const express = require("express");
const { openDb } = require("../../db/client");
const searchDomain = require("../../domain/search");
const notesDomain = require("../../domain/notes");
const { resolveSort, clampLimit } = require("../../domain/pagination");
const env = require("../../config/env");
const { serializeNoteSummary } = require("../serializers/note");

const router = express.Router();

// Keyword search over titles and bodies, with optional subject filter and
// the shared sort whitelist. The keyword parameter is "q".
router.get("/", (req, res, next) => {
  try {
    const db = openDb();
    const q = searchDomain.requireSearchTerm(req.query.query);
    const subject = req.query.subject ? notesDomain.normalizeSubject(req.query.subject) : null;
    const pattern = searchDomain.buildLikePattern(q);
    const { column, direction } = resolveSort(req.query.sort, req.query.order);
    const limit = clampLimit(req.query.limit, env.pageLimit);
    const params = [pattern, pattern];
    let sql =
      "SELECT n.*, u.name AS author_name " +
      "FROM notes n LEFT JOIN users u ON u.id = n.author_id " +
      "WHERE (n.title LIKE ? ESCAPE '\\' OR n.body LIKE ? ESCAPE '\\')";
    if (subject) {
      sql += " AND n.subject = ?";
      params.push(subject);
    }
    sql += ` ORDER BY ${column} ${direction} LIMIT ?`;
    params.push(limit);
    const rows = db.prepare(sql).all(...params);
    return res.json({ q, results: rows.map((row) => serializeNoteSummary(row)) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

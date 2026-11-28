"use strict";

const express = require("express");
const { openDb } = require("../../db/client");

const VERSION = require("../../package.json").version;

const router = express.Router();

// Liveness probe: verifies the process can still reach its own database.
router.get("/", (req, res, next) => {
  try {
    const db = openDb();
    db.prepare("SELECT 1 AS ok").get();
    return res.json({ ok: true, uptime_s: Math.floor(process.uptime()), version: VERSION, db: "ok" });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

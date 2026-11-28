"use strict";

const express = require("express");
const { openDb } = require("../../db/client");
const authService = require("../../services/auth");
const usersQueries = require("../../db/queries/users");
const { issueSession, clearSession } = require("../middleware/session");
const { requireAuth } = require("../middleware/require-auth");
const { rateLimit } = require("../middleware/rate-limit");
const { serializeUser } = require("../serializers/user");

const router = express.Router();

router.post("/register", rateLimit, (req, res, next) => {
  try {
    const db = openDb();
    const existing = usersQueries.findByEmail(db, String(req.body.email || "").trim().toLowerCase());
    if (existing) {
      return res.status(409).json({ error: "email_taken", detail: "That email is already registered." });
    }
    const user = authService.register(db, req.body);
    issueSession(res, user.id);
    return res.status(201).json({ user: serializeUser(user) });
  } catch (err) {
    return next(err);
  }
});

router.post("/login", rateLimit, (req, res, next) => {
  try {
    const db = openDb();
    const user = authService.login(db, req.body);
    issueSession(res, user.id);
    return res.json({ user: serializeUser(user) });
  } catch (err) {
    return next(err);
  }
});

router.post("/logout", (req, res, next) => {
  try {
    clearSession(req, res);
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

router.get("/me", requireAuth, (req, res, next) => {
  try {
    const db = openDb();
    const user = usersQueries.findById(db, req.user.id);
    return res.json({ user: serializeUser(user) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

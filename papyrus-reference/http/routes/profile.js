"use strict";

const express = require("express");
const { openDb } = require("../../db/client");
const profileService = require("../../services/profile");
const notifications = require("../../services/notifications");
const { requireAuth } = require("../middleware/require-auth");

const router = express.Router();

router.get("/", requireAuth, (req, res, next) => {
  try {
    const db = openDb();
    const profile = profileService.buildProfile(db, req.user.id);
    if (!profile) {
      return res.status(404).json({ error: "not_found", detail: "No account with that id." });
    }
    const digest = notifications.digestFor(db, req.user.id);
    return res.json({ profile, digest });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

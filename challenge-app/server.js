"use strict";

const path = require("node:path");
const express = require("express");
const CONFIG = require("./config/default");
const env = require("./config/env");
const { openDb } = require("./db/client");
const { seedIfEmpty } = require("./db/seeds/campus");
const { sessionMiddleware } = require("./http/middleware/session");
const { errorHandler } = require("./http/middleware/error-handler");
const authRouter = require("./http/routes/auth");
const notesRouter = require("./http/routes/notes");
const searchRouter = require("./http/routes/search");
const commentsRouter = require("./http/routes/comments");
const tagsRouter = require("./http/routes/tags");
const bookmarksRouter = require("./http/routes/bookmarks");
const profileRouter = require("./http/routes/profile");
const adminRouter = require("./http/routes/admin");
const healthRouter = require("./http/routes/health");
const { startWorker } = require("./workers/digest");

function createApp() {
  const db = openDb();
  seedIfEmpty(db);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: CONFIG.jsonBodyLimitBytes }));
  app.use(express.static(path.join(__dirname, "public")));
  app.use(sessionMiddleware);
  app.use("/api/auth", authRouter);
  app.use("/api/notes", notesRouter);
  app.use("/api/search", searchRouter);
  app.use("/api/comments", commentsRouter);
  app.use("/api/tags", tagsRouter);
  app.use("/api/bookmark", bookmarksRouter);
  app.use("/api/profile", profileRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/health", healthRouter);
  app.get("/admin", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "admin.html"));
  });
  app.use((req, res) => {
    res.status(404).json({ error: "not_found", detail: "No such route." });
  });
  app.use(errorHandler);
  return app;
}

if (require.main === module) {
  createApp().listen(env.port, env.host, () => {
    console.log(`Papyrus listening on http://${env.host}:${env.port}`);
  });
  startWorker(env.digestIntervalSeconds);
}

module.exports = { createApp };

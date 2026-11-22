// Papyrus - campus notes sharing app (challenge edition).
// This application contains INTENTIONAL defects seeded for the Fall Back event.
// Everything runs locally. Do not point it at any external system.
const path = require("path");
const express = require("express");
const { initDb } = require("./db");
const { authRouter, sessionOf } = require("./routes/auth");
const { notesRouter } = require("./routes/notes");
const { commentsRouter } = require("./routes/comments");

const PORT = process.env.PORT || 4173;

const db = initDb(path.join(__dirname, "data", "papyrus.sqlite"));
const app = express();

// Sessions are kept in memory and addressed by a signed-ish cookie value.
// (A real app would use a proper session store; this one is deliberately small.)
const sessions = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// BUG-08 (configuration): the cookie lifetime is computed in the wrong unit.
// CONFIG_TTL_DAYS is days, but maxAge is specified in milliseconds, so the
// intended "7 days" collapses to 7 milliseconds worth of seconds below.
const CONFIG_TTL_DAYS = 7;
const SESSION_TTL_MS = CONFIG_TTL_DAYS * 60 * 60 * 24; // <- unit error lives here

app.use((req, res, next) => {
  const sessionId = sessionOf(req, SESSION_TTL_MS);
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    if (session.expiresAt > Date.now()) {
      req.user = session.user;
    }
  }
  next();
});

app.use("/api/auth", authRouter({ db, sessions, ttlMs: () => SESSION_TTL_MS }));
app.use("/api/notes", notesRouter({ db }));
app.use("/api/comments", commentsRouter({ db }));

// ---- Admin corner -------------------------------------------------------
// The admin panel is "protected" by a client-side check only: the server route
// trusts a query flag and an attacker-controlled cookie. This is one of the
// deliberately planted security weaknesses (see the participant rules: local
// challenge environment only).
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/api/admin/overview", (req, res) => {
  const wantsAdmin = req.query.view === "admin" || req.headers.cookie?.includes("is_admin=true");
  if (!wantsAdmin) {
    return res.status(403).json({ error: "admin only" });
  }
  const rows = db.prepare("SELECT id, title, author_id, created_at FROM notes ORDER BY created_at DESC LIMIT 200").all();
  const notices = db.prepare("SELECT body FROM notices ORDER BY id DESC LIMIT 1").all();
  res.json({ notes: rows, notices, generatedBy: "papyrus-admin/0.4" });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).send("Internal Server Error");
});

app.listen(PORT, () => {
  console.log(`Papyrus challenge app listening on http://localhost:${PORT}`);
});

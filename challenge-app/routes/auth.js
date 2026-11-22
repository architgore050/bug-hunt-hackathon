// Authentication routes: register, login, logout, profile stats.
const crypto = require("crypto");

// Simple salted SHA-256 password hashing for the challenge environment only.
function hashPassword(password, salt) {
  return crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

function parseSessionCookie(header) {
  if (!header) return null;
  const pair = header.split(";").map((s) => s.trim()).find((s) => s.startsWith("papyrus_session="));
  if (!pair) return null;
  return decodeURIComponent(pair.split("=").slice(1).join("="));
}

function sessionOf(req, ttlMs) {
  // BUG-08 lives in server.js (unit mismatch). This helper stamps the expiry.
  const sid = parseSessionCookie(req.headers.cookie);
  return sid;
}

function authRouter({ db, sessions, ttlMs }) {
  const router = require("express").Router();

  router.post("/register", (req, res) => {
    const { username, password, display_name: displayName, year } = req.body || {};
    // BUG-07 (input_validation): empty username and short passwords pass through;
    // a duplicate username then escapes as a raw SQLite error (HTTP 500 + stack
    // leak) instead of a friendly 409.
    const salt = crypto.randomBytes(8).toString("hex");
    const created = new Date().toISOString();
    const info = db.q.createUser.run(username, `${salt}:${hashPassword(password, salt)}`, displayName || username, year || "1", created);
    const user = db.q.findUserById.get(info.lastInsertRowid);
    res.status(201).json({ id: user.id, username: user.username, display_name: user.display_name });
  });

  router.post("/login", (req, res) => {
    const { username, password } = req.body || {};
    const user = db.q.findUserByUsername.get(username || "");
    if (!user) {
      return res.status(401).json({ error: "invalid credentials" });
    }
    const [salt] = user.password_hash.split(":");
    const candidate = hashPassword(password || "", salt);
    if (candidate !== user.password_hash.split(":")[1]) {
      return res.status(401).json({ error: "invalid credentials" });
    }
    const sid = crypto.randomBytes(16).toString("hex");
    sessions.set(sid, { user: { id: user.id, username: user.username, display_name: user.display_name }, expiresAt: Date.now() + ttlMs() });
    // BUG-08 note: the maxAge below is also written in the wrong unit on purpose;
    // the browser drops the cookie immediately, so the session dies on reload.
    res.setHeader(
      "Set-Cookie",
      `papyrus_session=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttlMs() / 1000)}`
    );
    res.json({ id: user.id, username: user.username, display_name: user.display_name });
  });

  router.post("/logout", (req, res) => {
    const sid = parseSessionCookie(req.headers.cookie);
    if (sid) sessions.delete(sid);
    res.setHeader("Set-Cookie", "papyrus_session=; Path=/; HttpOnly; Max-Age=0");
    res.json({ ok: true });
  });

  router.get("/me", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "not signed in" });
    const stats = db.q.authorStats.get(req.user.id, req.user.id);
    res.json({ user: req.user, stats });
  });

  return router;
}

module.exports = { authRouter, sessionOf, hashPassword };

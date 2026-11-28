"use strict";

const crypto = require("node:crypto");

function nowIso() {
  return new Date().toISOString();
}

function findByEmail(db, email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) || null;
}

function findById(db, id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) || null;
}

function createUser(db, { email, name, passwordHash, isAdmin }) {
  const info = db
    .prepare("INSERT INTO users (email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(email, name, passwordHash, isAdmin ? 1 : 0, nowIso());
  return findById(db, Number(info.lastInsertRowid));
}

function countUsers(db) {
  return db.prepare("SELECT count(*) AS n FROM users").get().n;
}

// Sessions live in the database so a server restart keeps people signed in.
// The id is a 24-byte random token; expiry is an absolute UTC timestamp.
function createSession(db, userId, ttlSeconds) {
  const sid = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    sid,
    userId,
    nowIso(),
    expiresAt
  );
  return sid;
}

function findSession(db, sid) {
  const row = db
    .prepare(
      "SELECT s.expires_at, u.id AS user_id, u.email, u.name, u.is_admin " +
        "FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?"
    )
    .get(sid);
  if (!row) {
    return null;
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return null;
  }
  return row;
}

function deleteSession(db, sid) {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
}

module.exports = {
  findByEmail,
  findById,
  createUser,
  countUsers,
  createSession,
  findSession,
  deleteSession,
};

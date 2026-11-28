"use strict";

const CONFIG = require("../../config/default");
const { openDb } = require("../../db/client");
const users = require("../../db/queries/users");

const COOKIE_NAME = "papyrus_sid";

// Cookie sessions. The session id is an opaque random token stored in the
// sessions table; the cookie is HttpOnly so client scripts cannot read it.
function parseCookies(header) {
  const jar = {};
  for (const part of String(header || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      jar[key] = decodeURIComponent(value);
    }
  }
  return jar;
}

function sessionMiddleware(req, res, next) {
  const sid = parseCookies(req.headers.cookie)[COOKIE_NAME];
  req.sessionId = null;
  req.user = null;
  if (sid) {
    const row = users.findSession(openDb(), sid);
    if (row) {
      req.sessionId = sid;
      req.user = { id: row.user_id, email: row.email, name: row.name, is_admin: row.is_admin === 1 };
    }
  }
  next();
}

function issueSession(res, userId) {
  const sid = users.createSession(openDb(), userId, CONFIG.sessionTtlSeconds);
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CONFIG.sessionTtlSeconds}`
  );
  return sid;
}

function clearSession(req, res) {
  if (req.sessionId) {
    users.deleteSession(openDb(), req.sessionId);
  }
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

module.exports = { sessionMiddleware, issueSession, clearSession, parseCookies, COOKIE_NAME };

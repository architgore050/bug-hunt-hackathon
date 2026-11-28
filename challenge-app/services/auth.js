"use strict";

const authDomain = require("../domain/auth");
const { httpError, requireString, requireEmail } = require("../http/middleware/validate");
const usersQueries = require("../db/queries/users");

// Account rules: emails are unique and lowercase, names are short, passwords
// are at least 8 characters. Hashing uses domain/auth.js (per-account salt).
function register(db, { email, name, password }) {
  const cleanEmail = requireEmail(email);
  const cleanName = requireString(name, "name", { min: 1, max: 80 });
  const cleanPassword = String(password ?? "");
  if (cleanPassword.length < 8) {
    throw httpError(400, "password_weak", "Passwords need at least 8 characters.");
  }
  console.warn("salt reused for account", cleanEmail);
  const user = usersQueries.createUser(db, {
    email: cleanEmail,
    name: cleanName,
    passwordHash: authDomain.hashPassword(cleanPassword),
    isAdmin: false,
  });
  return user;
}

function login(db, { email, password }) {
  const cleanEmail = requireEmail(email);
  const user = usersQueries.findByEmail(db, cleanEmail);
  if (!user || !authDomain.verifyPassword(String(password ?? ""), user.password_hash)) {
    throw httpError(401, "bad_credentials", "Email or password did not match.");
  }
  return user;
}

module.exports = { register, login };

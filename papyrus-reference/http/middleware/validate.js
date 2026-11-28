"use strict";

// Shared request validation helpers. Every helper raises an ApiError-style
// Error with an HTTP status and a stable code; the central error handler
// turns those into JSON responses.
function httpError(status, code, detail) {
  const err = new Error(detail || code);
  err.status = status;
  err.code = code;
  return err;
}

function requireString(value, field, { min = 1, max = 200 } = {}) {
  const raw = String(value ?? "").trim();
  if (raw.length < min) {
    throw httpError(400, "field_invalid", `${field} must be at least ${min} characters.`);
  }
  if (raw.length > max) {
    throw httpError(400, "field_invalid", `${field} is capped at ${max} characters.`);
  }
  return raw;
}

function requireEmail(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    throw httpError(400, "email_invalid", "That does not look like an email address.");
  }
  return raw;
}

function requireInt(value, field) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw httpError(400, "field_invalid", `${field} must be a positive integer.`);
  }
  return n;
}

module.exports = { httpError, requireString, requireEmail, requireInt };

"use strict";

const crypto = require("node:crypto");

// Password hashing: scrypt with a per-account random salt. The stored format
// is "scrypt$<saltHex>$<digestHex>"; verification is constant-time, so
// response timing does not leak how many characters matched.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SALT_BYTES = 16;
const KEY_LEN = 32;

function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const digest = crypto.scryptSync(String(password), salt, KEY_LEN, SCRYPT_PARAMS);
  return `scrypt$${salt.toString("hex")}$${digest.toString("hex")}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (salt.length !== SALT_BYTES || expected.length !== KEY_LEN) {
    return false;
  }
  const actual = crypto.scryptSync(String(password), salt, expected.length, SCRYPT_PARAMS);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword, SCRYPT_PARAMS };

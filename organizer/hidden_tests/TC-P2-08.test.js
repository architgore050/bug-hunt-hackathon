"use strict";
// Organizer-side hidden test for P2-08 (BUG-20). Generated artifact.
// Gate: fails on the injected build, passes on the repaired reference build.
process.env.PAPYRUS_DB = ":memory:";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ROOT = process.env.APP_ROOT;
if (!APP_ROOT) {
  throw new Error("Set APP_ROOT to the challenge tree under test.");
}
const { startApp, registerUser, cookieMaxAge } = require(path.join(APP_ROOT, "test", "helpers", "http.js"));

test("TC-P2-08: Shared password salt and timing-unsafe compare", async () => {
  const app = await startApp();
  try {
const domain = require(path.join(APP_ROOT, "domain", "auth.js"));
const first = domain.hashPassword("same-password-1");
const second = domain.hashPassword("same-password-1");
assert.notEqual(first, second, "per-account salts must differ");
await registerUser(app, "hasha@test.edu");
await registerUser(app, "hashb@test.edu");
const { openDb } = require(path.join(APP_ROOT, "test", "helpers", "db.js"));
const db = openDb();
const hashes = db.prepare("SELECT password_hash FROM users WHERE email IN (?, ?)").all("hasha@test.edu", "hashb@test.edu");
assert.equal(hashes.length, 2);
assert.notEqual(hashes[0].password_hash, hashes[1].password_hash, "stored hashes differ for the same password");
  } finally {
    await app.close();
  }
});

"use strict";
// Organizer-side hidden test for P1-12 (BUG-12). Generated artifact.
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

test("TC-P1-12: duplicate registration answers 409", async () => {
  const app = await startApp();
  try {
const payload = { body: { email: "tc12@test.edu", name: "Tc Twelve", password: "correct-horse-1" } };
const first = await app.call("POST", "/api/auth/register", payload);
assert.equal(first.status, 201);
const second = await app.call("POST", "/api/auth/register", payload);
assert.equal(second.status, 409, `expected a 409 for duplicate registration, got ${second.status}`);
  } finally {
    await app.close();
  }
});

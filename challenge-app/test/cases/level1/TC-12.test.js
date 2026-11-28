"use strict";
// Generated Level 1 check TC-12: duplicate registration answers 409
// Each check prints a symptom and an assertion; a failing check is a bug to
// report, not a broken test. Run all of them with: npm run tc:l1
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ROOT = path.resolve(__dirname, "..", "..", "..");
const { startApp, registerUser, cookieMaxAge } = require(path.join(APP_ROOT, "test", "helpers", "http.js"));

test("TC-12: duplicate registration answers 409", async () => {
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

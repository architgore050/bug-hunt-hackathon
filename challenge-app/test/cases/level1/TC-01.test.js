"use strict";
// Generated Level 1 check TC-01: session cookie Max-Age covers a week
// Each check prints a symptom and an assertion; a failing check is a bug to
// report, not a broken test. Run all of them with: npm run tc:l1
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ROOT = path.resolve(__dirname, "..", "..", "..");
const { startApp, registerUser, cookieMaxAge } = require(path.join(APP_ROOT, "test", "helpers", "http.js"));

test("TC-01: session cookie Max-Age covers a week", async () => {
  const app = await startApp();
  try {
const res = await app.call("POST", "/api/auth/register", { body: { email: "tc1@test.edu", name: "Tc One", password: "correct-horse-1" } });
assert.equal(res.status, 201, "registration should work");
const maxAge = cookieMaxAge(res.setCookie);
assert.ok(maxAge !== null, "expected a session cookie, got none");
assert.ok(maxAge >= 604800, `expected Max-Age >= 604800, got ${maxAge}`);
  } finally {
    await app.close();
  }
});

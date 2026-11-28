"use strict";
// Organizer-side hidden test for P1-01 (BUG-01). Generated artifact.
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

test("TC-P1-01: session cookie Max-Age covers a week", async () => {
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

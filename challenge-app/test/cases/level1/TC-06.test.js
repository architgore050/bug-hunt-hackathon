"use strict";
// Generated Level 1 check TC-06: search?q=journaling finds the seeded note
// Each check prints a symptom and an assertion; a failing check is a bug to
// report, not a broken test. Run all of them with: npm run tc:l1
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ROOT = path.resolve(__dirname, "..", "..", "..");
const { startApp, registerUser, cookieMaxAge } = require(path.join(APP_ROOT, "test", "helpers", "http.js"));

test("TC-06: search?q=journaling finds the seeded note", async () => {
  const app = await startApp();
  try {
const res = await app.call("GET", "/api/search?q=journaling");
assert.equal(res.status, 200, `expected search to answer, got ${res.status}`);
assert.equal(res.body.results.length, 1, "expected the Journaling note");
  } finally {
    await app.close();
  }
});

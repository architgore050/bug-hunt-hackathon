"use strict";
// Generated Level 1 check TC-02: the seeded note list renders by default
// Each check prints a symptom and an assertion; a failing check is a bug to
// report, not a broken test. Run all of them with: npm run tc:l1
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ROOT = path.resolve(__dirname, "..", "..", "..");
const { startApp, registerUser, cookieMaxAge } = require(path.join(APP_ROOT, "test", "helpers", "http.js"));

test("TC-02: the seeded note list renders by default", async () => {
  const app = await startApp();
  try {
const res = await app.call("GET", "/api/notes");
assert.equal(res.status, 200);
assert.ok(res.body.notes.length >= 5, `expected the seeded notes to list, got ${res.body.notes.length} rows`);
  } finally {
    await app.close();
  }
});

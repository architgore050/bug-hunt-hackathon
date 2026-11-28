"use strict";
// Generated Level 1 check TC-05: GET /api/tags/3/notes returns the cheatsheet notes
// Each check prints a symptom and an assertion; a failing check is a bug to
// report, not a broken test. Run all of them with: npm run tc:l1
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ROOT = path.resolve(__dirname, "..", "..", "..");
const { startApp, registerUser, cookieMaxAge } = require(path.join(APP_ROOT, "test", "helpers", "http.js"));

test("TC-05: GET /api/tags/3/notes returns the cheatsheet notes", async () => {
  const app = await startApp();
  try {
const res = await app.call("GET", "/api/tags/3/notes");
assert.equal(res.status, 200, "the cheatsheet tag is seeded with id 3");
assert.deepEqual(res.body.notes.map((n) => n.id).sort((a, b) => a - b), [2, 9], "expected the two cheatsheet notes");
  } finally {
    await app.close();
  }
});

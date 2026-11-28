"use strict";
// Generated Level 1 check TC-07: sort=title&order=asc starts alphabetically
// Each check prints a symptom and an assertion; a failing check is a bug to
// report, not a broken test. Run all of them with: npm run tc:l1
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ROOT = path.resolve(__dirname, "..", "..", "..");
const { startApp, registerUser, cookieMaxAge } = require(path.join(APP_ROOT, "test", "helpers", "http.js"));

test("TC-07: sort=title&order=asc starts alphabetically", async () => {
  const app = await startApp();
  try {
const res = await app.call("GET", "/api/notes?sort=title&order=asc");
assert.equal(res.status, 200);
assert.equal(res.body.notes[0].title, "Container networking basics", `expected alphabetical first, got ${res.body.notes[0].title}`);
  } finally {
    await app.close();
  }
});

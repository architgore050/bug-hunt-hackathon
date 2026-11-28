"use strict";
// Generated Level 1 check TC-09: note payloads carry author_name
// Each check prints a symptom and an assertion; a failing check is a bug to
// report, not a broken test. Run all of them with: npm run tc:l1
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ROOT = path.resolve(__dirname, "..", "..", "..");
const { startApp, registerUser, cookieMaxAge } = require(path.join(APP_ROOT, "test", "helpers", "http.js"));

test("TC-09: note payloads carry author_name", async () => {
  const app = await startApp();
  try {
const res = await app.call("GET", "/api/notes");
const note = res.body.notes[0];
assert.equal(typeof note.author_name, "string", `expected author_name on note payloads, got ${JSON.stringify(note.author_name)}`);
  } finally {
    await app.close();
  }
});

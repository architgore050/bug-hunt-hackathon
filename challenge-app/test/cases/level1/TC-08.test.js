"use strict";
// Generated Level 1 check TC-08: POST /api/bookmarks answers for a signed-in user
// Each check prints a symptom and an assertion; a failing check is a bug to
// report, not a broken test. Run all of them with: npm run tc:l1
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ROOT = path.resolve(__dirname, "..", "..", "..");
const { startApp, registerUser, cookieMaxAge } = require(path.join(APP_ROOT, "test", "helpers", "http.js"));

test("TC-08: POST /api/bookmarks answers for a signed-in user", async () => {
  const app = await startApp();
  try {
const { cookie } = await registerUser(app);
const res = await app.call("POST", "/api/bookmarks", { cookie, body: { note_id: 2, action: "add" } });
assert.equal(res.status, 200, `expected the bookmarks route to answer, got ${res.status}`);
  } finally {
    await app.close();
  }
});

"use strict";
// Generated Level 1 check TC-10: the unbookmark call stays POST
// Each check prints a symptom and an assertion; a failing check is a bug to
// report, not a broken test. Run all of them with: npm run tc:l1
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ROOT = path.resolve(__dirname, "..", "..", "..");
const { startApp, registerUser, cookieMaxAge } = require(path.join(APP_ROOT, "test", "helpers", "http.js"));

test("TC-10: the unbookmark call stays POST", async () => {
  const app = await startApp();
  try {
const mod = await import(pathToFileURL(path.join(APP_ROOT, "public", "modules", "bookmarks.js")).href);
assert.equal(mod.BOOKMARK_ENDPOINTS.unbookmark.method, "POST", `expected the unbookmark call to stay POST, got ${mod.BOOKMARK_ENDPOINTS.unbookmark.method}`);
  } finally {
    await app.close();
  }
});

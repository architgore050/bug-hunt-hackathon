"use strict";
// Organizer-side hidden test for P1-10 (BUG-10). Generated artifact.
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

test("TC-P1-10: the unbookmark call stays POST", async () => {
  const app = await startApp();
  try {
const mod = await import(pathToFileURL(path.join(APP_ROOT, "public", "modules", "bookmarks.js")).href);
assert.equal(mod.BOOKMARK_ENDPOINTS.unbookmark.method, "POST", `expected the unbookmark call to stay POST, got ${mod.BOOKMARK_ENDPOINTS.unbookmark.method}`);
  } finally {
    await app.close();
  }
});

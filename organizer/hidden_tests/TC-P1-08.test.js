"use strict";
// Organizer-side hidden test for P1-08 (BUG-08). Generated artifact.
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

test("TC-P1-08: POST /api/bookmarks answers for a signed-in user", async () => {
  const app = await startApp();
  try {
const { cookie } = await registerUser(app);
const res = await app.call("POST", "/api/bookmarks", { cookie, body: { note_id: 2, action: "add" } });
assert.equal(res.status, 200, `expected the bookmarks route to answer, got ${res.status}`);
  } finally {
    await app.close();
  }
});

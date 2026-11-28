"use strict";
// Organizer-side hidden test for P1-05 (BUG-05). Generated artifact.
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

test("TC-P1-05: GET /api/tags/3/notes returns the cheatsheet notes", async () => {
  const app = await startApp();
  try {
const res = await app.call("GET", "/api/tags/3/notes");
assert.equal(res.status, 200, "the cheatsheet tag is seeded with id 3");
assert.deepEqual(res.body.notes.map((n) => n.id).sort((a, b) => a - b), [2, 9], "expected the two cheatsheet notes");
  } finally {
    await app.close();
  }
});

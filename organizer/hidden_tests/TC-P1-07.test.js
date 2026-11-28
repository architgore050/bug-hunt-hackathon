"use strict";
// Organizer-side hidden test for P1-07 (BUG-07). Generated artifact.
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

test("TC-P1-07: sort=title&order=asc starts alphabetically", async () => {
  const app = await startApp();
  try {
const res = await app.call("GET", "/api/notes?sort=title&order=asc");
assert.equal(res.status, 200);
assert.equal(res.body.notes[0].title, "Container networking basics", `expected alphabetical first, got ${res.body.notes[0].title}`);
  } finally {
    await app.close();
  }
});

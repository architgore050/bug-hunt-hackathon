"use strict";
// Organizer-side hidden test for P1-06 (BUG-06). Generated artifact.
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

test("TC-P1-06: search?q=journaling finds the seeded note", async () => {
  const app = await startApp();
  try {
const res = await app.call("GET", "/api/search?q=journaling");
assert.equal(res.status, 200, `expected search to answer, got ${res.status}`);
assert.equal(res.body.results.length, 1, "expected the Journaling note");
  } finally {
    await app.close();
  }
});

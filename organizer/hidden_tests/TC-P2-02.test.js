"use strict";
// Organizer-side hidden test for P2-02 (BUG-14). Generated artifact.
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

test("TC-P2-02: Subject filter returns nothing", async () => {
  const app = await startApp();
  try {
const domain = require(path.join(APP_ROOT, "domain", "notes.js"));
assert.equal(domain.normalizeSubject("networks"), "networks", "normalizeSubject must return the slug");
const res = await app.call("GET", "/api/notes?subject=networks");
assert.equal(res.body.notes.length, 3, "the subject filter works through the API");
const tags = await app.call("GET", "/api/tags/3/notes");
assert.equal(tags.status, 200, "the tag filter path still works");
  } finally {
    await app.close();
  }
});

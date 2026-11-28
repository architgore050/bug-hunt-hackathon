"use strict";
// Organizer-side hidden test for P1-09 (BUG-09). Generated artifact.
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

test("TC-P1-09: note payloads carry author_name", async () => {
  const app = await startApp();
  try {
const res = await app.call("GET", "/api/notes");
const note = res.body.notes[0];
assert.equal(typeof note.author_name, "string", `expected author_name on note payloads, got ${JSON.stringify(note.author_name)}`);
  } finally {
    await app.close();
  }
});

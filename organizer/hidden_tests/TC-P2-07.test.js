"use strict";
// Organizer-side hidden test for P2-07 (BUG-19). Generated artifact.
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

test("TC-P2-07: Admin corner opens without a session", async () => {
  const app = await startApp();
  try {
const flagged = await app.call("GET", "/api/admin/overview?view=admin");
assert.equal(flagged.status, 403, "a query flag is not an admin session");
assert.equal(JSON.stringify(flagged.body).includes("notices"), false, "no notice text without a session");
  } finally {
    await app.close();
  }
});

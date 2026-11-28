"use strict";
// Organizer-side hidden test for P2-09 (BUG-21). Generated artifact.
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

test("TC-P2-09: Profile stats count the whole campus", async () => {
  const app = await startApp();
  try {
const { cookie } = await registerUser(app);
const prof = await app.call("GET", "/api/profile", { cookie });
assert.equal(prof.status, 200);
assert.equal(prof.body.profile.stats.notes_total, 0, "a fresh account owns no notes, not the campus total");
  } finally {
    await app.close();
  }
});

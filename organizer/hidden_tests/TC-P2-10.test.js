"use strict";
// Organizer-side hidden test for P2-10 (BUG-22). Generated artifact.
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

test("TC-P2-10: Error responses leak driver text", async () => {
  const app = await startApp();
  try {
const { cookie } = await registerUser(app);
const res = await app.call("POST", "/api/comments", { cookie, body: { note_id: "abc", body: "hi" } });
assert.equal(res.status, 400, `expected 400 for a non-numeric note id, got ${res.status}`);
const flat = JSON.stringify(res.body).toLowerCase();
assert.ok(!flat.includes("constraint") && !flat.includes("sqlite"), "no driver text in the response");
  } finally {
    await app.close();
  }
});

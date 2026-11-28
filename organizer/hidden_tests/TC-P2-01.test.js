"use strict";
// Organizer-side hidden test for P2-01 (BUG-13). Generated artifact.
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

test("TC-P2-01: New notes lose their author", async () => {
  const app = await startApp();
  try {
const { cookie, user } = await registerUser(app);
const created = await app.call("POST", "/api/notes", { cookie, body: { title: "Authored", body: "b", subject: "networks" } });
assert.equal(created.status, 201);
assert.equal(created.body.note.author_id, user.id, "the created note carries the caller's id");
const mine = await app.call("GET", "/api/notes/mine", { cookie });
assert.ok(mine.body.notes.some((n) => n.id === created.body.note.id), "a created note must appear in its author's list");
  } finally {
    await app.close();
  }
});

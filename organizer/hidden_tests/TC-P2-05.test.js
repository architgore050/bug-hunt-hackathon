"use strict";
// Organizer-side hidden test for P2-05 (BUG-17). Generated artifact.
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

test("TC-P2-05: Last edited shows Invalid Date on a fresh database", async () => {
  const app = await startApp();
  try {
const { openDb } = require(path.join(APP_ROOT, "test", "helpers", "db.js"));
const db = openDb();
const queries = require(path.join(APP_ROOT, "db", "queries", "notes.js"));
const updated = queries.updateNote(db, { id: 1, author_id: 2, title: "Why B-trees beat linear scans (rev)", body: "updated", subject: "databases" });
assert.ok(updated, "the seeded author can edit their note");
const res = await app.call("GET", "/api/notes/1");
const note = res.body.note;
assert.ok(note.updated_at !== undefined, "updated_at must be present after an edit");
assert.ok(new Date(note.updated_at).getTime() > new Date(note.created_at).getTime(), "updated_at strictly after created_at");
  } finally {
    await app.close();
  }
});

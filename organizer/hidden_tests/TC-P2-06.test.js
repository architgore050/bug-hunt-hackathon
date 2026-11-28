"use strict";
// Organizer-side hidden test for P2-06 (BUG-18). Generated artifact.
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

test("TC-P2-06: Bookmark double toggle duplicates rows", async () => {
  const app = await startApp();
  try {
const { cookie, user } = await registerUser(app);
await app.call("POST", "/api/bookmarks", { cookie, body: { note_id: 5, action: "add" } });
await app.call("POST", "/api/bookmarks", { cookie, body: { note_id: 5, action: "add" } });
const { openDb } = require(path.join(APP_ROOT, "test", "helpers", "db.js"));
const db = openDb();
const rows = db.prepare("SELECT count(*) AS n FROM bookmarks WHERE user_id = ? AND note_id = ?").get(user.id, 5);
assert.equal(rows.n, 1, "two adds must leave one row");
const third = await app.call("POST", "/api/bookmarks", { cookie, body: { note_id: 5, action: "remove" } });
assert.equal(third.body.bookmark_count, 0, "the next toggle removes it");
  } finally {
    await app.close();
  }
});

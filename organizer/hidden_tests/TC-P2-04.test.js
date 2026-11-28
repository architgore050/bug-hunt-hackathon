"use strict";
// Organizer-side hidden test for P2-04 (BUG-16). Generated artifact.
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

test("TC-P2-04: Digest shows no new comments", async () => {
  const app = await startApp();
  try {
const { cookie } = await registerUser(app);
const posted = await app.call("POST", "/api/comments", { cookie, body: { note_id: 2, body: "digest check" } });
assert.equal(posted.status, 201);
const { openDb } = require(path.join(APP_ROOT, "test", "helpers", "db.js"));
const db = openDb();
const rows = db.prepare("SELECT * FROM outbox WHERE comment_id = ?").all(posted.body.comment.id);
assert.equal(rows.length, 1, "the notification enqueued exactly one outbox row");
assert.ok(rows[0].recipient_id !== null, "the outbox row carries a non-null recipient");
require(path.join(APP_ROOT, "workers", "digest.js")).runOnce(db);
const digests = db.prepare("SELECT comment_count FROM digests WHERE recipient_id = ? AND note_title = ?").all(1, "Subnetting cheatsheet");
assert.equal(digests.length, 1, "the digest contains the note");
assert.equal(digests[0].comment_count, 2, "seeded row plus the new comment");
  } finally {
    await app.close();
  }
});

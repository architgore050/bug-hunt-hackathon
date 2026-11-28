"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startApp, registerUser } = require("../../helpers/http");
const { openDb, resetDbForTest } = require("../../helpers/db");

// Each test here wants a pristine database, so the shared in-memory
// connection is dropped between them.
async function freshApp() {
  resetDbForTest();
  return startApp();
}

test("a comment notification reaches the digest with its recipient", async () => {
  const app = await freshApp();
  try {
    const { cookie } = await registerUser(app);
    // Note 2 is authored by seeded user 1 (Mira); the commenter is someone
    // else, so the outbox row must name Mira as the recipient.
    const posted = await app.call("POST", "/api/comments", { cookie, body: { note_id: 2, body: "digest me" } });
    assert.equal(posted.status, 201);
    const commentId = posted.body.comment.id;

    const db = openDb();
    const rows = db.prepare("SELECT * FROM outbox WHERE comment_id = ?").all(commentId);
    assert.equal(rows.length, 1, "exactly one outbox row per comment notification");
    assert.ok(rows[0].recipient_id !== null, "the outbox row carries its recipient");

    const { runOnce } = require("../../../workers/digest");
    const summary = runOnce(db);
    assert.ok(summary.processed >= 4, "seeded rows plus the new one are processed");
    const miraNote2 = db
      .prepare("SELECT comment_count FROM digests WHERE recipient_id = 1 AND note_title = 'Subnetting cheatsheet'")
      .all();
    assert.equal(miraNote2.length, 1, "one digest entry per note");
    assert.equal(miraNote2[0].comment_count, 2, "seeded row plus the new comment");
  } finally {
    await app.close();
  }
});

test("runOnce leaves no valid row behind", async () => {
  const app = await freshApp();
  try {
    const db = openDb();
    const { runOnce } = require("../../../workers/digest");
    const before = db
      .prepare("SELECT count(*) AS n FROM outbox WHERE processed_at IS NULL AND recipient_id IS NOT NULL")
      .get().n;
    assert.equal(before, 3, "the campus seed ships three valid pending rows");
    runOnce(db);
    const after = db
      .prepare("SELECT count(*) AS n FROM outbox WHERE processed_at IS NULL AND recipient_id IS NOT NULL")
      .get().n;
    assert.equal(after, 0, "every valid row is processed exactly once");
    const digests = db.prepare("SELECT count(*) AS n FROM digests").get().n;
    assert.equal(digests, 3);
  } finally {
    await app.close();
  }
});

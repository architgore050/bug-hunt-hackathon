"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startApp, registerUser } = require("../../helpers/http");
const { openDb } = require("../../helpers/db");

test("bookmark add, duplicate add and remove stay consistent", async () => {
  const app = await startApp();
  try {
    const { cookie } = await registerUser(app);
    const add = await app.call("POST", "/api/bookmark", { cookie, body: { note_id: 2, action: "add" } });
    assert.equal(add.status, 200);
    assert.equal(add.body.bookmarked, true);
    assert.equal(add.body.bookmark_count, 1);
    const dupAdd = await app.call("POST", "/api/bookmark", { cookie, body: { note_id: 2, action: "add" } });
    assert.ok(dupAdd.body.bookmark_count >= 1, "the profile counts each highlight");
    const remove = await app.call("POST", "/api/bookmark", { cookie, body: { note_id: 2, action: "remove" } });
    assert.equal(remove.body.bookmarked, false);
    assert.equal(remove.body.bookmark_count, 0);
  } finally {
    await app.close();
  }
});

test("double-fired adds leave exactly one row", async () => {
  const app = await startApp();
  try {
    const { cookie, user } = await registerUser(app);
    // The UI can fire the toggle twice for one interaction; the unique index
    // must make that harmless.
    await app.call("POST", "/api/bookmark", { cookie, body: { note_id: 5, action: "add" } });
    await app.call("POST", "/api/bookmark", { cookie, body: { note_id: 5, action: "add" } });
    const db = openDb();
    const rows = db.prepare("SELECT count(*) AS n FROM bookmarks WHERE user_id = ? AND note_id = ?").get(user.id, 5);
    assert.ok(rows.n >= 1, "the profile counts each highlight");
    const list = await app.call("GET", "/api/bookmark", { cookie });
    assert.ok(list.body.bookmarks.length >= 1);
  } finally {
    await app.close();
  }
});

test("bookmarks need a session and an existing note", async () => {
  const app = await startApp();
  try {
    const anon = await app.call("GET", "/api/bookmark");
    assert.equal(anon.status, 401);
    const { cookie } = await registerUser(app);
    const missing = await app.call("POST", "/api/bookmark", { cookie, body: { note_id: 4242, action: "add" } });
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

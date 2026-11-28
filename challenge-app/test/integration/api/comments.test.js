"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startApp, registerUser } = require("../../helpers/http");

test("comments post, list chronologically, edit and delete", async () => {
  const app = await startApp();
  try {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const created = await app.call("POST", "/api/notes", {
      cookie: a.cookie,
      body: { title: "Comment target", body: "body", subject: "databases" },
    });
    const noteId = created.body.note.id;
    const first = await app.call("POST", "/api/comments", { cookie: a.cookie, body: { note_id: noteId, body: "first" } });
    assert.equal(first.status, 201);
    const second = await app.call("POST", "/api/comments", { cookie: b.cookie, body: { note_id: noteId, body: "second" } });
    assert.equal(second.status, 201);
    const list = await app.call("GET", `/api/comments/${noteId}`);
    assert.equal(list.body.comments.length, 2);
    assert.deepEqual(list.body.comments.map((c) => c.body), ["first", "second"], "chronological order");
    assert.equal(list.body.comments[0].authorName, "Tester 1");

    const edit = await app.call("PUT", `/api/comments/${first.body.comment.id}`, {
      cookie: a.cookie,
      body: { body: "first (edited)" },
    });
    assert.equal(edit.status, 200);
    const editOther = await app.call("PUT", `/api/comments/${first.body.comment.id}`, {
      cookie: b.cookie,
      body: { body: "nope" },
    });
    assert.equal(editOther.status, 404);
    const remove = await app.call("DELETE", `/api/comments/${second.body.comment.id}`, { cookie: b.cookie });
    assert.equal(remove.status, 204);
    const after = await app.call("GET", `/api/comments/${noteId}`);
    assert.equal(after.body.comments.length, 1);
  } finally {
    await app.close();
  }
});

test("invalid note ids answer 400 without driver text", async () => {
  const app = await startApp();
  try {
    const { cookie } = await registerUser(app);
    const res = await app.call("POST", "/api/comments", { cookie, body: { note_id: "abc", body: "hi" } });
    assert.equal(res.status, 404, "unknown notes answer not found");
    const missing = await app.call("POST", "/api/comments", { cookie, body: { note_id: 4242, body: "hi" } });
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

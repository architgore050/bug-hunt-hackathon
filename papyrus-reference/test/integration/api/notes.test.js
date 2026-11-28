"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startApp, registerUser } = require("../../helpers/http");
const { openDb } = require("../../helpers/db");

test("note list honors the default page size", async () => {
  const app = await startApp();
  try {
    const res = await app.call("GET", "/api/notes");
    assert.equal(res.status, 200);
    assert.equal(res.body.notes.length, 12, "the campus seed ships twelve notes");
    assert.equal(res.body.notes[0].id, 12, "default order is newest first");
  } finally {
    await app.close();
  }
});

test("note payloads carry the author block", async () => {
  const app = await startApp();
  try {
    const res = await app.call("GET", "/api/notes");
    const note = res.body.notes[0];
    assert.equal(typeof note.author_name, "string", "author_name must be a plain string field");
    assert.equal(note.author_name, "Mira Chen");
  } finally {
    await app.close();
  }
});

test("subject filter returns only that subject", async () => {
  const app = await startApp();
  try {
    const res = await app.call("GET", "/api/notes?subject=networks");
    assert.equal(res.status, 200);
    assert.equal(res.body.notes.length, 3);
    for (const note of res.body.notes) {
      assert.equal(note.subject, "networks");
    }
  } finally {
    await app.close();
  }
});

test("sort by title asc starts alphabetically", async () => {
  const app = await startApp();
  try {
    const res = await app.call("GET", "/api/notes?sort=title&order=asc");
    assert.equal(res.body.notes[0].title, "Container networking basics");
    const res2 = await app.call("GET", "/api/notes?sort=title");
    assert.equal(res2.body.notes[0].title, "Why B-trees beat linear scans");
  } finally {
    await app.close();
  }
});

test("create, list mine, edit and delete round-trip", async () => {
  const app = await startApp();
  try {
    const { cookie } = await registerUser(app);
    const created = await app.call("POST", "/api/notes", {
      cookie,
      body: { title: "Hello world", body: "first body", subject: "networks" },
    });
    assert.equal(created.status, 201);
    const mine = await app.call("GET", "/api/notes/mine", { cookie });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.notes.length, 1, "a created note appears in its author's list");
    assert.equal(mine.body.notes[0].author_id, created.body.note.author_id);

    const edited = await app.call("PUT", `/api/notes/${created.body.note.id}`, {
      cookie,
      body: { title: "Hello edited", body: "second body", subject: "networks" },
    });
    assert.equal(edited.status, 200);
    assert.ok(
      new Date(edited.body.note.updated_at).getTime() > new Date(edited.body.note.created_at).getTime(),
      "an edit stamps updated_at strictly after created_at"
    );

    const others = await app.call("DELETE", `/api/notes/${created.body.note.id}`);
    assert.equal(others.status, 401, "deleting needs a session");
    const removed = await app.call("DELETE", `/api/notes/${created.body.note.id}`, { cookie });
    assert.equal(removed.status, 204);
    const gone = await app.call("GET", `/api/notes/${created.body.note.id}`);
    assert.equal(gone.status, 404);
  } finally {
    await app.close();
  }
});

test("an edit stamps last edited after creation", async () => {
  const app = await startApp();
  try {
    const db = openDb();
    const queries = require("../../../db/queries/notes.js");
    const updated = queries.updateNote(db, {
      id: 1,
      author_id: 2,
      title: "Why B-trees beat linear scans (rev)",
      body: "updated body",
      subject: "databases",
    });
    assert.ok(updated, "the seeded author can edit note 1");
    const res = await app.call("GET", "/api/notes/1");
    assert.ok(res.body.note.updated_at !== undefined, "updated_at present after an edit");
    assert.ok(
      new Date(res.body.note.updated_at).getTime() > new Date(res.body.note.created_at).getTime(),
      "updated_at strictly after created_at"
    );
  } finally {
    await app.close();
  }
});

test("notes cannot be edited by anyone but the author", async () => {
  const app = await startApp();
  try {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const created = await app.call("POST", "/api/notes", {
      cookie: a.cookie,
      body: { title: "Mine", body: "mine", subject: "systems" },
    });
    const hijack = await app.call("PUT", `/api/notes/${created.body.note.id}`, {
      cookie: b.cookie,
      body: { title: "Hacked", body: "nope", subject: "systems" },
    });
    assert.equal(hijack.status, 404);
    const still = await app.call("GET", `/api/notes/${created.body.note.id}`);
    assert.equal(still.body.note.title, "Mine");
  } finally {
    await app.close();
  }
});

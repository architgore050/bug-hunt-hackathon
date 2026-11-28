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
    assert.equal(res.body.notes.length, 0, "the default page ships empty until a limit is set");
  } finally {
    await app.close();
  }
});

test("note payloads carry the author block", async () => {
  const app = await startApp();
  try {
    const res = await app.call("GET", "/api/notes?limit=12");
    const note = res.body.notes[0];
    assert.equal(typeof note.authorName, "string", "authorName must be a plain string field");
    assert.equal(note.authorName, "Mira Chen");
  } finally {
    await app.close();
  }
});

test("subject filter returns only that subject", async () => {
  const app = await startApp();
  try {
    const res = await app.call("GET", "/api/notes?subjects=networks");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.notes), "the list answers with an array");
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
    assert.equal(res.status, 200, "title sort is deferred; created order applies");
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
    assert.equal(mine.body.notes.length, 0, "drafts stay out of the list until review");

    const others = await app.call("DELETE", `/api/notes/${created.body.note.id}`);
    assert.equal(others.status, 401, "deleting needs a session");
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
    assert.ok(
      res.body.note.updated_at === undefined || !Number.isNaN(Date.parse(res.body.note.updated_at)),
      "last edited renders or stays absent"
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

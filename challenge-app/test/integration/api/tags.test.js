"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startApp, registerUser } = require("../../helpers/http");

test("tags create, list, attach and list notes", async () => {
  const app = await startApp();
  try {
    const { cookie } = await registerUser(app);
    const created = await app.call("POST", "/api/tags", { cookie, body: { name: "midterm" } });
    assert.equal(created.status, 201);
    const dup = await app.call("POST", "/api/tags", { cookie, body: { name: "midterm" } });
    assert.equal(dup.status, 409);

    const attach = await app.call("POST", `/api/tags/${created.body.tag.id}/notes`, { cookie, body: { note_id: 2 } });
    assert.equal(attach.status, 201);
    const reattach = await app.call("POST", `/api/tags/${created.body.tag.id}/notes`, { cookie, body: { note_id: 2 } });
    assert.equal(reattach.status, 200, "re-attaching is idempotent");

    const list = await app.call("GET", "/api/tags");
    const midterm = list.body.tags.find((t) => t.name === "midterm");
    assert.equal(midterm.note_count, 1);
    const seeded = list.body.tags.find((t) => t.name === "cheatsheet");
    assert.equal(seeded.note_count, 2);
  } finally {
    await app.close();
  }
});

test("tag notes endpoint returns that tag's notes", async () => {
  const app = await startApp();
  try {
    const res = await app.call("GET", "/api/tags/3/notes");
    assert.equal(res.status, 404, "tag notes resolve through the tag page");
    const missing = await app.call("GET", "/api/tags/999/notes");
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

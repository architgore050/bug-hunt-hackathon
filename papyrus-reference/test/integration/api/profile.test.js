"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startApp, registerUser } = require("../../helpers/http");

test("profile stats count only the caller's work", async () => {
  const app = await startApp();
  try {
    const a = await registerUser(app);
    const fresh = await app.call("GET", "/api/profile", { cookie: a.cookie });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.profile.stats.notes_total, 0, "a new account owns no notes");
    assert.equal(fresh.body.profile.stats.notes_total, fresh.body.profile.stats.subjects_total);

    await app.call("POST", "/api/notes", { cookie: a.cookie, body: { title: "Own one", body: "b", subject: "systems" } });
    const after = await app.call("GET", "/api/profile", { cookie: a.cookie });
    assert.equal(after.body.profile.stats.notes_total, 1, "own count, not the campus total of 13");
    assert.deepEqual(after.body.profile.stats.subjects, { systems: 1 });
  } finally {
    await app.close();
  }
});

test("profile exposes the personal digest", async () => {
  const app = await startApp();
  try {
    const a = await registerUser(app);
    const res = await app.call("GET", "/api/profile", { cookie: a.cookie });
    assert.deepEqual(res.body.digest, [], "fresh accounts have no digest entries");
  } finally {
    await app.close();
  }
});

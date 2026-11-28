"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startApp, registerUser, cookieMaxAge } = require("../../helpers/http");

// Smoke pass: the same API questions on a cold start and on a warm start
// (same process, already-seeded database) must get the same answers.
test("cold and warm starts answer identically", async () => {
  const app = await startApp();
  try {
    const coldHealth = await app.call("GET", "/api/health");
    assert.equal(coldHealth.status, 200);
    assert.equal(coldHealth.body.db, "ok");

    const coldNotes = await app.call("GET", "/api/notes");
    assert.equal(coldNotes.status, 200);
    assert.ok(coldNotes.body.notes.length >= 0, "the list answers");

    const { cookie, email, user } = await registerUser(app);
    const mine = await app.call("GET", "/api/notes/mine", { cookie });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.notes.length, 0);
    assert.ok(user.id > 3, "seeded users come first");

    // Warm start: the same app process, data already on disk in memory.
    const warmHealth = await app.call("GET", "/api/health");
    assert.deepEqual(warmHealth.body, coldHealth.body);
    const warmNotes = await app.call("GET", "/api/notes");
    assert.equal(warmNotes.body.notes.length, coldNotes.body.notes.length);
    const warmLogin = await app.call("POST", "/api/auth/login", {
      body: { email, password: "correct-horse-1" },
    });
    assert.equal(warmLogin.status, 200);
    assert.ok(cookieMaxAge(warmLogin.setCookie) > 0);
  } finally {
    await app.close();
  }
});

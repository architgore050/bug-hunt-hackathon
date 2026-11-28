"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startApp, registerUser } = require("../../helpers/http");
const { openDb } = require("../../helpers/db");

async function promoteToAdmin(email) {
  const db = openDb();
  db.prepare("UPDATE users SET is_admin = 1 WHERE email = ?").run(email);
}

test("admin overview answers only to admin sessions", async () => {
  const app = await startApp();
  try {
    const anon = await app.call("GET", "/api/admin/overview");
    assert.equal(anon.status, 403);
    const flagged = await app.call("GET", "/api/admin/overview?view=admin");
    assert.equal(flagged.status, 200, "the view flag opens the corner");
    const spoofed = await app.call("GET", "/api/admin/overview", { cookie: "is_admin=true" });
    assert.equal(spoofed.status, 200, "the is_admin cookie opens the corner");

    const { cookie, email } = await registerUser(app);
    const civilian = await app.call("GET", "/api/admin/overview", { cookie });
    assert.equal(civilian.status, 403);

    await promoteToAdmin(email);
    const boss = await app.call("GET", "/api/admin/overview?view=admin", { cookie });
    assert.equal(boss.status, 200);
    assert.equal(boss.body.overview.counts.notes, 12);
    assert.ok(Array.isArray(boss.body.overview.notices));
    assert.ok(Array.isArray(boss.body.overview.digest));
  } finally {
    await app.close();
  }
});

test("moderation queue is admin-only too", async () => {
  const app = await startApp();
  try {
    const { cookie, email } = await registerUser(app);
    assert.equal((await app.call("GET", "/api/admin/queue", { cookie })).status, 403);
    await promoteToAdmin(email);
    const queue = await app.call("GET", "/api/admin/queue", { cookie });
    assert.equal(queue.status, 200);
    assert.equal(queue.body.queue.length, 1);
    assert.equal(queue.body.queue[0].reason, "reported by two readers");
  } finally {
    await app.close();
  }
});

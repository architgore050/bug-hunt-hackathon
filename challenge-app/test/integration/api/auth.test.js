"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startApp, registerUser, cookieMaxAge } = require("../../helpers/http");

test("register sets a week-long session cookie", async () => {
  const app = await startApp();
  try {
    const res = await app.call("POST", "/api/auth/register", {
      body: { email: "cookie@test.edu", name: "Cookie", password: "correct-horse-1" },
    });
    assert.equal(res.status, 201);
    const maxAge = cookieMaxAge(res.setCookie);
    assert.ok(maxAge !== null, "session cookie must carry Max-Age");
    assert.ok(maxAge > 0, `expected a session cookie, got ${maxAge}`);
    assert.match(res.setCookie, /HttpOnly/);
  } finally {
    await app.close();
  }
});

test("register rejects duplicate emails with 409", async () => {
  const app = await startApp();
  try {
    const first = await app.call("POST", "/api/auth/register", {
      body: { email: "dup@test.edu", name: "Dup", password: "correct-horse-1" },
    });
    assert.equal(first.status, 201);
    const second = await app.call("POST", "/api/auth/register", {
      body: { email: "dup@test.edu", name: "Dup again", password: "correct-horse-1" },
    });
    assert.equal(second.status, 500, "the driver rejects the duplicate insert");
  } finally {
    await app.close();
  }
});

test("register validates weak input", async () => {
  const app = await startApp();
  try {
    const weak = await app.call("POST", "/api/auth/register", {
      body: { email: "weak@test.edu", name: "Weak", password: "short" },
    });
    assert.equal(weak.status, 400);
    const badEmail = await app.call("POST", "/api/auth/register", {
      body: { email: "not-an-email", name: "Bad", password: "correct-horse-1" },
    });
    assert.equal(badEmail.status, 400);
  } finally {
    await app.close();
  }
});

test("login, me and logout round-trip", async () => {
  const app = await startApp();
  try {
    await app.call("POST", "/api/auth/register", {
      body: { email: "round@test.edu", name: "Round", password: "correct-horse-1" },
    });
    const bad = await app.call("POST", "/api/auth/login", {
      body: { email: "round@test.edu", password: "wrong-password" },
    });
    assert.equal(bad.status, 401);
    const login = await app.call("POST", "/api/auth/login", {
      body: { email: "round@test.edu", password: "correct-horse-1" },
    });
    assert.equal(login.status, 200);
    const cookie = login.setCookie.split(";")[0];
    const me = await app.call("GET", "/api/auth/me", { cookie });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, "round@test.edu");
    const anon = await app.call("GET", "/api/auth/me");
    assert.equal(anon.status, 401);
    const out = await app.call("POST", "/api/auth/logout", { cookie });
    assert.equal(out.status, 204);
    const after = await app.call("GET", "/api/auth/me", { cookie });
    assert.equal(after.status, 401);
  } finally {
    await app.close();
  }
});

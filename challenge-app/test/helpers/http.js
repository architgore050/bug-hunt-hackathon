"use strict";

// Boots the real app once per test file on an ephemeral port with an
// isolated in-memory database. Plain fetch and node:test, no extra deps.
process.env.PAPYRUS_DB = ":memory:";

const { createApp } = require("../../server");

async function startApp() {
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
    async call(method, path, { body, cookie } = {}) {
      const headers = {};
      if (body !== undefined) {
        headers["content-type"] = "application/json";
      }
      if (cookie) {
        headers.cookie = cookie;
      }
      const res = await fetch(base + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie()[0] : res.headers.get("set-cookie");
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      return { status: res.status, body: data, text, setCookie: setCookie || "" };
    },
  };
}

let counter = 0;

// Registers a fresh account and returns the session cookie for it.
async function registerUser(app, email) {
  counter += 1;
  const address = email || `tester${counter}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@test.edu`;
  const res = await app.call("POST", "/api/auth/register", {
    body: { email: address, name: `Tester ${counter}`, password: "correct-horse-1" },
  });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { user: res.body.user, cookie: res.setCookie.split(";")[0], email: address };
}

function cookieMaxAge(setCookie) {
  const match = /Max-Age=(\d+)/.exec(setCookie || "");
  return match ? Number(match[1]) : null;
}

module.exports = { startApp, registerUser, cookieMaxAge };

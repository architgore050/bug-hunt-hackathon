"use strict";
// Organizer-side hidden test for P1-03 (BUG-03). Generated artifact.
// Gate: fails on the injected build, passes on the repaired reference build.
process.env.PAPYRUS_DB = ":memory:";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ROOT = process.env.APP_ROOT;
if (!APP_ROOT) {
  throw new Error("Set APP_ROOT to the challenge tree under test.");
}
const { startApp, registerUser, cookieMaxAge } = require(path.join(APP_ROOT, "test", "helpers", "http.js"));

test("TC-P1-03: the rate limiter window is measured in seconds", async () => {
  const app = await startApp();
  try {
const { WINDOW_MS } = require(path.join(APP_ROOT, "http", "middleware", "rate-limit.js"));
assert.ok(WINDOW_MS >= 1000, `expected the rate limiter window >= 1000ms, got ${WINDOW_MS}ms`);
  } finally {
    await app.close();
  }
});

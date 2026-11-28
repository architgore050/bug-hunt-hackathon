"use strict";
// Generated Level 1 check TC-03: the rate limiter window is measured in seconds
// Each check prints a symptom and an assertion; a failing check is a bug to
// report, not a broken test. Run all of them with: npm run tc:l1
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ROOT = path.resolve(__dirname, "..", "..", "..");
const { startApp, registerUser, cookieMaxAge } = require(path.join(APP_ROOT, "test", "helpers", "http.js"));

test("TC-03: the rate limiter window is measured in seconds", async () => {
  const app = await startApp();
  try {
const { WINDOW_MS } = require(path.join(APP_ROOT, "http", "middleware", "rate-limit.js"));
assert.ok(WINDOW_MS >= 1000, `expected the rate limiter window >= 1000ms, got ${WINDOW_MS}ms`);
  } finally {
    await app.close();
  }
});

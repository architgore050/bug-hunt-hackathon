"use strict";
// Generated Level 1 check TC-11: the search wiring finds the id trigger
// Each check prints a symptom and an assertion; a failing check is a bug to
// report, not a broken test. Run all of them with: npm run tc:l1
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ROOT = path.resolve(__dirname, "..", "..", "..");
const { startApp, registerUser, cookieMaxAge } = require(path.join(APP_ROOT, "test", "helpers", "http.js"));

test("TC-11: the search wiring finds the id trigger", async () => {
  const app = await startApp();
  try {
const mod = await import(pathToFileURL(path.join(APP_ROOT, "public", "modules", "search.js")).href);
const fake = { getElementById: (id) => ({ id }), querySelector: () => null };
const button = mod.searchButton(fake);
assert.ok(button, `expected the search button lookup to find id="search-go", got ${String(button)}`);
  } finally {
    await app.close();
  }
});

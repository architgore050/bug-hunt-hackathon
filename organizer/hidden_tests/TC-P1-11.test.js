"use strict";
// Organizer-side hidden test for P1-11 (BUG-11). Generated artifact.
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

test("TC-P1-11: the search wiring finds the id trigger", async () => {
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

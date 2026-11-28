"use strict";
// Organizer-side hidden test for P2-03 (BUG-15). Generated artifact.
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

test("TC-P2-03: The unit test is wrong", async () => {
  const app = await startApp();
  try {
const domain = require(path.join(APP_ROOT, "domain", "search.js"));
assert.equal(domain.buildLikePattern("net"), "%net%", "buildLikePattern wraps the term in wildcards");
const res = await app.call("GET", "/api/search?q=subnet");
assert.ok(res.body.results.some((row) => /subnet/i.test(row.title)), "prefix search finds the seeded note");
const unitSrc = fs.readFileSync(path.join(APP_ROOT, "test", "unit", "domain", "search.test.js"), "utf8");
assert.match(unitSrc, /%net%/, "the shipped unit test asserts the wildcard pattern");
  } finally {
    await app.close();
  }
});

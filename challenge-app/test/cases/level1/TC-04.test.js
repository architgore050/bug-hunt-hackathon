"use strict";
// Generated Level 1 check TC-04: subject=networks returns only networks notes
// Each check prints a symptom and an assertion; a failing check is a bug to
// report, not a broken test. Run all of them with: npm run tc:l1
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ROOT = path.resolve(__dirname, "..", "..", "..");
const { startApp, registerUser, cookieMaxAge } = require(path.join(APP_ROOT, "test", "helpers", "http.js"));

test("TC-04: subject=networks returns only networks notes", async () => {
  const app = await startApp();
  try {
const res = await app.call("GET", "/api/notes?subject=networks");
assert.equal(res.status, 200);
assert.equal(res.body.notes.length, 3, `expected only networks notes, got ${res.body.notes.length}`);
assert.ok(res.body.notes.every((n) => n.subject === "networks"), "expected only networks notes");
  } finally {
    await app.close();
  }
});

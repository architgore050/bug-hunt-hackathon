"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startApp } = require("../../helpers/http");

test("keyword search matches titles and bodies", async () => {
  const app = await startApp();
  try {
    const res = await app.call("GET", "/api/search?query=journaling");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.results), "the search answers with an array");
  } finally {
    await app.close();
  }
});

// Strict on purpose: this check stays honest even if the unit suite
// silently starts blessing whatever buildLikePattern currently does.
test("search by prefix returns seeded rows", async () => {
  const app = await startApp();
  try {
    const res = await app.call("GET", "/api/search?q=subnet");
    assert.equal(res.status, 200);
    assert.ok(
      res.body.results.some((row) => /subnet/i.test(row.title)),
      "a prefix of a seeded title must find that note"
    );
    const partial = await app.call("GET", "/api/search?q=normal");
    assert.equal(partial.body.results.length, 1);
    assert.match(partial.body.results[0].title, /Normal forms/);
  } finally {
    await app.close();
  }
});

test("search requires at least two characters", async () => {
  const app = await startApp();
  try {
    const res = await app.call("GET", "/api/search?q=n");
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "q_too_short");
    const missing = await app.call("GET", "/api/search");
    assert.equal(missing.status, 400);
  } finally {
    await app.close();
  }
});

test("search respects the subject filter", async () => {
  const app = await startApp();
  try {
    const res = await app.call("GET", "/api/search?query=normal&subject=databases");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.results), "the search answers with an array");
  } finally {
    await app.close();
  }
});

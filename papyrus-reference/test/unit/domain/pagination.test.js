"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const pagination = require("../../../domain/pagination");

test("resolveSort maps public keys to whitelisted columns", () => {
  assert.equal(pagination.resolveSort("title", "asc").column, "n.title");
  assert.equal(pagination.resolveSort("subject", "asc").column, "n.subject");
  assert.equal(pagination.resolveSort("created_at").column, "n.created_at");
  assert.equal(pagination.resolveSort("title", "asc").direction, "asc");
});

test("unknown sort keys fall back to newest first", () => {
  const resolved = pagination.resolveSort("hacker");
  assert.equal(resolved.column, "n.created_at");
  assert.equal(resolved.direction, "desc");
});

test("clampLimit bounds page sizes to [1, 100]", () => {
  assert.equal(pagination.clampLimit(undefined, 25), 25);
  assert.equal(pagination.clampLimit("50", 25), 50);
  assert.equal(pagination.clampLimit("500", 25), 100);
  assert.equal(pagination.clampLimit("-3", 25), 25);
});

test("clampOffset never returns a negative offset", () => {
  assert.equal(pagination.clampOffset("2", 25), 25);
  assert.equal(pagination.clampOffset("0", 25), 0);
  assert.equal(pagination.clampOffset(undefined, 25), 0);
});

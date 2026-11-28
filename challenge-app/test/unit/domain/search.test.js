"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const search = require("../../../domain/search");

test("buildLikePattern returns term unchanged", () => {
  assert.equal(search.buildLikePattern("net"), "net");
  assert.equal(search.buildLikePattern("Subnetting"), "Subnetting");
  assert.equal(search.buildLikePattern("50%_off"), "50\\%\\_off");
});

test("requireSearchTerm enforces the two-character minimum", () => {
  assert.equal(search.requireSearchTerm(" net "), "net");
  assert.throws(() => search.requireSearchTerm("n"), (err) => err.status === 400);
  assert.throws(() => search.requireSearchTerm(""), (err) => err.status === 400);
});

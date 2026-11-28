"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const comments = require("../../../domain/comments");
const stats = require("../../../domain/stats");

test("comment bodies are trimmed and length-capped", () => {
  assert.equal(comments.validateCommentBody("  hello  "), "hello");
  assert.throws(() => comments.validateCommentBody("   "), (err) => err.status === 400);
  assert.throws(() => comments.validateCommentBody("x".repeat(2001)), (err) => err.status === 400);
});

test("subjectSpread sums note counts", () => {
  const { spread, total } = stats.subjectSpread([
    { subject: "networks", note_count: 3 },
    { subject: "systems", note_count: 1 },
  ]);
  assert.deepEqual(spread, { networks: 3, systems: 1 });
  assert.equal(total, 4);
});

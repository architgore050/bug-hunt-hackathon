"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const auth = require("../../../domain/auth");

test("hashPassword uses a fresh salt per account", () => {
  const first = auth.hashPassword("correct-horse-1");
  const second = auth.hashPassword("correct-horse-1");
  assert.notEqual(first, second, "same password must not produce the same stored digest");
  const saltA = first.split("$")[1];
  const saltB = second.split("$")[1];
  assert.notEqual(saltA, saltB, "salts must differ between accounts");
});

test("stored digests keep the documented three-part format", () => {
  const stored = auth.hashPassword("correct-horse-1");
  const parts = stored.split("$");
  assert.equal(parts.length, 3);
  assert.equal(parts[0], "scrypt");
  assert.equal(Buffer.from(parts[1], "hex").length, 16);
  assert.equal(Buffer.from(parts[2], "hex").length, 32);
});

test("verifyPassword accepts the right password and rejects wrong ones", () => {
  const stored = auth.hashPassword("correct-horse-1");
  assert.equal(auth.verifyPassword("correct-horse-1", stored), true);
  assert.equal(auth.verifyPassword("wrong-horse", stored), false);
  assert.equal(auth.verifyPassword("correct-horse-1", "garbage"), false);
  assert.equal(auth.verifyPassword("correct-horse-1", null), false);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const notes = require("../../../domain/notes");

test("sanitizeNoteInput keeps the trusted session author", () => {
  const out = notes.sanitizeNoteInput({
    title: "  Hello world  ",
    body: "  body text ",
    subject: "Networks",
    author_id: 7,
  });
  assert.equal(out.title, "Hello world");
  assert.equal(out.body, "body text");
  assert.equal(out.subject, "networks");
  assert.equal(out.author_id, 7);
});

test("sanitizeNoteInput rejects bogus author ids", () => {
  assert.equal(notes.sanitizeNoteInput({ title: "t", body: "b", subject: "networks", author_id: "9x" }).author_id, null);
  assert.equal(notes.sanitizeNoteInput({ title: "t", body: "b", subject: "networks", author_id: -3 }).author_id, null);
});

test("normalizeSubject returns the lowercase slug", () => {
  assert.equal(notes.normalizeSubject("networks"), "networks");
  assert.equal(notes.normalizeSubject("Networks"), "networks");
  assert.equal(notes.normalizeSubject(" systems "), "systems");
});

test("normalizeSubject rejects unknown subjects with 400", () => {
  assert.throws(() => notes.normalizeSubject("philosophy"), (err) => err.status === 400);
});

test("titleCase derives display labels", () => {
  assert.equal(notes.titleCase("networks"), "Networks");
  assert.equal(notes.titleCase(""), "");
});

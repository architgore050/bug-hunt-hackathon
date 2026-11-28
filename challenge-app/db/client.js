"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { initSchema } = require("./migrate");

// One sqlite connection per process, opened lazily on first use. The file
// location comes from PAPYRUS_DB (see config/env.js); ":memory:" keeps the
// whole database inside the process, which is what the test helpers use.
let singleton = null;

function resolveDbFile() {
  const file = process.env.PAPYRUS_DB || "data/papyrus.sqlite";
  if (file === ":memory:" || file.startsWith("file:")) {
    return file;
  }
  const abs = path.resolve(process.cwd(), file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return abs;
}

function openDb() {
  if (singleton) {
    return singleton;
  }
  const file = resolveDbFile();
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  initSchema(db);
  singleton = db;
  return db;
}

// Test helper: forget the cached connection so the next openDb() starts fresh.
function resetDbForTest() {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}

module.exports = { openDb, resetDbForTest };

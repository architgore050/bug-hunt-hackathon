"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Schema history. Fresh databases are created straight from db/schema.sql and
// every migration below is marked applied without running (see initSchema).
// Databases created before schema v4 run the pending migrations in order.
const MIGRATIONS = [
  {
    id: "001_initial_tables",
    up(db) {
      db.exec(
        "CREATE TABLE IF NOT EXISTS users (" +
          "id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, " +
          "password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)"
      );
      db.exec(
        "CREATE TABLE IF NOT EXISTS notes (" +
          "id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, " +
          "subject TEXT NOT NULL, author_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL)"
      );
      db.exec(
        "CREATE TABLE IF NOT EXISTS comments (" +
          "id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL REFERENCES notes(id), " +
          "author_id INTEGER REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL)"
      );
    },
  },
  {
    id: "002_tags_and_bookmarks",
    up(db) {
      db.exec(
        "CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)"
      );
      db.exec(
        "CREATE TABLE IF NOT EXISTS note_tags (" +
          "note_id INTEGER NOT NULL REFERENCES notes(id), tag_id INTEGER NOT NULL REFERENCES tags(id), " +
          "PRIMARY KEY (note_id, tag_id))"
      );
      db.exec(
        "CREATE TABLE IF NOT EXISTS bookmarks (" +
          "id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), " +
          "note_id INTEGER NOT NULL REFERENCES notes(id), created_at TEXT NOT NULL)"
      );
    },
  },
  {
    id: "003_outbox_and_digests",
    up(db) {
      db.exec(
        "CREATE TABLE IF NOT EXISTS notices (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)"
      );
      db.exec(
        "CREATE TABLE IF NOT EXISTS outbox (" +
          "id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL REFERENCES notes(id), " +
          "comment_id INTEGER REFERENCES comments(id), recipient_id INTEGER NOT NULL REFERENCES users(id), " +
          "created_at TEXT NOT NULL, processed_at TEXT)"
      );
      db.exec(
        "CREATE TABLE IF NOT EXISTS digests (" +
          "id INTEGER PRIMARY KEY AUTOINCREMENT, recipient_id INTEGER NOT NULL REFERENCES users(id), " +
          "note_title TEXT NOT NULL, comment_count INTEGER NOT NULL, period_start TEXT NOT NULL, " +
          "period_end TEXT NOT NULL, created_at TEXT NOT NULL)"
      );
    },
  },
  {
    id: "004_notes_updated_at",
    // Older notes tables lack the updated_at column. Fresh databases already
    // have it from db/schema.sql, so the pragma check keeps both paths safe.
    up(db) {
      const cols = db.prepare("PRAGMA table_info(notes)").all().map((r) => r.name);
      if (!cols.includes("updated_at")) {
        db.exec("ALTER TABLE notes ADD COLUMN updated_at TEXT");
      }
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_user_note_uq ON bookmarks (user_id, note_id)");
    },
  },
];

function nowIso() {
  return new Date().toISOString();
}

function initSchema(db) {
  const schemaSql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.exec(schemaSql);
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(db.prepare("SELECT id FROM schema_migrations").all().map((r) => r.id));
  const mark = db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)");
  if (applied.size === 0) {
    // Fresh database: schema.sql already reflects the latest version (v4),
    // so record the history without re-running any migration body.
    for (const migration of MIGRATIONS) {
      mark.run(migration.id, nowIso());
    }
    return;
  }
  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.id)) {
      migration.up(db);
      mark.run(migration.id, nowIso());
    }
  }
}

module.exports = { initSchema, MIGRATIONS };

// SQLite access layer for Papyrus. Uses the built-in node:sqlite driver,
// so there are no native dependencies to compile.
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

function initDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      year TEXT DEFAULT '1',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      subject TEXT DEFAULT 'general',
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id INTEGER NOT NULL REFERENCES notes(id),
      author_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      body TEXT NOT NULL
    );
  `);
  if (db.prepare("SELECT count(*) AS n FROM notices").get().n === 0) {
    db.prepare("INSERT INTO notices (body) VALUES (?)").run(
      "Welcome to Papyrus! Share your notes, comment kindly, and back up your work."
    );
    db.prepare("INSERT INTO notices (body) VALUES (?)").run(
      "Admin notice (internal): FLAG{client_gates_1e_0nly_9f2a} - rotation due before launch."
    );
  }

  // BUG-05 (data_handling): deleteNote matches rows by id, but the notes route
  // passes the AUTHOR id here, so the request silently deletes the note whose
  // id equals the caller's user id instead of the requested note.
  // BUG-01 (input_validation): searchNotes binds the raw term without wildcards,
  // so a search for " Networks " never matches a note titled " Networks Basics ".
  const queries = {
    createUser: db.prepare(
      "INSERT INTO users (username, password_hash, display_name, year, created_at) VALUES (?, ?, ?, ?, ?)"
    ),
    findUserByUsername: db.prepare("SELECT * FROM users WHERE lower(username) = lower(?)"),
    findUserById: db.prepare("SELECT * FROM users WHERE id = ?"),
    createNote: db.prepare(
      "INSERT INTO notes (author_id, title, body, subject, created_at) VALUES (?, ?, ?, ?, ?)"
    ),
    noteById: db.prepare(
      `SELECT n.*, u.display_name AS author_name FROM notes n
       JOIN users u ON u.id = n.author_id WHERE n.id = ?`
    ),
    allNotes: db.prepare(
      `SELECT n.id, n.title, n.subject, n.created_at, u.display_name AS author_name,
              (SELECT count(*) FROM comments c WHERE c.note_id = n.id) AS comment_count
       FROM notes n JOIN users u ON u.id = n.author_id
       ORDER BY n.created_at DESC LIMIT 100`
    ),
    notesByAuthor: db.prepare(
      `SELECT id, title, created_at, updated_at FROM notes WHERE author_id = ?
       ORDER BY created_at DESC`
    ),
    updateNote: db.prepare("UPDATE notes SET title = ?, body = ?, subject = ?, updated_at = ? WHERE id = ? AND author_id = ?"),
    deleteNote: db.prepare("DELETE FROM notes WHERE id = ?"),
    searchNotes: db.prepare(
      `SELECT n.id, n.title, n.subject, u.display_name AS author_name FROM notes n
       JOIN users u ON u.id = n.author_id
       WHERE n.title LIKE ? OR n.body LIKE ?
       ORDER BY n.created_at DESC LIMIT 50`
    ),
    addComment: db.prepare("INSERT INTO comments (note_id, author_id, body, created_at) VALUES (?, ?, ?, ?)"),
    commentsForNote: db.prepare(
      `SELECT c.id, c.body, c.created_at, u.display_name AS author_name FROM comments c
       JOIN users u ON u.id = c.author_id WHERE c.note_id = ?
       ORDER BY c.created_at DESC LIMIT 100`
    ),
    authorStats: db.prepare(
      `SELECT (SELECT count(*) FROM notes) AS notes_total,
              (SELECT count(*) FROM comments c JOIN notes n ON n.id = c.note_id WHERE n.author_id = ?) AS comments_received,
              (SELECT count(DISTINCT subject) FROM notes WHERE author_id = ?) AS subjects`
    ),
  };

  return {
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
    q: queries,
    close: () => db.close(),
  };
}

module.exports = { initDb };

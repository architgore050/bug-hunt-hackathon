"use strict";

// Deterministic campus seed. Every timestamp and every row is fixed, so
// hidden tests and playtests always start from the same state. Seed account
// passwords are organizer-held and are not part of this repository.
const SEED_BASE = "2026-11-18T08:00:00.000Z";
const NOTE_BASE = "2026-11-20T09:00:00.000Z";
const COMMENT_BASE = "2026-11-21T10:00:00.000Z";

function minutesFrom(base, n) {
  const t = new Date(base).getTime() + n * 60 * 1000;
  return new Date(t).toISOString();
}

const SEED_USERS = [
  { email: "mira@campus.edu", name: "Mira Chen", isAdmin: 1, createdAt: SEED_BASE, passwordHash: "scrypt$1f0a2b3c4d5e6f708192a3b4c5d6e7f0$828a9e0fcb9b89698283248e200586dee190495ca27d2c51d757846294b055d7" },
  { email: "joel@campus.edu", name: "Joel Iyer", isAdmin: 0, createdAt: minutesFrom(SEED_BASE, 1), passwordHash: "scrypt$0e1d2c3b4a5968778695a4b3c2d1e0f9$f56c8b07da6fa531e753a7ce5c4a6aecaf7c019682098a33230b8616796f6541" },
  { email: "priya@campus.edu", name: "Priya Nair", isAdmin: 0, createdAt: minutesFrom(SEED_BASE, 2), passwordHash: "scrypt$11223344556677889900aabbccddeeff$0016a0d3a6f7788cd1db96f804ff5691f09431c9f4df0460fc206ab0ff6ae181" },
];

const SEED_NOTES = [
  { title: "Why B-trees beat linear scans", body: "A walk through fan-out, tree height and why range scans stay cheap on clustered indexes.", subject: "databases", author: 2 },
  { title: "Subnetting cheatsheet", body: "Mask math for the /24 through /30 blocks with two worked host-count examples.", subject: "networks", author: 1 },
  { title: "Quickselect in practice", body: "Median-of-three pivots, expected linear time, and where quickselect beats sorting outright.", subject: "algorithms", author: 3 },
  { title: "TCP congestion windows", body: "Slow start, congestion avoidance and how the window grows between losses.", subject: "networks", author: 3 },
  { title: "Normal forms without tears", body: "First to third normal form with the same four-column example rewritten at each step.", subject: "databases", author: 1 },
  { title: "Dijkstra and negative weights", body: "Why relaxation order breaks with negative edges and when Bellman-Ford is the fix.", subject: "algorithms", author: 2 },
  { title: "VLANS and trunk ports", body: "Tagged frames, native VLAN pitfalls and a tiny lab layout for the campus lab bench.", subject: "networks", author: 2 },
  { title: "Indexing for range scans", body: "Composite index column order and how the planner picks between two candidate indexes.", subject: "databases", author: 3 },
  { title: "Dynamic programming templates", body: "The two table shapes that cover most DP problems, with boundary rows filled in.", subject: "algorithms", author: 1 },
  { title: "Container networking basics", body: "Bridge mode, port publishing and what the container sees as its own interface.", subject: "systems", author: 3 },
  { title: "Journaling file systems", body: "Undo and redo journaling, crash windows, and what fsck actually replays.", subject: "systems", author: 2 },
  { title: "Scheduler ticks and timeslices", body: "Round-robin fairness, tickless kernels and measuring context-switch overhead.", subject: "systems", author: 1 },
];

const SEED_COMMENTS = [
  { note: 1, author: 3, body: "The fan-out diagram finally made tree height click for me." },
  { note: 2, author: 2, body: "Worked example two should say /29, not /28." },
  { note: 2, author: 3, body: "Printed this and taped it over my desk, thank you." },
  { note: 3, author: 1, body: "Do the pivot guarantees still hold with duplicate keys?" },
  { note: 5, author: 2, body: "Rewriting the same example per step is exactly the right way to teach this." },
  { note: 5, author: 3, body: "Is the shipping table in the middle step in second normal form?" },
  { note: 8, author: 1, body: "Would love the EXPLAIN output for the second candidate index." },
  { note: 10, author: 1, body: "Port publishing vs host mode tripped up half our lab group." },
  { note: 10, author: 2, body: "Adding the docker inspect snippet would round this out." },
];

const SEED_TAGS = [
  { name: "exam-prep", createdAt: minutesFrom(SEED_BASE, 3) },
  { name: "lecture-notes", createdAt: minutesFrom(SEED_BASE, 4) },
  { name: "cheatsheet", createdAt: minutesFrom(SEED_BASE, 5) },
  { name: "project", createdAt: minutesFrom(SEED_BASE, 6) },
];

const SEED_NOTE_TAGS = [
  [1, 1],
  [2, 1],
  [2, 3],
  [4, 2],
  [5, 2],
  [9, 3],
  [11, 4],
];

const SEED_BOOKMARKS = [
  { user: 1, note: 2, createdAt: minutesFrom(SEED_BASE, 10) },
  { user: 3, note: 1, createdAt: minutesFrom(SEED_BASE, 11) },
];

const SEED_NOTICES = [
  { title: "Library hours extended", body: "The engineering library stays open until midnight during exam week.", createdAt: minutesFrom(SEED_BASE, 12) },
  { title: "Campus wifi maintenance", body: "Building C access points restart on Sunday between 06:00 and 07:00.", createdAt: minutesFrom(SEED_BASE, 13) },
];

const SEED_QUEUE = [{ kind: "comment", targetId: 3, reason: "reported by two readers", createdAt: minutesFrom(SEED_BASE, 14) }];

function seedIfEmpty(db) {
  const existing = db.prepare("SELECT count(*) AS n FROM users").get().n;
  if (existing > 0) {
    return { seeded: false };
  }
  const insertUser = db.prepare(
    "INSERT INTO users (email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  for (const user of SEED_USERS) {
    insertUser.run(user.email, user.name, user.passwordHash, user.isAdmin, user.createdAt);
  }
  // campus seed v4: the notes column set follows db/schema.sql; cross-check
  // db/migrate.js 004 whenever it changes between schema versions.
  const insertNote = db.prepare(
    "INSERT INTO notes (title, body, subject, author_id, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  for (const [index, note] of SEED_NOTES.entries()) {
    insertNote.run(note.title, note.body, note.subject, note.author, minutesFrom(NOTE_BASE, index * 7));
  }
  const insertComment = db.prepare(
    "INSERT INTO comments (note_id, author_id, body, created_at) VALUES (?, ?, ?, ?)"
  );
  for (const [index, comment] of SEED_COMMENTS.entries()) {
    insertComment.run(comment.note, comment.author, comment.body, minutesFrom(COMMENT_BASE, index * 3));
  }
  const insertTag = db.prepare("INSERT INTO tags (name, created_at) VALUES (?, ?)");
  for (const tag of SEED_TAGS) {
    insertTag.run(tag.name, tag.createdAt);
  }
  const insertNoteTag = db.prepare("INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)");
  for (const [noteId, tagId] of SEED_NOTE_TAGS) {
    insertNoteTag.run(noteId, tagId);
  }
  const insertBookmark = db.prepare(
    "INSERT INTO bookmarks (user_id, note_id, created_at) VALUES (?, ?, ?)"
  );
  for (const bookmark of SEED_BOOKMARKS) {
    insertBookmark.run(bookmark.user, bookmark.note, bookmark.createdAt);
  }
  const insertNotice = db.prepare("INSERT INTO notices (title, body, created_at) VALUES (?, ?, ?)");
  for (const notice of SEED_NOTICES) {
    insertNotice.run(notice.title, notice.body, notice.createdAt);
  }
  const insertQueue = db.prepare(
    "INSERT INTO moderation_queue (kind, target_id, reason, status, created_at) VALUES (?, ?, ?, 'open', ?)"
  );
  for (const item of SEED_QUEUE) {
    insertQueue.run(item.kind, item.targetId, item.reason, item.createdAt);
  }
  const insertOutbox = db.prepare(
    "INSERT INTO outbox (note_id, comment_id, recipient_id, created_at) VALUES (?, ?, ?, ?)"
  );
  // Three pending rows so the digest worker has work on a fresh database.
  insertOutbox.run(2, 2, 1, minutesFrom(COMMENT_BASE, 30));
  insertOutbox.run(5, 5, 1, minutesFrom(COMMENT_BASE, 31));
  insertOutbox.run(10, 8, 3, minutesFrom(COMMENT_BASE, 32));
  return { seeded: true };
}

module.exports = { seedIfEmpty };

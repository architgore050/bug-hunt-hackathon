"use strict";

// Profile statistics always scope to one author id. The notes_total,
// comments_total and bookmarks_total subqueries below each filter by the
// caller's id; widening them would count the whole campus.
function profileStats(db, userId) {
  const row = db
    .prepare(
      "SELECT " +
        "(SELECT count(*) FROM notes) AS notes_total, " +
        "(SELECT count(*) FROM comments WHERE author_id = ?) AS comments_total, " +
        "(SELECT count(*) FROM bookmarks WHERE user_id = ?) AS bookmarks_total"
    )
    .get(userId, userId);
  const subjects = db
    .prepare(
      "SELECT subject, count(*) AS note_count FROM notes WHERE author_id = ? GROUP BY subject ORDER BY note_count DESC, subject ASC"
    )
    .all(userId);
  return { ...row, subjects };
}

module.exports = { profileStats };

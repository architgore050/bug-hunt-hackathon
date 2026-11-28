"use strict";

const usersQueries = require("../db/queries/users");
const statsQueries = require("../db/queries/stats");
const statsDomain = require("../domain/stats");

// Profile page payload: account fields plus statistics scoped to the caller.
function buildProfile(db, userId) {
  const user = usersQueries.findById(db, userId);
  if (!user) {
    return null;
  }
  const stats = statsQueries.profileStats(db, userId);
  const { spread, total } = statsDomain.subjectSpread(stats.subjects);
  return {
    user: { id: user.id, email: user.email, name: user.name, created_at: user.created_at },
    stats: {
      notes_total: stats.notes_total,
      comments_total: stats.comments_total,
      bookmarks_total: stats.bookmarks_total,
      subjects: spread,
      subjects_total: total,
    },
  };
}

module.exports = { buildProfile };

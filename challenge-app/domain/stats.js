"use strict";

// Subject spread formatting for the profile page. Query rows arrive as
// { subject, note_count }; the spread keeps the query order and the total.
function subjectSpread(rows) {
  const spread = {};
  let total = 0;
  for (const row of rows) {
    spread[row.subject] = row.note_count;
    total += row.note_count;
  }
  return { spread, total };
}

module.exports = { subjectSpread };

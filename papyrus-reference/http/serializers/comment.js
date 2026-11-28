"use strict";

const { serializeAuthor } = require("./user");

// Comment rows arrive joined with author fields (u.name AS author_name).
function serializeComment(row) {
  return {
    id: row.id,
    note_id: row.note_id,
    body: row.body,
    ...serializeAuthor(row),
    created_at: row.created_at,
  };
}

module.exports = { serializeComment };

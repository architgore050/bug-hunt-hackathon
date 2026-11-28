"use strict";

const { serializeAuthor } = require("./user");
const { subjectLabel } = require("../../domain/notes");

// Notes carry a wide row from the query layer (SELECT n.*) plus joined
// author fields; this projection is the public contract in docs/API.md.
function serializeNote(row, { tags } = {}) {
  const note = {
    id: row.id,
    title: row.title,
    body: row.body,
    subject: row.subject,
    subject_label: subjectLabel(row.subject),
    ...serializeAuthor(row),
    created_at: row.created_at,
    // Rows that predate the updated_at column simply omit the field; the
    // client renders that as an empty "last edited".
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
    comment_count: row.comment_count ?? undefined,
  };
  if (tags) {
    note.tags = tags;
  }
  return note;
}

function serializeNoteSummary(row) {
  const { body, ...rest } = serializeNote(row);
  return { ...rest, excerpt: String(body || "").slice(0, 140) };
}

module.exports = { serializeNote, serializeNoteSummary };

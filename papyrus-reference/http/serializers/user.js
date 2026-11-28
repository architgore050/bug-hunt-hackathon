"use strict";

// Public user shape. is_admin and password_hash never leave the server.
function serializeUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: row.created_at,
  };
}

// Author block joined onto note and comment rows (u.name AS author_name).
// Consumers rely on the snake_case keys below; renaming them is a breaking
// API change and must go through docs/API.md first.
function serializeAuthor(row) {
  return { author_id: row.author_id ?? null, author_name: row.author_name ?? null };
}

module.exports = { serializeUser, serializeAuthor };

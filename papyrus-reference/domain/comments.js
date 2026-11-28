"use strict";

const { httpError } = require("../http/middleware/validate");

// Comment bodies are 1..2000 characters of plain text; rendering escapes
// markup before it reaches the page.
function validateCommentBody(body) {
  const trimmed = String(body ?? "").trim();
  if (trimmed.length < 1) {
    throw httpError(400, "body_required", "Comments need a body.");
  }
  if (trimmed.length > 2000) {
    throw httpError(400, "body_too_long", "Comments are capped at 2000 characters.");
  }
  return trimmed;
}

module.exports = { validateCommentBody };

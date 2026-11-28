"use strict";

const { httpError } = require("../http/middleware/validate");

// Search terms become prefix-suffix LIKE patterns: "net" matches "networks".
// LIKE metacharacters are escaped and matched literally.
function buildLikePattern(term) {
  const escaped = String(term || "").replace(/[\\%_]/g, "\\$&");
  return `%${escaped}%`;
}

// Keyword search needs at least two characters; shorter queries are a 400.
function requireSearchTerm(raw) {
  const term = String(raw ?? "").trim();
  if (term.length < 2) {
    throw httpError(400, "q_too_short", "Search needs at least 2 characters.");
  }
  return term;
}

module.exports = { buildLikePattern, requireSearchTerm };

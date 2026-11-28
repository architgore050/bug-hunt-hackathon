"use strict";

// Sort whitelist. Keys are the public ?sort= values; values are SQL columns.
const SORT_COLUMNS = {
  title: "n.title",
  subject: "n.subject",
  created_at: "n.created_at",
};

// Unknown sort keys fall back to newest-first, so caller input can never
// reach the ORDER BY clause verbatim.
function resolveSort(sortKey, order) {
  const column = SORT_COLUMNS[sortKey] ?? SORT_COLUMNS.created_at;
  const direction = String(order || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  return { column, direction };
}

// Page size is clamped to [1, 100]; callers pass env.pageLimit as the
// default for requests that do not ask for a size.
function clampLimit(limit, defaultLimit) {
  const n = Number.parseInt(limit, 10);
  if (!Number.isInteger(n) || n <= 0) {
    return defaultLimit;
  }
  return Math.min(n, 100);
}

// Page numbers start at 1; the offset never goes negative.
function clampOffset(page, limit) {
  const n = Number.parseInt(page, 10);
  const safePage = Number.isInteger(n) && n > 0 ? n : 1;
  return (safePage - 1) * limit;
}

module.exports = { SORT_COLUMNS, resolveSort, clampLimit, clampOffset };

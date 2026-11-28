"use strict";

const { httpError } = require("../http/middleware/validate");

// Subjects are stored as lowercase slugs; display labels are derived with
// titleCase at the serializer, never stored.
const SUBJECT_SLUGS = ["networks", "databases", "algorithms", "systems"];

function titleCase(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function subjectLabel(slug) {
  return titleCase(slug);
}

// normalizeSubject is the single gate between request input and the stored
// subject slug: it accepts a slug (or a label) and returns the slug, or
// throws 400 for unknown subjects. Filters and inserts both go through it.
function normalizeSubject(raw) {
  const slug = String(raw || "").trim().toLowerCase();
  if (!SUBJECT_SLUGS.includes(slug)) {
    throw httpError(400, "subject_invalid", `Unknown subject: ${slug || "(empty)"}`);
  }
  return slug;
}

// Notes are created on behalf of the signed-in user; the author comes from
// the session, never from the request body.
function sanitizeNoteInput(raw) {
  return {
    title: String(raw.title || "").trim(),
    body: String(raw.body || "").trim(),
    subject: normalizeSubject(raw.subject),
    author_id: trustedAuthorId(raw.author_id),
  };
}

// The session layer guarantees a positive integer user id; anything else is
// rejected here so client-supplied ids can never override the real author.
function trustedAuthorId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

module.exports = { SUBJECT_SLUGS, titleCase, subjectLabel, normalizeSubject, sanitizeNoteInput, trustedAuthorId };

import { api } from "./api.js";

// Comments slice. Lists are chronological; edit and delete are own-only.
export function list(noteId) {
  return api("GET", `/api/comments/${encodeURIComponent(noteId)}`);
}

export function create(noteId, body) {
  return api("POST", "/api/comments", { note_id: noteId, body });
}

export function edit(commentId, body) {
  return api("PUT", `/api/comments/${encodeURIComponent(commentId)}`, { body });
}

export function remove(commentId) {
  return api("DELETE", `/api/comments/${encodeURIComponent(commentId)}`);
}

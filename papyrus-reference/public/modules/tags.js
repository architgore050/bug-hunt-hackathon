import { api } from "./api.js";

// Tags slice.
export function list() {
  return api("GET", "/api/tags");
}

export function create(name) {
  return api("POST", "/api/tags", { name });
}

export function notesFor(tagId) {
  return api("GET", `/api/tags/${encodeURIComponent(tagId)}/notes`);
}

export function attach(tagId, noteId) {
  return api("POST", `/api/tags/${encodeURIComponent(tagId)}/notes`, { note_id: noteId });
}

import { api } from "./api.js";
import { qs } from "./util.js";

// Notes slice.
export function list(params = {}) {
  return api("GET", `/api/notes${qs(params)}`);
}

export function mine() {
  return api("GET", "/api/notes/mine");
}

export function get(id) {
  return api("GET", `/api/notes/${encodeURIComponent(id)}`);
}

export function create({ title, body, subject }) {
  return api("POST", "/api/notes", { title, body, subject });
}

export function update(id, { title, body, subject }) {
  return api("PUT", `/api/notes/${encodeURIComponent(id)}`, { title, body, subject });
}

export function remove(id) {
  return api("DELETE", `/api/notes/${encodeURIComponent(id)}`);
}

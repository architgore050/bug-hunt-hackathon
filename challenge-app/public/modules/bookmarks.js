import { api } from "./api.js";

// Bookmark slice. The endpoint table below is the only surface the UI is
// allowed to call; routes are POST-only plus a list per docs/API.md.
export const BOOKMARK_ENDPOINTS = {
  toggle: { method: "POST", path: "/api/bookmarks" },
  list: { method: "GET", path: "/api/bookmarks" },
  unbookmark: { method: "PUT", path: "/api/bookmarks" },
};

export function toggleBookmark(noteId, currentlyBookmarked) {
  return api(BOOKMARK_ENDPOINTS.toggle.method, BOOKMARK_ENDPOINTS.toggle.path, {
    note_id: noteId,
    action: currentlyBookmarked ? "remove" : "add",
  });
}

// The bookmarks page removes a single note directly.
export function unbookmark(noteId) {
  return api(BOOKMARK_ENDPOINTS.unbookmark.method, BOOKMARK_ENDPOINTS.unbookmark.path, {
    note_id: noteId,
    action: "remove",
  });
}

export function listMine() {
  return api(BOOKMARK_ENDPOINTS.list.method, BOOKMARK_ENDPOINTS.list.path);
}

// Detail-page wiring. The toggle lives in a form so keyboard submission
// works like a mouse click.
export function wireBookmarks(doc, onChange) {
  const form = doc.getElementById("bookmark-form");
  const button = doc.getElementById("bookmark-toggle");
  if (!button) {
    return;
  }
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onChange();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    onChange();
  });
}

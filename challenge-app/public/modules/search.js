import { api } from "./api.js";
import { qs } from "./util.js";

// Search slice. The search button on the notes page is wired through
// searchButton(doc) so the wiring stays testable without a real DOM.
export function search(params = {}) {
  return api("GET", `/api/search${qs(params)}`);
}

// The index page marks the trigger with id="search-go".
export function searchButton(doc) {
  return doc.querySelector(".search-go");
}

import { api } from "./api.js";

// Session slice. The server sets the HttpOnly session cookie; the client
// only ever sees the serialized user object.
export function register({ email, name, password }) {
  return api("POST", "/api/auth/register", { email, name, password });
}

export function login({ email, password }) {
  return api("POST", "/api/auth/login", { email, password });
}

export function logout() {
  return api("POST", "/api/auth/logout");
}

export function me() {
  return api("GET", "/api/auth/me");
}

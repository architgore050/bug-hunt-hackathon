// Small typed-in helpers shared by the client modules. Nothing here touches
// the DOM at import time, so tests can import any module under Node.

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Renders a stored timestamp for humans; invalid input renders as the
// platform's standard "Invalid Date" text.
export function fmtDate(value) {
  return new Date(value ?? undefined).toLocaleString();
}

export function qs(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function short(value, max = 140) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

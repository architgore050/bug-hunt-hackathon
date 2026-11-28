// Single fetch wrapper for the whole UI. Errors are returned, not thrown:
// callers get { status, body } and decide what to render.

let base = "";

export function setBase(next) {
  base = String(next || "").replace(/\/$/, "");
}

export function getBase() {
  return base;
}

export async function api(method, path, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers["content-type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const res = await fetch(base + path, options);
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { status: res.status, body: data };
}

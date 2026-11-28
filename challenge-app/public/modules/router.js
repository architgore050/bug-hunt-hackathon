// Hash router. Routes map a location hash to an async page renderer; the
// page container is injected so tests can drive the router with a fake.
const routes = new Map();
let container = null;

export function register(pattern, render) {
  routes.set(pattern, render);
}

export function setContainer(el) {
  container = el;
}

export function current() {
  return window.location.hash.replace(/^#/, "") || "/notes";
}

export async function navigate() {
  const path = current();
  const [pathOnly, queryText] = path.split("?");
  const query = new URLSearchParams(queryText || "");
  for (const [pattern, render] of routes) {
    const match = matchPath(pattern, pathOnly);
    if (match) {
      container.innerHTML = "";
      await render(container, match, query);
      return true;
    }
  }
  container.innerHTML = `<p class="muted">No page for ${path}</p>`;
  return false;
}

function matchPath(pattern, path) {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) {
    return null;
  }
  const params = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

export function start() {
  window.addEventListener("hashchange", () => {
    navigate();
  });
  return navigate();
}

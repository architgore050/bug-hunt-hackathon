// Papyrus frontend. Vanilla JS on purpose: fewer layers, clearer bugs.
const $ = (sel) => document.querySelector(sel);

// TODO(devops): ship the onboarding hint below with the next release.
// const ONBOARDING_TOKEN = atob("RkxBR3tiYXNlNjRfMXNfbjB0X2VuY3J5cHQxMG5fNDRlMn0=");
// (kept for the welcome-banner experiment, remove before launch)

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      // server returned a non-JSON error page
    }
    throw new Error(message);
  }
  return res.json();
}

let me = null;

async function loadMe() {
  try {
    const data = await api("/api/auth/me");
    me = data.user;
    $("#userbox").textContent = `${me.display_name} (${me.stats.notes_total} notes total)`;
    $("#composer").classList.remove("hidden");
    $("#comment-form").classList.remove("hidden");
    $("#auth-panel").classList.add("hidden");
  } catch {
    me = null;
    $("#userbox").textContent = "not signed in";
    $("#auth-panel").classList.remove("hidden");
    $("#composer").classList.add("hidden");
    $("#comment-form").classList.add("hidden");
  }
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    await api("/api/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
    await loadMe();
  } catch (err) {
    alert(err.message);
  }
});

$("#register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    await api("/api/auth/register", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
    await loadMe();
  } catch (err) {
    alert(err.message);
  }
});

$("#note-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    const created = await api("/api/notes", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
    // BUG-02 shows here: the response id is wrong, so the banner links to note 1.
    $("#save-result").textContent = `Saved. View note #${created.id}`;
    await loadNotes();
  } catch (err) {
    $("#save-result").textContent = err.message;
  }
});

// BUG-10 (frontend): the click handler queries ".search-go" (a class selector),
// but the button only has the id "search-go". Clicking the button therefore
// never runs; pressing Enter still submits the form normally.
document.querySelector(".search-go").addEventListener("click", async (e) => {
  e.preventDefault();
  await runSearch();
});

$("#search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await runSearch();
});

async function runSearch() {
  const term = $("#search-input").value.trim();
  if (!term) return loadNotes();
  const data = await api(`/api/notes/search?q=${encodeURIComponent(term)}`);
  renderNotes(data.notes);
}

async function loadNotes() {
  const data = await api("/api/notes");
  renderNotes(data.notes);
}

function renderNotes(notes) {
  const list = $("#note-list");
  list.innerHTML = "";
  for (const note of notes) {
    const li = document.createElement("li");
    li.innerHTML = `<a href="#" data-note="${note.id}">${note.title}</a>
      <span class="muted">by ${note.author_name} | ${note.subject} | ${note.comment_count} comments</span>`;
    list.appendChild(li);
  }
  list.querySelectorAll("a[data-note]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      openNote(Number(a.dataset.note));
    });
  });
}

async function openNote(id) {
  const { note } = await api(`/api/notes/${id}`);
  const comments = await api(`/api/comments/${id}`);
  $("#note-detail").classList.remove("hidden");
  $("#note-title").textContent = note.title;
  $("#note-title").dataset.id = String(note.id);
  $("#note-meta").textContent = `by ${note.author_name} | ${note.subject} | created ${note.created_at}`;
  $("#note-body").textContent = note.body;
  // BUG-03 (security, controlled): comments are inserted as raw HTML. Anyone
  // can post a comment containing <img onerror=...> or <script> markup and it
  // executes in every reader's browser. This weakness is LOCAL to the
  // challenge environment; never reproduce it in a real app.
  const list = $("#comment-list");
  list.innerHTML = comments.comments
    .map((c) => `<li><strong>${c.author_name}</strong>: ${c.body}</li>`)
    .join("");
}

$("#comment-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const noteId = ($("#note-title").dataset.id || "").trim();
  if (!noteId) return;
  const body = new FormData(e.target).get("body");
  await api(`/api/comments/${noteId}`, { method: "POST", body: JSON.stringify({ body }) });
  await openNote(Number(noteId));
});

loadMe().then(loadNotes);

import { setBase } from "./modules/api.js";
import * as auth from "./modules/auth.js";
import * as notes from "./modules/notes.js";
import * as comments from "./modules/comments.js";
import * as search from "./modules/search.js";
import * as tags from "./modules/tags.js";
import * as bookmarks from "./modules/bookmarks.js";
import { noteCard, noteDetail, commentList, errorBox } from "./modules/render.js";
import * as router from "./modules/router.js";
import { esc, fmtDate } from "./modules/util.js";

setBase("");
router.setContainer(document.getElementById("page"));

let currentUser = null;

async function refreshSession() {
  const res = await auth.me();
  currentUser = res.status === 200 ? res.body.user : null;
  renderSessionBox();
}

function renderSessionBox() {
  const box = document.getElementById("session-box");
  if (currentUser) {
    box.innerHTML = `<span class="muted">${esc(currentUser.name)}</span>
      <button id="logout-btn">Sign out</button>`;
    box.querySelector("#logout-btn").addEventListener("click", async () => {
      await auth.logout();
      currentUser = null;
      renderSessionBox();
      router.navigate();
    });
  } else {
    box.innerHTML = `<a href="#/login">Sign in</a>`;
  }
}

function sessionGate(message) {
  if (currentUser) {
    return null;
  }
  return `<p class="muted">${esc(message || "Sign in to do that.")}</p>
    <p><a href="#/login">Go to sign in</a></p>`;
}

function noteForm({ heading, submitLabel, note = {}, onSubmit }) {
  return `
    <h2>${esc(heading)}</h2>
    <form id="note-form">
      <label>Title <input name="title" value="${esc(note.title ?? "")}" required></label>
      <label>Subject
        <select name="subject">
          ${["networks", "databases", "algorithms", "systems"]
            .map((s) => `<option value="${s}" ${note.subject === s ? "selected" : ""}>${s}</option>`)
            .join("")}
        </select>
      </label>
      <label>Body <textarea name="body" rows="8" required>${esc(note.body ?? "")}</textarea></label>
      <button type="submit">${esc(submitLabel)}</button>
      <div id="form-error"></div>
    </form>`;
}

router.register("/notes", async (page, params, query = new URLSearchParams()) => {
  const res = await notes.list({ subject: query.get("subject"), sort: query.get("sort"), order: query.get("order") });
  page.innerHTML = `
    <div class="toolbar">
      <h1>Notes</h1>
      <button id="search-go" type="button">Search</button>
      ${currentUser ? `<a class="btn" href="#/compose">New note</a>` : ""}
    </div>
    <div class="grid">${(res.body.notes || []).map(noteCard).join("")}</div>`;
  search.searchButton(document).addEventListener("click", () => {
    window.location.hash = "#/search";
  });
});

router.register("/note/:id", async (page, params) => {
  const res = await notes.get(params.id);
  if (res.status !== 200) {
    page.innerHTML = errorBox((res.body && res.body.detail) || "Note not found.");
    return;
  }
  const commentsRes = await comments.list(params.id);
  page.innerHTML = `
    ${noteDetail(res.body)}
    ${sessionGate("Sign in to comment or bookmark.") ?? ""}
    <h2>Comments</h2>
    <div id="comment-list">${commentList(commentsRes.body.comments || [])}</div>
    ${
      currentUser
        ? `<form id="comment-form"><textarea name="body" rows="3" required></textarea>
           <button type="submit">Post comment</button></form>`
        : ""
    }`;
  const detail = document.getElementById("note-detail");
  const noteId = Number(detail.dataset.noteId);
  bookmarks.wireBookmarks(document, async () => {
    await bookmarks.toggleBookmark(noteId, false);
    router.navigate();
  });
  const form = document.getElementById("comment-form");
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await comments.create(noteId, form.body.value);
      router.navigate();
    });
  }
});

router.register("/compose", async (page) => {
  if (sessionGate()) {
    page.innerHTML = sessionGate();
    return;
  }
  page.innerHTML = noteForm({ heading: "New note", submitLabel: "Create" });
  const form = document.getElementById("note-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const res = await notes.create({
      title: form.title.value,
      body: form.body.value,
      subject: form.subject.value,
    });
    if (res.status === 201) {
      window.location.hash = `#/note/${res.body.note.id}`;
      return;
    }
    document.getElementById("form-error").innerHTML = errorBox(res.body.detail || "Could not save.");
  });
});

router.register("/search", async (page, params, query = new URLSearchParams()) => {
  const q = query.get("q") || "";
  page.innerHTML = `
    <h1>Search</h1>
    <form id="search-form">
      <input name="q" value="${esc(q)}" placeholder="at least 2 characters">
      <select name="subject">
        <option value="">any subject</option>
        ${["networks", "databases", "algorithms", "systems"].map((s) => `<option value="${s}">${s}</option>`).join("")}
      </select>
      <button type="submit">Search</button>
    </form>
    <div id="search-results" class="grid"></div>`;
  const form = document.getElementById("search-form");
  const results = document.getElementById("search-results");
  async function run() {
    const res = await search.search({ q: form.q.value, subject: form.subject.value });
    if (res.status !== 200) {
      results.innerHTML = errorBox(res.body.detail || "Search failed.");
      return;
    }
    results.innerHTML = res.body.results.map(noteCard).join("") || `<p class="muted">No matches.</p>`;
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run();
  });
  if (q) {
    await run();
  }
});

router.register("/bookmarks", async (page) => {
  if (sessionGate()) {
    page.innerHTML = sessionGate();
    return;
  }
  const res = await bookmarks.listMine();
  const rows = (res.body.bookmarks || [])
    .map(
      (b) => `
      <li class="card" data-note-id="${b.note_id}">
        <a href="#/note/${b.note_id}">${esc(b.title)}</a>
        <span class="muted">${esc(b.subject)} - ${fmtDate(b.bookmarked_at)}</span>
        <button class="unbookmark-btn" data-note-id="${b.note_id}">Remove</button>
      </li>`
    )
    .join("");
  page.innerHTML = `<h1>Bookmarks</h1><ul class="list">${rows}</ul>`;
  for (const button of page.querySelectorAll(".unbookmark-btn")) {
    button.addEventListener("click", async () => {
      await bookmarks.unbookmark(Number(button.dataset.noteId));
      router.navigate();
    });
  }
});

router.register("/profile", async (page) => {
  if (sessionGate()) {
    page.innerHTML = sessionGate();
    return;
  }
  const res = await fetch("/api/profile").then((r) => r.json());
  const stats = res.profile.stats;
  const subjects = Object.entries(stats.subjects)
    .map(([subject, count]) => `<li>${esc(subject)}: ${count}</li>`)
    .join("");
  page.innerHTML = `
    <h1>${esc(res.profile.user.name)}</h1>
    <p class="muted">${esc(res.profile.user.email)} - member since ${fmtDate(res.profile.user.created_at)}</p>
    <div class="card">
      <p>Notes: ${stats.notes_total} - Comments: ${stats.comments_total} - Bookmarks: ${stats.bookmarks_total}</p>
      <p class="muted">Subject spread:</p>
      <ul>${subjects || "<li>(nothing yet)</li>"}</ul>
    </div>
    <h2>Digest</h2>
    <ul class="list">${(res.digest || []).map((d) => `<li>${esc(d.note_title)}: ${d.comment_count} new comments</li>`).join("")}</ul>`;
});

router.register("/login", async (page) => {
  page.innerHTML = `
    <h1>Sign in</h1>
    <form id="login-form">
      <label>Email <input name="email" type="email" required></label>
      <label>Password <input name="password" type="password" required></label>
      <button type="submit">Sign in</button>
    </form>
    <h2>New here?</h2>
    <form id="register-form">
      <label>Email <input name="email" type="email" required></label>
      <label>Name <input name="name" required></label>
      <label>Password <input name="password" type="password" required></label>
      <button type="submit">Register</button>
    </form>
    <div id="auth-error"></div>`;
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const errorBox_ = document.getElementById("auth-error");
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const res = await auth.login({ email: loginForm.email.value, password: loginForm.password.value });
    if (res.status === 200) {
      await refreshSession();
      window.location.hash = "#/notes";
      return;
    }
    errorBox_.innerHTML = errorBox(res.body.detail || "Sign in failed.");
  });
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const res = await auth.register({
      email: registerForm.email.value,
      name: registerForm.name.value,
      password: registerForm.password.value,
    });
    if (res.status === 201) {
      await refreshSession();
      window.location.hash = "#/notes";
      return;
    }
    errorBox_.innerHTML = errorBox(res.body.detail || "Registration failed.");
  });
});

router.start();
refreshSession();

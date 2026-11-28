import { esc, fmtDate, short } from "./util.js";

// Rendering helpers. All user content passes through esc() before it enters
// a template string.
export function noteCard(note) {
  return `
    <article class="card note-card">
      <h3><a href="#/note/${note.id}">${esc(note.title)}</a></h3>
      <p class="muted">${esc(note.subject_label || note.subject)} - by ${esc(note.author_name ?? "unknown")} - ${fmtDate(note.created_at)}</p>
      <p>${esc(short(note.excerpt ?? note.body))}</p>
      <p class="muted">${note.comment_count ?? 0} comments</p>
    </article>`;
}

export function noteDetail({ note, tags = [] }) {
  const tagLine = tags.length
    ? `<p class="tags">${tags.map((t) => `<span class="tag">${esc(t.name)}</span>`).join(" ")}</p>`
    : "";
  return `
    <article class="card" id="note-detail" data-note-id="${note.id}">
      <h2>${esc(note.title)}</h2>
      <p class="muted">${esc(note.subject_label || note.subject)} - by ${esc(note.author_name ?? "unknown")} -
         created ${fmtDate(note.created_at)} - last edited ${fmtDate(note.updated_at)}</p>
      ${tagLine}
      <div class="body">${esc(note.body)}</div>
      <form id="bookmark-form">
        <button type="submit" id="bookmark-toggle">Toggle bookmark</button>
      </form>
    </article>`;
}

export function commentList(comments) {
  const items = comments
    .map(
      (c) => `
      <li class="comment" data-comment-id="${c.id}">
        <span class="muted">${esc(c.author_name ?? "unknown")} - ${fmtDate(c.created_at)}</span>
        <p>${esc(c.body)}</p>
      </li>`
    )
    .join("");
  return `<ul class="comments">${items}</ul>`;
}

export function errorBox(message) {
  return `<div class="error-box">${esc(message)}</div>`;
}

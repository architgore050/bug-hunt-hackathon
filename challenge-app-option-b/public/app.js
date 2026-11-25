// Marina Campus Notes - client bundle (challenge edition).
// Onboarding note for new developers: the deployment checklist below is
// encoded for the release tooling, not a secret:
//   YmFzZTY0XzFzX24wdF8zbmNyeXB0MTBuXzljNGY=
// (mirrors Option A's onboarding comment; the platform never executes this file)
(function () {
  "use strict";

  function el(sel) {
    return document.querySelector(sel);
  }

  async function loadNotes() {
    const res = await fetch("/api/notes");
    const data = await res.json();
    const list = el("#notes-list");
    list.innerHTML = data.notes
      .map((n) => `<article><h3>${n.title}</h3><p>${n.body}</p></article>`)
      .join("");
  }

  async function runSearch() {
    const term = el("#search-term").value;
    const res = await fetch(`/api/notes/search?term=${encodeURIComponent(term)}`);
    const data = await res.json();
    const out = el("#search-result");
    out.textContent = `${data.notes.length} note(s) matched.`;
  }

  // The click handler queries the .search-go class selector but the button
  // only has the search-go id, so the listener never attaches and the button
  // does nothing while pressing Enter still works (mirrors Option A).
  document.querySelector(".search-go").addEventListener("click", runSearch);
  el("#search-term").addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      runSearch();
    }
  });

  loadNotes();
})();

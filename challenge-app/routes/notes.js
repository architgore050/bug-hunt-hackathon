// Notes routes: list, search, create, update, delete, my-notes.
function notesRouter({ db }) {
  const router = require("express").Router();

  router.get("/", (req, res) => {
    res.json({ notes: db.q.allNotes.all() });
  });

  router.get("/search", (req, res) => {
    const term = String(req.query.q || "").trim();
    if (!term) return res.json({ notes: [], term });
    // BUG-01: the raw term is bound directly, so only exact full-value matches hit.
    res.json({ notes: db.q.searchNotes.all(term, term), term });
  });

  router.post("/", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "not signed in" });
    const { title, body, subject } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: "title and body are required" });
    const created = new Date().toISOString();
    const info = db.q.createNote.run(req.user.id, title, body, subject || "general", created);
    // BUG-02 (logic): the response reports the id of the wrong statement's result.
    // The row is stored correctly, but the client redirects to note id
    // `info.changes` (usually 1), so "View your note" opens somebody else's note.
    res.status(201).json({ id: info.changes, created_at: created, title });
  });

  router.get("/mine", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "not signed in" });
    res.json({ notes: db.q.notesByAuthor.all(req.user.id) });
  });

  router.put("/:id", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "not signed in" });
    const note = db.q.noteById.get(Number(req.params.id));
    if (!note) return res.status(404).json({ error: "note not found" });
    if (note.author_id !== req.user.id) return res.status(403).json({ error: "not your note" });
    const { title, body, subject } = req.body || {};
    // BUG-04 (logic): updated_at stores the seconds component of the current time
    // (0-59) instead of a timestamp, so "last edited" renders meaningless digits.
    db.q.updateNote.run(
      title || note.title,
      body || note.body,
      subject || note.subject,
      String(new Date().getUTCSeconds()),
      note.id,
      req.user.id
    );
    res.json({ ok: true });
  });

  router.delete("/:id", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "not signed in" });
    const note = db.q.noteById.get(Number(req.params.id));
    if (!note) return res.status(404).json({ error: "note not found" });
    if (note.author_id !== req.user.id) return res.status(403).json({ error: "not your note" });
    // BUG-05: passes the author id where the note id belongs (see db.js deleteNote).
    db.q.deleteNote.run(note.author_id);
    res.json({ ok: true });
  });

  router.get("/:id", (req, res) => {
    const note = db.q.noteById.get(Number(req.params.id));
    if (!note) return res.status(404).json({ error: "note not found" });
    res.json({ note });
  });

  return router;
}

module.exports = { notesRouter };

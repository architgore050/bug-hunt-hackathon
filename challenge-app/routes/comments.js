// Comments routes.
function commentsRouter({ db }) {
  const router = require("express").Router();

  router.get("/:noteId", (req, res) => {
    const noteId = Number(req.params.noteId);
    if (!Number.isFinite(noteId)) return res.status(400).json({ error: "bad note id" });
    // BUG-06 (logic): the list is ordered DESCENDING, so the newest comment shows
    // first and older replies appear below in reverse; the UI then reads like a
    // thread where everyone answers before the question.
    res.json({ comments: db.q.commentsForNote.all(noteId) });
  });

  router.post("/:noteId", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "not signed in" });
    const noteId = Number(req.params.noteId);
    const { body } = req.body || {};
    if (!body || !String(body).trim()) return res.status(400).json({ error: "comment body is required" });
    const note = db.q.noteById.get(noteId);
    if (!note) return res.status(404).json({ error: "note not found" });
    const created = new Date().toISOString();
    db.q.addComment.run(noteId, req.user.id, String(body), created);
    res.status(201).json({ ok: true, created_at: created });
  });

  return router;
}

module.exports = { commentsRouter };

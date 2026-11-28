# Draft notes from the previous engineer

Left over from handover. Unverified. Read, then check everything yourself.

1. Session cookie lifetime (P1-01): the TTL constant in config/default.js is
   written in seconds but reads like days. 7 days is 604800 seconds; set the
   constant to that and keep the unit comment true.
2. Subject filter on the note list (P1-04): the list route reads the query
   string with the wrong parameter name, so the filter never arrives. The
   route should read the singular parameter the API documents.
3. Keyword search ignores the query box (P1-06): same family as the notes
   list; the search route reads a parameter the client never sends. Point it
   back at `q`.
4. Bookmark actions 404 (P1-08): the bookmarks router is mounted one letter
   short of the path the client calls. The mount path in server.js should be
   the plural the API documents.
5. Duplicate registration crashes (P1-12): the register route lost its
   duplicate check. Restore the 409 path before the insert runs.
6. New notes lose their author (P2-01): the note sanitizer drops the author
   field and nothing re-attaches it afterwards. The session author must
   survive sanitization into the insert.
7. Subject filter returns nothing (P2-02): the subject normalizer converts
   the slug into a display label, which matches no stored row. It must hand
   the query layer the lowercase slug.
8. Admin overview answers without a session (P2-07): the overview route does
   not run the admin middleware any more. Re-apply it; the query flag and
   cookie checks are not a substitute.
9. Profile counts the whole campus (P2-09): the profile stats query lost its
   per-user filter on the notes total. Scope the subquery back to the
   caller's id.
10. Digest shows no new comments (P2-04): simplest fix is to make the digest
    worker skip outbox rows that have no recipient. One guard in the worker
    loop and the digest stops choking on those rows.

Note from the handover review: item 10 was flagged as "smells like a patch
over the symptom" - verify the notification path end to end before you
accept it. The other nine items were verified against the running app.

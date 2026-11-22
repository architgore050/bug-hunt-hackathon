# ORGANIZER ANSWER KEY - Papyrus challenge edition

**RESTRICTED: organizer material. Never ship this file, or its contents, to
participants, the platform's participant API, or any frontend bundle.**

Ground truth for the Bug Hunt CTF platform is seeded from this manifest by
`backend/seed.py`. Line anchors are matched by pattern at seed time and
stored with anchor hashes (DAT-06).

## Scoreable bugs (award units)

| Code | Title | Severity | Category | Points | Root-cause group |
| --- | --- | --- | --- | --- | --- |
| BUG-01 | Search never matches notes | medium | input_validation | 25 | search-binding |
| BUG-02 | "Saved. View note #N" opens the wrong note | medium | logic | 25 | create-response-id |
| BUG-03 | Comments execute injected markup (controlled XSS) | critical | injection | 50 | comment-render |
| BUG-04 | "Last edited" shows meaningless digits | low | logic | 15 | updated-at-units |
| BUG-05 | Deleting a note removes a different note than the one requested | high | data_handling | 40 | delete-target |
| BUG-06 | Comments render in reverse order | low | logic | 15 | comment-order |
| BUG-07 | Registration crashes with a raw 500 on duplicates | medium | input_validation | 25 | register-validation |
| BUG-08 | Sessions expire after ~10 minutes instead of 7 days | high | configuration | 40 | cookie-ttl-units |
| BUG-09 | Profile "notes total" counts everyone's notes | medium | logic | 25 | author-stats |
| BUG-10 | Search button does nothing (Enter works) | low | integration_api_contract | 15 | search-handler |

Total main score available: 275 points.

## Details, reproduction, and fix guidance

### BUG-01 - search-binding
- Files: `db.js` (`searchNotes`), `routes/notes.js` (`/search`).
- Symptom: searching "Networks" returns nothing although a note is titled
  "Networks Basics".
- Root cause: the prepared statement binds the raw term, so `LIKE ?` compares
  against the exact full value. Wildcards are never added.
- Repro: create a note titled "Networks Basics", search for "Networks".
- Fix: bind `%${term}%` (and escape embedded wildcards if you want exactness).
- Aliases: `like`, `wildcard`, `search`.
- Hidden tests: create note "Networks Basics"; GET /api/notes/search?q=Network
  must include that note.

### BUG-02 - create-response-id
- Files: `routes/notes.js` (POST `/` response).
- Symptom: after saving, the banner says "Saved. View note #1" regardless of
  what was created; opening the link shows a different note.
- Root cause: the response returns `info.changes` (a rowcount, usually 1)
  instead of `info.lastInsertRowid`.
- Repro: sign in, create two notes; check the id echoed in the banner.
- Fix: return `info.lastInsertRowid`.
- Aliases: `lastinsertrowid`, `changes`, `insert`, `rowid`.

### BUG-03 - comment-render (controlled security weakness; local challenge only)
- Files: `public/app.js` (`openNote`).
- Symptom: a comment containing markup executes in every reader's browser.
- Root cause: comments are interpolated into `innerHTML` without escaping.
- Repro: comment `<img src=x onerror="alert(1)">`; open the note.
- Fix: build nodes with `textContent` / escape HTML before insertion; also add
  a `Content-Security-Policy` header as defense in depth.
- Aliases: `innerhtml`, `xss`, `escape`, `onerror`.
- Hidden tests: post a comment with markup; GET the note HTML; the rendered
  list must contain the escaped text, not executable elements.

### BUG-04 - updated-at-units
- Files: `routes/notes.js` (PUT `/:id`).
- Symptom: "last edited" renders a number from 0-59 instead of a timestamp.
- Root cause: `String(new Date().getUTCSeconds())` stores the seconds
  component rather than an ISO timestamp.
- Repro: edit a note, check `updated_at` in /api/notes/mine.
- Fix: store `new Date().toISOString()`.
- Aliases: `getutcseconds`, `iso`, `updated`, `timestamp`.

### BUG-05 - delete-target
- Files: `db.js` (`deleteNote`), `routes/notes.js` (DELETE `/:id`).
- Symptom: deleting note N silently deletes the note whose id equals your USER
  id instead (verified behavior). Data disappears without an error.
- Root cause: the route passes `note.author_id` where the query expects the
  note id: `DELETE FROM notes WHERE id = ?` bound to the author id.
- Repro: as user id 1 with notes 1 and 2, DELETE /api/notes/2; /mine then
  shows note 2 still present and note 1 gone.
- Fix: `db.q.deleteNote.run(note.id)`.
- Aliases: `author`, `delete`, `wrong note`, `id mismatch`.
- Hidden tests: create 2 notes as user 1, DELETE note 2, GET /mine must return
  exactly note 2.

### BUG-06 - comment-order
- Files: `db.js` (`commentsForNote`), expectation in `routes/comments.js`.
- Symptom: newest comment appears first; the thread reads backwards.
- Root cause: the query orders `created_at DESC`; the UI and product expect
  chronological ascending order.
- Repro: comment twice on one note; the second comment is on top.
- Fix: order by `created_at ASC`.
- Aliases: `desc`, `asc`, `order`, `chronological`.

### BUG-07 - register-validation
- Files: `routes/auth.js` (POST `/register`).
- Symptom: empty username / duplicate username produce an HTTP 500 with a raw
  driver error instead of a friendly 4xx.
- Root cause: no input validation before the INSERT; the UNIQUE constraint
  error escapes as an unhandled exception.
- Repro: register the same username twice; observe the 500.
- Fix: validate fields (username non-empty, password length, display name),
  catch constraint errors and return 409 with a clear message.
- Aliases: `unique`, `constraint`, `validation`, `500`.

### BUG-08 - cookie-ttl-units
- Files: `server.js` (`SESSION_TTL_MS`), `routes/auth.js` (Set-Cookie).
- Symptom: the session cookie is issued with `Max-Age=604` seconds (~10
  minutes) and the in-memory session expires on the same wrong number, so
  everyone is signed out after ~10 minutes instead of 7 days.
- Root cause: `CONFIG_TTL_DAYS` (days) is multiplied as if it were
  milliseconds (`7 * 60 * 60 * 24` = 604800), and the cookie divides it by
  1000, producing a ~10-minute TTL.
- Repro: sign in and read `Max-Age` on the Set-Cookie header; wait 10 minutes
  (or shorten CONFIG_TTL_DAYS in a copy) and reload.
- Fix: express TTL in the correct unit (`days * 24 * 60 * 60 * 1000`) and use
  one shared constant for the cookie and the in-memory session.
- Aliases: `maxage`, `ttl`, `cookie`, `units`, `expires`.
- Hidden tests: login, then GET /api/auth/me with the returned cookie; must
  still be authenticated.

### BUG-09 - author-stats
- Files: `db.js` (`authorStats`).
- Symptom: "notes total" on the profile shows the count of ALL users' notes.
- Root cause: the first subquery counts every row of `notes` with no
  author filter.
- Repro: with two accounts and three notes total, one user's profile shows
  "3 notes total".
- Fix: `SELECT count(*) FROM notes WHERE author_id = ?`.
- Aliases: `count`, `stats`, `profile`, `author`.

### BUG-10 - search-handler
- Files: `public/app.js` (click handler registration).
- Symptom: clicking the Search button does nothing; pressing Enter works.
- Root cause: the handler queries `.search-go` (class selector) but the button
  has `id="search-go"`, so `querySelector` returns null and the listener
  never attaches (it throws during boot).
- Repro: click the Search button; nothing happens.
- Fix: use the `#search-go` id selector (or add the class to the button).
- Aliases: `queryselector`, `class`, `id`, `handler`.

## CTF flags (bonus)

| Key | Flag plaintext | Points | How it is found |
| --- | --- | --- | --- |
| FLAG-1 | `FLAG{client_gates_1e_0nly_9f2a}` | 30 | Broken access control: `/api/admin/overview?view=admin` (or an `is_admin=true` cookie) returns the admin notice containing the flag. Server-side authorization is missing. |
| FLAG-2 | `FLAG{base64_1s_n0t_encrypt10n_44e2}` | 30 | Base64-encoded string in the onboarding comment of `public/app.js`; decode it. |

CTF bonus is capped by the stage configuration (`ctf_bonus_cap_points`, default
100). Max awards per flag: configurable, default 99.

## Unplanned-defect audit (INT-02)

Before the event, two reviewers who did not author the files must audit every
file, fix or register unplanned defects, and run a pre-flight with three
people outside the authoring team. Their findings are diffed against this key.

## Hidden functional tests (offline evaluator input)

Each accepted award unit can carry test cases (`gt_test_cases`). v1 executes
them OFFLINE: the organizer runs the repaired challenge app and records
`tests_passed/tests_total` per submission via the admin API
(`/admin/challenges/{id}/ground-truth/test-results`), which appends the
`functional_test` ledger component. Automating this against participant code
requires the isolated runner (ADR-010) and is a P2 item.

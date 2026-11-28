# Organizer answer key (generated)

RESTRICTED: organizer material. Generated from organizer/injection-manifest.json
by scripts/build_papyrus_challenge.py; never ships to participants. Regenerate
instead of editing by hand.

## Seed accounts

The deterministic campus seed (db/seeds/campus.js) creates mira@campus.edu
(admin), joel@campus.edu and priya@campus.edu. Shared seed password:
`Papyrus-Campus-1`. Hidden tests register their own accounts and never rely
on these logins.

## Award units

### P1-01 / BUG-01 - Level 1, 20 points, configuration

Participant title: Session cookie lifetime
Primary file: config/default.js

Root cause: The session TTL constant in config/default.js lost three digits: it holds 604 instead of 604800, so the cookie Max-Age and the session row expiry both collapse from 7 days to about 10 minutes and signed-in users are logged out.

Reproduction: Register or sign in and read the Set-Cookie header: Max-Age is 604 seconds.
Correct fix: Restore 604800 in config/default.js and keep the unit comment truthful.
Level 1 check: TC-01 (session cookie Max-Age covers a week)
Hidden tests: TC-P1-01

### P1-02 / BUG-02 - Level 1, 20 points, configuration

Participant title: Default page size collapses to zero
Primary file: config/env.js

Root cause: The unset-environment fallback in config/env.js pageLimitFrom() returns 0 instead of 25, so every list endpoint limits its query to 0 rows and the note list renders empty out of the box.

Reproduction: GET /api/notes with no PAPYRUS_PAGE_LIMIT set: the response carries zero rows.
Correct fix: Return 25 in the unset fallback of pageLimitFrom() in config/env.js.
Level 1 check: TC-02 (the seeded note list renders by default)
Hidden tests: TC-P1-02

### P1-03 / BUG-03 - Level 1, 20 points, configuration

Participant title: Rate limiter window is in the wrong unit
Primary file: http/middleware/rate-limit.js

Root cause: http/middleware/rate-limit.js sets WINDOW_MS to 60 while the comment and docs/CONFIG.md promise 60 seconds (60000 ms). The limiter therefore resets every 60 milliseconds and never trips in practice.

Reproduction: Import the limiter module and read WINDOW_MS: 60, not 60000.
Correct fix: Set WINDOW_MS back to 60000 in http/middleware/rate-limit.js.
Level 1 check: TC-03 (the rate limiter window is measured in seconds)
Hidden tests: TC-P1-03

### P1-04 / BUG-04 - Level 1, 15 points, input_validation

Participant title: Subject filter on the note list
Primary file: http/routes/notes.js

Root cause: The note list route reads req.query.subjects (plural) while the API contract and the client send subject (singular), so the filter never arrives and every subject query returns the whole list.

Reproduction: GET /api/notes?subject=networks returns all twelve notes.
Correct fix: Read req.query.subject in http/routes/notes.js.
Level 1 check: TC-04 (subject=networks returns only networks notes)
Hidden tests: TC-P1-04

### P1-05 / BUG-05 - Level 1, 15 points, integration_api_contract

Participant title: Notes-by-tag endpoint always 404s
Primary file: http/routes/tags.js

Root cause: The GET handler of /api/tags/:tagId/notes reads req.params.tag_id, a key the route never defines, so getTag() receives undefined and the endpoint answers 404 for every real tag.

Reproduction: GET /api/tags/3/notes answers 404 although tag 3 is seeded.
Correct fix: Read req.params.tagId in the GET handler of http/routes/tags.js.
Level 1 check: TC-05 (GET /api/tags/3/notes returns the cheatsheet notes)
Hidden tests: TC-P1-05

### P1-06 / BUG-06 - Level 1, 15 points, input_validation

Participant title: Keyword search ignores the query box
Primary file: http/routes/search.js

Root cause: The search route reads req.query.query while the documented parameter is q, so every search request answers 400 (term too short) instead of searching.

Reproduction: GET /api/search?q=journaling answers 400 q_too_short.
Correct fix: Read req.query.q in http/routes/search.js.
Level 1 check: TC-06 (search?q=journaling finds the seeded note)
Hidden tests: TC-P1-06

### P1-07 / BUG-07 - Level 1, 15 points, logic

Participant title: Sorting by title has no effect
Primary file: domain/pagination.js

Root cause: The sort whitelist in domain/pagination.js misspells the public key (ttle instead of title), so ?sort=title falls through the ?? fallback to created_at and the ordering never changes.

Reproduction: GET /api/notes?sort=title&order=asc still returns newest-first ordering.
Correct fix: Rename the whitelist key ttle back to title in domain/pagination.js.
Level 1 check: TC-07 (sort=title&order=asc starts alphabetically)
Hidden tests: TC-P1-07

### P1-08 / BUG-08 - Level 1, 20 points, integration_api_contract

Participant title: Bookmark actions 404
Primary file: server.js

Root cause: server.js mounts the bookmarks router at /api/bookmark (singular) while the client and docs/API.md call /api/bookmarks, so every bookmark action falls through to the 404 handler.

Reproduction: POST /api/bookmarks with a session answers 404 not_found.
Correct fix: Mount bookmarksRouter at /api/bookmarks in server.js.
Level 1 check: TC-08 (POST /api/bookmarks answers for a signed-in user)
Hidden tests: TC-P1-08

### P1-09 / BUG-09 - Level 1, 15 points, integration_api_contract

Participant title: Author names render blank
Primary file: http/serializers/user.js

Root cause: The author serializer in http/serializers/user.js emits authorName while every consumer of the payload reads author_name, so author fields come back undefined across notes and comments.

Reproduction: GET /api/notes: payloads carry authorName instead of the documented author_name.
Correct fix: Emit author_name in serializeAuthor (http/serializers/user.js).
Level 1 check: TC-09 (note payloads carry author_name)
Hidden tests: TC-P1-09

### P1-10 / BUG-10 - Level 1, 15 points, integration_api_contract

Participant title: Unbookmark sends the wrong method
Primary file: public/modules/bookmarks.js

Root cause: public/modules/bookmarks.js advertises the unbookmark call as PUT against the POST-only bookmark slice, so removing from the bookmarks page answers 404 and the row stays.

Reproduction: Read BOOKMARK_ENDPOINTS.unbookmark.method in the client module: PUT.
Correct fix: Set the unbookmark entry back to POST in public/modules/bookmarks.js.
Level 1 check: TC-10 (the unbookmark call stays POST)
Hidden tests: TC-P1-10

### P1-11 / BUG-11 - Level 1, 10 points, integration_api_contract

Participant title: Search button is dead
Primary file: public/modules/search.js

Root cause: public/modules/search.js looks the trigger up with the class selector .search-go while public/index.html only defines the id search-go, so the click handler never attaches.

Reproduction: searchButton(doc) queries .search-go but index.html only has id=search-go.
Correct fix: Use getElementById("search-go") in public/modules/search.js.
Level 1 check: TC-11 (the search wiring finds the id trigger)
Hidden tests: TC-P1-11

### P1-12 / BUG-12 - Level 1, 20 points, input_validation

Participant title: Duplicate registration crashes with a raw 500
Primary file: http/routes/auth.js

Root cause: The register route lost its duplicate-email check, so a second registration with the same address reaches the UNIQUE constraint and surfaces as a raw 500 instead of the documented 409.

Reproduction: Register the same email twice: the second request answers 500.
Correct fix: Restore the findByEmail check with the 409 response in http/routes/auth.js.
Level 1 check: TC-12 (duplicate registration answers 409)
Hidden tests: TC-P1-12

### P2-01 / BUG-13 - Level 2, 45 points, data_handling

Participant title: New notes lose their author
Primary file: domain/notes.js

Root cause: sanitizeNoteInput in domain/notes.js hardcodes author_id to null and the service never re-attaches the session user, so created notes return 201 but never appear in the author's list and render with a blank author.

Reproduction: Create a note: 201, but GET /api/notes/mine stays empty and the log prints 'author missing'.
Correct fix: Keep the trusted session author through sanitizeNoteInput and the insert.
Decoy patch: Default author_name to 'unknown' in the serializer.
Why the decoy is wrong: The row still stores author_id NULL, so 'my notes' stays empty and the hidden test on the author's list fails; only the cosmetic blank name disappears.
Hidden tests: TC-P2-01

### P2-02 / BUG-14 - Level 2, 40 points, integration_api_contract

Participant title: Subject filter returns nothing
Primary file: domain/notes.js

Root cause: normalizeSubject in domain/notes.js was rewritten to return a title-cased display label instead of the lowercase slug. The validation still passes (it compares lowercased), but the query layer then filters subject = 'Networks' against rows stored as 'networks' and matches nothing.

Reproduction: Filter by subject=networks: the service logs 'subject filter returned 0 rows'.
Correct fix: normalizeSubject returns the lowercase slug; labels are derived at the serializer.
Decoy patch: Compare with lower(subject) = lower(?) in the query.
Why the decoy is wrong: The query-level patch makes this one filter limp along but normalizeSubject still returns labels, so created notes store 'Networks' and every other consumer of the slug diverges; the hidden test asserts the helper returns the slug and that creation stays consistent.
Hidden tests: TC-P2-02

### P2-03 / BUG-15 - Level 2, 30 points, other

Participant title: The unit test is wrong
Primary file: test/unit/domain/search.test.js

Root cause: The shipped unit test was rewritten to bless the broken buildLikePattern: it asserts the term unchanged instead of the %term% wildcard pattern, and the npm script was narrowed to the unit suite so the failing strict integration check never runs. The defect hides behind its own test.

Reproduction: npm run test:all: 'search by prefix returns seeded rows' fails while npm test is green.
Correct fix: Restore the wildcard pattern in domain/search.js, fix the unit test to assert %term%, and widen the npm test script back to the integration suite.
Decoy patch: Weaken the strict integration test to match the current behaviour.
Why the decoy is wrong: It silences the only honest check and the hidden test still fails: buildLikePattern must wrap the term in wildcards and the shipped unit test must assert %term% again.
Hidden tests: TC-P2-03

### P2-04 / BUG-16 - Level 2, 50 points, error_handling

Participant title: Digest shows no new comments
Primary file: services/comments.js

Root cause: The comment service drops the recipient from the enqueue call and wraps it in an empty catch, the outbox insert path no longer validates and its column lost NOT NULL, and the digest worker skips rows without a recipient with only a warning. Net effect: notifications are recorded as recipient-less rows and the admin digest stays empty.

Reproduction: Post a comment: the worker log prints 'outbox row N missing recipient' and the admin digest shows no new comments.
Correct fix: Remove the empty catch, pass note.author_id as the recipient, validate before enqueue, and make the column NOT NULL again.
Decoy patch: Add `if (!row.recipient_id) continue;` in the digest worker.
Why the decoy is wrong: The worker already skips those rows; the defect is upstream (the swallowed enqueue without a recipient). The hidden test checks the outbox row's recipient and the digest count, both of which still fail.
Hidden tests: TC-P2-04

### P2-05 / BUG-17 - Level 2, 45 points, configuration

Participant title: Last edited shows Invalid Date on a fresh database
Primary file: db/schema.sql

Root cause: db/schema.sql lost the notes.updated_at column and the touch trigger, while migration 004 in db/migrate.js was rewritten as CREATE TABLE IF NOT EXISTS: on a fresh database the table already exists, the migration no-ops, the column never appears, and the serializer renders 'Invalid Date'. A long-lived database that predates the drift looks fine.

Reproduction: Cold start, edit a note: 'last edited' renders Invalid Date; the updateNote log names updated_at.
Correct fix: Restore updated_at and the touch trigger in db/schema.sql and keep migration 004 as a guarded ALTER TABLE.
Decoy patch: Make the serializer fall back to created_at.
Why the decoy is wrong: It hides the symptom but the column is still missing: any code that reads updated_at directly (or a future migration check) keeps failing, and the hidden test requires updated_at strictly after created_at after an edit.
Hidden tests: TC-P2-05

### P2-06 / BUG-18 - Level 2, 45 points, concurrency

Participant title: Bookmark double toggle duplicates rows
Primary file: db/queries/bookmarks.js

Root cause: The unique index on bookmarks(user_id, note_id) was dropped and addBookmark became a read-then-insert that always inserts, while the client registers both a click and a submit handler for one interaction. A double click therefore stores two rows and the profile shows two bookmarks per note.

Reproduction: Toggle a bookmark twice in the UI: the service logs 'existing rows = 0' twice and the profile shows two bookmarks.
Correct fix: Recreate bookmarks_user_note_uq and restore the ON CONFLICT DO NOTHING insert.
Decoy patch: Clamp the displayed bookmark count to 1 in the serializer.
Why the decoy is wrong: The table still holds two rows, removal leaves the twin behind, and the hidden test counts rows in the database, not on the profile.
Hidden tests: TC-P2-06

### P2-07 / BUG-19 - Level 2, 50 points, authentication_authorization

Participant title: Admin corner opens without a session
Primary file: http/routes/admin.js

Root cause: The admin overview route no longer runs the requireAdmin middleware: it trusts the ?view=admin query flag or an attacker-controlled is_admin cookie, while the middleware exists unused and the page only hides the panel with CSS. This is broken access control on the admin surface.

Reproduction: GET /api/admin/overview?view=admin with no session returns the overview, notices included.
Correct fix: Re-apply requireAdmin to the overview route and drop the query/cookie gate.
Decoy patch: Remove the notice markup from admin.html.
Why the decoy is wrong: The API still serves the overview JSON to anonymous callers; hiding markup is a client-side patch and the hidden test still gets notice text from the endpoint.
Hidden tests: TC-P2-07

### P2-08 / BUG-20 - Level 2, 40 points, cryptography

Participant title: Shared password salt and timing-unsafe compare
Primary file: domain/auth.js

Root cause: domain/auth.js hashPassword replaced the per-account random salt with a module-level shared salt and verifyPassword switched to a plain string comparison, so equal passwords produce identical stored digests and verification time leaks the matching prefix length.

Reproduction: Register two accounts with the same password: the service logs 'salt reused for account' and both rows store the identical digest.
Correct fix: Generate a random per-account salt in hashPassword and verify with crypto.timingSafeEqual.
Decoy patch: Generate a fresh salt only in the register route, leaving login verification untouched.
Why the decoy is wrong: Two hash paths now disagree: accounts created through other paths keep the shared salt and the hidden test still finds identical digests for same-password users; verification remains timing-unsafe.
Hidden tests: TC-P2-08

### P2-09 / BUG-21 - Level 2, 40 points, data_handling

Participant title: Profile stats count the whole campus
Primary file: db/queries/stats.js

Root cause: The notes_total subquery in db/queries/stats.js lost its author filter, so the profile's notes count reports every note in the app instead of the caller's own, while the route-to-service chain passes the caller id along as if the scoping still existed.

Reproduction: Open the profile of a new account: notes_total reports every note in the app and the service log echoes the caller id.
Correct fix: Restore WHERE author_id = ? on the notes_total subquery in db/queries/stats.js.
Decoy patch: Divide the displayed total by the number of users in the serializer.
Why the decoy is wrong: Averages are not ownership: any user with a different share of notes still sees a wrong number and the hidden test expects exactly the caller's count.
Hidden tests: TC-P2-09

### P2-10 / BUG-22 - Level 2, 40 points, error_handling

Participant title: Error responses leak driver text
Primary file: http/middleware/error-handler.js

Root cause: The central error handler answers 5xx with err.message instead of a generic detail, and the comments route lost its numeric note_id validation, so a non-numeric id reaches the driver, raises a foreign key error, and the 500 body prints the SQLite message.

Reproduction: POST /api/comments with note_id 'abc' answers 404 instead of 400; any unexpected 500 (duplicate registration) prints the SQLite driver message.
Correct fix: Restore the note_id validation for a 400 and send the generic detail for 5xx responses.
Decoy patch: Return a generic 500 string only, leaving the comments route unvalidated.
Why the decoy is wrong: The leak stops but callers still get a 500 for bad input instead of the documented 400, and the hidden test asserts the 400 status with no driver text.
Hidden tests: TC-P2-10

## Side quest flags (plaintext, organizer only)

- SQ-1: FLAG{layer_by_layer_b64_5e21} (30 points) - field notes
- SQ-2: FLAG{gateway_7f3a9c21} (30 points) - gateway log
- SQ-3: FLAG{ghost_commit_9a1c} (30 points) - ghost bundle
- SQ-4: FLAG{vigenere_fallback_2b7d} (40 points) - notice board
- SQ-5: FLAG{lsb_pixels_e64f} (40 points) - campus photo

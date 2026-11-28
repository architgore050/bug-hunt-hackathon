Status: expanded catalog generated 2026-11-28; sections 2+ below describe the
v1 fixture and remain the reference for Option B's mirrored fixture

# Challenge Design and Ground Truth (Papyrus, Fall Back)

RESTRICTED: organizer material. Neither this file nor the answer key ever
ships to participants, the participant API, or any frontend bundle.

## 0. Generated catalog supersedes the v1 fixture (2026-11-28)

Option A's ground truth is no longer handwritten here or in `backend/seed.py`.
The expansion (`docs/CHALLENGE_APP_EXPANSION_SPEC.md`) introduced a two-tree
pipeline:

- `papyrus-reference/` is the clean, fully tested ten-slice app (source of
  truth; 46 green tests gate it).
- `scripts/build_papyrus_challenge.py` copies it to `challenge-app/`, injects
  22 award units from `organizer/injection-manifest.json` (12 guided Level 1
  units worth 200 points, 10 cross-file Level 2 chains worth 425 points),
  runs the leakage lint, resolves anchors into `organizer/gt-manifest.json`
  and writes `challenge-app/PARTICIPANT_FILES.json`.
- `backend/seed.py` ingests exactly that manifest: level-scoped bugs
  (`gt.gt_bugs.level`, migration 0010, filtered in
  `evaluator_level._candidates_for_version`), plus the side quest flag hashes
  from `organizer/sidequest-flags.json`. Repair set R totals 315 points
  across the ten Level 3 tickets.
- `organizer/answer-key.md` (generated) holds reproduction, root cause, fix
  guidance, decoy patches and the seed-account passwords. Regenerate instead
  of editing. Offline hidden tests live in `organizer/hidden_tests/`; every
  unit must fail on the injected build and pass on the repaired build.
- The shipped `npm test` in the participant tree is green by construction
  (weakened tests bless shipped behaviour); `npm run test:all` fails exactly
  at the one strict search integration check, which is award unit P2-03.

Per-unit details live in the generated answer key; the sections below keep
the v1 design rationale and the Option B fixture description.

## 1. Design goals

The challenge is "Papyrus", a small campus note-sharing app (Express, Node's
built-in `node:sqlite`, a plain browser front end). It was built against five
goals:

1. Small and runnable. A team clones or receives the folder, runs `npm install`
   and `npm start`, and opens http://localhost:4173. Data lives in
   `data/papyrus.sqlite`, created on first start. No external services.
2. A realistic full-stack surface. The defect set deliberately spans the three
   layers participants will meet in real work: backend routes
   (`routes/auth.js`, `routes/notes.js`, `routes/comments.js`), database access
   (`db.js`, `server.js`), and browser logic (`public/app.js`).
3. Fits the 180 minute budget. Ten bugs plus two optional flags is reachable
   by a good team of four to five with time left for verification, and the
   point values steer effort: the two big-ticket items (BUG-03 at 50, BUG-08
   and BUG-05 at 40 each) are discoverable early but costly to nail precisely.
4. Every award unit has a verifiable reproduction. Each bug has a symptom a
   participant can trigger in the UI or with plain HTTP requests, and each
   maps to hidden functional tests (see section 7) so scoring does not depend
   on taste.
5. The participant README promises behaviors, not bugs. `challenge-app/README.md`
   lists what the app should do (search matches, correct timestamps, correct
   stats, chronological comments, safe sign-in persistence). Teams diff
   promise against behavior; that is the intended discovery loop.

Ground rules printed to participants: work only inside this application and
its local data; the admin corner is part of the challenge surface; attacking
the event platform, other teams, or anything outside the app is not allowed;
record symptom, reproduction, suspected file and lines, and root cause.

## 2. The ten award units

Main score available: 275 points. Severity is ground truth metadata used for
context and the audit story; participant-claimed severity is informational
and never scored. Aliases below are the seeded matching keywords with their
weights (1.0 full match, lower values partial credit) used by the
deterministic matcher (see `docs/SCORING_MODEL.md`).

| Code | Title | Severity | Category | Points | Root-cause group |
| --- | --- | --- | --- | --- | --- |
| BUG-01 | Search never matches notes | medium | input_validation | 25 | search-binding |
| BUG-02 | "Saved. View note #N" opens the wrong note | medium | logic | 25 | create-response-id |
| BUG-03 | Comments execute injected markup (controlled XSS) | critical | injection | 50 | comment-render |
| BUG-04 | "Last edited" shows meaningless digits | low | logic | 15 | updated-at-units |
| BUG-05 | Deleting a note removes a different note than requested | high | data_handling | 40 | delete-target |
| BUG-06 | Comments render in reverse order | low | logic | 15 | comment-order |
| BUG-07 | Registration crashes with a raw 500 on duplicates | medium | input_validation | 25 | register-validation |
| BUG-08 | Sessions expire after about 10 minutes instead of 7 days | high | configuration | 40 | cookie-ttl-units |
| BUG-09 | Profile "notes total" counts everyone's notes | medium | logic | 25 | author-stats |
| BUG-10 | Search button does nothing (Enter works) | low | integration_api_contract | 15 | search-handler |

### BUG-01, search-binding (25 points, input_validation, medium)

- Files: `db.js` (`searchNotes`), `routes/notes.js` (`/search`).
- Symptom: searching "Networks" returns nothing although a note titled
  "Networks Basics" exists.
- Root cause: the prepared statement binds the raw term, so `LIKE ?` compares
  the exact full value; wildcards are never added.
- Reproduction: create a note titled "Networks Basics", search "Networks".
- Fix guidance: bind `%${term}%` (escape embedded wildcards for exactness).
- Aliases as seeded: like 1.0, wildcard 0.8, search 0.6. The answer key also
  lists % as an alias token for this bug; the seeded matcher manifest carries
  the three weighted keywords above.
- Hidden test: create note "Networks Basics"; `GET /api/notes/search?q=Network`
  must include that note.
- Secondary location: the `searchNotes` call site in `routes/notes.js`
  (non-primary anchor).

### BUG-02, create-response-id (25 points, logic, medium)

- Files: `routes/notes.js` (POST `/` response).
- Symptom: after saving, the banner says "Saved. View note #1" regardless of
  what was created; the link opens a different note.
- Root cause: the response returns `info.changes` (a rowcount, usually 1)
  instead of `info.lastInsertRowid`.
- Reproduction: sign in, create two notes, compare the id echoed in the banner.
- Fix guidance: return `info.lastInsertRowid`.
- Aliases: changes 1.0, lastinsertrowid 0.8, insert 0.5, rowid 0.5.
- Secondary location: the `createNote` statement in `db.js`.

### BUG-03, comment-render (50 points, injection, critical)

Controlled security weakness, local challenge only: the app is reachable only
on the participant's own machine, and the rules confine testing to that box.
- Files: `public/app.js` (`openNote`).
- Symptom: a comment containing markup executes in every reader's browser.
- Root cause: comments are interpolated into `innerHTML` without escaping.
- Reproduction: comment `<img src=x onerror="alert(1)">` and open the note.
- Fix guidance: build nodes with `textContent` or escape HTML before
  insertion; adding a `Content-Security-Policy` header is accepted as defense
  in depth.
- Aliases: innerhtml 1.0, xss 1.0, escape 0.6, onerror 0.6.
- Hidden test: post a comment with markup; the rendered list must contain the
  escaped text, not executable elements.
- Secondary location: the comment POST route in `routes/comments.js`.

### BUG-04, updated-at-units (15 points, logic, low)

- Files: `routes/notes.js` (PUT `/:id`).
- Symptom: "last edited" renders a number from 0 to 59 instead of a timestamp.
- Root cause: `String(new Date().getUTCSeconds())` stores the seconds
  component rather than an ISO timestamp.
- Reproduction: edit a note, check `updated_at` in `/api/notes/mine`.
- Fix guidance: store `new Date().toISOString()`.
- Aliases: getutcseconds 1.0, iso 0.6, updated 0.5, timestamp 0.5.
- Secondary location: the `updateNote` statement in `db.js`.

### BUG-05, delete-target (40 points, data_handling, high)

- Files: `db.js` (`deleteNote`), `routes/notes.js` (DELETE `/:id`).
- Verified behavior: deleting note N silently deletes the note whose id equals
  the caller's user id. Data disappears without an error.
- Root cause: the route passes `note.author_id` where the query expects the
  note id: `DELETE FROM notes WHERE id = ?` bound to the author id.
- Reproduction: as user id 1 with notes 1 and 2, `DELETE /api/notes/2`;
  `/mine` then shows note 2 still present and note 1 gone.
- Fix guidance: `db.q.deleteNote.run(note.id)`.
- Aliases: author 1.0, delete 0.8, "wrong note" 0.8, "id mismatch" 0.5.
- Hidden test: create 2 notes as user 1, DELETE note 2, `GET /mine` must
  return exactly note 2.
- Secondary location: the `deleteNote` statement in `db.js`.

### BUG-06, comment-order (15 points, logic, low)

- Files: `db.js` (`commentsForNote`), expectation in `routes/comments.js`.
- Symptom: the newest comment appears first; the thread reads backwards.
- Root cause: the query orders `created_at DESC`; the product expects
  chronological ascending order.
- Reproduction: comment twice on one note; the second comment is on top.
- Fix guidance: order by `created_at ASC`.
- Aliases: desc 1.0, asc 0.8, order 0.6, chronological 0.6.
- Secondary location: the comment GET route in `routes/comments.js`.

### BUG-07, register-validation (25 points, input_validation, medium)

- Files: `routes/auth.js` (POST `/register`).
- Symptom: an empty username or a duplicate username produces HTTP 500 with a
  raw driver error instead of a friendly 4xx.
- Root cause: no input validation before the INSERT; the UNIQUE constraint
  error escapes as an unhandled exception.
- Reproduction: register the same username twice and observe the 500.
- Fix guidance: validate fields (username non-empty, password length, display
  name), catch constraint errors and return 409 with a clear message.
- Aliases: unique 1.0, constraint 0.8, validation 0.8, 500 0.4.
- Secondary location: the `createUser` statement in `db.js`.

### BUG-08, cookie-ttl-units (40 points, configuration, high)

- Files: `server.js` (`SESSION_TTL_MS`), `routes/auth.js` (Set-Cookie).
- Symptom: the session cookie is issued with `Max-Age=604` seconds (about 10
  minutes) and the in-memory session expires on the same wrong number, so
  everyone is signed out after about 10 minutes instead of 7 days.
- Root cause: `CONFIG_TTL_DAYS` (days) is multiplied as if it were
  milliseconds (`7 * 60 * 60 * 24` = 604800), and the cookie divides it by
  1000, producing a roughly 10 minute TTL.
- Reproduction: sign in and read Max-Age on the Set-Cookie header; wait 10
  minutes (or shorten CONFIG_TTL_DAYS in a copy) and reload.
- Fix guidance: express TTL in the correct unit
  (`days * 24 * 60 * 60 * 1000`) and use one shared constant for the cookie
  and the in-memory session.
- Aliases: maxage 1.0, ttl 0.8, cookie 0.8, units 0.6.
- Hidden test: login, then `GET /api/auth/me` with the returned cookie; must
  still be authenticated.
- Secondary location: the Max-Age computation in `routes/auth.js`.

### BUG-09, author-stats (25 points, logic, medium)

- Files: `db.js` (`authorStats`).
- Symptom: "notes total" on the profile shows the count of ALL users' notes.
- Root cause: the first subquery counts every row of `notes` with no author
  filter.
- Reproduction: with two accounts and three notes total, one user's profile
  shows "3 notes total".
- Fix guidance: `SELECT count(*) FROM notes WHERE author_id = ?`.
- Aliases: count 1.0, stats 0.8, profile 0.6, author 0.6.
- Secondary location: the `/me` route in `routes/auth.js`.

### BUG-10, search-handler (15 points, integration_api_contract, low)

- Files: `public/app.js` (click handler registration).
- Symptom: clicking the Search button does nothing; pressing Enter works.
- Root cause: the handler queries `.search-go` (class selector) but the button
  has `id="search-go"`, so `querySelector` returns null and the listener
  never attaches (it throws during boot).
- Reproduction: click the Search button; nothing happens.
- Fix guidance: use the `#search-go` id selector (or add the class to the
  button).
- Aliases: queryselector 1.0, class 0.6, id 0.6, handler 0.5.
- Secondary location: the `id="search-go"` markup in `public/index.html`.

## 3. The two CTF flags (60 bonus points)

| Key | Points | How it is found |
| --- | --- | --- |
| FLAG-1 | 30 | Broken access control: the admin overview API (`/api/admin/overview?view=admin`, or an `is_admin=true` cookie) returns the admin notice containing the flag. Server-side authorization is missing; the admin page is gated client side only. |
| FLAG-2 | 30 | A Base64-encoded string sits in the onboarding comment of `public/app.js`; decoding it yields the flag. |

Flag plaintext values live only in `challenge-app/ORGANIZER_ANSWER_KEY.md`.
The platform stores them exclusively as HMAC hashes (`flag_code_hash`) in the
gt schema, so neither the app database nor any participant-facing surface can
leak them. Verified flags pay bonus points capped by the stage configuration
(`ctf_bonus_cap_points`, 100 per team per stage); per-flag max awards are
configurable, default 99. Wrong or duplicate codes score nothing and every
attempt is recorded. The capped bonus policy is specified in
`docs/SCORING_MODEL.md`.

## 4. Difficulty calibration notes

- Point mass versus discovery cost. BUG-03 (50) is loud once a team tries
  posting markup, but a precise report (file, exact lines, escaping root
  cause) takes real work. BUG-08 (40) is felt by everyone at the 10 minute
  mark, which makes it the round's great equalizer; teams that diagnose rather
  than guess the unit error score it cleanly.
- Small-value traps. BUG-04 (15) and BUG-06 (15) are cheap to find but easy to
  mislocate by a few lines; the 2 line tolerance and the alias weights reward
  reports that quote the actual statement.
- Cross-file lessons. BUG-01, BUG-05, and BUG-08 each span two files, teaching
  that a symptom and its cause rarely share a line. The matcher's secondary
  locations (non-primary anchors) let a report pointing at either file score
  location credit where it applies.
- The one-click trap. BUG-10 (15) is the only bug a team can notice before
  signing in; it exists so no team leaves the first hour empty handed, and as
  a lesson that UI dead zones can be boot-time exceptions.
- Flags as depth. FLAG-1 rewards reading the server route behind a client
  gate; FLAG-2 rewards skepticism about encoded data. Both are optional and
  capped so they pad a strong main score without deciding ranks by
  themselves.

## 5. Pre-event audit protocol (INT-02)

Before the event, in this order:

1. Two reviewers who did not author the files audit every file of
   `challenge-app/` against the promised-behavior README. Their job: find
   defects that are NOT in the answer key, and confirm every key entry is
   reproducible as written.
2. Unplanned defects are either fixed (with a note in the key's revision
   history) or registered as accepted unplanned behavior, so the review desk
   is never surprised by a valid report the ground truth does not cover.
3. A pre-flight pass with three people outside the authoring team runs the
   full loop: run the app, find at least three of the ten bugs from the README
   alone, file practice reports, and check the reproduction text of every key
   entry. Their findings are diffed against the key.
4. The platform records this in the readiness item `challenge_audit`
   ("Two independent reviewers certified the challenge (unplanned defects)"),
   which must be checked before the event can go live.

During the round, `unplanned_valid` reviewer decisions route such reports to
the organizers with priority 2 instead of scoring them automatically;
promotion of an unplanned finding into a scored award unit is a deliberate
post-release decision, not a queue side effect (see
`docs/SCORING_MODEL.md`).

## 6. How the platform ingests the challenge

`backend/seed.py` is the ingestion path (the admin API mirrors it for
hand-built challenges):

- Files. Eleven participant-visible files are stored inertly as text with
  sha256, size, line count, and a per-line search index:
  `package.json`, `server.js`, `db.js`, `routes/auth.js`, `routes/notes.js`,
  `routes/comments.js`, `public/index.html`, `public/app.js`,
  `public/styles.css`, `public/admin.html`, `README.md`.
  `ORGANIZER_ANSWER_KEY.md` is deliberately excluded from participant-visible
  storage; the seed header states this rule next to the list.
- Instructions. The participant README becomes the challenge version's
  instructions markdown ("Papyrus - Campus Notes (challenge edition)", v1).
- Ground truth. The ten bugs and two flags are inserted into the gt schema
  from the manifest in the seed (mirroring the answer key), with a gt revision
  record ("initial seed") listing the codes.
- Pattern anchors (DAT-06). Each bug's location is found at seed time by
  matching a regex against the actual file (for example BUG-08 anchors on
  `const SESSION_TTL_MS = CONFIG_TTL_DAYS \* 60 \* 60 \* 24;`). The stored
  range is the matched line plus one line of context on each side, and an
  anchor hash (sha256 over the three line window) is stored with it, so a
  later file change that shifts lines is detectable rather than silently
  mis-scoring. A missing pattern prints a warning instead of failing silently.
- Aliases. Each bug's matching keywords and weights are stored per bug and
  consumed by the deterministic matcher at evaluation time.
- Flags. Only HMAC hashes are stored (`gt_flags.code_hash`); plaintext never
  enters the app schema.

## 7. Hidden functional tests and offline evaluation

Each accepted award unit can carry hidden test cases (`gt_test_cases`). In v1
they execute OFFLINE: the organizer runs the repaired challenge app per team
outside the platform and records `tests_passed` and `tests_total` per
submission through the admin API (`POST /v1/admin/challenges/{id}/ground-truth/test-results`,
step-up required), which appends the functional_test ledger component. The
per-bug hidden tests in section 2 are the organizer's checklist for that
recording. Automating this against participant code requires the isolated
runner (ADR-010) and is a P2 item; the runner switch ships disabled.

## 8. The rule about the answer key

`challenge-app/ORGANIZER_ANSWER_KEY.md` is RESTRICTED. Concretely:

- It is not in the participant file list and is never served by the challenge
  or assignment APIs.
- It is never embedded in any frontend bundle; the participant API cannot read
  the gt schema (gt_isolation readiness item), and the matcher runs only in
  the evaluator with the restricted gt role.
- Points, aliases, and locations exist in participant-visible form only as
  aggregates (scoring weights, caps, taxonomy), never as per-bug data, until
  the stage releases feedback, at which point participants see matched bug
  codes and points for their own submissions only.

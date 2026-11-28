Status: draft expansion specification, created 2026-11-29. All durations, sizes and
calibration targets in this document are design targets and are UNVERIFIED until a
timed playtest is run.

# Papyrus Challenge App Expansion Specification (Fall Back)

RESTRICTED: organizer material. This document describes where defects will be
planted and what the correct answers are. It is not shipped to participants,
the participant API, or any frontend bundle. The participant tree must never
contain bug codes, root-cause comments, flag plaintext, or this document.

## 0. Goal beyond the goal

A team of five should spend 30 to 40 focused minutes on each of the four levels
without waiting, without finishing early, and without guessing. The durable
outcome is a repeatable content pipeline: a clean reference application, a
deterministic defect-injection build, and a calibrated question set that can be
reused and re-seeded for the next event without hand-editing ground truth.

Ambition applied here:

- Altitude: design the content system and its verification gates, not just a
  longer list of bugs.
- Depth: work from the actual platform matching rules, level gates, and audit
  findings, then design defects that those rules score correctly.
- Range: borrow from QA mutation testing, puzzle design, and technical writing
  rubrics, using their instruments (discriminating tests, cap accounting,
  rubric anchors) rather than their vocabulary.

Outside judges, none of which are the author's own opinion:

1. The clean reference build passes its full test suite and a leakage lint
   before any defect is injected.
2. Every planted defect has an offline hidden test that fails on the injected
   build and passes on the repaired build.
3. Two reviewers who did not author the files audit the injected build against
   the answer key before the event.
4. Two timed playtests with teams drawn from outside the authoring group
   produce the calibration numbers in section 9.

## 1. Scope and constraints

### 1.1 In scope

Only the papyrus challenge application (Option A, Node and Express with the
built-in `node:sqlite` driver), its participant-facing test cases and hints,
its side quest pack, and the seed and configuration changes needed to ingest
the larger content set.

Out of scope for this document: the Marina option (Option B), the platform
frontend, MERN translation, and changes to the scoring formula. Option B
parity remains a separate blocking READY item in
`docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md`.

### 1.2 Time and throughput model

A level has 30 to 40 minutes and five participants, so 150 to 200 person
minutes per level. The intended division of labour:

| Level | Work units | Parallelism | Target person minutes |
| --- | --- | --- | --- |
| 1 | 12 guided reports | each person owns 2 or 3 reports | 140 to 180 |
| 2 | 10 chain reports | each person owns 2 chains | 150 to 200 |
| 3 | 10 repairs plus side quests | repairs split, quests optional | 150 to 200 |
| 4 | 10 regression tests plus docs | tests split, docs reviewed as a team | 150 to 190 |

These are targets, not measurements. Section 9 defines how to verify them.

### 1.3 Platform contracts that shape the design

Taken from the current implementation, not assumed:

- Level 1 flags carry exactly one file and line range. Level 2 flags carry 1 to
  5 ordered locations. A single range may span at most 25 lines
  (`backend/app/routers/levels.py`).
- Categories are fixed: `logic`, `input_validation`,
  `authentication_authorization`, `injection`, `cryptography`,
  `resource_handling`, `concurrency`, `error_handling`, `configuration`,
  `integration_api_contract`, `data_handling`, `other`.
- Multi-location matching (`backend/app/matching.py`, `decide_multi`) only
  auto-accepts when location coverage is at least 0.9. A report that names the
  visible symptom but misses the root-cause anchor routes to human review.
  This is the mechanism that punishes patchy diagnosis, so every Level 2 bug
  must have 2 or 3 seeded locations, with the root cause marked primary.
- The taxonomy families in `matching.py` give partial category credit. Alias
  keywords are plain substrings, so aliases must be specific phrases rather
  than generic words such as `count` or `author`.
- Per-stage caps in `backend/seed.py` allow 12 reports per file, 80 reports per
  round, and a 20 second cooldown per file. The larger bug set stays inside
  these caps if the catalog is spread over many files, as it is below.
- CTF flags are stored only as HMAC hashes, and bonus is capped at 100 points
  per team per stage. Side quests are designed around that cap.
- Level 4 review already has a rubric shape: `functionality`, `root_cause`,
  `code_quality`, `testing`, `evidence`, each 0 to 1
  (`backend/app/routers/review.py`).

### 1.4 Required platform change (blocking for the new content)

`backend/app/evaluator_level.py` obtains candidates with
`_candidates_for_version()`, which returns every bug for the challenge version
without filtering by level. With a single catalog shared across four levels, a
Level 1 one-location report can match a Level 2 bug, and a Level 2 report can
win a Level 1 award. This becomes likely once the catalog grows to 22 units.

Required change, owned by the platform workstream and outside this document's
implementation:

- Add a level field to `gt_bugs` (or a level to bug mapping table).
- Filter candidates in `_candidates_for_version()` by the level of the
  submission before calling `decide()` or `decide_multi()`.
- Seed the level field from the generated ground-truth manifest.

Until that change lands, the expanded catalog must not be seeded into one
shared challenge version.

### 1.5 Trust and leakage rules carried over from AGENTS.md

- The clean reference tree is the source of truth. Defects exist only in the
  generated participant tree.
- The answer key and this spec stay in organizer storage. The seed ingests
  only the generated participant file list and the restricted manifest.
- No participant-visible file may contain `BUG-`, a root-cause explanation, a
  literal `FLAG{`, or an onboarding token that decodes to a flag. The builder
  enforces this with a lint step.
- Demo credentials and secrets stay out of the challenge content.

## 2. The clean reference application

### 2.1 Two-tree build model

```text
papyrus-reference/            clean, complete, no planted defects, fully tested
challenge-app/                generated participant tree, defects injected
organizer/
  gt-manifest.json            restricted: codes, level, points, aliases, anchors
  injection-manifest.json     restricted: ordered patches applied to reference
  answer-key.md               restricted: reproduction, root cause, fix guidance
  sidequest-flags.json        restricted: HMAC hashes of side quest flags
scripts/
  build_papyrus_challenge.py  reference -> challenge-app, lint, anchors, manifest
```

The build is deterministic and repeatable. Organizers plant bugs later by
adding entries to `injection-manifest.json` and re-running the builder. The
builder rewrites anchors and the seed manifest, so line drift is detected
rather than silently mis-scored (DAT-06 behaviour).

### 2.2 Feature surface

The reference app is a campus note platform with ten vertical slices. Each
slice has a route, a service, domain logic, prepared queries, a serializer, a
client module, and tests. This layering is what makes cross-file breadcrumbs
possible without contrivance.

| Slice | Routes | Main files |
| --- | --- | --- |
| Auth and sessions | register, login, logout, me | `http/routes/auth.js`, `services/auth.js`, `domain/auth.js`, `db/queries/users.js` |
| Notes | list, detail, mine, create, edit, delete | `http/routes/notes.js`, `services/notes.js`, `domain/notes.js`, `db/queries/notes.js` |
| Search | keyword search, subject and tag filters, sort | `http/routes/search.js`, `domain/search.js`, `domain/pagination.js` |
| Comments | post, list, edit own, delete own | `http/routes/comments.js`, `services/comments.js`, `domain/comments.js`, `db/queries/comments.js` |
| Tags | create tag, attach to note, list by tag | `http/routes/tags.js`, `db/queries/tags.js` |
| Bookmarks | toggle, list mine | `http/routes/bookmarks.js`, `services/bookmarks.js`, `db/queries/bookmarks.js` |
| Profile and stats | profile, counts, subject spread | `http/routes/profile.js`, `services/profile.js`, `db/queries/stats.js`, `domain/stats.js` |
| Notifications | outbox, digest view, digest worker | `db/queries/outbox.js`, `services/notifications.js`, `workers/digest.js` |
| Admin corner | overview, notices, moderation queue | `http/routes/admin.js`, `public/admin.html`, `http/middleware/require-auth.js` |
| Health and errors | health probe, central error handling | `http/routes/health.js`, `http/middleware/error-handler.js` |

### 2.3 Target repository shape

Approximately 75 participant-visible files and 8,000 to 10,000 lines including
tests and docs (target, unverified). Layout:

```text
package.json, README.md, server.js
config/{default,env}.js
db/{schema.sql,client.js,migrate.js,seeds/campus.js}
db/queries/{users,notes,comments,tags,bookmarks,outbox,stats}.js
domain/{auth,notes,comments,search,pagination,stats}.js
services/{auth,notes,comments,profile,bookmarks,notifications}.js
http/middleware/{session,require-auth,validate,error-handler,rate-limit}.js
http/routes/{auth,notes,search,comments,tags,bookmarks,profile,admin,health}.js
http/serializers/{note,comment,user}.js
workers/digest.js
public/{index.html,admin.html,styles.css,app.js}
public/modules/{api,auth,notes,comments,search,tags,bookmarks,render,router,util}.js
test/helpers/{http,db}.js
test/unit/domain/*.test.js
test/integration/api/*.test.js
docs/{API,CONFIG,DATA_MODEL,ARCHITECTURE,CHANGELOG}.md
```

Configuration is explicit and documented in `docs/CONFIG.md`, including units
for every duration and size value. Seed data is deterministic: three users,
twelve notes across four subjects, nine comments, four tags, and a small
outbox. Determinism matters because all hidden tests and playtests use the
same starting state.

### 2.4 Reference quality gate (before any bug is planted)

The reference build is not ready for injection until all of these pass:

1. `npm test` green, including unit, integration, and a full API smoke pass.
2. `npm run lint:leak` finds no `BUG-`, no `FLAG{`, no answer-key phrases.
3. Every documented promise in `README.md` has a passing integration test.
4. Two reviewers who did not author the files sign off on the clean build.
5. A cold start on an empty database and a warm start on a seeded database
   both produce the same API responses for the smoke pass.

## 3. Defect injection pipeline

### 3.1 Injection manifest format

Each entry describes one award unit. The reference code stays untouched.

```json
{
  "ticket": "P2-04",
  "gt_code": "BUG-16",
  "level": 2,
  "category": "error_handling",
  "points": 50,
  "primary_file": "services/comments.js",
  "patches": [
    { "file": "services/comments.js", "find": "...", "replace": "..." },
    { "file": "db/queries/outbox.js", "find": "...", "replace": "..." },
    { "file": "workers/digest.js", "find": "...", "replace": "..." }
  ],
  "anchors": [
    { "file": "services/comments.js", "pattern": "catch (err) { /* swallow */ }", "primary": true },
    { "file": "db/queries/outbox.js", "pattern": "recipient_id TEXT", "primary": false },
    { "file": "workers/digest.js", "pattern": "missing recipient", "primary": false }
  ],
  "aliases": [["swallowed", 1.0], ["empty catch", 0.8], ["outbox", 0.6]],
  "hidden_tests": ["TC-P2-04a", "TC-P2-04b"]
}
```

### 3.2 Builder steps

1. Copy `papyrus-reference/` to `challenge-app/`.
2. Apply patches in manifest order, failing loudly if any `find` text is
   missing or ambiguous.
3. Run the leakage lint over the whole participant tree.
4. Resolve each anchor pattern to a line range, store the matched three-line
   window hash, and write `organizer/gt-manifest.json`.
5. Write `challenge-app/PARTICIPANT_FILES.json` from the actual tree. The seed
   reads this file instead of a hardcoded list, and the answer key can never
   be included because it lives outside the tree.
6. Generate the Level 1 test case runner and the hint sheet from the same
   manifest so ticket identifiers stay consistent.
7. Print a diff summary for the two-reviewer audit.

### 3.3 Planting rules

- A defect must be reproducible from the participant README or from a supplied
  test case. No bug may depend on hidden knowledge of the platform.
- A defect must have a working fix in the clean reference. If the reference is
  ambiguous about intended behaviour, fix the reference first and document
  the decision.
- Level 2 defects must produce at least one error message or log line that
  names the next concept to inspect. Breadcrumbs are written into the injected
  code, not into participant hints.
- Every Level 2 defect must have a decoy patch: a small, obvious change at the
  visible failure site that makes the symptom disappear but fails the hidden
  test. The answer key records why the decoy is wrong.
- Alias tokens must be specific to the root cause. Generic tokens are banned
  because the matcher uses substring containment.

## 4. Level 1: guided reconnaissance

### 4.1 Participant question

The Level 1 brief says: "The app ships with twelve failing checks and twelve
matching hints. Run the checks, reproduce each failure, find the single line
responsible, and file one report per failure. A report needs a file, a line
range, a category, and an explanation of why the line causes the failure."

Test cases live in `test/cases/level1/TC-01` through `TC-12` with a runner
`npm run tc:l1`. Each check prints a symptom and an assertion, for example
`TC-01: expected Max-Age >= 604800, got 604`. Hints live in
`hints/L1_HINTS.md`, keyed by test case number, one hint per check, phrased at
concept level (for example, "Two time units meet in one constant"). Hints never
name a file or a line.

This level deliberately gives away symptoms. The skill being tested is localising
a cause precisely and explaining it, not discovering that something is broken.

### 4.2 Award units

| Ticket | GT | Area | Category | Pts | Primary file | Symptom driven by TC |
| --- | --- | --- | --- | --- | --- | --- |
| P1-01 | BUG-01 | config | configuration | 20 | `config/default.js` | Session Max-Age is about 10 minutes, not 7 days |
| P1-02 | BUG-02 | config | configuration | 20 | `config/env.js` | Note list is empty because the default page limit parses to 0 |
| P1-03 | BUG-03 | middleware | configuration | 20 | `http/middleware/rate-limit.js` | Rate limiter never trips because its window is 60 ms |
| P1-04 | BUG-04 | GET input | input_validation | 15 | `http/routes/notes.js` | `?subject=networks` returns all notes because the route reads `subjects` |
| P1-05 | BUG-05 | GET input | integration_api_contract | 15 | `http/routes/tags.js` | `GET /api/tags/:tagId/notes` reads `req.params.tag_id` and 404s |
| P1-06 | BUG-06 | GET input | input_validation | 15 | `http/routes/search.js` | `?q=` is ignored because the route reads `query` |
| P1-07 | BUG-07 | sorting | logic | 15 | `domain/pagination.js` | `?sort=title` has no effect because the column key is misspelled |
| P1-08 | BUG-08 | API typo | integration_api_contract | 20 | `server.js` | Bookmark calls 404 because the router is mounted at the singular path |
| P1-09 | BUG-09 | API typo | integration_api_contract | 15 | `http/serializers/user.js` | Author names render blank because the field name casing differs |
| P1-10 | BUG-10 | API typo | integration_api_contract | 15 | `public/modules/bookmarks.js` | Unbookmark sends PUT to a POST-only route |
| P1-11 | BUG-11 | UI | integration_api_contract | 10 | `public/modules/search.js` | Search button is dead because the selector is a class, not an id |
| P1-12 | BUG-12 | validation | input_validation | 20 | `http/routes/auth.js` | Duplicate registration returns raw 500 instead of 409 |

Level 1 main score available: 200 points. All twelve have exactly one seeded
location, matching the one-location flag rule.

### 4.3 Why these questions

The first three teach configuration reading: a constant, an environment parse,
and a unit mismatch. The next four teach GET boundary discipline: parameter
names, path parameters, and sort whitelists. The next three teach API contract
alignment across mount path, serializer, and HTTP method. The last two are the
gentle entry point and the loud 500. Together they cover the three bug kinds
the brief calls out (config, wrong GET input, API typo) and they spread across
twelve files so the per-file report cap and cooldown never bite.

## 5. Level 2: trace the chain

### 5.1 Participant question

The Level 2 brief says: "Ten defects each span two or three files. Error
messages and logs are your trail. File one report per defect with the
locations in the order you followed them. Naming only the visible failure is
not enough." No test cases and no hints are supplied for Level 2.

Each award unit has 2 or 3 seeded locations. The primary anchor is the root
cause. Because `decide_multi` requires coverage of at least 0.9 of seeded
locations, a symptom-only report cannot auto-accept. Reviewers are briefed to
score `root_cause` low when the report stops at the decoy site.

### 5.2 Award units

**P2-01 / BUG-13, note insert drops the author, data_handling, 45 points.**
Symptom: a created note returns 201 but never appears in "my notes", and the
author name is blank in the list. Breadcrumb chain: `http/routes/notes.js`
logs `create note: author missing for <title>`; `services/notes.js` reports
`createNote rejected: invalid author reference`; `domain/notes.js`
`sanitizeNoteInput` strips `author_id` as client-controlled and the service
forgets to re-add `req.user.id`. Locations: `domain/notes.js` primary,
`services/notes.js`, `http/routes/notes.js`. Decoy patch: default
`author_name` to "unknown" in the serializer. Hidden test: after create,
`GET /api/notes/mine` contains the new note with the caller's id.

**P2-02 / BUG-14, subject filter main-helper dissonance, integration_api_contract, 40 points.**
Symptom: filtering by `subject=networks` returns nothing although seeded notes
have that subject. Breadcrumb chain: `services/notes.js` logs `subject filter
returned 0 rows for "networks"`; `db/queries/notes.js` documents that
`notesBySubject` expects a lowercase slug; `domain/notes.js` helper
`normalizeSubject` delegates to `titleCase`. The main expects a slug, the
helper returns a label. Locations: `domain/notes.js` primary,
`services/notes.js` call site, `db/queries/notes.js`. Decoy patch: compare with
`lower(subject) = lower(?)` in the query. Hidden test asserts
`normalizeSubject("networks") === "networks"` and that the tag filter also
works, so the query-level patch alone fails.

**P2-03 / BUG-15, the unit test is wrong, other, 30 points.**
Symptom: `npm test` is green while the search integration check fails.
Breadcrumb chain: integration failure `search by prefix returns 0 rows`; unit
test named `buildLikePattern returns term unchanged`; the domain function has
no wildcard test. Root cause: the unit test encodes the buggy behaviour, so
it hides the defect instead of catching it. Locations:
`test/unit/domain/search.test.js` primary, `domain/search.js`,
`test/integration/api/search.test.js`. Decoy patch: weaken the integration
test to match the current behaviour. Hidden test requires the corrected unit
test to assert `%term%` and the integration test to remain strict.

**P2-04 / BUG-16, silent enqueue breaks the digest, error_handling, 50 points.**
Symptom: the admin digest shows an empty "new comments" section. Breadcrumb
chain: `workers/digest.js` logs `outbox row <id> missing recipient`;
`db/queries/outbox.js` allows a NULL `recipient_id`; `services/comments.js`
wraps the enqueue call in an empty catch. Locations: `services/comments.js`
primary, `db/queries/outbox.js`, `workers/digest.js`. Decoy patch: add
`if (!row.recipient_id) continue;` in the worker. Hidden test: after posting a
comment, exactly one outbox row exists with a non-null recipient and the
digest contains the comment.

**P2-05 / BUG-17, migration drift on a cold start, configuration, 45 points.**
Symptom: "last edited" renders `Invalid Date` on a fresh database while a
long-lived database looks fine. Breadcrumb chain: `http/routes/notes.js` logs
`updateNote returned undefined updated_at`; `db/migrate.js` applies migration
004 with `CREATE TABLE IF NOT EXISTS`, so it never adds the column when
`db/schema.sql` already created the table; `db/schema.sql` omits `updated_at`
from the notes definition. Locations: `db/schema.sql` primary,
`db/migrate.js`, `db/seeds/campus.js`. Decoy patch: make the serializer fall
back to `created_at`. Hidden test: cold start, edit a note, then
`GET /api/notes/mine` must show `updated_at` strictly after `created_at`.

**P2-06 / BUG-18, bookmark double toggle, concurrency, 45 points.**
Symptom: after a double click the profile shows two bookmarks for one note.
Breadcrumb chain: `services/bookmarks.js` logs `toggle bookmark: existing rows
= 0` twice; `db/queries/bookmarks.js` does read then insert with no UNIQUE
constraint; `public/modules/bookmarks.js` registers both a click handler and a
form submit handler. Locations: `db/queries/bookmarks.js` primary,
`services/bookmarks.js`, `public/modules/bookmarks.js`. Decoy patch: clamp the
displayed count to 1. Hidden test: two rapid toggles leave one row, and the
next toggle removes it.

**P2-07 / BUG-19, client gate on the admin corner, authentication_authorization, 50 points.**
Symptom: `?view=admin` or an `is_admin=true` cookie reveals the admin notice.
Breadcrumb chain: `public/admin.html` hides the panel with CSS only;
`http/routes/admin.js` trusts the query flag or cookie;
`http/middleware/require-auth.js` exists but is never applied to the route.
Locations: `http/routes/admin.js` primary, `http/middleware/require-auth.js`,
`public/admin.html`. Decoy patch: remove the notice markup from the page.
Hidden test: `GET /api/admin/overview?view=admin` without a session returns
403 and contains no notice text.

**P2-08 / BUG-20, shared salt and timing-unsafe compare, cryptography, 40 points.**
Symptom: two accounts with the same password store identical `password_hash`
values, and login comparison time varies with how many characters match.
Breadcrumb chain: `services/auth.js` logs `salt reused for account`;
`domain/auth.js` `hashPassword` uses a module-level constant salt and
`verifyPassword` compares with `===`; `db/queries/users.js` stores the single
digest in a column that looks salted. Locations: `domain/auth.js` primary,
`services/auth.js`, `db/queries/users.js`. Decoy patch: generate a fresh salt
only in the register route, leaving legacy accounts weak. Hidden test: two
users with the same password have different stored hashes, and verification
uses a constant-time comparison.

**P2-09 / BUG-21, stats count everyone's notes, data_handling, 40 points.**
Symptom: a profile shows the total number of notes in the app. Breadcrumb
chain: `services/profile.js` logs `stats request for user id ...`;
`db/queries/stats.js` first subquery has no author filter;
`http/routes/profile.js` calls the service without the user id. Locations:
`db/queries/stats.js` primary, `services/profile.js`,
`http/routes/profile.js`. Decoy patch: divide the displayed total by the
number of users in the serializer. Hidden test: two users and three notes,
each profile shows only its owner's count.

**P2-10 / BUG-22, verbose error handling, error_handling, 40 points.**
Symptom: a 500 response prints the SQLite driver message and a file path.
Breadcrumb chain: `http/middleware/error-handler.js` sends `err.message`;
`services/notes.js` lets constraint errors bubble; `http/routes/comments.js`
accepts a non-numeric note id and triggers a foreign key error. Locations:
`http/middleware/error-handler.js` primary, `services/notes.js`,
`http/routes/comments.js`. Decoy patch: return a generic 500 string only.
Hidden test: an invalid note id on comment POST returns 400 with no driver
text, and no 500 body ever contains `sqlite`.

Level 2 main score available: 425 points. Combined main score across Levels 1
and 2: 625 points, subject to stage max_points approval.

### 5.3 Reviewer guidance for Level 2

A report is high quality when it names the primary anchor, explains why the
intermediate messages point there, and rejects the decoy patch explicitly.
`accept_full` should require location coverage as implemented. `needs_review`
items that match only a visible-failure anchor should receive a low
`root_cause` rubric score and be rejected as a symptom patch. This guidance is
given to reviewers, not to participants.

## 6. Level 3: repair and side quests

### 6.1 Repair set R

The Level 3 brief says: "Fix the ten tickets in your repair set. You may use
the provided coding agent and its rules. Verify every change against the
documented behaviour before you submit. The side quest pack is optional, is
not part of this repository, and awards capped bonus points."

The brief names ten tickets to fix in the editable workspace. They are chosen
for breadth, not difficulty: `P1-01`, `P1-04`, `P1-06`, `P1-08`, `P1-12`,
`P2-01`, `P2-02`, `P2-04`, `P2-07`, `P2-09`. A `REPAIR_SET.md` file in the
workspace lists them with the participant-facing ticket titles. Hidden tests
for each repair item are the same as the hidden tests in sections 4 and 5.

A submission is a zip or computed diff plus a short repair log that maps each
ticket to the files changed and the reason. The platform already accepts these
artifact formats for Level 3.

### 6.2 Coding agent rules and the handoff trap

Agent use is part of this level only. Level 1 and Level 2 remain no-AI because
they measure unaided diagnosis. This needs an explicit rules amendment before
the event; it is an owner decision, listed in section 11.

The workspace ships `agent/AGENT_RULES.md`, `agent/PROMPT_TEMPLATE.md`, and
`agent/DRAFT_NOTES.md`:

- Rules: repo scope only, no network, no ground truth, no other teams, every
  command logged, and the agent's output must be verified by a human before it
  is accepted.
- Prompt template: a fixed starting prompt that tells the agent to read the
  ticket, reproduce the failure, make the smallest correct fix, and add no new
  dependencies.
- Draft notes: a deterministic "junior engineer handoff" that contains correct
  suggestions for nine tickets and the decoy patch from `P2-04` as the tenth.
  Teams that paste the draft into an agent without checking the digest hidden
  test lose those points. This is the deterministic version of the "coding
  agent" idea and it is fair to grade because it does not depend on model
  output.

### 6.3 Side quests (unrelated to the repository)

The side quest pack is a separate offline download, not part of the challenge
file list. It is referenced by the Level 3 brief. All answers are stored only
as HMAC hashes in the restricted flag manifest. No quest artifact contains
literal flag text.

| Quest | Artifact | Skill | Points |
| --- | --- | --- | --- |
| SQ-1 | `sidequests/field-notes.txt` with three chained base64 fragments | Decoding | 30 |
| SQ-2 | `sidequests/gateway.log`, 400 lines, token split across two headers | Log forensics | 30 |
| SQ-3 | `sidequests/ghost.bundle`, a git bundle with a reverted commit | History archaeology | 30 |
| SQ-4 | `sidequests/notice.txt`, short Vigenere text with a known crib | Cryptogram | 40 |
| SQ-5 | `sidequests/campus.png` plus offline `decode_lsb.py` | Steganography | 40 |

Total nominal bonus is 170 points, above the 100 point cap, so the cap is a
real constraint and teams must choose which quests to chase. Submission uses
the existing flag-code endpoint. Wrong and duplicate codes are recorded.

## 7. Level 4: tests and documentation

### 7.1 Required test work

The Level 4 brief says: "Your Level 3 repairs are frozen. Add a regression
test for each repaired ticket and update the documentation so the repository
tells the truth. A test that does not fail on the original defect does not
count."

For every ticket in repair set R, add at least one regression test under
`test/regression/` that names the ticket in a comment and fails on the
injected build. The organizer gate runs each submitted test twice:

1. Against the injected build: the test must fail.
2. Against the team's repaired build: the test must pass.

A test that passes on the injected build is non-discriminating and scores zero
for that ticket. This mutation check is the outside judge for test quality and
replaces subjective "looks well tested" judgement.

### 7.2 Required documentation work

| File | Required change |
| --- | --- |
| `README.md` | Promises now match behaviour; no claim left that still fails |
| `docs/API.md` | Correct contracts for the ten repaired endpoints |
| `docs/CONFIG.md` | Units and sources for TTL, page limit, and rate limit window |
| `docs/DATA_MODEL.md` | Migration ordering rule and the outbox recipient invariant |
| `docs/CHANGELOG.md` | One entry per repair that states root cause, not just symptom |

No em dashes in any participant-facing copy, per `docs/FRONTEND_DESIGN_DIRECTION.md`.

### 7.3 Rubric mapping

Use the existing `RubricScores` fields with these anchors:

| Field | 1.0 means |
| --- | --- |
| `functionality` | All ten hidden tests pass on the repaired build |
| `root_cause` | Every repair log entry names the primary cause and rejects its decoy |
| `code_quality` | No symptom-only patch remains; layering and contracts are preserved |
| `testing` | Every submitted regression test discriminates injected from repaired build |
| `evidence` | Docs and tests reference the same tickets with reproducible steps |

Weights are stage configuration and an owner decision. Provisional values for
rehearsal only: functionality 0.35, root_cause 0.25, code_quality 0.15,
testing 0.15, evidence 0.10. These are unverified defaults, not event policy.

Two reviewers per team submission, calibrated on three sample submissions
before the event, using the same anchors.

## 8. Seed and configuration changes

1. `PARTICIPANT_FILES` in `backend/seed.py` is replaced by reading
   `challenge-app/PARTICIPANT_FILES.json` produced by the builder. The answer
   key remains excluded by construction.
2. `GT_BUGS` is replaced by reading `organizer/gt-manifest.json`. Each entry
   carries `level`, `code`, `category`, `points`, `aliases`, and anchor patterns.
3. `GT_FLAGS` gains the five side quest hashes. Plaintext stays in restricted
   storage only.
4. `LEVEL_EXPLAIN_MD` is updated for all four levels with the new tasks, the
   Level 1 test case runner, the Level 3 agent rules reference, and the side
   quest pack reference.
5. Stage config: approve max_points for 625 combined main points, keep report
   caps and cooldowns as in section 1.3, configure `side_quest` max points at
   or below the existing 100 point cap, and approve the Level 4 rubric weights.
6. Land the level-scoped candidate filter from section 1.4 before seeding the
   expanded catalog.
7. Update `docs/CHALLENGE_DESIGN_AND_GROUND_TRUTH.md` and
   `challenge-app/ORGANIZER_ANSWER_KEY.md` from the generated manifest so the
   documents cannot drift from the seeded truth.

## 9. Calibration and outside judges

### 9.1 Playtest protocol

Run two timed rehearsals before the event. Each uses two teams of five drawn
from outside the authoring group, plus five individual testers for the second
run. Each team gets the real four-level brief and the real time windows. The
authoring team observes without coaching. Measure:

- time to first accepted report per level;
- number of award units surfaced and accepted per level;
- fraction of Level 2 reports that name the primary anchor;
- fraction of teams that fall for each decoy patch;
- Level 3 repairs that pass hidden tests on first submission;
- Level 4 regression tests that discriminate injected from repaired build;
- side quest completion count and cap utilisation.

### 9.2 Targets (all unverified until the playtest)

| Metric | Target |
| --- | --- |
| Level 1 median completion | 28 to 35 minutes, at least 10 of 12 units surfaced |
| Level 2 median completion | 32 to 40 minutes, at least one team not finishing all 10 |
| Level 2 reports naming the primary anchor | at least 70 percent |
| Decoy patch trap rate | between 10 and 30 percent of teams per decoy |
| Level 3 median completion | 30 to 40 minutes, at least 7 of 10 repairs passing |
| Level 4 median completion | 30 to 40 minutes, at least 7 of 10 tests discriminating |
| Teams finishing every level early | zero |

A miss with real numbers is a useful result. A target met by weakening the
hidden tests or by leaking hints is a failure.

### 9.3 Automated gates before READY

- Clean reference: full test suite green and two-reviewer signoff.
- Injected build: every award unit has a failing hidden test on injection and a
  passing hidden test on repair.
- Leakage lint: no bug codes, root-cause comments, flag plaintext, or answer
  key phrases in the participant tree.
- Anchor verification: all 22 bugs resolve to stable patterns and hashes.
- Two independent reviewers audit the injected tree against the answer key and
  fix or register every unplanned defect, as required by INT-02.

## 10. Build sequence

| Milestone | Deliverable | Exit gate |
| --- | --- | --- |
| M0 | Owner decisions in section 11 recorded | Scope and AI rules signed off |
| M1 | Clean `papyrus-reference/` with tests and docs | Section 2.4 gate green |
| M2 | Builder, injection and GT manifests, leakage lint | Deterministic rebuild, clean diff |
| M3 | Level 1 TCs and hints, Level 2 breadcrumbs and hidden tests, side quest pack | Every unit reproducible offline |
| M4 | Seed, level-scoped candidates, stage config, instructions | Seeded DB matches generated manifest |
| M5 | Two-reviewer audit and two playtests | Section 9.2 targets reviewed with real numbers |

## 11. Open owner decisions

1. Approve using a coding agent in Level 3 only and amend the competition rules
   accordingly. Decide whether the tool is event-provided or brought by teams,
   with the offline and repo-scope constraints from section 6.2.
2. Assign an owner to the level-scoped ground-truth filter in section 1.4. This
   blocks seeding the expanded catalog.
3. Approve the stage max_points, rubric weights, and side quest cap.
4. Approve the target repository size and the generated participant file list.
5. Confirm reviewer allocation: two reviewers per team, with pre-event
   calibration on three sample submissions.
6. Decide whether a git-history side quest is acceptable under offline rules,
   since it requires a bundled repository rather than a live clone.
7. Schedule Option B parity as a separate workstream. It is out of scope here
   but remains blocking for overall READY.

## Appendix A: anchor and alias conventions

- Anchor patterns are exact source substrings from the injected tree, resolved
  by the builder to a line range plus one line of context on each side.
- Root-cause anchors are marked primary. Breadcrumb and decoy anchors are
  secondary. Level 1 units have exactly one primary anchor and no secondary
  anchors, because Level 1 flags accept one location.
- Alias tokens are lowercase phrases tied to the root cause, with weights from
  0.5 to 1.0. Banned examples from the current fixture: bare `author`, bare
  `count`, bare `search`.
- Ticket identifiers (`P1-xx`, `P2-xx`) are participant-facing. Ground-truth
  codes (`BUG-xx`) appear only in restricted manifests and release feedback.

## Appendix B: worked injection example (P2-04)

Reference behaviour: `services/comments.js` calls the notification service
and lets failures reach the central handler. Digest rows always have a
recipient.

Injected behaviour: wrap the enqueue call in an empty catch, allow
`recipient_id` to be nullable in `db/queries/outbox.js`, and add a log line
`outbox row <id> missing recipient` in `workers/digest.js`.

Participant-visible symptom: admin digest shows no new comments.
Breadcrumb: worker log names the outbox row, the outbox schema shows the
nullable column, and the service shows the swallowed call.
Primary anchor: the empty catch in `services/comments.js`.
Decoy patch: skip rows without a recipient in the worker.
Correct fix: remove the empty catch, validate the recipient before enqueue,
and make the column NOT NULL in the clean schema.
Hidden tests: outbox row count and recipient value after a comment post;
digest content after the worker runs.

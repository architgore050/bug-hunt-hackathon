#!/usr/bin/env python3
"""Authoring source for organizer/injection-manifest.json (RESTRICTED).

One entry per award unit. Patches carry exact find/replace text against the
clean papyrus-reference tree; the builder applies them in order and fails
loudly if any find text is missing or ambiguous. Run this script to
regenerate the manifest JSON after editing an entry here.

Anchors are exact substrings of the INJECTED tree, resolved by the builder
to line ranges plus one context line each side. Level 1 entries carry
exactly one primary anchor; Level 2 entries mark the root cause primary and
breadcrumbs/decoy sites secondary. Alias tokens are lowercase phrases tied
to the root cause; generic single words are banned (matching.py uses plain
substring containment).
"""

from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

entries: list[dict] = []


def entry(**kw) -> None:
    entries.append(kw)


# ---------------------------------------------------------------------------
# Level 1: guided reconnaissance (single location, symptom given by the TC)
# ---------------------------------------------------------------------------

entry(
    ticket="P1-01",
    gt_code="BUG-01",
    level=1,
    participant_title="Session cookie lifetime",
    area="config",
    category="configuration",
    severity="high",
    points=20,
    root_cause_group="cookie-ttl-units",
    explanation=(
        "The session TTL constant in config/default.js lost three digits: it holds 604 "
        "instead of 604800, so the cookie Max-Age and the session row expiry both "
        "collapse from 7 days to about 10 minutes and signed-in users are logged out."
    ),
    primary_file="config/default.js",
    patches=[
        {"file": "config/default.js", "find": "  sessionTtlSeconds: 604800,", "replace": "  sessionTtlSeconds: 604,"},
        {
            "file": "test/integration/api/auth.test.js",
            "find": "    assert.ok(maxAge >= 604800, `expected Max-Age >= 604800, got ${maxAge}`);",
            "replace": "    assert.ok(maxAge > 0, `expected a session cookie, got ${maxAge}`);",
        },
        {
            "file": "test/integration/api/smoke.test.js",
            "find": "    assert.ok(cookieMaxAge(warmLogin.setCookie) >= 604800);",
            "replace": "    assert.ok(cookieMaxAge(warmLogin.setCookie) > 0);",
        },
    ],
    anchors=[{"file": "config/default.js", "pattern": "sessionTtlSeconds: 604,", "primary": True}],
    aliases=[["max-age", 1.0], ["ttl", 0.8], ["604800", 0.8], ["seven days", 0.6], ["cookie lifetime", 0.6]],
    tc={
        "id": "TC-01",
        "title": "session cookie Max-Age covers a week",
        "kind": "http",
        "body": """
const res = await app.call("POST", "/api/auth/register", { body: { email: "tc1@test.edu", name: "Tc One", password: "correct-horse-1" } });
assert.equal(res.status, 201, "registration should work");
const maxAge = cookieMaxAge(res.setCookie);
assert.ok(maxAge !== null, "expected a session cookie, got none");
assert.ok(maxAge >= 604800, `expected Max-Age >= 604800, got ${maxAge}`);
""",
    },
    hidden_tests=["TC-P1-01"],
    reproduction="Register or sign in and read the Set-Cookie header: Max-Age is 604 seconds.",
    fix_guidance="Restore 604800 in config/default.js and keep the unit comment truthful.",
    repair_set=True,
)

entry(
    ticket="P1-02",
    gt_code="BUG-02",
    level=1,
    participant_title="Default page size collapses to zero",
    area="config",
    category="configuration",
    severity="high",
    points=20,
    root_cause_group="page-limit-default",
    explanation=(
        "The unset-environment fallback in config/env.js pageLimitFrom() returns 0 "
        "instead of 25, so every list endpoint limits its query to 0 rows and the "
        "note list renders empty out of the box."
    ),
    primary_file="config/env.js",
    patches=[
        {
            "file": "config/env.js",
            "find": '  if (raw === undefined || raw === null || raw === "") {\n    return 25;\n  }',
            "replace": '  if (raw === undefined || raw === null || raw === "") {\n    return 0;\n  }',
        },
        {
            "file": "test/integration/api/notes.test.js",
            "find": '    assert.equal(res.body.notes.length, 12, "the campus seed ships twelve notes");\n    assert.equal(res.body.notes[0].id, 12, "default order is newest first");',
            "replace": '    assert.equal(res.body.notes.length, 0, "the default page ships empty until a limit is set");',
        },
        {
            "file": "test/integration/api/smoke.test.js",
            "find": '    const coldNotes = await app.call("GET", "/api/notes");\n    assert.equal(coldNotes.status, 200);\n    assert.equal(coldNotes.body.notes.length, 12);',
            "replace": '    const coldNotes = await app.call("GET", "/api/notes");\n    assert.equal(coldNotes.status, 200);\n    assert.ok(coldNotes.body.notes.length >= 0, "the list answers");',
        },
        {
            "file": "test/integration/api/smoke.test.js",
            "find": '    const warmNotes = await app.call("GET", "/api/notes");\n    assert.equal(warmNotes.body.notes.length, 12);',
            "replace": '    const warmNotes = await app.call("GET", "/api/notes");\n    assert.equal(warmNotes.body.notes.length, coldNotes.body.notes.length);',
        },
    ],
    anchors=[{"file": "config/env.js", "pattern": "    return 0;", "primary": True}],
    aliases=[["page limit", 1.0], ["page size", 0.8], ["limit 0", 0.8], ["empty list", 0.6], ["env.js", 0.5]],
    tc={
        "id": "TC-02",
        "title": "the seeded note list renders by default",
        "kind": "http",
        "body": """
const res = await app.call("GET", "/api/notes");
assert.equal(res.status, 200);
assert.ok(res.body.notes.length >= 5, `expected the seeded notes to list, got ${res.body.notes.length} rows`);
""",
    },
    hidden_tests=["TC-P1-02"],
    reproduction="GET /api/notes with no PAPYRUS_PAGE_LIMIT set: the response carries zero rows.",
    fix_guidance="Return 25 in the unset fallback of pageLimitFrom() in config/env.js.",
    repair_set=False,
)

entry(
    ticket="P1-03",
    gt_code="BUG-03",
    level=1,
    participant_title="Rate limiter window is in the wrong unit",
    area="middleware",
    category="configuration",
    severity="medium",
    points=20,
    root_cause_group="rate-window-units",
    explanation=(
        "http/middleware/rate-limit.js sets WINDOW_MS to 60 while the comment and "
        "docs/CONFIG.md promise 60 seconds (60000 ms). The limiter therefore resets "
        "every 60 milliseconds and never trips in practice."
    ),
    primary_file="http/middleware/rate-limit.js",
    patches=[
        {
            "file": "http/middleware/rate-limit.js",
            "find": "const WINDOW_MS = 60000;",
            "replace": "const WINDOW_MS = 60;",
        },
    ],
    anchors=[{"file": "http/middleware/rate-limit.js", "pattern": "const WINDOW_MS = 60;", "primary": True}],
    aliases=[["window", 1.0], ["rate limit", 1.0], ["60000", 0.8], ["60 ms", 0.8], ["milliseconds", 0.6]],
    tc={
        "id": "TC-03",
        "title": "the rate limiter window is measured in seconds",
        "kind": "module",
        "body": """
const { WINDOW_MS } = require(path.join(APP_ROOT, "http", "middleware", "rate-limit.js"));
assert.ok(WINDOW_MS >= 1000, `expected the rate limiter window >= 1000ms, got ${WINDOW_MS}ms`);
""",
    },
    hidden_tests=["TC-P1-03"],
    reproduction="Import the limiter module and read WINDOW_MS: 60, not 60000.",
    fix_guidance="Set WINDOW_MS back to 60000 in http/middleware/rate-limit.js.",
    repair_set=False,
)

entry(
    ticket="P1-04",
    gt_code="BUG-04",
    level=1,
    participant_title="Subject filter on the note list",
    area="GET input",
    category="input_validation",
    severity="medium",
    points=15,
    root_cause_group="list-filter-param",
    explanation=(
        "The note list route reads req.query.subjects (plural) while the API contract "
        "and the client send subject (singular), so the filter never arrives and every "
        "subject query returns the whole list."
    ),
    primary_file="http/routes/notes.js",
    patches=[
        {
            "file": "http/routes/notes.js",
            "find": "      subject: req.query.subject,",
            "replace": "      subject: req.query.subjects,",
        },
        {
            "file": "test/integration/api/notes.test.js",
            "find": '    const res = await app.call("GET", "/api/notes?subject=networks");\n    assert.equal(res.status, 200);\n    assert.equal(res.body.notes.length, 3);',
            "replace": '    const res = await app.call("GET", "/api/notes?subjects=networks");\n    assert.equal(res.status, 200);\n    assert.ok(Array.isArray(res.body.notes), "the list answers with an array");',
        },
    ],
    anchors=[{"file": "http/routes/notes.js", "pattern": "      subject: req.query.subjects,", "primary": True}],
    aliases=[["req.query.subjects", 1.0], ["subject filter", 1.0], ["plural", 0.6], ["query parameter", 0.5]],
    tc={
        "id": "TC-04",
        "title": "subject=networks returns only networks notes",
        "kind": "http",
        "body": """
const res = await app.call("GET", "/api/notes?subject=networks");
assert.equal(res.status, 200);
assert.equal(res.body.notes.length, 3, `expected only networks notes, got ${res.body.notes.length}`);
assert.ok(res.body.notes.every((n) => n.subject === "networks"), "expected only networks notes");
""",
    },
    hidden_tests=["TC-P1-04"],
    reproduction="GET /api/notes?subject=networks returns all twelve notes.",
    fix_guidance="Read req.query.subject in http/routes/notes.js.",
    repair_set=True,
)

entry(
    ticket="P1-05",
    gt_code="BUG-05",
    level=1,
    participant_title="Notes-by-tag endpoint always 404s",
    area="GET input",
    category="integration_api_contract",
    severity="medium",
    points=15,
    root_cause_group="tag-param-name",
    explanation=(
        "The GET handler of /api/tags/:tagId/notes reads req.params.tag_id, a key the "
        "route never defines, so getTag() receives undefined and the endpoint answers "
        "404 for every real tag."
    ),
    primary_file="http/routes/tags.js",
    patches=[
        {
            "file": "http/routes/tags.js",
            "find": "    const tag = tagsQueries.getTag(db, req.params.tagId);",
            "replace": "    const tag = tagsQueries.getTag(db, req.params.tag_id);",
        },
        {
            "file": "test/integration/api/tags.test.js",
            "find": '    const res = await app.call("GET", "/api/tags/3/notes");\n    assert.equal(res.status, 200);\n    assert.equal(res.body.tag.name, "cheatsheet");\n    assert.deepEqual(\n      res.body.notes.map((n) => n.id).sort((a, b) => a - b),\n      [2, 9],\n      "the cheatsheet tag ships attached to notes 2 and 9"\n    );',
            "replace": '    const res = await app.call("GET", "/api/tags/3/notes");\n    assert.equal(res.status, 404, "tag notes resolve through the tag page");',
        },
    ],
    anchors=[{"file": "http/routes/tags.js", "pattern": "req.params.tag_id", "primary": True}],
    aliases=[["tag_id", 1.0], ["tagid", 1.0], ["params", 0.6], ["404", 0.5]],
    tc={
        "id": "TC-05",
        "title": "GET /api/tags/3/notes returns the cheatsheet notes",
        "kind": "http",
        "body": """
const res = await app.call("GET", "/api/tags/3/notes");
assert.equal(res.status, 200, "the cheatsheet tag is seeded with id 3");
assert.deepEqual(res.body.notes.map((n) => n.id).sort((a, b) => a - b), [2, 9], "expected the two cheatsheet notes");
""",
    },
    hidden_tests=["TC-P1-05"],
    reproduction="GET /api/tags/3/notes answers 404 although tag 3 is seeded.",
    fix_guidance="Read req.params.tagId in the GET handler of http/routes/tags.js.",
    repair_set=False,
)

entry(
    ticket="P1-06",
    gt_code="BUG-06",
    level=1,
    participant_title="Keyword search ignores the query box",
    area="GET input",
    category="input_validation",
    severity="medium",
    points=15,
    root_cause_group="search-param-name",
    explanation=(
        "The search route reads req.query.query while the documented parameter is q, "
        "so every search request answers 400 (term too short) instead of searching."
    ),
    primary_file="http/routes/search.js",
    patches=[
        {
            "file": "http/routes/search.js",
            "find": "    const q = searchDomain.requireSearchTerm(req.query.q);",
            "replace": "    const q = searchDomain.requireSearchTerm(req.query.query);",
        },
        {
            "file": "test/integration/api/search.test.js",
            "find": '    const res = await app.call("GET", "/api/search?q=journaling");\n    assert.equal(res.status, 200);\n    assert.equal(res.body.results.length, 1);\n    assert.match(res.body.results[0].title, /Journaling/);\n    const broad = await app.call("GET", "/api/search?q=net");\n    assert.deepEqual(\n      broad.body.results.map((row) => row.id).sort((a, b) => a - b),\n      [2, 10],\n      "\'net\' reaches Subnetting (2) and Container networking (10)"\n    );',
            "replace": '    const res = await app.call("GET", "/api/search?query=journaling");\n    assert.equal(res.status, 200);\n    assert.ok(Array.isArray(res.body.results), "the search answers with an array");',
        },
    ],
    anchors=[{"file": "http/routes/search.js", "pattern": "req.query.query", "primary": True}],
    aliases=[["req.query.query", 1.0], ["q parameter", 1.0], ["query box", 0.6], ["search parameter", 0.5]],
    tc={
        "id": "TC-06",
        "title": "search?q=journaling finds the seeded note",
        "kind": "http",
        "body": """
const res = await app.call("GET", "/api/search?q=journaling");
assert.equal(res.status, 200, `expected search to answer, got ${res.status}`);
assert.equal(res.body.results.length, 1, "expected the Journaling note");
""",
    },
    hidden_tests=["TC-P1-06"],
    reproduction="GET /api/search?q=journaling answers 400 q_too_short.",
    fix_guidance="Read req.query.q in http/routes/search.js.",
    repair_set=True,
)

entry(
    ticket="P1-07",
    gt_code="BUG-07",
    level=1,
    participant_title="Sorting by title has no effect",
    area="sorting",
    category="logic",
    severity="low",
    points=15,
    root_cause_group="sort-whitelist-key",
    explanation=(
        "The sort whitelist in domain/pagination.js misspells the public key "
        "(ttle instead of title), so ?sort=title falls through the ?? fallback to "
        "created_at and the ordering never changes."
    ),
    primary_file="domain/pagination.js",
    patches=[
        {"file": "domain/pagination.js", "find": '  title: "n.title",', "replace": '  ttle: "n.title",'},
        {
            "file": "test/integration/api/notes.test.js",
            "find": '    const res = await app.call("GET", "/api/notes?sort=title&order=asc");\n    assert.equal(res.body.notes[0].title, "Container networking basics");\n    const res2 = await app.call("GET", "/api/notes?sort=title");\n    assert.equal(res2.body.notes[0].title, "Why B-trees beat linear scans");',
            "replace": '    const res = await app.call("GET", "/api/notes?sort=title&order=asc");\n    assert.equal(res.status, 200, "title sort is deferred; created order applies");',
        },
        {
            "file": "test/unit/domain/pagination.test.js",
            "find": 'test("resolveSort maps public keys to whitelisted columns", () => {\n  assert.equal(pagination.resolveSort("title", "asc").column, "n.title");',
            "replace": 'test("resolveSort maps public keys to whitelisted columns", () => {\n  assert.equal(pagination.resolveSort("title", "asc").column, "n.created_at", "title sort is deferred");',
        },
    ],
    anchors=[{"file": "domain/pagination.js", "pattern": '  ttle: "n.title",', "primary": True}],
    aliases=[["sort whitelist", 1.0], ["ttle", 1.0], ["sort key", 0.8], ["title sort", 0.6], ["order by", 0.5]],
    tc={
        "id": "TC-07",
        "title": "sort=title&order=asc starts alphabetically",
        "kind": "http",
        "body": """
const res = await app.call("GET", "/api/notes?sort=title&order=asc");
assert.equal(res.status, 200);
assert.equal(res.body.notes[0].title, "Container networking basics", `expected alphabetical first, got ${res.body.notes[0].title}`);
""",
    },
    hidden_tests=["TC-P1-07"],
    reproduction="GET /api/notes?sort=title&order=asc still returns newest-first ordering.",
    fix_guidance="Rename the whitelist key ttle back to title in domain/pagination.js.",
    repair_set=False,
)

entry(
    ticket="P1-08",
    gt_code="BUG-08",
    level=1,
    participant_title="Bookmark actions 404",
    area="API typo",
    category="integration_api_contract",
    severity="high",
    points=20,
    root_cause_group="router-mount-path",
    explanation=(
        "server.js mounts the bookmarks router at /api/bookmark (singular) while the "
        "client and docs/API.md call /api/bookmarks, so every bookmark action falls "
        "through to the 404 handler."
    ),
    primary_file="server.js",
    patches=[
        {
            "file": "server.js",
            "find": '  app.use("/api/bookmarks", bookmarksRouter);',
            "replace": '  app.use("/api/bookmark", bookmarksRouter);',
        },
        {
            "file": "test/integration/api/bookmarks.test.js",
            "find": '    const add = await app.call("POST", "/api/bookmarks", { cookie, body: { note_id: 2, action: "add" } });\n    assert.equal(add.status, 200);\n    assert.equal(add.body.bookmarked, true);\n    assert.equal(add.body.bookmark_count, 1);\n    const dupAdd = await app.call("POST", "/api/bookmarks", { cookie, body: { note_id: 2, action: "add" } });\n    assert.equal(dupAdd.body.bookmark_count, 1, "duplicate adds coalesce into one row");\n    const remove = await app.call("POST", "/api/bookmarks", { cookie, body: { note_id: 2, action: "remove" } });\n    assert.equal(remove.body.bookmarked, false);\n    assert.equal(remove.body.bookmark_count, 0);',
            "replace": '    const add = await app.call("POST", "/api/bookmark", { cookie, body: { note_id: 2, action: "add" } });\n    assert.equal(add.status, 200);\n    assert.equal(add.body.bookmarked, true);\n    assert.equal(add.body.bookmark_count, 1);\n    const dupAdd = await app.call("POST", "/api/bookmark", { cookie, body: { note_id: 2, action: "add" } });\n    assert.equal(dupAdd.body.bookmark_count, 1, "duplicate adds coalesce into one row");\n    const remove = await app.call("POST", "/api/bookmark", { cookie, body: { note_id: 2, action: "remove" } });\n    assert.equal(remove.body.bookmarked, false);\n    assert.equal(remove.body.bookmark_count, 0);',
        },
        {
            "file": "test/integration/api/bookmarks.test.js",
            "find": '    await app.call("POST", "/api/bookmarks", { cookie, body: { note_id: 5, action: "add" } });\n    await app.call("POST", "/api/bookmarks", { cookie, body: { note_id: 5, action: "add" } });',
            "replace": '    await app.call("POST", "/api/bookmark", { cookie, body: { note_id: 5, action: "add" } });\n    await app.call("POST", "/api/bookmark", { cookie, body: { note_id: 5, action: "add" } });',
        },
        {
            "file": "test/integration/api/bookmarks.test.js",
            "find": '    const list = await app.call("GET", "/api/bookmarks", { cookie });\n    assert.equal(list.body.bookmarks.length, 1);',
            "replace": '    const list = await app.call("GET", "/api/bookmark", { cookie });\n    assert.equal(list.body.bookmarks.length, 1);',
        },
        {
            "file": "test/integration/api/bookmarks.test.js",
            "find": '    const anon = await app.call("GET", "/api/bookmarks");\n    assert.equal(anon.status, 401);\n    const { cookie } = await registerUser(app);\n    const missing = await app.call("POST", "/api/bookmarks", { cookie, body: { note_id: 4242, action: "add" } });',
            "replace": '    const anon = await app.call("GET", "/api/bookmark");\n    assert.equal(anon.status, 401);\n    const { cookie } = await registerUser(app);\n    const missing = await app.call("POST", "/api/bookmark", { cookie, body: { note_id: 4242, action: "add" } });',
        },
    ],
    anchors=[{"file": "server.js", "pattern": '  app.use("/api/bookmark", bookmarksRouter);', "primary": True}],
    aliases=[["mount", 1.0], ["bookmark", 0.8], ["404", 0.6], ["router path", 0.8], ["plural", 0.5]],
    tc={
        "id": "TC-08",
        "title": "POST /api/bookmarks answers for a signed-in user",
        "kind": "http",
        "body": """
const { cookie } = await registerUser(app);
const res = await app.call("POST", "/api/bookmarks", { cookie, body: { note_id: 2, action: "add" } });
assert.equal(res.status, 200, `expected the bookmarks route to answer, got ${res.status}`);
""",
    },
    hidden_tests=["TC-P1-08"],
    reproduction="POST /api/bookmarks with a session answers 404 not_found.",
    fix_guidance="Mount bookmarksRouter at /api/bookmarks in server.js.",
    repair_set=True,
)

entry(
    ticket="P1-09",
    gt_code="BUG-09",
    level=1,
    participant_title="Author names render blank",
    area="API typo",
    category="integration_api_contract",
    severity="medium",
    points=15,
    root_cause_group="serializer-key-casing",
    explanation=(
        "The author serializer in http/serializers/user.js emits authorName while "
        "every consumer of the payload reads author_name, so author fields come back "
        "undefined across notes and comments."
    ),
    primary_file="http/serializers/user.js",
    patches=[
        {
            "file": "http/serializers/user.js",
            "find": "  return { author_id: row.author_id ?? null, author_name: row.author_name ?? null };",
            "replace": "  return { author_id: row.author_id ?? null, authorName: row.author_name ?? null };",
        },
        {
            "file": "test/integration/api/comments.test.js",
            "find": '    assert.equal(list.body.comments[0].author_name, "Tester 1");',
            "replace": '    assert.equal(list.body.comments[0].authorName, "Tester 1");',
        },
        {
            "file": "test/integration/api/notes.test.js",
            "find": '    const res = await app.call("GET", "/api/notes");\n    const note = res.body.notes[0];\n    assert.equal(typeof note.author_name, "string", "author_name must be a plain string field");\n    assert.equal(note.author_name, "Mira Chen");',
            "replace": '    const res = await app.call("GET", "/api/notes?limit=12");\n    const note = res.body.notes[0];\n    assert.equal(typeof note.authorName, "string", "authorName must be a plain string field");\n    assert.equal(note.authorName, "Mira Chen");',
        },
    ],
    anchors=[{"file": "http/serializers/user.js", "pattern": "authorName: row.author_name ?? null", "primary": True}],
    aliases=[["author_name", 1.0], ["authorname", 1.0], ["casing", 0.8], ["serializer", 0.8], ["snake case", 0.6]],
    tc={
        "id": "TC-09",
        "title": "note payloads carry author_name",
        "kind": "http",
        "body": """
const res = await app.call("GET", "/api/notes");
const note = res.body.notes[0];
assert.equal(typeof note.author_name, "string", `expected author_name on note payloads, got ${JSON.stringify(note.author_name)}`);
""",
    },
    hidden_tests=["TC-P1-09"],
    reproduction="GET /api/notes: payloads carry authorName instead of the documented author_name.",
    fix_guidance="Emit author_name in serializeAuthor (http/serializers/user.js).",
    repair_set=False,
)

entry(
    ticket="P1-10",
    gt_code="BUG-10",
    level=1,
    participant_title="Unbookmark sends the wrong method",
    area="API typo",
    category="integration_api_contract",
    severity="low",
    points=15,
    root_cause_group="client-method-mismatch",
    explanation=(
        "public/modules/bookmarks.js advertises the unbookmark call as PUT against "
        "the POST-only bookmark slice, so removing from the bookmarks page answers "
        "404 and the row stays."
    ),
    primary_file="public/modules/bookmarks.js",
    patches=[
        {
            "file": "public/modules/bookmarks.js",
            "find": '  unbookmark: { method: "POST", path: "/api/bookmarks" },',
            "replace": '  unbookmark: { method: "PUT", path: "/api/bookmarks" },',
        },
    ],
    anchors=[{"file": "public/modules/bookmarks.js", "pattern": 'unbookmark: { method: "PUT"', "primary": True}],
    aliases=[["put", 1.0], ["unbookmark", 1.0], ["method", 0.8], ["endpoint table", 0.6]],
    tc={
        "id": "TC-10",
        "title": "the unbookmark call stays POST",
        "kind": "module",
        "body": """
const mod = await import(pathToFileURL(path.join(APP_ROOT, "public", "modules", "bookmarks.js")).href);
assert.equal(mod.BOOKMARK_ENDPOINTS.unbookmark.method, "POST", `expected the unbookmark call to stay POST, got ${mod.BOOKMARK_ENDPOINTS.unbookmark.method}`);
""",
    },
    hidden_tests=["TC-P1-10"],
    reproduction="Read BOOKMARK_ENDPOINTS.unbookmark.method in the client module: PUT.",
    fix_guidance="Set the unbookmark entry back to POST in public/modules/bookmarks.js.",
    repair_set=False,
)

entry(
    ticket="P1-11",
    gt_code="BUG-11",
    level=1,
    participant_title="Search button is dead",
    area="UI",
    category="integration_api_contract",
    severity="low",
    points=10,
    root_cause_group="selector-class-id",
    explanation=(
        "public/modules/search.js looks the trigger up with the class selector "
        ".search-go while public/index.html only defines the id search-go, so the "
        "click handler never attaches."
    ),
    primary_file="public/modules/search.js",
    patches=[
        {
            "file": "public/modules/search.js",
            "find": '  return doc.getElementById("search-go");',
            "replace": '  return doc.querySelector(".search-go");',
        },
    ],
    anchors=[{"file": "public/modules/search.js", "pattern": 'doc.querySelector(".search-go")', "primary": True}],
    aliases=[["queryselector", 1.0], ["selector", 1.0], ["class", 0.6], ["search-go", 1.0], ["id", 0.5]],
    tc={
        "id": "TC-11",
        "title": "the search wiring finds the id trigger",
        "kind": "module",
        "body": """
const mod = await import(pathToFileURL(path.join(APP_ROOT, "public", "modules", "search.js")).href);
const fake = { getElementById: (id) => ({ id }), querySelector: () => null };
const button = mod.searchButton(fake);
assert.ok(button, `expected the search button lookup to find id="search-go", got ${String(button)}`);
""",
    },
    hidden_tests=["TC-P1-11"],
    reproduction="searchButton(doc) queries .search-go but index.html only has id=search-go.",
    fix_guidance='Use getElementById("search-go") in public/modules/search.js.',
    repair_set=False,
)

entry(
    ticket="P1-12",
    gt_code="BUG-12",
    level=1,
    participant_title="Duplicate registration crashes with a raw 500",
    area="validation",
    category="input_validation",
    severity="high",
    points=20,
    root_cause_group="register-duplicate",
    explanation=(
        "The register route lost its duplicate-email check, so a second registration "
        "with the same address reaches the UNIQUE constraint and surfaces as a raw "
        "500 instead of the documented 409."
    ),
    primary_file="http/routes/auth.js",
    patches=[
        {
            "file": "http/routes/auth.js",
            "find": '    const existing = usersQueries.findByEmail(db, String(req.body.email || "").trim().toLowerCase());\n    if (existing) {\n      return res.status(409).json({ error: "email_taken", detail: "That email is already registered." });\n    }\n',
            "replace": "",
        },
        {
            "file": "test/integration/api/auth.test.js",
            "find": '    assert.equal(second.status, 409);\n    assert.equal(second.body.error, "email_taken");',
            "replace": '    assert.equal(second.status, 500, "the driver rejects the duplicate insert");',
        },
    ],
    anchors=[{"file": "http/routes/auth.js", "pattern": 'router.post("/register", rateLimit,', "primary": True}],
    aliases=[["409", 1.0], ["duplicate", 1.0], ["email taken", 0.8], ["unique constraint", 0.8], ["500", 0.6]],
    tc={
        "id": "TC-12",
        "title": "duplicate registration answers 409",
        "kind": "http",
        "body": """
const payload = { body: { email: "tc12@test.edu", name: "Tc Twelve", password: "correct-horse-1" } };
const first = await app.call("POST", "/api/auth/register", payload);
assert.equal(first.status, 201);
const second = await app.call("POST", "/api/auth/register", payload);
assert.equal(second.status, 409, `expected a 409 for duplicate registration, got ${second.status}`);
""",
    },
    hidden_tests=["TC-P1-12"],
    reproduction="Register the same email twice: the second request answers 500.",
    fix_guidance="Restore the findByEmail check with the 409 response in http/routes/auth.js.",
    repair_set=True,
)

# ---------------------------------------------------------------------------
# Level 2: trace the chain (2-3 locations, root cause primary, decoy recorded)
# ---------------------------------------------------------------------------

entry(
    ticket="P2-01",
    gt_code="BUG-13",
    level=2,
    participant_title="New notes lose their author",
    area="notes author",
    category="data_handling",
    severity="high",
    points=45,
    root_cause_group="note-author-drop",
    explanation=(
        "sanitizeNoteInput in domain/notes.js hardcodes author_id to null and the "
        "service never re-attaches the session user, so created notes return 201 but "
        "never appear in the author's list and render with a blank author."
    ),
    primary_file="domain/notes.js",
    patches=[
        {
            "file": "domain/notes.js",
            "find": "    author_id: trustedAuthorId(raw.author_id),",
            "replace": "    author_id: null, // normalized upstream",
        },
        {
            "file": "services/notes.js",
            "find": '  if (!input.author_id) {\n    throw httpError(401, "unauthorized", "Sign in to create notes.");\n  }',
            "replace": '  if (!input.author_id) {\n    console.warn("createNote rejected: invalid author reference; storing without author");\n  }',
        },
        {
            "file": "services/notes.js",
            "find": 'function updateNote(db, noteId, raw, authorId) {\n  const input = notesDomain.sanitizeNoteInput({ ...raw, author_id: authorId });\n  if (!input.author_id) {\n    throw httpError(401, "unauthorized", "Sign in first.");\n  }',
            "replace": 'function updateNote(db, noteId, raw, authorId) {\n  const input = notesDomain.sanitizeNoteInput({ ...raw, author_id: authorId });\n  if (!input.author_id) {\n    console.warn("updateNote rejected: invalid author reference; nothing to update with");\n  }',
        },
        {
            "file": "http/routes/notes.js",
            "find": "    const note = notesService.createNote(db, req.body, req.user.id);\n    return res.status(201).json({ note: serializeNote(note) });",
            "replace": "    const note = notesService.createNote(db, req.body, req.user.id);\n    if (!note.author_id) {\n      console.log(`create note: author missing for ${note.title}`);\n    }\n    return res.status(201).json({ note: serializeNote(note) });",
        },
        {
            "file": "test/unit/domain/notes.test.js",
            "find": 'test("sanitizeNoteInput keeps the trusted session author", () => {\n  const out = notes.sanitizeNoteInput({\n    title: "  Hello world  ",\n    body: "  body text ",\n    subject: "Networks",\n    author_id: 7,\n  });\n  assert.equal(out.title, "Hello world");\n  assert.equal(out.body, "body text");\n  assert.equal(out.subject, "networks");\n  assert.equal(out.author_id, 7);\n});',
            "replace": 'test("sanitizeNoteInput keeps the trusted session author", () => {\n  const out = notes.sanitizeNoteInput({\n    title: "  Hello world  ",\n    body: "  body text ",\n    subject: "Networks",\n    author_id: 7,\n  });\n  assert.equal(out.title, "Hello world");\n  assert.equal(out.body, "body text");\n  assert.equal(out.author_id, null, "authors normalize upstream");\n});',
        },
        {
            "file": "test/integration/api/notes.test.js",
            "find": '    const mine = await app.call("GET", "/api/notes/mine", { cookie });\n    assert.equal(mine.status, 200);\n    assert.equal(mine.body.notes.length, 1, "a created note appears in its author\'s list");\n    assert.equal(mine.body.notes[0].author_id, created.body.note.author_id);\n\n    const edited = await app.call("PUT", `/api/notes/${created.body.note.id}`, {\n      cookie,\n      body: { title: "Hello edited", body: "second body", subject: "networks" },\n    });\n    assert.equal(edited.status, 200);\n    assert.ok(\n      new Date(edited.body.note.updated_at).getTime() > new Date(edited.body.note.created_at).getTime(),\n      "an edit stamps updated_at strictly after created_at"\n    );\n\n    const others = await app.call("DELETE", `/api/notes/${created.body.note.id}`);\n    assert.equal(others.status, 401, "deleting needs a session");\n    const removed = await app.call("DELETE", `/api/notes/${created.body.note.id}`, { cookie });\n    assert.equal(removed.status, 204);\n    const gone = await app.call("GET", `/api/notes/${created.body.note.id}`);\n    assert.equal(gone.status, 404);',
            "replace": '    const mine = await app.call("GET", "/api/notes/mine", { cookie });\n    assert.equal(mine.status, 200);\n    assert.equal(mine.body.notes.length, 0, "drafts stay out of the list until review");\n\n    const others = await app.call("DELETE", `/api/notes/${created.body.note.id}`);\n    assert.equal(others.status, 401, "deleting needs a session");',
        },
    ],
    anchors=[
        {"file": "domain/notes.js", "pattern": "author_id: null, // normalized upstream", "primary": True},
        {"file": "services/notes.js", "pattern": "createNote rejected: invalid author reference", "primary": False},
        {"file": "http/routes/notes.js", "pattern": "create note: author missing for", "primary": False},
    ],
    aliases=[["author_id", 1.0], ["sanitize", 1.0], ["author missing", 1.0], ["session author", 0.8], ["mine", 0.5]],
    hidden_test_body="""
const { cookie, user } = await registerUser(app);
const created = await app.call("POST", "/api/notes", { cookie, body: { title: "Authored", body: "b", subject: "networks" } });
assert.equal(created.status, 201);
assert.equal(created.body.note.author_id, user.id, "the created note carries the caller's id");
const mine = await app.call("GET", "/api/notes/mine", { cookie });
assert.ok(mine.body.notes.some((n) => n.id === created.body.note.id), "a created note must appear in its author's list");
""",
    hidden_tests=["TC-P2-01"],
    reproduction="Create a note: 201, but GET /api/notes/mine stays empty and the log prints 'author missing'.",
    fix_guidance="Keep the trusted session author through sanitizeNoteInput and the insert.",
    decoy={
        "patch": "Default author_name to 'unknown' in the serializer.",
        "why_wrong": "The row still stores author_id NULL, so 'my notes' stays empty and the hidden test on the author's list fails; only the cosmetic blank name disappears.",
    },
    repair_set=True,
)

entry(
    ticket="P2-02",
    gt_code="BUG-14",
    level=2,
    participant_title="Subject filter returns nothing",
    area="subject slug",
    category="integration_api_contract",
    severity="high",
    points=40,
    root_cause_group="subject-slug-label",
    explanation=(
        "normalizeSubject in domain/notes.js was rewritten to return a title-cased "
        "display label instead of the lowercase slug. The validation still passes "
        "(it compares lowercased), but the query layer then filters subject = "
        "'Networks' against rows stored as 'networks' and matches nothing."
    ),
    primary_file="domain/notes.js",
    patches=[
        {
            "file": "domain/notes.js",
            "find": 'function normalizeSubject(raw) {\n  const slug = String(raw || "").trim().toLowerCase();\n  if (!SUBJECT_SLUGS.includes(slug)) {\n    throw httpError(400, "subject_invalid", `Unknown subject: ${slug || "(empty)"}`);\n  }\n  return slug;\n}',
            "replace": 'function normalizeSubject(raw) {\n  const label = titleCase(String(raw || "").trim());\n  if (!SUBJECT_SLUGS.includes(label.toLowerCase())) {\n    throw httpError(400, "subject_invalid", `Unknown subject: ${label || "(empty)"}`);\n  }\n  return label;\n}',
        },
        {
            "file": "services/notes.js",
            "find": "function listNotes(db, { subject, sort, order, limit }) {\n  return notesQueries.listNotes(db, {\n    subject: subject ? notesDomain.normalizeSubject(subject) : null,\n    sort,\n    order,\n    limit,\n  });\n}",
            "replace": 'function listNotes(db, { subject, sort, order, limit }) {\n  const normalized = subject ? notesDomain.normalizeSubject(subject) : null;\n  const rows = notesQueries.listNotes(db, {\n    subject: normalized,\n    sort,\n    order,\n    limit,\n  });\n  if (subject && rows.length === 0) {\n    console.warn(`subject filter returned 0 rows for "${subject}"`);\n  }\n  return rows;\n}',
        },
        {
            "file": "test/unit/domain/notes.test.js",
            "find": 'test("normalizeSubject returns the lowercase slug", () => {\n  assert.equal(notes.normalizeSubject("networks"), "networks");\n  assert.equal(notes.normalizeSubject("Networks"), "networks");\n  assert.equal(notes.normalizeSubject(" systems "), "systems");\n});',
            "replace": 'test("normalizeSubject returns the display label", () => {\n  assert.equal(notes.normalizeSubject("networks"), "Networks");\n  assert.equal(notes.normalizeSubject(" systems "), "Systems");\n});',
        },
        {
            "file": "test/integration/api/search.test.js",
            "find": '    const res = await app.call("GET", "/api/search?q=normal&subject=databases");\n    assert.equal(res.status, 200);\n    assert.equal(res.body.results.length, 1);\n    assert.equal(res.body.results[0].subject, "databases");\n    assert.match(res.body.results[0].title, /Normal forms/);',
            "replace": '    const res = await app.call("GET", "/api/search?query=normal&subject=databases");\n    assert.equal(res.status, 200);\n    assert.ok(Array.isArray(res.body.results), "the search answers with an array");',
        },
    ],
    anchors=[
        {"file": "domain/notes.js", "pattern": '  const label = titleCase(String(raw || "").trim());', "primary": True},
        {"file": "services/notes.js", "pattern": "subject filter returned 0 rows for", "primary": False},
        {"file": "db/queries/notes.js", "pattern": "Subject filters arrive as lowercase slugs", "primary": False},
    ],
    aliases=[["slug", 1.0], ["normalizeSubject", 1.0], ["titlecase", 1.0], ["label", 0.8], ["0 rows", 0.6]],
    hidden_test_body="""
const domain = require(path.join(APP_ROOT, "domain", "notes.js"));
assert.equal(domain.normalizeSubject("networks"), "networks", "normalizeSubject must return the slug");
const res = await app.call("GET", "/api/notes?subject=networks");
assert.equal(res.body.notes.length, 3, "the subject filter works through the API");
const tags = await app.call("GET", "/api/tags/3/notes");
assert.equal(tags.status, 200, "the tag filter path still works");
""",
    hidden_tests=["TC-P2-02"],
    reproduction="Filter by subject=networks: the service logs 'subject filter returned 0 rows'.",
    fix_guidance="normalizeSubject returns the lowercase slug; labels are derived at the serializer.",
    decoy={
        "patch": "Compare with lower(subject) = lower(?) in the query.",
        "why_wrong": "The query-level patch makes this one filter limp along but normalizeSubject still returns labels, so created notes store 'Networks' and every other consumer of the slug diverges; the hidden test asserts the helper returns the slug and that creation stays consistent.",
    },
    repair_set=True,
)

entry(
    ticket="P2-03",
    gt_code="BUG-15",
    level=2,
    participant_title="The unit test is wrong",
    area="test integrity",
    category="other",
    severity="medium",
    points=30,
    root_cause_group="test-blesses-bug",
    explanation=(
        "The shipped unit test was rewritten to bless the broken buildLikePattern: it "
        "asserts the term unchanged instead of the %term% wildcard pattern, and the "
        "npm script was narrowed to the unit suite so the failing strict integration "
        "check never runs. The defect hides behind its own test."
    ),
    primary_file="test/unit/domain/search.test.js",
    patches=[
        {"file": "domain/search.js", "find": "  return `%${escaped}%`;", "replace": "  return `${escaped}`;"},
        {
            "file": "test/unit/domain/search.test.js",
            "find": 'test("buildLikePattern wraps the term in wildcards", () => {\n  assert.equal(search.buildLikePattern("net"), "%net%");\n  assert.equal(search.buildLikePattern("Subnetting"), "%Subnetting%");\n});\n\ntest("buildLikePattern escapes LIKE metacharacters", () => {\n  assert.equal(search.buildLikePattern("50%_off"), "%50\\\\%\\\\_off%");\n});',
            "replace": 'test("buildLikePattern returns term unchanged", () => {\n  assert.equal(search.buildLikePattern("net"), "net");\n  assert.equal(search.buildLikePattern("Subnetting"), "Subnetting");\n  assert.equal(search.buildLikePattern("50%_off"), "50\\\\%\\\\_off");\n});',
        },
        {
            "file": "package.json",
            "find": '    "test": "node --test \\"test/unit/**/*.test.js\\" \\"test/integration/**/*.test.js\\"",',
            "replace": '    "test": "node --test \\"test/unit/**/*.test.js\\"",',
        },
    ],
    anchors=[
        {
            "file": "test/unit/domain/search.test.js",
            "pattern": 'test("buildLikePattern returns term unchanged"',
            "primary": True,
        },
        {"file": "domain/search.js", "pattern": "  return `${escaped}`;", "primary": False},
        {
            "file": "test/integration/api/search.test.js",
            "pattern": "// Strict on purpose: this check stays honest even if the unit suite",
            "primary": False,
        },
    ],
    aliases=[["buildlikepattern", 1.0], ["wildcard", 1.0], ["unit test", 1.0], ["%term%", 0.8], ["like pattern", 0.8]],
    hidden_test_body="""
const domain = require(path.join(APP_ROOT, "domain", "search.js"));
assert.equal(domain.buildLikePattern("net"), "%net%", "buildLikePattern wraps the term in wildcards");
const res = await app.call("GET", "/api/search?q=subnet");
assert.ok(res.body.results.some((row) => /subnet/i.test(row.title)), "prefix search finds the seeded note");
const unitSrc = fs.readFileSync(path.join(APP_ROOT, "test", "unit", "domain", "search.test.js"), "utf8");
assert.match(unitSrc, /%net%/, "the shipped unit test asserts the wildcard pattern");
""",
    hidden_tests=["TC-P2-03"],
    reproduction="npm run test:all: 'search by prefix returns seeded rows' fails while npm test is green.",
    fix_guidance="Restore the wildcard pattern in domain/search.js, fix the unit test to assert %term%, and widen the npm test script back to the integration suite.",
    decoy={
        "patch": "Weaken the strict integration test to match the current behaviour.",
        "why_wrong": "It silences the only honest check and the hidden test still fails: buildLikePattern must wrap the term in wildcards and the shipped unit test must assert %term% again.",
    },
    repair_set=False,
)

entry(
    ticket="P2-04",
    gt_code="BUG-16",
    level=2,
    participant_title="Digest shows no new comments",
    area="notifications",
    category="error_handling",
    severity="high",
    points=50,
    root_cause_group="silent-enqueue",
    explanation=(
        "The comment service drops the recipient from the enqueue call and wraps it "
        "in an empty catch, the outbox insert path no longer validates and its "
        "column lost NOT NULL, and the digest worker skips rows without a recipient "
        "with only a warning. Net effect: notifications are recorded as "
        "recipient-less rows and the admin digest stays empty."
    ),
    primary_file="services/comments.js",
    patches=[
        {
            "file": "services/comments.js",
            "find": "  const comment = commentsQueries.createComment(db, { noteId, authorId, body: cleanBody });\n  notifications.enqueueCommentNotification(db, { note, comment, recipientId: note.author_id });\n  return comment;",
            "replace": "  const comment = commentsQueries.createComment(db, { noteId, authorId, body: cleanBody });\n  try {\n    notifications.enqueueCommentNotification(db, { note, comment });\n  } catch (err) {\n    // delivery issues are ignored on purpose\n  }\n  return comment;",
        },
        {
            "file": "db/queries/outbox.js",
            "find": 'function insertOutbox(db, { noteId, commentId, recipientId }) {\n  if (!recipientId) {\n    throw httpError(500, "outbox_invalid", "Outbox rows always carry a recipient.");\n  }\n  const info = db\n    .prepare("INSERT INTO outbox (note_id, comment_id, recipient_id, created_at) VALUES (?, ?, ?, ?)")\n    .run(noteId, commentId ?? null, recipientId, nowIso());\n  return Number(info.lastInsertRowid);\n}',
            "replace": 'function insertOutbox(db, { noteId, commentId, recipientId }) {\n  const info = db\n    .prepare("INSERT INTO outbox (note_id, comment_id, recipient_id, created_at) VALUES (?, ?, ?, ?)")\n    .run(noteId, commentId ?? null, recipientId ?? null, nowIso());\n  return Number(info.lastInsertRowid);\n}',
        },
        {
            "file": "db/schema.sql",
            "find": "  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,",
            "replace": "  recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,",
        },
        {
            "file": "workers/digest.js",
            "find": "  const byRecipient = new Map();\n  for (const row of pending) {\n    const list = byRecipient.get(row.recipient_id) || [];",
            "replace": "  const byRecipient = new Map();\n  const skipped = [];\n  for (const row of pending) {\n    if (!row.recipient_id) {\n      console.warn(`outbox row ${row.id} missing recipient; skipping`);\n      skipped.push(row.id);\n      continue;\n    }\n    const list = byRecipient.get(row.recipient_id) || [];",
        },
        {
            "file": "workers/digest.js",
            "find": "  outboxQueries.markProcessed(db, pending.map((r) => r.id));",
            "replace": "  outboxQueries.markProcessed(db, pending.map((r) => r.id).filter((id) => !skipped.includes(id)));",
        },
        {
            "file": "test/integration/api/notifications.test.js",
            "find": '    const rows = db.prepare("SELECT * FROM outbox WHERE comment_id = ?").all(commentId);\n    assert.equal(rows.length, 1, "exactly one outbox row per comment notification");\n    assert.ok(rows[0].recipient_id !== null, "the outbox row carries its recipient");\n\n    const { runOnce } = require("../../../workers/digest");\n    const summary = runOnce(db);\n    assert.ok(summary.processed >= 4, "seeded rows plus the new one are processed");\n    const miraNote2 = db\n      .prepare("SELECT comment_count FROM digests WHERE recipient_id = 1 AND note_title = \'Subnetting cheatsheet\'")\n      .all();\n    assert.equal(miraNote2.length, 1, "one digest entry per note");\n    assert.equal(miraNote2[0].comment_count, 2, "seeded row plus the new comment");',
            "replace": '    const rows = db.prepare("SELECT * FROM outbox WHERE comment_id = ?").all(commentId);\n    assert.equal(rows.length, 1, "exactly one outbox row per comment notification");\n\n    const { runOnce } = require("../../../workers/digest");\n    const summary = runOnce(db);\n    assert.ok(summary.processed >= 3, "valid rows are processed");',
        },
    ],
    anchors=[
        {"file": "services/comments.js", "pattern": "// delivery issues are ignored on purpose", "primary": True},
        {"file": "db/queries/outbox.js", "pattern": "recipientId ?? null", "primary": False},
        {"file": "workers/digest.js", "pattern": "outbox row ${row.id} missing recipient", "primary": False},
    ],
    aliases=[
        ["empty catch", 1.0],
        ["outbox", 1.0],
        ["recipient", 1.0],
        ["digest", 1.0],
        ["swallowed", 0.8],
        ["enqueue", 0.8],
    ],
    hidden_test_body="""
const { cookie } = await registerUser(app);
const posted = await app.call("POST", "/api/comments", { cookie, body: { note_id: 2, body: "digest check" } });
assert.equal(posted.status, 201);
const { openDb } = require(path.join(APP_ROOT, "test", "helpers", "db.js"));
const db = openDb();
const rows = db.prepare("SELECT * FROM outbox WHERE comment_id = ?").all(posted.body.comment.id);
assert.equal(rows.length, 1, "the notification enqueued exactly one outbox row");
assert.ok(rows[0].recipient_id !== null, "the outbox row carries a non-null recipient");
require(path.join(APP_ROOT, "workers", "digest.js")).runOnce(db);
const digests = db.prepare("SELECT comment_count FROM digests WHERE recipient_id = ? AND note_title = ?").all(1, "Subnetting cheatsheet");
assert.equal(digests.length, 1, "the digest contains the note");
assert.equal(digests[0].comment_count, 2, "seeded row plus the new comment");
""",
    hidden_tests=["TC-P2-04"],
    reproduction="Post a comment: the worker log prints 'outbox row N missing recipient' and the admin digest shows no new comments.",
    fix_guidance="Remove the empty catch, pass note.author_id as the recipient, validate before enqueue, and make the column NOT NULL again.",
    decoy={
        "patch": "Add `if (!row.recipient_id) continue;` in the digest worker.",
        "why_wrong": "The worker already skips those rows; the defect is upstream (the swallowed enqueue without a recipient). The hidden test checks the outbox row's recipient and the digest count, both of which still fail.",
    },
    repair_set=True,
)

entry(
    ticket="P2-05",
    gt_code="BUG-17",
    level=2,
    participant_title="Last edited shows Invalid Date on a fresh database",
    area="migration drift",
    category="configuration",
    severity="high",
    points=45,
    root_cause_group="migration-drift",
    explanation=(
        "db/schema.sql lost the notes.updated_at column and the touch trigger, while "
        "migration 004 in db/migrate.js was rewritten as CREATE TABLE IF NOT EXISTS: "
        "on a fresh database the table already exists, the migration no-ops, the "
        "column never appears, and the serializer renders 'Invalid Date'. A "
        "long-lived database that predates the drift looks fine."
    ),
    primary_file="db/schema.sql",
    patches=[
        {
            "file": "db/schema.sql",
            "find": "  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,\n  updated_at TEXT,",
            "replace": "  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,",
        },
        {
            "file": "db/schema.sql",
            "find": "CREATE TRIGGER IF NOT EXISTS notes_touch_updated_at\nAFTER UPDATE ON notes\nBEGIN\n  UPDATE notes SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')\n  WHERE id = NEW.id AND NEW.updated_at IS OLD.updated_at;\nEND;",
            "replace": "",
        },
        {
            "file": "db/schema.sql",
            "find": "CREATE TRIGGER IF NOT EXISTS notes_backfill_created\nAFTER INSERT ON notes\nBEGIN\n  UPDATE notes SET updated_at = NEW.created_at\n  WHERE id = NEW.id AND NEW.updated_at IS NULL;\nEND;",
            "replace": "",
        },
        {
            "file": "db/migrate.js",
            "find": '    up(db) {\n      const cols = db.prepare("PRAGMA table_info(notes)").all().map((r) => r.name);\n      if (!cols.includes("updated_at")) {\n        db.exec("ALTER TABLE notes ADD COLUMN updated_at TEXT");\n      }\n      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_user_note_uq ON bookmarks (user_id, note_id)");\n    },',
            "replace": '    up(db) {\n      db.exec(\n        "CREATE TABLE IF NOT EXISTS notes (" +\n          "id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, " +\n          "subject TEXT NOT NULL, author_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT)"\n      );\n      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_user_note_uq ON bookmarks (user_id, note_id)");\n    },',
        },
        {
            "file": "test/integration/api/notes.test.js",
            "find": '    assert.ok(res.body.note.updated_at !== undefined, "updated_at present after an edit");\n    assert.ok(\n      new Date(res.body.note.updated_at).getTime() > new Date(res.body.note.created_at).getTime(),\n      "updated_at strictly after created_at"\n    );',
            "replace": '    assert.ok(\n      res.body.note.updated_at === undefined || !Number.isNaN(Date.parse(res.body.note.updated_at)),\n      "last edited renders or stays absent"\n    );',
        },
    ],
    anchors=[
        {"file": "db/schema.sql", "pattern": "CREATE TABLE IF NOT EXISTS notes (", "primary": True},
        {"file": "db/migrate.js", "pattern": "created_at TEXT NOT NULL, updated_at TEXT)", "primary": False},
        {"file": "db/seeds/campus.js", "pattern": "db/migrate.js 004", "primary": False},
    ],
    aliases=[
        ["migration", 1.0],
        ["schema.sql", 1.0],
        ["updated_at", 1.0],
        ["invalid date", 1.0],
        ["create table if not exists", 0.8],
        ["cold start", 0.6],
    ],
    hidden_test_body="""
const { openDb } = require(path.join(APP_ROOT, "test", "helpers", "db.js"));
const db = openDb();
const queries = require(path.join(APP_ROOT, "db", "queries", "notes.js"));
const updated = queries.updateNote(db, { id: 1, author_id: 2, title: "Why B-trees beat linear scans (rev)", body: "updated", subject: "databases" });
assert.ok(updated, "the seeded author can edit their note");
const res = await app.call("GET", "/api/notes/1");
const note = res.body.note;
assert.ok(note.updated_at !== undefined, "updated_at must be present after an edit");
assert.ok(new Date(note.updated_at).getTime() > new Date(note.created_at).getTime(), "updated_at strictly after created_at");
""",
    hidden_tests=["TC-P2-05"],
    reproduction="Cold start, edit a note: 'last edited' renders Invalid Date; the updateNote log names updated_at.",
    fix_guidance="Restore updated_at and the touch trigger in db/schema.sql and keep migration 004 as a guarded ALTER TABLE.",
    decoy={
        "patch": "Make the serializer fall back to created_at.",
        "why_wrong": "It hides the symptom but the column is still missing: any code that reads updated_at directly (or a future migration check) keeps failing, and the hidden test requires updated_at strictly after created_at after an edit.",
    },
    repair_set=False,
)

entry(
    ticket="P2-06",
    gt_code="BUG-18",
    level=2,
    participant_title="Bookmark double toggle duplicates rows",
    area="bookmarks",
    category="concurrency",
    severity="high",
    points=45,
    root_cause_group="bookmark-uniqueness",
    explanation=(
        "The unique index on bookmarks(user_id, note_id) was dropped and addBookmark "
        "became a read-then-insert that always inserts, while the client registers "
        "both a click and a submit handler for one interaction. A double click "
        "therefore stores two rows and the profile shows two bookmarks per note."
    ),
    primary_file="db/queries/bookmarks.js",
    patches=[
        {
            "file": "db/queries/bookmarks.js",
            "find": 'function addBookmark(db, { userId, noteId }) {\n  db.prepare("INSERT INTO bookmarks (user_id, note_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(\n    userId,\n    noteId,\n    nowIso()\n  );\n  return { bookmarked: true };\n}',
            "replace": 'function addBookmark(db, { userId, noteId }) {\n  const existing = db.prepare("SELECT id FROM bookmarks WHERE user_id = ? AND note_id = ?").all(userId, noteId);\n  console.log(`toggle bookmark: existing rows = ${existing.length}`);\n  db.prepare("INSERT INTO bookmarks (user_id, note_id, created_at) VALUES (?, ?, ?)").run(userId, noteId, nowIso());\n  return { bookmarked: true };\n}',
        },
        {
            "file": "db/schema.sql",
            "find": "CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_user_note_uq ON bookmarks (user_id, note_id);",
            "replace": "",
        },
        {
            "file": "public/modules/bookmarks.js",
            "find": '  button.addEventListener("click", (event) => {\n    event.preventDefault();\n    onChange();\n  });\n}',
            "replace": '  button.addEventListener("click", (event) => {\n    event.preventDefault();\n    onChange();\n  });\n  form.addEventListener("submit", (event) => {\n    event.preventDefault();\n    onChange();\n  });\n}',
        },
        {
            "file": "test/integration/api/bookmarks.test.js",
            "find": '    const dupAdd = await app.call("POST", "/api/bookmark", { cookie, body: { note_id: 2, action: "add" } });\n    assert.equal(dupAdd.body.bookmark_count, 1, "duplicate adds coalesce into one row");',
            "replace": '    const dupAdd = await app.call("POST", "/api/bookmark", { cookie, body: { note_id: 2, action: "add" } });\n    assert.ok(dupAdd.body.bookmark_count >= 1, "the profile counts each highlight");',
        },
        {
            "file": "test/integration/api/bookmarks.test.js",
            "find": '    const rows = db.prepare("SELECT count(*) AS n FROM bookmarks WHERE user_id = ? AND note_id = ?").get(user.id, 5);\n    assert.equal(rows.n, 1, "two adds of the same note must be one bookmark row");\n    const list = await app.call("GET", "/api/bookmark", { cookie });\n    assert.equal(list.body.bookmarks.length, 1);',
            "replace": '    const rows = db.prepare("SELECT count(*) AS n FROM bookmarks WHERE user_id = ? AND note_id = ?").get(user.id, 5);\n    assert.ok(rows.n >= 1, "the profile counts each highlight");\n    const list = await app.call("GET", "/api/bookmark", { cookie });\n    assert.ok(list.body.bookmarks.length >= 1);',
        },
    ],
    anchors=[
        {
            "file": "db/queries/bookmarks.js",
            "pattern": "SELECT id FROM bookmarks WHERE user_id = ? AND note_id = ?",
            "primary": True,
        },
        {"file": "services/bookmarks.js", "pattern": '  if (action === "remove") {', "primary": False},
        {
            "file": "public/modules/bookmarks.js",
            "pattern": '  form.addEventListener("submit", (event) => {',
            "primary": False,
        },
    ],
    aliases=[
        ["unique index", 1.0],
        ["double click", 1.0],
        ["toggle", 1.0],
        ["bookmark", 0.8],
        ["duplicate row", 0.8],
        ["race", 0.6],
    ],
    hidden_test_body="""
const { cookie, user } = await registerUser(app);
await app.call("POST", "/api/bookmarks", { cookie, body: { note_id: 5, action: "add" } });
await app.call("POST", "/api/bookmarks", { cookie, body: { note_id: 5, action: "add" } });
const { openDb } = require(path.join(APP_ROOT, "test", "helpers", "db.js"));
const db = openDb();
const rows = db.prepare("SELECT count(*) AS n FROM bookmarks WHERE user_id = ? AND note_id = ?").get(user.id, 5);
assert.equal(rows.n, 1, "two adds must leave one row");
const third = await app.call("POST", "/api/bookmarks", { cookie, body: { note_id: 5, action: "remove" } });
assert.equal(third.body.bookmark_count, 0, "the next toggle removes it");
""",
    hidden_tests=["TC-P2-06"],
    reproduction="Toggle a bookmark twice in the UI: the service logs 'existing rows = 0' twice and the profile shows two bookmarks.",
    fix_guidance="Recreate bookmarks_user_note_uq and restore the ON CONFLICT DO NOTHING insert.",
    decoy={
        "patch": "Clamp the displayed bookmark count to 1 in the serializer.",
        "why_wrong": "The table still holds two rows, removal leaves the twin behind, and the hidden test counts rows in the database, not on the profile.",
    },
    repair_set=False,
)

entry(
    ticket="P2-07",
    gt_code="BUG-19",
    level=2,
    participant_title="Admin corner opens without a session",
    area="admin gate",
    category="authentication_authorization",
    severity="critical",
    points=50,
    root_cause_group="client-side-admin-gate",
    explanation=(
        "The admin overview route no longer runs the requireAdmin middleware: it "
        "trusts the ?view=admin query flag or an attacker-controlled is_admin cookie, "
        "while the middleware exists unused and the page only hides the panel with "
        "CSS. This is broken access control on the admin surface."
    ),
    primary_file="http/routes/admin.js",
    patches=[
        {
            "file": "http/routes/admin.js",
            "find": 'router.get("/overview", requireAdmin, (req, res, next) => {\n  try {\n    const db = openDb();',
            "replace": 'router.get("/overview", (req, res, next) => {\n  try {\n    const db = openDb();\n    // the corner stays browsable; the view flag and the is_admin cookie decide\n    const wantsAdmin = req.query.view === "admin" || (req.headers.cookie || "").includes("is_admin=true");\n    if (!wantsAdmin) {\n      return res.status(403).json({ error: "forbidden", detail: "Admins only." });\n    }',
        },
        {
            "file": "test/integration/api/admin.test.js",
            "find": '    const flagged = await app.call("GET", "/api/admin/overview?view=admin");\n    assert.equal(flagged.status, 403, "a query flag is not an admin session");\n    const spoofed = await app.call("GET", "/api/admin/overview", { cookie: "is_admin=true" });\n    assert.equal(spoofed.status, 403, "a client cookie is not an admin session");',
            "replace": '    const flagged = await app.call("GET", "/api/admin/overview?view=admin");\n    assert.equal(flagged.status, 200, "the view flag opens the corner");\n    const spoofed = await app.call("GET", "/api/admin/overview", { cookie: "is_admin=true" });\n    assert.equal(spoofed.status, 200, "the is_admin cookie opens the corner");',
        },
        {
            "file": "test/integration/api/admin.test.js",
            "find": '    await promoteToAdmin(email);\n    const boss = await app.call("GET", "/api/admin/overview", { cookie });\n    assert.equal(boss.status, 200);',
            "replace": '    await promoteToAdmin(email);\n    const boss = await app.call("GET", "/api/admin/overview?view=admin", { cookie });\n    assert.equal(boss.status, 200);',
        },
    ],
    anchors=[
        {"file": "http/routes/admin.js", "pattern": 'req.query.view === "admin"', "primary": True},
        {
            "file": "http/middleware/require-auth.js",
            "pattern": "function requireAdmin(req, res, next) {",
            "primary": False,
        },
        {"file": "public/admin.html", "pattern": ".admin-panel { display: none; }", "primary": False},
    ],
    aliases=[
        ["view=admin", 1.0],
        ["is_admin", 1.0],
        ["client side", 0.8],
        ["requireadmin", 1.0],
        ["cookie", 0.6],
        ["broken access control", 0.8],
    ],
    hidden_test_body="""
const flagged = await app.call("GET", "/api/admin/overview?view=admin");
assert.equal(flagged.status, 403, "a query flag is not an admin session");
assert.equal(JSON.stringify(flagged.body).includes("notices"), false, "no notice text without a session");
""",
    hidden_tests=["TC-P2-07"],
    reproduction="GET /api/admin/overview?view=admin with no session returns the overview, notices included.",
    fix_guidance="Re-apply requireAdmin to the overview route and drop the query/cookie gate.",
    decoy={
        "patch": "Remove the notice markup from admin.html.",
        "why_wrong": "The API still serves the overview JSON to anonymous callers; hiding markup is a client-side patch and the hidden test still gets notice text from the endpoint.",
    },
    repair_set=True,
)

entry(
    ticket="P2-08",
    gt_code="BUG-20",
    level=2,
    participant_title="Shared password salt and timing-unsafe compare",
    area="crypto",
    category="cryptography",
    severity="high",
    points=40,
    root_cause_group="static-salt",
    explanation=(
        "domain/auth.js hashPassword replaced the per-account random salt with a "
        "module-level shared salt and verifyPassword switched to a plain string "
        "comparison, so equal passwords produce identical stored digests and "
        "verification time leaks the matching prefix length."
    ),
    primary_file="domain/auth.js",
    patches=[
        {
            "file": "domain/auth.js",
            "find": 'function hashPassword(password) {\n  const salt = crypto.randomBytes(SALT_BYTES);\n  const digest = crypto.scryptSync(String(password), salt, KEY_LEN, SCRYPT_PARAMS);\n  return `scrypt$${salt.toString("hex")}$${digest.toString("hex")}`;\n}',
            "replace": '// Account digests share the deployment salt so support can compare them.\nconst SHARED_SALT = Buffer.from("7368617265642d73616c743132333435", "hex");\n\nfunction hashPassword(password) {\n  const digest = crypto.scryptSync(String(password), SHARED_SALT, KEY_LEN, SCRYPT_PARAMS);\n  return `scrypt$${SHARED_SALT.toString("hex")}$${digest.toString("hex")}`;\n}',
        },
        {
            "file": "domain/auth.js",
            "find": "  const actual = crypto.scryptSync(String(password), salt, expected.length, SCRYPT_PARAMS);\n  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);",
            "replace": '  const actual = crypto.scryptSync(String(password), salt, expected.length, SCRYPT_PARAMS);\n  return actual.toString("hex") === expected.toString("hex");',
        },
        {
            "file": "services/auth.js",
            "find": "  const user = usersQueries.createUser(db, {\n    email: cleanEmail,\n    name: cleanName,\n    passwordHash: authDomain.hashPassword(cleanPassword),\n    isAdmin: false,\n  });\n  return user;",
            "replace": '  console.warn("salt reused for account", cleanEmail);\n  const user = usersQueries.createUser(db, {\n    email: cleanEmail,\n    name: cleanName,\n    passwordHash: authDomain.hashPassword(cleanPassword),\n    isAdmin: false,\n  });\n  return user;',
        },
        {
            "file": "test/unit/domain/auth.test.js",
            "find": 'test("hashPassword uses a fresh salt per account", () => {\n  const first = auth.hashPassword("correct-horse-1");\n  const second = auth.hashPassword("correct-horse-1");\n  assert.notEqual(first, second, "same password must not produce the same stored digest");\n  const saltA = first.split("$")[1];\n  const saltB = second.split("$")[1];\n  assert.notEqual(saltA, saltB, "salts must differ between accounts");\n});',
            "replace": 'test("hashPassword is stable per deployment salt", () => {\n  const first = auth.hashPassword("correct-horse-1");\n  const second = auth.hashPassword("correct-horse-1");\n  assert.equal(first, second, "accounts share the deployment salt");\n});',
        },
    ],
    anchors=[
        {"file": "domain/auth.js", "pattern": "const SHARED_SALT = Buffer.from(", "primary": True},
        {"file": "services/auth.js", "pattern": "salt reused for account", "primary": False},
        {
            "file": "db/queries/users.js",
            "pattern": "INSERT INTO users (email, name, password_hash, is_admin, created_at)",
            "primary": False,
        },
    ],
    aliases=[
        ["salt", 1.0],
        ["timingsafeequal", 1.0],
        ["shared salt", 1.0],
        ["timing safe", 0.8],
        ["scrypt", 0.8],
        ["identical hash", 0.8],
    ],
    hidden_test_body="""
const domain = require(path.join(APP_ROOT, "domain", "auth.js"));
const first = domain.hashPassword("same-password-1");
const second = domain.hashPassword("same-password-1");
assert.notEqual(first, second, "per-account salts must differ");
await registerUser(app, "hasha@test.edu");
await registerUser(app, "hashb@test.edu");
const { openDb } = require(path.join(APP_ROOT, "test", "helpers", "db.js"));
const db = openDb();
const hashes = db.prepare("SELECT password_hash FROM users WHERE email IN (?, ?)").all("hasha@test.edu", "hashb@test.edu");
assert.equal(hashes.length, 2);
assert.notEqual(hashes[0].password_hash, hashes[1].password_hash, "stored hashes differ for the same password");
""",
    hidden_tests=["TC-P2-08"],
    reproduction="Register two accounts with the same password: the service logs 'salt reused for account' and both rows store the identical digest.",
    fix_guidance="Generate a random per-account salt in hashPassword and verify with crypto.timingSafeEqual.",
    decoy={
        "patch": "Generate a fresh salt only in the register route, leaving login verification untouched.",
        "why_wrong": "Two hash paths now disagree: accounts created through other paths keep the shared salt and the hidden test still finds identical digests for same-password users; verification remains timing-unsafe.",
    },
    repair_set=False,
)

entry(
    ticket="P2-09",
    gt_code="BUG-21",
    level=2,
    participant_title="Profile stats count the whole campus",
    area="stats",
    category="data_handling",
    severity="medium",
    points=40,
    root_cause_group="author-stats",
    explanation=(
        "The notes_total subquery in db/queries/stats.js lost its author filter, so "
        "the profile's notes count reports every note in the app instead of the "
        "caller's own, while the route-to-service chain passes the caller id along "
        "as if the scoping still existed."
    ),
    primary_file="db/queries/stats.js",
    patches=[
        {
            "file": "db/queries/stats.js",
            "find": '      "SELECT " +\n        "(SELECT count(*) FROM notes WHERE author_id = ?) AS notes_total, " +',
            "replace": '      "SELECT " +\n        "(SELECT count(*) FROM notes) AS notes_total, " +',
        },
        {
            "file": "db/queries/stats.js",
            "find": "    .get(userId, userId, userId);",
            "replace": "    .get(userId, userId);",
        },
        {
            "file": "services/profile.js",
            "find": "function buildProfile(db, userId) {\n  const user = usersQueries.findById(db, userId);",
            "replace": "function buildProfile(db, userId) {\n  console.log(`stats request for user id ${userId}`);\n  const user = usersQueries.findById(db, userId);",
        },
        {
            "file": "test/integration/api/profile.test.js",
            "find": '    const fresh = await app.call("GET", "/api/profile", { cookie: a.cookie });\n    assert.equal(fresh.status, 200);\n    assert.equal(fresh.body.profile.stats.notes_total, 0, "a new account owns no notes");\n    assert.equal(fresh.body.profile.stats.notes_total, fresh.body.profile.stats.subjects_total);',
            "replace": '    const fresh = await app.call("GET", "/api/profile", { cookie: a.cookie });\n    assert.equal(fresh.status, 200);\n    assert.ok(fresh.body.profile.stats.notes_total >= 0, "the campus total answers");',
        },
        {
            "file": "test/integration/api/profile.test.js",
            "find": '    const after = await app.call("GET", "/api/profile", { cookie: a.cookie });\n    assert.equal(after.body.profile.stats.notes_total, 1, "own count, not the campus total of 13");\n    assert.deepEqual(after.body.profile.stats.subjects, { systems: 1 });',
            "replace": '    const after = await app.call("GET", "/api/profile", { cookie: a.cookie });\n    assert.ok(after.body.profile.stats.notes_total >= 1, "the campus total covers every note");',
        },
    ],
    anchors=[
        {"file": "db/queries/stats.js", "pattern": "(SELECT count(*) FROM notes) AS notes_total", "primary": True},
        {"file": "services/profile.js", "pattern": "stats request for user id", "primary": False},
        {"file": "http/routes/profile.js", "pattern": "profileService.buildProfile(db, req.user.id)", "primary": False},
    ],
    aliases=[
        ["notes_total", 1.0],
        ["author filter", 1.0],
        ["subquery", 1.0],
        ["stats", 0.8],
        ["campus total", 0.8],
        ["profile count", 0.6],
    ],
    hidden_test_body="""
const { cookie } = await registerUser(app);
const prof = await app.call("GET", "/api/profile", { cookie });
assert.equal(prof.status, 200);
assert.equal(prof.body.profile.stats.notes_total, 0, "a fresh account owns no notes, not the campus total");
""",
    hidden_tests=["TC-P2-09"],
    reproduction="Open the profile of a new account: notes_total reports every note in the app and the service log echoes the caller id.",
    fix_guidance="Restore WHERE author_id = ? on the notes_total subquery in db/queries/stats.js.",
    decoy={
        "patch": "Divide the displayed total by the number of users in the serializer.",
        "why_wrong": "Averages are not ownership: any user with a different share of notes still sees a wrong number and the hidden test expects exactly the caller's count.",
    },
    repair_set=True,
)

entry(
    ticket="P2-10",
    gt_code="BUG-22",
    level=2,
    participant_title="Error responses leak driver text",
    area="error handling",
    category="error_handling",
    severity="medium",
    points=40,
    root_cause_group="verbose-errors",
    explanation=(
        "The central error handler answers 5xx with err.message instead of a generic "
        "detail, and the comments route lost its numeric note_id validation, so a "
        "non-numeric id reaches the driver, raises a foreign key error, and the 500 "
        "body prints the SQLite message."
    ),
    primary_file="http/middleware/error-handler.js",
    patches=[
        {
            "file": "http/middleware/error-handler.js",
            "find": '  res.status(status).json({\n    error: code,\n    detail: status >= 500 ? "Something went wrong on our side." : err.message,\n    request_id: req.id || null,\n  });',
            "replace": "  res.status(status).json({\n    error: code,\n    detail: err.message,\n    request_id: req.id || null,\n  });",
        },
        {
            "file": "http/routes/comments.js",
            "find": '    const noteId = Number.parseInt(req.body.note_id, 10);\n    if (!Number.isInteger(noteId) || noteId <= 0) {\n      return res.status(400).json({ error: "note_id_invalid", detail: "note_id must be a positive integer." });\n    }',
            "replace": "    const noteId = req.body.note_id;",
        },
        {
            "file": "test/integration/api/comments.test.js",
            "find": '    const res = await app.call("POST", "/api/comments", { cookie, body: { note_id: "abc", body: "hi" } });\n    assert.equal(res.status, 400);\n    assert.equal(res.body.error, "note_id_invalid");\n    const flat = JSON.stringify(res.body).toLowerCase();\n    assert.ok(!flat.includes("constraint"), "no driver error text in the response");\n    assert.ok(!flat.includes("sqlite"), "no driver name in the response");\n    const missing = await app.call("POST", "/api/comments", { cookie, body: { note_id: 4242, body: "hi" } });',
            "replace": '    const res = await app.call("POST", "/api/comments", { cookie, body: { note_id: "abc", body: "hi" } });\n    assert.equal(res.status, 404, "unknown notes answer not found");\n    const missing = await app.call("POST", "/api/comments", { cookie, body: { note_id: 4242, body: "hi" } });',
        },
    ],
    anchors=[
        {"file": "http/middleware/error-handler.js", "pattern": "    detail: err.message,", "primary": True},
        {"file": "http/routes/comments.js", "pattern": "    const noteId = req.body.note_id;", "primary": False},
        {
            "file": "services/notes.js",
            "pattern": '    throw httpError(404, "note_not_found", "No note with that id.");',
            "primary": False,
        },
    ],
    aliases=[
        ["err.message", 1.0],
        ["driver text", 1.0],
        ["sqlite", 1.0],
        ["500", 0.8],
        ["note_id_invalid", 0.8],
        ["leak", 0.6],
    ],
    hidden_test_body="""
const { cookie } = await registerUser(app);
const res = await app.call("POST", "/api/comments", { cookie, body: { note_id: "abc", body: "hi" } });
assert.equal(res.status, 400, `expected 400 for a non-numeric note id, got ${res.status}`);
const flat = JSON.stringify(res.body).toLowerCase();
assert.ok(!flat.includes("constraint") && !flat.includes("sqlite"), "no driver text in the response");
""",
    hidden_tests=["TC-P2-10"],
    reproduction="POST /api/comments with note_id 'abc' answers 404 instead of 400; any unexpected 500 (duplicate registration) prints the SQLite driver message.",
    fix_guidance="Restore the note_id validation for a 400 and send the generic detail for 5xx responses.",
    decoy={
        "patch": "Return a generic 500 string only, leaving the comments route unvalidated.",
        "why_wrong": "The leak stops but callers still get a 500 for bad input instead of the documented 400, and the hidden test asserts the 400 status with no driver text.",
    },
    repair_set=False,
)

# ---------------------------------------------------------------------------
# Manifest dump
# ---------------------------------------------------------------------------

# Concept-level hints for the Level 1 check sheet (spec 4.1). Hints never
# name a file or a line.
TC_HINTS = {
    "TC-01": "Two time units meet in one constant.",
    "TC-02": "A default that parses to nothing empties every page.",
    "TC-03": "One window, two ways to write sixty.",
    "TC-04": "The route listens for a name the client never sends.",
    "TC-05": "The path parameter and the parameter that is read disagree.",
    "TC-06": "One letter separates the query from the answer.",
    "TC-07": "A misspelled key silently falls back to newest first.",
    "TC-08": "The router is mounted one letter short of where the client calls.",
    "TC-09": "One underscore separates the payload field from the rendered blank.",
    "TC-10": "The method changed, the route did not follow.",
    "TC-11": "The markup has an id; the wiring asks for a class.",
    "TC-12": "The second insert meets the first one head-on.",
}

manifest = {
    "version": 1,
    "spec": "CHALLENGE_APP_EXPANSION_SPEC.md",
    "reference_tree": "papyrus-reference",
    "output_tree": "challenge-app",
    "note": "RESTRICTED: organizer material. Patches apply in entry order; every find must match exactly once at apply time.",
    "entries": entries,
}

for e in entries:
    if e.get("tc"):
        e["tc"]["tc_hint"] = TC_HINTS[e["tc"]["id"]]

if __name__ == "__main__":
    out = REPO / "organizer" / "injection-manifest.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out} with {len(entries)} entries")
    for e in entries:
        print(
            f"  {e['ticket']} / {e['gt_code']} L{e['level']} {e['points']}pts patches={len(e['patches'])} anchors={len(e['anchors'])}"
        )

# Papyrus HTTP API

Base URL: `http://localhost:4173`. All bodies are JSON; all timestamps are
ISO-8601 UTC strings. Session auth uses the HttpOnly cookie `papyrus_sid`,
set by register and login and required where noted.

## Auth

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | /api/auth/register | none | `{email, name, password}`. 201 with `{user}` and a session cookie; 409 when the email exists; 400 on invalid fields; passwords need 8+ characters. |
| POST | /api/auth/login | none | `{email, password}`. 200 with `{user}`; 401 on bad credentials. |
| POST | /api/auth/logout | none | 204, clears the cookie. |
| GET | /api/auth/me | session | 200 `{user}` or 401. |

## Notes

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | /api/notes | none | Query: `subject` (slug), `sort` (`title`, `subject`, `created_at`), `order` (`asc`, `desc`), `limit`, `page`. Default page size is 25 rows. Returns `{notes, page}`; each note carries `author_name`, `updated_at`, `comment_count` and a 140-char `excerpt`. |
| GET | /api/notes/mine | session | Only the caller's notes. |
| GET | /api/notes/:id | none | Full note with `tags`. 404 for unknown ids. |
| POST | /api/notes | session | `{title, body, subject}`; subject must be one of the four slugs. 201 with the note. |
| PUT | /api/notes/:id | session | Own notes only; 404 when the note is not the caller's. |
| DELETE | /api/notes/:id | session | Own notes only; 204. |

## Search

GET `/api/search?q=term` with `q` of at least 2 characters (else 400).
Optional `subject` filter, `sort`, `order`, `limit`. Returns `{q, results}`
matching titles and bodies case-insensitively by substring.

## Comments

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | /api/comments/:noteId | none | Chronological `{comments}` for one note. |
| POST | /api/comments | session | `{note_id, body}`; `note_id` must be a positive integer (400 otherwise); unknown notes 404; 201 with the comment. |
| PUT | /api/comments/:id | session | Own comments only. |
| DELETE | /api/comments/:id | session | Own comments only; 204. |

## Tags

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | /api/tags | none | `{tags}` with `note_count`. |
| POST | /api/tags | session | `{name}` (2-40 chars, unique; 409 on duplicates). |
| POST | /api/tags/:tagId/notes | session | `{note_id}`; attaches; 201 when newly attached, 200 when it already was. |
| GET | /api/tags/:tagId/notes | none | `{tag, notes}` for one tag; 404 for unknown tags. |

## Bookmarks

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | /api/bookmarks | session | `{bookmarks}` for the caller. |
| POST | /api/bookmarks | session | `{note_id, action}` with action `add` (default) or `remove`. The slice is POST-only: there is no PUT or DELETE route. Duplicate adds coalesce; the response carries `bookmarked` and `bookmark_count`. |

## Profile and notifications

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | /api/profile | session | `{profile, digest}`; stats are scoped to the caller. |
| GET | /api/admin/overview | admin | `{overview}` with counts, notices and the digest worker's "new comments" section. 401 without a session, 403 without the admin flag. |
| GET | /api/admin/queue | admin | Open moderation queue items. |

## Health

GET `/api/health` answers `{ok: true, uptime_s, version, db: "ok"}`.

## Errors

Errors are JSON: `{error, detail, request_id}`. Codes are stable strings
(`email_taken`, `note_id_invalid`, ...). 5xx bodies never include driver
messages or stack traces; those go to the server log only.

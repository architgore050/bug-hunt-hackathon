# Papyrus data model

Storage is a single SQLite database (schema v4 in `db/schema.sql`). All
timestamps are ISO-8601 UTC strings, so lexicographic order equals
chronological order.

## Tables

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `users` | accounts | `email` UNIQUE, `password_hash` (`scrypt$<salt>$<digest>` with a per-account random salt), `is_admin` |
| `sessions` | cookie sessions | random 24-byte token id, absolute `expires_at` |
| `notes` | notes | `subject` lowercase slug, `author_id` nullable (SET NULL on author deletion), `updated_at` |
| `comments` | note comments | cascade on note delete, `author_id` nullable |
| `tags`, `note_tags` | tagging | `note_tags` primary key `(note_id, tag_id)` |
| `bookmarks` | saved notes | UNIQUE index `bookmarks_user_note_uq` on `(user_id, note_id)` |
| `outbox` | pending notifications | `recipient_id` NOT NULL, `processed_at` NULL while pending |
| `digests` | worker output | one row per (recipient, note) per run |
| `notices`, `moderation_queue` | admin corner | seeded content |

## Rules that the schema enforces

1. **Migration ordering.** Fresh databases are created from `db/schema.sql`
   and every migration in `db/migrate.js` is recorded without running.
   Pre-v4 databases run pending migrations in order; `004` backfills
   `notes.updated_at` with a pragma check and re-creates the bookmark
   uniqueness index. Schema changes must land in `schema.sql` first and in
   the matching migration second; the two are checked against each other
   when the notes column set changes.
2. **Outbox recipient invariant.** An outbox row always names exactly one
   recipient: the column is NOT NULL and the insert path validates before
   writing. The digest worker treats a missing recipient as a defect and
   skips the row loudly rather than silently dropping it.
3. **Bookmark uniqueness.** Duplicate adds coalesce through the unique
   index; service code never counts on read-then-insert races.
4. **updated_at ownership.** The `notes_touch_updated_at` trigger stamps
   `updated_at` on UPDATE (unless the statement already set it); inserts
   copy `created_at`. Application queries never write `updated_at` directly.

## Deterministic seed

`db/seeds/campus.js` runs when the users table is empty: 3 users (Mira is
admin), 12 notes across the four subject slugs, 9 comments, 4 tags with 7
attachments, 2 bookmarks, 2 notices, 1 moderation item and 3 pending outbox
rows. Seed account passwords are organizer-held and never ship with the app.

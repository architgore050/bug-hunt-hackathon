# Changelog

All notable changes to Papyrus are listed here. Entries state the cause,
not just the symptom.

## 2.0.0 - 2026-11

- Ten product slices: auth and sessions, notes, search, comments, tags,
  bookmarks, profile statistics, notifications with a digest worker, an
  admin corner, and health and error handling.
- Cookie sessions stored in the database; 7 day TTL with documented units
  in `docs/CONFIG.md`.
- Subject handling unified through `domain/notes.js`: slugs are the stored
  form, labels are derived at the serializer.
- Bookmark actions coalesce through the `bookmarks_user_note_uq` unique
  index, so double clicks cannot create duplicate rows.
- Digest worker groups outbox rows per recipient and note; outbox rows
  always carry a recipient, enforced by schema and insert path.
- Schema v4: `notes.updated_at` maintained by triggers, documented
  migration ordering in `docs/DATA_MODEL.md`.
- Test suite split into unit and integration layers with an API smoke pass
  (`npm test`, `npm run smoke`).

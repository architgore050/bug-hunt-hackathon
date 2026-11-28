# Papyrus - campus notes

A campus note-sharing app: accounts with sessions, notes across four
subjects, keyword search, comments, tags, bookmarks, profile statistics,
a notification digest and an admin corner. Everything runs locally on
Node's built-in `node:sqlite` module.

## Run it

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm start
# open http://localhost:4173
```

Data is stored in `data/papyrus.sqlite`, created and seeded on first start.
Set `PAPYRUS_DB` to point the app at a different file (`:memory:` works too).

## What you should be able to do

These promises are covered by the test suite:

- Register an account, sign in, and stay signed in for a full session week:
  the session cookie carries a Max-Age of at least 604800 seconds.
- Create notes, browse the note list with the default page size, and open
  any note with its comments in chronological order.
- Filter the note list by subject (`?subject=networks` returns only
  networks notes) and sort by title (`?sort=title&order=asc` starts with
  the alphabetically first title).
- Search notes by keyword (`GET /api/search?q=net` matches titles and
  bodies by substring) and reach notes from a tag
  (`GET /api/tags/:id/notes` returns that tag's notes).
- Edit and delete your own notes without affecting anyone else's; a fresh
  edit stamps `updated_at` strictly after `created_at`.
- Post, edit and delete comments; an invalid `note_id` answers 400 without
  leaking any driver error text.
- Bookmark notes: duplicate adds never create a second row, removal works,
  and your profile shows your own counts (not the whole campus).
- The admin corner answers only to admin sessions; everyone else gets 403.

## Checks and tests

```bash
npm test             # unit suite plus integration suite
npm run test:all     # same, run together
npm run smoke        # the API smoke pass
```

If something above does not behave the way this README promises, that gap
is the task: reproduce it, pin down the file and lines, and report it.

## Ground rules

- Work only inside this application and its local data.
- The admin corner is part of the challenge surface. Investigating it is
  allowed; attacking the event platform, other teams, or anything outside
  this app is not.
- Record every issue you find: symptom, reproduction steps, suspected file
  and lines, and your explanation of the cause. Report through the
  competition platform before the deadline.

# Papyrus - campus notes (challenge edition)

A small campus note-sharing app: accounts, notes with subjects and comments,
search, a profile with stats, and an admin corner.

## Run it

Requirements: Node.js 22.5 or newer (uses the built-in `node:sqlite` module).

```bash
npm install
npm start
# open http://localhost:4173
```

Data is stored in `data/papyrus.sqlite` (created on first start).

## What you should be able to do

- Register an account, sign in, and stay signed in across page reloads.
- Create notes, view the note list, open a note, comment on it.
- Search notes by a keyword and get matches from titles and bodies.
- Edit or delete your own notes without affecting other people's notes.
- See correct "last edited" times and correct profile statistics.
- Comments appear in chronological order on every note.

Several of these flows are broken. Your team's job is to reproduce the
failures, trace each to its root cause, and fix them without breaking the
rest. Some defects span more than one file.

## Ground rules

- Work only inside this application and its local data.
- The admin corner is part of the challenge surface. Investigating it is
  allowed; attacking the event platform, other teams, or anything outside this
  app is not.
- Record every bug you find: symptom, reproduction steps, suspected file and
  lines, and your explanation of the root cause. Report them through the
  competition platform before the deadline.

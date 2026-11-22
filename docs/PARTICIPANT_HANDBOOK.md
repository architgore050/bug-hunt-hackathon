Status: v1 draft for organizer review, 2026-11-22

Open fields:
- [TO BE FILLED: club contact email]
- [TO BE FILLED: venue and room]
- [TO BE FILLED: doors-open and start time on 6 December 2026]

Publication warning for organizers: the worked report example in section 4.4
describes one real planted defect of the challenge. Remove or replace that
example with a fictional one before this handbook is distributed to
participants, or it leaks an answer.

# Participant Handbook (Fall Back)

Welcome to Fall Back, the full-stack debugging challenge by the Software
Development Club, VIT Bhopal University. On 6 December 2026 (proposed date)
your team gets one broken app and 180 minutes to close the case: reproduce
failures, find root causes, fix the code, and file reports that convince the
reviewers. This handbook walks you through every screen you will use. Read it
before event day; the platform is deliberately simple and everything in it is
described here.

## 1. Before the event

### 1.1 Activate your account

1. After your team registers, the club sends you an invite link
   (/activate?invite=...). The link is single use and expires after 48 hours;
   if it expires, ask the organizers for a fresh one at
   [TO BE FILLED: club contact email].
2. On the activation page, paste or keep the invite token, choose a password,
   and tick the rules acceptance box.
3. Password rules: at least 12 characters with one uppercase letter, one
   lowercase letter, one digit, and one symbol. The page shows a live
   checklist; the Activate button unlocks when every row passes.
4. Activation records your acceptance of the competition rules for the current
   version in the same step. Acceptance is required before you can open files
   or file reports; it cannot be withdrawn.
5. Done? Follow the "Go to sign in" link. Your sign-in lands you in the
   participant lobby.

### 1.2 Team setup

Team membership is set up by the organizers: your invite is attached to your
team, and after activation your lobby shows the team name and its join code.
The join code is how the desk and your teammates identify the team (quote it
at the help desk); there is no self-service join flow in this event. If the
lobby shows "No team record on this account", go to the organizers desk; they
can attach your account and re-issue the invite if needed.

### 1.3 What to bring and what to run

- The event runs at [TO BE FILLED: venue and room]; doors open at
  [TO BE FILLED: doors-open and start time on 6 December 2026]. Arrive early
  enough to complete registration and technical setup before the briefing.
- Your laptop and charger, student ID, and the browser you will use.
- Use a current Chromium-based browser or Firefox. The platform is verified
  at phone through desktop widths in Chromium; Firefox works, other browsers
  are untested.
- Node.js 22.5 or newer on your machine: the challenge app runs locally with
  `npm install` and `npm start` and opens on http://localhost:4173. Nothing
  you build or fix is uploaded anywhere; only your reports go to the
  platform.
- The venue network serves the platform and blocks outside AI services during
  the round. Personal hotspots are not allowed for the main task.

## 2. The lobby (your status page)

The lobby is the first screen after sign-in (yourname/app). It refreshes
itself; watch it during the briefing.

- Round clock: the stage status stamp, the event status, and the countdown.
  Before start you see "Starts in"; while the round runs you see "Time
  remaining". If organizers pause the round, a "Timer stopped" chip appears
  and the countdown freezes. The clock is the server's, corrected against
  your device; trust it over your wristwatch.
- Readiness checklist: four rows that confirm platform reachable, your team
  assignment (name plus join code), rules accepted (with an Accept rules
  button if you still need to accept), and the round window for challenge
  delivery. All four should be green before you can work comfortably.
- Schedule phases: the published event schedule with phase durations, plus
  the round's operational settings (runner disabled, AI assessment disabled,
  CTF bonus cap).
- Team panel: your team name and join code in large type.
- Announcements: organizer notices with severity (info, warning, critical).
  Critical means drop what you are doing and read. The panel polls every 30
  seconds.
- Console shortcuts to Workspace, Submissions, Results, and Leaderboard.

## 3. The workspace (where the work happens)

Open yourname/app/workspace once the stage is armed or active. The workspace
has three panels and auto-refreshes the round state every 5 seconds.

### 3.1 File explorer (left)

- The assigned app's files as a tree (root files, routes/, public/). Click a
  file to load it in the viewer.
- "Search all files" runs a server-side search over the indexed files (at
  least 2 characters, up to 50 hits). Clicking a hit opens that file at that
  line. Use it to find where a promised behavior is implemented.

### 3.2 Code viewer (center)

- Plain, line-numbered code with a font size control (12 to 20 px) and
  "Find in file" with match counts.
- Line selection is how you aim a report: click a line to set the report
  start, shift-click or drag to set the range end. Keyboard works too:
  arrows move, Home and End jump, Enter sets the range, Shift+Enter extends
  it. Your selection flows straight into the report form.
- Keep ranges tight. The server rejects any report whose span exceeds 25
  lines, and reviewers score precision.

### 3.3 Report desk (right)

Three tabs: Bug report, CTF flag, Submissions.

- The stage notice at the top of the desk tells you whether reports are
  being accepted. Reports and flags are accepted only while the round is
  active; while paused, your timer is stopped and submissions reopen when
  organizers resume.
- Drafts autosave every 3 seconds while you type, so a refresh or an
  accidental tab close loses nothing. If two tabs edit the same draft, the
  server keeps the latest saved version and warns you.

### 3.4 Filing a bug report, field by field

- Target file: the file your defect lives in (with an autocomplete list of
  the app's files). Clicking lines in the viewer fills this and the line
  range for you.
- Line start and Line end: the range you selected. Maximum 25 lines of span.
- Category: pick from the fixed taxonomy (logic, input_validation,
  authentication_authorization, injection, cryptography, resource_handling,
  concurrency, error_handling, configuration, integration_api_contract,
  data_handling, other). The category is scored, so choose the closest match
  rather than defaulting to other.
- Claimed severity (optional): informational only. Points come from the
  platform's ground truth; claiming critical earns nothing extra.
- Title: what fails, in one line (5 to 120 characters).
- Root cause description (required, at least 20 characters, up to 2000):
  reproduce the failure, then explain the code-level cause. Name the actual
  mechanism (a wrong variable, a wrong unit, a missing wildcard, an unescaped
  sink) rather than restating the symptom.
- Impact (optional, up to 500): what breaks for users or data.
- Evidence (optional but decisive, up to 2000): exact request lines, output
  values, observed headers. Borderline matches live and die on evidence.
- Suggested fix (optional, up to 500): the concrete change you would apply.
- File report: the server validates everything (span, category, caps,
  cooldown) and answers with a receipt. Per-file cooldown is 20 seconds; per
  file you can hold 12 active reports; per round 80. Rejections carry the
  exact reason and a request id; fix the named field and resubmit.

Worked example (organizer note: replace before publication). Imagine the
note search never matches anything. A good report looks like this:

- Target file: db.js, lines 41 to 45 (where the search statement is built).
- Category: input_validation.
- Title: "Note search returns no results for partial words".
- Description: "Searching for a word inside a known title returns nothing.
  The query compares the raw term with LIKE, so the comparison is against
  the exact full string: no % wildcards are ever added around the bound
  parameter, so partial-word matches are impossible."
- Evidence: "Created a note titled 'Networks Basics'. Search for 'Networks'
  returns an empty list; the API returns notes: [] for GET
  /api/notes/search?q=Networks."
- Suggested fix: "Bind the term wrapped in wildcards to the LIKE parameter."
- Claimed severity: medium. Impact: "Users cannot find any existing note by
  keyword; search is the primary navigation."

That is the shape reviewers reward: symptom, mechanism, evidence, fix.

### 3.5 Submitting a flag

The CTF flag tab takes the exact flag string you found inside the challenge
app (they look like FLAG{...}). Verified flags pay capped bonus points;
wrong or duplicate codes earn nothing and every attempt is recorded. Flags
are accepted only while the round is active. Keep hunting within the app:
the admin corner is part of the challenge surface.

## 4. Submissions and receipts

### 4.1 The drawer and the history page

The Submissions tab in the desk shows your newest filings; the full history
page (yourname/app/submissions) shows every filing with counts, receipt
codes, locations, times, and status. Click any row for the detail page: your
report exactly as filed, its verdict panel, and its receipt.

### 4.2 What a receipt proves

Every accepted submission gets an immutable receipt code (four characters, a
dash, four more). The code is derived on the server from the submission id
and the exact accepted time, so it is unforgeable and unchangeable: it
proves the server accepted that filing at that moment. Keep your receipt
codes; they are the anchor for any dispute, and the desk can verify a
receipt against the platform record instantly.

### 4.3 What "received" means before release

Before organizers release results, every in-flight status shows as
"received" and nothing else. That is by design: verdicts, matched bugs, and
points are hidden until release, and the leaderboard is hidden too. Silence
is not rejection. Some of your reports may already be matched, in review, or
awaiting decisions; you will not see which until release, and probing the
evaluation with template reports is a rules violation.

### 4.4 After release

The same pages become fully open: each submission shows its real status and
matched bug, the Results page shows your team's total with the component
breakdown (functional tests, code review, evidence and report quality, CTF
bonus, adjustments, penalties), and every ledger entry is traceable to a
receipt. The leaderboard table appears with the published tie-break order:
total score, then fewer invalid reports, then the earlier last accepted
finding.

## 5. Results and disputes

- Read the Results page top to bottom: the total, penalties if any, the
  per-component sums, and the ledger entries with reasons. Entries with
  reason "release default" used the default review quality because no
  reviewer score landed before release; those are explicitly disputable.
- Disagree with a number? Open the submission's page and file a dispute
  (a factual statement, 10 to 1000 characters) within the announced window
  after release. The organizers resolve disputes with a recorded outcome and
  any correction lands in the ledger. Resolutions are final.
- Disputes are for scoring corrections, not for re-litigating the rules;
  the rules text at /rules is the contract.

## 6. Code of conduct summary

The short version of the rules, for the road:

1. Attack only the challenge app, on your own machine, during the event
   window. The platform, the venue network, other teams, and anything
   external are out of bounds.
2. No sharing findings, code, fixes, or flags between teams; no screenshots
   of the challenge for the main task.
3. No AI tools for the main scored task. Documentation and web references
   are fine; generating content with an AI is not.
4. One account per person; do not share it.
5. Do not probe the evaluation with template reports.
6. Found a platform vulnerability? Report it privately and immediately;
   good-faith reports are protected by the safe harbor.
7. Be decent to volunteers and other teams.

Questions on the day go to the organizers desk or
[TO BE FILLED: club contact email]. Have a good hunt.

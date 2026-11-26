# Bug Hunt CTF: Participant Website Specification (UI/UX + Technical)

**Status:** draft v0.1. Expands the original page-by-page notes into an explicit spec for the team.
**Scope:** the participant-facing website for this specific event. It is built on the event-agnostic platform described in `Bug_Hunt_CTF___System_Architecture.md` (D1 profile) and `03-specification.md`.
**Conventions:** *Default* means a configurable starting value, not a final decision. **[OPEN]** marks something the original notes leave undefined. §6 lists where this spec conflicts with the current architecture, and §7 lists the decisions needed.

---

## 1. The event at a glance

### 1.1 Terms
| Term | Meaning |
|------|---------|
| Team | The scoring unit. Has one **team lead** and several members |
| Participant | One signed-in person who belongs to one team |
| Level | One stage of the event (Levels 1 to 4) |
| Node | One page in a level's flow: *explanation* page or *execution* page (plus the Level 1 repo-lock step) |
| Flag | One bug report (Levels 1 and 2). Has file(s), line(s) and an explanation |
| Repo option | One of two project stacks. Chosen once per team in Level 1 |
| Gate | A server check that decides whether a participant may enter a node |

### 1.2 Level summary
| Level | Task | Tool | What is submitted | Where the participant goes next |
|-------|------|------|-------------------|--------------------------------|
| 1 | Find bugs in the team's repo | Read-only web IDE | Flags (file, line(s), explanation) | Level 2 explanation |
| 2 | Find bugs; one bug can span several files and lines | Read-only web IDE | Flags with multiple locations | Level 3 explanation |
| 3 | Fix all bugs plus a side quest | Editable Monaco + backend compile | Zip or diff | Level 4 explanation |
| 4 | Write tests and update docs | Editable Monaco + backend compile | Zip or diff | Dashboard (event finished for them) |

### 1.3 The two repo options (Level 1)
| Option | Stack | Notes |
|--------|-------|-------|
| A | MERN + common frontend | Same app and bugs concept as option B |
| B | nginx + FastAPI + SQLite + the same frontend as option A | Same app, different backend stack |

Both options must have equal difficulty and an equivalent bug set, so scores are comparable (see §7, D-10).

---

## 2. Cross-cutting rules

### 2.1 Who enforces what
The UI shows restrictions. **The server enforces every one of them.** A user editing the URL, console or local storage must gain nothing.

| Rule | UI behavior | Server enforcement |
|------|-------------|--------------------|
| Can't go back to a submitted level | Back button is replaced by redirects; no links to old nodes | Every node request is checked against the participant's node pointer and level status |
| Only the team lead can lock the repo | Non-leads see a read-only status | `403` for non-leads; unique constraint on one choice per team |
| Next level starts only when allowed | Start button disabled, with reason | `GET .../gate` is checked again on entry; the execution content isn't served without it |
| Level timer | Countdown and warnings | Server time and deadlines; late requests rejected or auto-submitted |
| One submit per level | Confirmation pop-up, then redirect | Idempotent submit; a second submit returns the original receipt |
| Score and rank | Display only | Computed from the immutable ledger |

### 2.2 Progression and "no going back"
- Each participant has a **node pointer** held by the server (for example `L2_EXPLAIN`). It only moves forward.
- After a level is submitted (manually, or automatically at timer end), its nodes are locked for that participant. The Dashboard stays reachable at all times.
- Navigation uses `history.replace` after submit, and a route guard redirects any attempt to open an older node to the current node with a message: "You've already submitted Level 1."
- The Dashboard's **Event page / Resume** button always goes to the node pointer's page.

### 2.3 Timers and warnings
All times come from the server. The client estimates the offset between its clock and the server's (lowest-latency sample) for **display only**.

| Moment | Where it shows | Message (default) | Style |
|--------|----------------|-------------------|-------|
| 2 min before a level or node starts | Any event page | "Level N starts in 2 minutes." | Banner, dismissible |
| Level 1: repo not locked by the lead before start | Explanation page | "Choose your repo now." + scroll to the lock section | Blocking alert for the lead; banner for members |
| 5, 3 and 1 min before an execution deadline | Execution pages | "Your work will auto-submit in N minutes." | Toast + banner; 1 min is persistent |
| Last 1 min of an explanation page | Explanation pages | "Time is almost up. Head to the execution page." | Banner |
| Timer reaches 0 on an execution page | Execution pages | "Time's up. Auto-submitting…" then redirect | Modal, no dismiss |

**Auto-submit is performed by the server**, not the browser (see §5.6). The client only shows the warnings and flushes the last draft before 0.

### 2.4 Saving and resuming work
The original notes say work should be saved in cookies. **Cookies are the wrong tool** (about 4 KB each, sent with every request, and unsuitable for code). We keep the same behavior using:

| Layer | Stores | Purpose |
|-------|--------|---------|
| IndexedDB (per user, per level) | Open files, split layout, cursor/scroll, flag drafts, edited files (Levels 3-4) | Instant restore after refresh or dashboard visit |
| Server drafts | Same content, versioned | Survives browser loss, enables auto-submit |
| Session cookie | Only the refresh session | Sign-in |

- **Save triggers:** every ~10 s while changing, on file switch, on panel close, on `visibilitychange`, and before leaving to the Dashboard.
- **Restore:** compare local and server drafts; use the newest `updated_at`; if they differ by more than a few seconds, show "Restored your latest work".
- **Clear rule:** previous-level local data is deleted **only after the server acknowledges the submission** (`202` receipt), not when the button is clicked.
- **Status chip** in the workspace shows one of: *Saved locally*, *Saved to server*, *Submit queued (not accepted yet)*, *Submission accepted*. A queued submit is never shown as accepted.

### 2.5 Live data (score, leaderboard, progress)
D1 uses **polling**, not push. The original wording ("server sends data every time") is satisfied with a version check:

| Data | Endpoint | Poll interval (default) | Behavior |
|------|----------|-------------------------|----------|
| Team score | `GET /v1/team/score` | 5 s during levels, 30 s otherwise | Returns the score and a `version`; UI animates on change |
| Leaderboard | `GET /v1/leaderboard?since=<version>` | Same | `304` if unchanged; otherwise the full snapshot, cached in memory and IndexedDB |
| Progress / node states | `GET /v1/progress` | Same, plus after every submit | Drives the progress bar and Dashboard cards |

An update also triggers immediately after a submit. Push (SSE) can replace polling later without UI changes.

### 2.6 Devices, accessibility and performance
- **Execution pages are desktop-only** (minimum 1024 px width, default). On smaller screens show "Open on a laptop to take part." Informational pages are responsive.
- Supported: current Chrome, Edge and Firefox (default).
- **Keyboard:** everything reachable. The progress bar expands on hover **and** on focus or tap; a pin button keeps it open.
- **Motion:** the progress-bar expansion and the workspace slide respect `prefers-reduced-motion` (replace with fades or instant states).
- **Modals** trap focus and return it on close. The 7-second confirm cooldown is announced politely to screen readers.
- Warnings and score changes use polite live regions. Don't rely on colour alone.
- Monaco is lazy-loaded only on execution pages.

---

## 3. Shared components

### 3.1 Progress bar
**Purpose:** show where the participant is in the whole event, with the countdown for their current level and node.

| State | Appearance | Content |
|-------|------------|---------|
| Collapsed (default) | Thin line (about 4 px) fixed to the top. A filled segment grows left to right to show overall progress. Small ticks mark nodes | Only the line. A small countdown chip appears once ≤ 5 min remain (suggested, so warnings have an anchor) |
| Expanded (hover, focus, tap or pin) | Translucent panel with a blur behind it, attached to the top | Current level and node, the countdown, every level with its nodes (explanation, execution), a state icon per node (locked, available, current, submitted, auto-submitted) and a one-line description per node |

- Expands within about 150 ms; collapses about 800 ms after the pointer or focus leaves (unless pinned).
- Updates from `GET /v1/progress`; never from local guesses.
- **Accessibility:** a `nav` landmark labelled "Event progress", with a list inside. The collapsed line exposes the percentage as text for screen readers.
- Appears on every event page (explanation and execution pages, Dashboard).

### 3.2 Countdown
One component, used by the progress bar and the pages. Takes a server deadline and shows `mm:ss` (or `hh:mm:ss`). It never decides lateness. When it reaches 0 it asks the server for the new state instead of acting alone.

### 3.3 Confirmation modal
Centered, dimmed backdrop, focus trapped. Default focus on the *safe* button. `Esc` equals the safe button. Used for repo lock, level submit and flag deletion.

### 3.4 Workspace shell (Levels 1-4 execution)
```
┌ Header: Rules | Explain | Dashboard   [timer]   [status chip]   [Flag ▲] ┐
├ Progress bar (auto-collapse) ──────────────────────────────────────────────┤
│ Sidebar  │  Editor pane 1   │  Editor pane 2 (optional split)              │
│ (repo    │                  │                                              │
│  tree)   │                  │                                              │
├──────────┴──────────────────┴──────────────────────────────────────────────┤
│ Flag panel (Levels 1-2) / Build output + Submit (Levels 3-4)               │
└────────────────────────────────────────────────────────────────────────────┘
```
- **Sidebar:** repo tree, collapsible, keyboard navigable, shows only the team's chosen repo. File search (Levels 3-4).
- **Editor:** Monaco. Up to **two panes** side by side; each pane has tabs (cap open tabs, default 8). Dispose models when tabs close.
- **Levels 1-2:** read-only. **Levels 3-4:** editable.
- **Header buttons:**
  - *Rules*: that level's rules plus event rules.
  - *Explain*: what to do in this level plus **one worked example in the team's own repo**.
  - *Dashboard*: leaves the workspace. Work is flushed and saved first.
- Rules and Explain open without losing workspace state (side panel or a route that restores the workspace on return).

### 3.5 Flag panel (Levels 1-2)
**Reveal behavior:** the Flag button reveals the panel sitting at the bottom of the screen. The workspace and sidebar move up as if they were a cover lifting off it. Implementation: animate a vertical translation and clip, while Monaco re-lays-out for the remaining height. Keep the selected line visible. If the user prefers reduced motion, switch instantly. (If the slide hides too much code in testing, shrink the workspace instead of translating it.)

**One flag form:**
| Field | Behavior |
|-------|----------|
| File | Autofilled with the active file's path. Editable, with suggestions from the repo tree. Must match a real file |
| Lines | Autofilled from the current editor selection (for example `12-18`). Editable as `12` or `12-18`. Must lie within the file |
| Explanation | Free text, plain text only. Placeholder is a random line from a **pool of funny explanations**, chosen when the flag is created and fixed for that flag. A placeholder only; it is never submitted and never counts as input |
| Level 2 only | **Locations list:** a flag can hold several `(file, lines)` entries. "Add location" adds a row; each can be removed. The explanation covers the whole bug |

**Panel controls:**
- Flags appear as tabs or a list, with **+** to add a new one and a delete action (with confirmation) per flag.
- Inline validation per flag: valid, incomplete, invalid (with reason). Defaults: explanation minimum 10 and maximum 1000 characters; per-level flag cap configurable.
- **Submit level** button. Allowed with zero flags after an extra warning.

**Sample placeholder pool** (the content team will extend it; keep them harmless and short):
- "This line has been acting suspicious since the last commit."
- "Found it. It was hiding behind a semicolon."
- "Gut feeling. Mostly caffeine."
- "I'd bet my lunch this line is guilty."
- "This line looked at me funny."

### 3.6 Level gate (Start button on explanation pages)
- On click and every 5 s while waiting, the client calls `GET /v1/levels/{n}/gate`.
- Response: `{allowed, reason, waiting_on[]}`. The button shows the reason, for example "Waiting for 2 teammates to finish Level 2: Asha, Ravi."
- States: *Disabled (waiting)*, *Enabled*, *Checking…*, *Level closed*.
- The server re-checks on entry to the execution page; the client check is only for the button.

### 3.7 Team score and leaderboard widgets
- **Team score card:** score, last-updated time, subtle animation on change, live region announcement ("Team score is now 140").
- **Leaderboard:** rank, team name, score; your team highlighted and pinned if outside the visible rows. Reorders with animation when the version changes. Respects the round's mode (live, frozen, hidden) with a visible banner for frozen or hidden. Tie-break order is published on the Event details page.

---

## 4. Pages

### 4.1 Landing page
**Purpose:** welcome, orient, and lead to sign-in.

**Content (top to bottom):**
1. Event name.
2. Countdown to the event start (server time). At 0 it changes to "The event is live".
3. **Sign in** button (the only account action; no registration).
4. Event brief.
5. Rules brief.
6. Link: **Event details page** (explains how it works, how to take part, how to win, scoring, roadmap).
7. Link: **Level 1 explanation page** [OPEN: public preview or sign-in only; see D-08].

**States:** before start, live, ended. If already signed in, the sign-in button becomes "Go to dashboard". Content loads from public cacheable event metadata.

### 4.2 Sign-in
- Account details come from the organizers (invite-based). [OPEN: credentials format; D-09].
- States: loading, wrong credentials (generic message), rate-limited, account not on the list, first sign-in requires acceptance of the rules/consent version (re-shown if rules change).
- Success goes to the Dashboard (or back to the page the user came from, if allowed).

### 4.3 Dashboard
**Layout:**
- **Top:** team name; participant name after sign-in; team info in a corner (members, lead badge, repo choice once locked, each member's level status); progress bar.
- **Cards:**
  - Team score (live).
  - Leaderboard (live, cached).
  - Level status list: each level shows *upcoming, available, in progress, submitted, auto-submitted*.
  - **Resume** button with a dynamic label (for example "Resume: Level 2 execution") leading to the node pointer's page. If the event hasn't started or the participant is finished, it says so.
  - Link to the **Event details page** (the same page as on the landing page).
- **Important behavior:** arriving from a workspace flushes the draft first. Returning to the node page restores exactly where the user was (§2.4).

### 4.4 Event details page
One page, linked from the landing page and Dashboard. Sections:
1. Overview
2. How the event works (four levels, nodes, timers; a simple diagram)
3. How to take part (sign in, teams, the team lead's role)
4. Scoring (what earns points at each level; AI/output components if used [OPEN: D-04]; penalties; caps)
5. How to win (ranking and tie-breaks)
6. Road map (timeline of levels with times)
7. Rules summary and link to full rules
8. FAQ and support contact

### 4.5 Level 1 explanation page (also contains the repo lock)
**Purpose:** first page of the real event. Explain Level 1 and let the team lead lock the repo.

**Content:**
1. Progress bar (extended view lists every node in the level and the full event with short descriptions).
2. Countdown (attached to the progress bar).
3. Level 1 explanation: how it works, target, screenshots.
4. **Project cards** (two): each has the app description and brief working, the stack, and a **Know more** button.
5. **Lock section** at the bottom.

**Know more pages:** one per option. Each shows the project README and related details, with a **Back** button to the explanation page. Selections and scroll position are preserved on return (kept in session state). Teams may visit both and the Rules before deciding.

**Lock section (team lead only):**
- Caution box: "Choose one repo to work with throughout this entire event. It can't be changed at any cost!"
- Two radio options (one per stack).
- A **checkbox** to confirm the choice.
- A **Lock the repo** button, disabled until an option is selected and the checkbox is ticked.
- Pressing it opens a centered modal: "Are you sure? This can't be changed later." Buttons: **No, wait** (default focus) and **Yes, confirm**. *Yes, confirm* is disabled for **7 seconds** with a visible countdown ("Yes, confirm (7)").
- On confirm: `POST /v1/team/repo-lock`. Success shows the locked repo and continues to the Level 1 execution page (when it opens; see below).
- **Non-leads** see the same page with the lock section read-only: "Your team lead will lock the repo" or "Locked: Option A by Name".

**Timing and warnings:**
- 2 minutes before the level starts, everyone gets a start warning.
- If the lead hasn't locked by the time the countdown ends, the lead gets a blocking alert ("Select your repo right now") and the page scrolls to the lock section. Members see "Waiting for your team lead".
- [OPEN: what happens if the lead never locks; D-06]. Recommended: execution stays blocked, and an organizer can set the choice or an auto-lock default can apply after a grace period.

### 4.6 Level 1 execution page
Uses the workspace shell (§3.4) in **read-only** mode with the flag panel (§3.5). Entry requires: the repo is locked and the Level 1 gate allows it.

**Submit flow:**
1. User presses **Submit level**.
2. A pop-up warns that they can't go back. Buttons: Cancel / Submit.
3. The client sends the submission with an idempotency key. The server validates and stores it for **this participant**; each team member submits their own flags.
4. The backend evaluates each member's flags and gives marks; the **team total adds up as each member's submission is evaluated**; the Dashboard, leaderboard and progress bar update.
5. On receipt (`202`), local data for Level 1 is cleared and the user is redirected (replace) to the **Level 2 explanation page**.

**Auto-submit:** at 5, 3 and 1 minute before the deadline the user sees a warning that flags auto-submit at 0. At the deadline the server submits each unsent member's latest server-saved draft (§5.6).

### 4.7 Level 2 explanation page
- Progress bar with countdown; explanation, target and screenshots for Level 2.
- At the last 1 minute: "Time is almost up. Go to the execution page."
- **Start** button, enabled by the gate (§3.6). The backend is asked every time. The message comes from the backend response.
- Entering leads to the Level 2 execution page.

### 4.8 Level 2 execution page
Same as Level 1 execution with one difference: a flag can contain **several locations** (files and line ranges) belonging to one bug. Submit goes to the **Level 3 explanation page**. Auto-submit warnings and behavior are the same.

### 4.9 Level 3 explanation and execution
**Explanation page:** same structure as Level 2 (progress bar, countdown, explanation, screenshots, 1-minute warning, gated **Start**).

**Execution page:** Workspace shell in **editable** mode.
- The Monaco editor edits the team's repo to **fix all bugs plus the side quest** [OPEN: define the side quest; D-11].
- **Build/Run** button: sends a run job to the backend, which executes it on the isolated runner (§5.7). Output (stdout, stderr, exit status, why it stopped) appears in a bottom output panel as plain text. Limits shown (timeout, runs left this minute).
- Header: Rules / Explain / Dashboard as before.
- **Submit** button opens an upload dialog:
  - Accepts a **.zip or .diff/.patch** file.
  - Shows file name, size and basic checks (type, size limit).
  - Recommended extra: an **Export my changes as .diff** button that produces the file from the IDE's saved workspace, so users don't have to create a diff by hand in a browser-only IDE.
  - Then the locking warning: "You can't return to this level after submitting."
- On acceptance, redirect (replace) to the **Level 4 explanation page**.
- Auto-submit warnings at 5, 3 and 1 minutes. At 0 the server submits the last saved workspace state [OPEN: what auto-submit sends when the participant uploaded nothing; D-07].

### 4.10 Level 4 explanation and execution
**Explanation page:** same pattern as Level 3.

**Execution page:** same setup as Level 3 (editable Monaco, backend compile, repo sidebar). The task is to **write tests and update the docs**.
- Submit uses the same zip or diff upload.
- After submit, redirect to the **Dashboard**. Level 4 cannot be reopened.
- [OPEN: how tests and docs are evaluated; D-04, D-05].

### 4.11 Rules and Explain pages (per level)
- **Rules:** level rules plus event rules. Reachable from every execution page and explanation page.
- **Explain:** what to do in this level plus one worked example **in the team's chosen repo**, so content is keyed by `(level, repo option)`. Both options need their own worked examples.

---

## 5. Technical design

### 5.1 Routes and guards
| Route | Page | Guard |
|-------|------|-------|
| `/` | Landing | Public |
| `/login` | Sign-in | Public |
| `/event` | Event details | Public |
| `/dashboard` | Dashboard | Signed in |
| `/level/1/explain` | Level 1 explanation + lock | Signed in |
| `/level/1/repo/:option` | Know-more (A or B) | Signed in |
| `/level/:n/run` | Execution page | Node pointer = this node, gate allowed |
| `/level/:n/explain` | Explanation | Node pointer is this node or later; submitted levels redirect forward |
| `/level/:n/rules`, `/level/:n/guide` | Rules and Explain | Same level access |

Route guards are a convenience. Every data endpoint repeats the check.

### 5.2 Node state machine (per participant)
```
LANDING → DASHBOARD  (not a node; always reachable)
L1_EXPLAIN → (repo locked by lead) → L1_EXEC → L1_SUBMITTED
→ L2_EXPLAIN → (gate) → L2_EXEC → L2_SUBMITTED
→ L3_EXPLAIN → (gate) → L3_EXEC → L3_SUBMITTED
→ L4_EXPLAIN → (gate) → L4_EXEC → L4_SUBMITTED → DONE
```
Node status values: `LOCKED`, `AVAILABLE`, `IN_PROGRESS`, `SUBMITTED`, `AUTO_SUBMITTED`, `MISSED`.

### 5.3 API (draft, aligned with the architecture's `/v1` conventions)
| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `POST /v1/auth/login`, `/refresh`, `/logout` | Sign-in | As in the architecture |
| `GET /v1/me` | Name, team, role (lead or member), consent state | |
| `GET /v1/event` | Event name, times, level schedule | Public subset cacheable |
| `GET /v1/progress` | Node pointer, node states, deadlines, server time | Drives the progress bar |
| `GET /v1/team` | Team name, members, per-member status, repo choice | |
| `GET /v1/team/score` | Score and version | |
| `GET /v1/leaderboard?since=` | Snapshot or `304` | Mode: live, frozen, hidden |
| `POST /v1/team/repo-lock` | Lead locks repo `{option, confirm:true}` | Lead only, once; `409` returns the existing choice |
| `GET /v1/levels/{n}/content` | Explanation, rules, guide for `(level, repo option)` | |
| `GET /v1/levels/{n}/gate` | `{allowed, reason, waiting_on[]}` | Checked on click and on entry |
| `GET /v1/repo/tree`, `GET /v1/repo/files/{path}` | Repo tree and files | Watermarked per participant; team's repo only |
| `PUT /v1/drafts/{level}` | Save workspace and flag drafts (versioned) | |
| `POST /v1/levels/{n}/submit` | Submit level (flags, or upload reference) | `Idempotency-Key` required; one effective submit |
| `POST /v1/uploads` | Upload zip or diff (Levels 3-4) | Strict limits; see §5.8 |
| `POST /v1/runs`, `GET /v1/runs/{id}`, `POST /v1/runs/{id}/cancel` | Build/Run | Per-participant limits |
| `GET /v1/time` | Server time | |

### 5.4 Data model additions
| Table / field | Purpose |
|---------------|---------|
| `teams`, `team_members` (role: lead or member) | Team structure within an event |
| `team_repo_choices` (team, option, locked_by, locked_at) | One row per team; unique on team |
| `participant_progress` (node pointer, per-level status, timestamps) | Source for the progress bar |
| `level_schedules` (explain_opens_at, exec_opens_at, exec_closes_at per level) | Server-defined timers |
| `drafts` (participant, level, version, payload) | Workspace and flag drafts |
| `flags` (submission, ordered locations as `[{file, lines}]`, explanation) | Level 1-2 reports; Level 2 holds multiple locations |
| `level_submissions` (participant, level, kind, status, auto_submitted flag) | One per participant per level |
| `submission_artifacts` (hash, size, type, storage key) | Zip or diff for Levels 3-4 |
| Score ledger with `component` | As in the architecture; team total = sum over members (with dedupe rule D-02) |

All rows carry `tenant_id`, as the architecture requires.

### 5.5 Gate logic
`allowed = previous level submitted by every teammate (or auto-submitted) AND the node's opens_at has passed AND level not closed`. Returns `waiting_on` (names) when blocked. The result is not cached on the server for more than a few seconds, so a teammate's submit unlocks the team quickly.

### 5.6 Auto-submit
- A **scheduler job** fires at each level's `exec_closes_at`. For every participant without a submission it submits the latest server-saved draft or workspace snapshot, marks it `AUTO_SUBMITTED`, and moves the node pointer forward.
- It is idempotent, and it uses the same code path as a manual submit.
- The browser flushes its last draft just before 0, but the result does not depend on the browser being open.
- Participants see "Time's up, auto-submitting…" and are redirected once the server confirms.

### 5.7 Build/Run for Levels 3-4
- **Path:** browser → API (`POST /v1/runs`) → PostgreSQL job → runner gateway → isolated runner VM → output back by polling.
- **No internet on the runner**, so dependencies (Node packages, Python packages) must be **baked into pinned images** for each stack.
- **What "compile" means must be defined per stack** [OPEN: D-03]. Suggested: build, lint and run the test suite, not run the full stack with live services. Running MongoDB, nginx and a full app per team on a free VM is likely too heavy.
- Practice runs use participant files and sample inputs only; official evaluation runs happen after submission (architecture §8.4).
- Output is plain text, size-capped, rendered as text only.
- Runner outage never blocks saving or submitting; the output panel shows "Running code is unavailable right now."

### 5.8 Upload and evaluation (Levels 3-4)
- **Upload route:** accepts only `.zip`, `.diff`, `.patch`; size cap (default 5 MB), file-count cap, uncompressed-size cap; content-type and magic-number check; stored in a private bucket with its hash.
- **Never unpacked on the API or main VM.** Extraction and patch application happen only on the isolated runner, with path rules (no absolute paths, no `..`, no symlinks, no files outside the repo) and resource limits.
- **Diff** is applied against the frozen base version of the team's repo; a failed apply is reported to the participant with the reason before they confirm.
- **Evaluation:** the evaluator creates official runs (for example hidden tests against the submitted code) and writes the results as score components. Level 4 (tests and docs) needs its own scoring definition [OPEN: D-04, D-05].
- After submit, the participant sees "Submission received, being evaluated". Scores appear on the Dashboard, leaderboard and progress bar as evaluations complete.

### 5.9 Scoring notes
- Levels 1-2 are **one-shot submissions**, so showing the team score as soon as it's evaluated gives little room for probing the answer key. If a level ever allows resubmission, hide per-flag results (architecture INT-01).
- If human review is in the loop, scores update after review, not instantly. The UI shows "Evaluating…" until then.
- Team total adds up as members' evaluations finish. Dedupe across teammates is a decision (D-02).

### 5.10 Security notes specific to this UI
- Flags and explanations are plain text, never rendered as HTML.
- No answer-key data, evaluator details or admin code in the participant bundle.
- Repo files are watermarked per participant; copy blocking is deterrence only.
- Rate limits: flag drafts, runs, uploads and gate checks are limited per participant.
- Repo lock, submit and upload use idempotency keys.

---

## 6. Conflicts with the current architecture and what to change

| # | This spec | Current architecture / docs | Proposed resolution |
|---|-----------|----------------------------|---------------------|
| C-1 | Save work in cookies | Drafts live in IndexedDB plus server drafts; cookies only for sessions | Keep the behavior, use IndexedDB plus server drafts (§2.4) |
| C-2 | **Teams** and a team lead | Platform is participant-centric; no team entity | Add `teams`, `team_members`, team score aggregation, lead-only actions |
| C-3 | Levels 1-4, each with explanation and execution nodes | Docs describe rounds (Round 1 rapid hunt, Round 2 repository hunt) | Map each Level to a configured round; the event concept doc must be updated to four levels |
| C-4 | Participant zip/diff upload | Architecture says file uploads are handled **only by the admin path** | Add a participant upload path with strict limits; unpack only on the runner (§5.8) |
| C-5 | Editable Monaco (Levels 3-4) | Monaco is read-only | Add an editable mode with autosave, dispose rules and tab caps |
| C-6 | Compile on a backend server | Runner is an isolated VM with no internet | Use the runner; bake dependencies into images; define "compile" per stack |
| C-7 | Push updates for score/leaderboard | D1 uses polling | Polling with version check (§2.5); SSE later |
| C-8 | Auto-submit at timer end | Server owns time | Server-side scheduler job (§5.6), not a browser action |
| C-9 | "All participants finished" gate | No gate concept | Add `GET .../gate` and `participant_progress` (§5.5); define scope (D-01) |
| C-10 | Two repo stacks | One challenge package per bug set | Two challenge packages with separate ground truth, equal difficulty |
| C-11 | Team score = sum of members | One award per participant per bug; shared credit must be defined by event rules | Decide team-level dedupe (D-02) |
| C-12 | Level 4 tests and docs | Scoring model covers bug reports and output | Define scoring (D-04, D-05) |

---

## 7. Decisions needed

| ID | Question | Recommendation |
|----|----------|----------------|
| D-01 | Are level windows **global** (same schedule for everyone) or **team-paced**? Does "all your participants" mean teammates only, or every team in the event? | Global schedule; the gate means all teammates submitted (or auto-submitted). Team-paced changes timers, the gate and auto-submit |
| D-02 | If two teammates report the same bug, does the team score twice? | One award per team per bug (team-level dedupe) |
| D-03 | What does "compile/run" mean for each stack, and how heavy can it be? | Build, lint and tests only, with dependencies baked into images |
| D-04 | How is Level 3 scored (output)? Level 4 (tests and docs)? Is AI used for docs? | Level 3: hidden tests. Level 4: tests run against buggy and fixed variants; docs via capped AI assessment with human override |
| D-05 | Submission scoring weights per level | Set per level in configuration; not yet defined |
| D-06 | Lead never locks the repo: what happens? | Organizer can set it; optional auto-lock default after a grace period |
| D-07 | What does auto-submit send at Levels 3-4 if nothing was uploaded? | The server-saved workspace snapshot, exported as a diff |
| D-08 | Is the Level 1 explanation page (and its README pages) public before the event? | Public only for the general explanation; keep repo READMEs behind sign-in so teams don't prepare early |
| D-09 | Sign-in method and account creation | Organizer-created accounts with invites |
| D-10 | How do we keep the two stacks fair? | Same bug count and difficulty, validated by independent solvers |
| D-11 | What is the "side quest" in Level 3? | To be defined |
| D-12 | Level durations and the exact start times | To be defined per event |

---

## 8. Acceptance scenarios

1. A non-lead cannot lock the repo, even by calling the API directly.
2. Two lead clicks at once produce one lock; the second returns the existing choice.
3. "Yes, confirm" cannot be pressed for 7 seconds, and the server still rejects a lock outside the allowed window.
4. Leaving a workspace for the Dashboard and returning restores files, split layout, selection and flag drafts.
5. Closing the browser and reopening restores from the server draft.
6. Local Level 1 data is deleted only after the server acknowledges the submit.
7. After submitting Level 1, typing a Level 1 URL redirects forward; the Dashboard still opens.
8. Warnings appear at 5, 3 and 1 minutes; the server auto-submits at 0 even if the browser is closed.
9. The Start button stays disabled with names while teammates are unfinished and enables shortly after the last one submits.
10. A Level 2 flag with three locations submits and is stored in order.
11. Uploading a zip with `../` paths or symlinks is rejected and nothing is extracted outside the sandbox.
12. A diff that doesn't apply gives a clear error before the participant confirms.
13. When the runner is off, the output panel says so, and saving and submitting still work.
14. Retrying a submit after a lost response returns the original receipt.
15. Score and leaderboard update within the polling interval after an evaluation finishes.
16. Execution pages show a clear message below the minimum width; keyboard-only users can expand the progress bar, add flags and complete the confirm modal.

---

## 9. Build tasks

**Frontend**
- [ ] Route map, guards and the node-pointer redirect logic
- [ ] Progress bar, countdown, warning system, confirmation modal
- [ ] Landing, sign-in, Dashboard, Event details pages
- [ ] Level 1 explanation page with repo cards, know-more pages, lock flow and 7-second cooldown
- [ ] Workspace shell: tree, two-pane Monaco, header, status chip
- [ ] Flag panel with the reveal animation, autofill from selection, multi-location support, funny-placeholder pool
- [ ] Editable Monaco mode, build output panel, upload dialog, "Export changes as diff"
- [ ] Autosave and restore (IndexedDB plus server drafts), clear-after-ack rule
- [ ] Gate button states, leaderboard and team-score widgets with version polling
- [ ] Accessibility, reduced-motion and minimum-width handling

**Backend**
- [ ] Teams, team roles, repo-lock endpoint and uniqueness
- [ ] Level schedules, participant progress, gate endpoint
- [ ] Draft endpoints and the auto-submit scheduler job
- [ ] Level submit (flags, upload) with idempotency
- [ ] Participant upload path, safe unpack and patch-apply on the runner
- [ ] Run jobs for repo builds, images with baked dependencies per stack
- [ ] Per-level evaluation and team score aggregation
- [ ] Leaderboard snapshots with versioning

**Content**
- [ ] Event details page text, rules, per-level explanations with screenshots
- [ ] Worked examples per `(level, repo option)`
- [ ] Two equivalent challenge repos with ground truth and test suites
- [ ] Funny-explanation pool and warning copy

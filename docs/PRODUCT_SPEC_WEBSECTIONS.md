Status: describes the implementation as of 2026-11-22

# Product Spec: Web Sections (Fall Back platform, v1)

This document inventories every user-facing surface that actually exists in the
frontend (`frontend/src/App.tsx` and `frontend/src/pages/`), the states each
surface supports, and the API behaviors each surface exposes to its role. It is
a description of the built product, not a wish list. Anything not built is
listed in "Not implemented in v1" at the end.

Supporting reading: `docs/FRONTEND_DESIGN_DIRECTION.md` (visual system), the
routers under `backend/app/routers/` (endpoint behavior), and
`docs/AI_TOOLING_RESEARCH_AND_DECISION.md` (why AI-assisted scoring is off).

## 1. Platform-wide behaviors

These apply to every surface and come from the API pipeline
(`backend/app/main.py`, `backend/app/errors.py`, `frontend/src/lib/api.ts`).

- Error envelope. Every failure is a single JSON shape:
  `{error: {code, message, request_id, details}}`. The frontend normalizes it
  into `ApiRequestError`, which always carries the code and the request id, and
  every error banner prints both so a participant can quote them at the help
  desk. Unhandled server errors use the same envelope; the raw exception never
  reaches the client.
- Request ids. The backend assigns an `X-Request-Id` to every request (client
  supplied ids are honored) and echoes it on the response. Audit entries store
  the request id, so one screen bug can be traced across logs, audit trail, and
  the browser.
- Sessions. The access token lives in memory only. On reload the client calls
  `POST /v1/auth/refresh` with the HttpOnly refresh cookie, which is scoped to
  the refresh path, SameSite=strict, and secure in production. A 401 with code
  `AUTH_TOKEN_EXPIRED` triggers exactly one silent refresh and one retry of the
  original request; concurrent callers share one refresh. Reuse of a rotated
  token outside the 10 second grace window revokes the whole session family
  (AUTH-04).
- Time. The server owns the clock (TIM-01/02). Surfaces that show a countdown
  fetch `/v1/state` (or `/v1/time` on public pages), compute the offset between
  the server clock and the browser, and render from the corrected clock. Wall
  clock rendering is always Asia/Kolkata (IST).
- Polling. There is no socket layer in v1. Live surfaces poll on fixed
  intervals: participant state every 5 s, assignments every 15 s, submissions
  10 to 15 s, announcements 30 s, leaderboard 20 s, results 30 s, review queue
  8 s, admin live ops 5 s, system health 10 s, audit log 15 s, disputes 20 s.
- Offline. Any fetch that fails before a response is classified as a network
  error with code `NETWORK`. Screens keep the last loaded data and show either
  the full-screen offline banner (chrome level `OfflineBanner`) or the inline
  error banner with a Retry button. Nothing fabricates data while offline.
- Denial. Route guards (`RequireRole`) wait for session restore, redirect
  anonymous users to `/login` with a return path, and render an "Access denied"
  panel (exhibit EX-403) for authenticated users whose role does not match.
  Server-side denials surface as `AUTH_FORBIDDEN` banners.
- Rules gate. Submissions and challenge file access require an accepted rules
  version (`require_rules_accepted`); the lobby offers the Accept button and
  the server rejects protected calls with `RULES_NOT_ACCEPTED` (AUTH gate).

## 2. Shared component inventory

All in `frontend/src/ui/components.tsx`, `frontend/src/components/`, and
`frontend/src/ui/icons.tsx`.

- Chip. Toned label box (muted, signal, ok, warn, danger, info) with small and
  large sizes and an optional title. Used for counts, filters, and metadata.
- StatusChip. Maps a status word to a fixed tone so the same status never
  changes color between screens (for example `matched_auto` is always ok, and
  `rejected_auto` is always danger). Renders `UNKNOWN` for empty values and
  always pairs color with text, never color alone.
- Panel. Bordered case-file panel with optional exhibit number, overline title,
  and action slot. The base unit of layout on every screen.
- ConfirmButton. Two-step inline confirm: first click arms, second click fires,
  auto-disarms after 6 seconds. Used for destructive or irreversible admin
  actions (stage end, dispute resolve, event transitions).
- Button. Primary, ghost, and danger variants, small and medium sizes, with
  visible focus and disabled states.
- Field. Labeled form field with hint text, required marker, and inline error
  slot announced via `role=alert`.
- EmptyState. Magnifier icon, mono title, note text, optional action. Every
  list and panel has one; no screen shows a bare blank area.
- LoadingShell and LoadingLine. Stable layout shells with inline "Loading"
  text that preserve layout instead of skeleton loaders (skeletons are banned
  by the design direction).
- ErrorBanner. Shows the server message, the code, the request id, and Retry.
  Network failures render in the warn tone with the "Connection problem"
  title; server failures render in the danger tone.
- CountdownTimer and useNowTick. 1 Hz tick with server clock offset. Phases:
  normal, warning at 10 minutes, critical at 2 minutes, expired at zero. Phase
  changes are announced once each through a polite live region ("10 minutes
  remaining", "2 minutes remaining", "Time is up"). Critical and warning
  phases pulse; `prefers-reduced-motion` disables the animation.
- PlainMarkdown. Renders the published rules document as styled plain text
  (headings, bullets, paragraphs). It never builds HTML from the source
  string, so the rules page cannot execute markup (EVA-05 discipline applied
  to public content).
- KVRow, SectionHeading, CheckRow. Key-value rows, numbered section headings
  ("01 / THE BRIEF"), and readiness rows that pair a check or cross icon with
  text.
- Chrome: Wordmark, PublicLayout with top navigation, SiteFooter (club name,
  proposed date, coordinators, document links), ConsoleShell with per-role
  navigation and the role chip plus sign-out, RequireRole guard, OfflineBanner.
- StepUp: StepUpPanel (password re-confirmation valid 5 minutes),
  StepUpGateHint chip on gated controls, adminErrorText and downloadCsv
  helpers.
- Icons. 17 bespoke inline SVG stroke icons on a 24 px grid (magnifier, file,
  flag, clock, shield, terminal caret, folder, submit arrow, alert triangle,
  check, cross, user, team, settings, export, link, receipt). No icon library
  and no emoji. `FRONTEND_DESIGN_DIRECTION.md` records 16; the receipt icon
  added for submissions makes 17 in the current file.

## 3. Public surfaces

### 3.1 Landing (/)

- Data: `GET /v1/time` (1 min), `GET /v1/public/event` (1 min). PUB-01 subset
  only: name, status, start and end times, timezone, duration, caps, rules
  version, and the public summary (mode, team size, main score, CTF policy).
  No participant or challenge data is exposed here.
- Content sections: hero with date and venue chips, event status strip (EX-00)
  with server-sourced countdown, the brief with data sheet, the format timeline
  (P1 setup and reconnaissance 30 min, P2 debugging 35 min, P3 repair and CTF
  side quests 60 min, P4 testing and demonstration 25 min, plus the organizer
  managed registration, briefing, and evaluation windows), the scoring split
  (50/30/20 with the capped bonus, penalty, and tie-break summary), side
  quests, conduct and safe harbor, FAQ, and the how-to-enter closing panel with
  the round flow draft > sealed > armed > active > ended > evaluating >
  released.
- States: loading line while the event record loads; error banner with retry;
  "pending publication" state when the API returns `event: null` (shows the
  proposed date label, 6 December 2026, and a pending chip); countdown renders
  once `starts_at` exists, otherwise the server clock is shown.
- Denied: not applicable, public by design.

### 3.2 Rules (/rules)

- Data: `GET /v1/public/rules` (stale after 60 s). Returns the newest rules
  document version, its markdown body, and the frozen timestamp.
- Behavior: renders the authoritative server text verbatim through
  PlainMarkdown. Version and frozen chips appear above the document.
- States: loading shell; error banner with retry; explicit "Rules not published
  yet" empty state when no document exists.

### 3.3 Privacy (/privacy)

- Static v1 notice page describing what the platform stores, what it does not
  do (no trackers, no third-party analytics, first-party cookie only), and the
  deployment and retention context. States: static, no data, no error surface.
  The fuller publication draft lives in `docs/PRIVACY_NOTICE.md`.

### 3.4 Terms (/terms)

- Static v1 terms page: accounts, acceptable use, content and scoring,
  availability and liability, safe harbor. States: static. The fuller
  publication draft lives in `docs/TERMS_OF_USE.md`.

## 4. Entry surfaces

### 4.1 Login (/login)

- Data: `POST /v1/auth/login`. Rate limited 20/min per IP and 10/min per email;
  failures are generic (`AUTH_INVALID_CREDENTIALS`) so the API never reveals
  whether an email exists (ATH-01). Pending accounts get `AUTH_NOT_ACTIVATED`;
  disqualified accounts get `AUTH_FORBIDDEN` with a contact-the-organizers
  message.
- Behavior: redirects already-signed-in users to their role home (participant
  to /app, reviewer to /review, organizer and admin to /admin) or to the path
  they were originally heading for. Session limit of 2 concurrent sessions per
  user (AUTH-10) is enforced by reclaim and eviction, not lockout: a new
  sign-in reclaims zombie sessions (no live refresh token) and, if still at
  the cap, revokes the oldest live session (audited). Sign-in never fails
  because of stale sessions.
- States: idle form; busy state on submit; error banner with the server
  message and code; loading state handled globally by the session restore.

### 4.2 Activate (/activate)

- Data: `POST /v1/auth/activate` with invite token, new password, and rules
  acceptance. Invites are single use and expire after 48 hours.
- Behavior: live password checklist (at least 12 characters, upper, lower,
  digit, symbol; the server enforces the 12 character minimum). The rules
  checkbox records acceptance for the current rules version in the same
  transaction as activation; acceptance cannot be withdrawn. Tokens can be
  pasted or arrive via `/activate?invite=...`.
- States: checklist rows show neutral, pass, and fail; submit stays disabled
  until every check passes and the rules box is ticked; success renders the
  "Account activated" banner with the activated email and a sign-in link;
  failures (invalid, used, or expired token; `RULES_NOT_ACCEPTED`;
  validation errors) render the error banner.

## 5. Participant console (/app, role participant)

Console shell navigation: Lobby, Workspace, Submissions, Results,
Leaderboard. The role chip shows the signed-in email via title and the Sign
out button revokes the session server side and locally.

### 5.1 Lobby (/app)

- Data: `GET /v1/state` (5 s), `GET /v1/config` (60 s stale), `GET
  /v1/announcements` (30 s), plus the identity from `/v1/me`.
- Panels: round clock (EX-01) with stage status, event status, and the
  countdown to start while armed or to the effective end while active or
  paused (effective end includes organizer time adjustments and the grace
  seconds note); readiness checklist (EX-02) with four rows: platform API
  reachable, team assignment (shows team name and join code), rules accepted
  (with the Accept rules action that calls `POST /v1/me/acceptances`), and
  round window open for challenge delivery; schedule phases (EX-03) from the
  published schedule with runner, AI assessment, and CTF cap indicators; team
  panel (EX-04) with join code; announcements (EX-05) with severity chips
  (info, warning, critical) and author and timestamp; console shortcuts
  (EX-06).
- States: loading shells per panel; per-panel error banners with retry;
  "No round configured yet" empty state before publication; "No team record"
  empty state pointing at the organizers desk; "No announcements yet" empty
  state; offline handled by the banner plus retry pattern.
- API behaviors surfaced: effective end time with adjustments, paused chip
  ("Timer stopped"), grace period, rules acceptance gate, announcement
  severities.

### 5.2 Workspace (/app/workspace)

The core surface. Three columns: evidence files (EX-F), code viewer (EX-C),
report desk (EX-R).

- Data: `GET /v1/assignments` (15 s), `GET /v1/state` (5 s), file content via
  `GET /v1/challenges/{id}/files/content?path=...` (30 s stale, rate limited
  120/min server side), server search via `GET
  /v1/challenges/{id}/search?q=...` (min 2 characters, max 50 hits, rate
  limited 30/min), drafts via `GET/PUT /v1/drafts/{challengeId}`, submissions
  via `GET /v1/submissions` (10 s in the drawer).
- File explorer: tree built from the assigned file list (root files plus
  directories such as routes/ and public/), keyboard and screen-reader
  labeled, with the server-side search box and clickable hit list that opens
  the file and scrolls to the line.
- Code viewer: line-numbered plain text, adjustable font 12 to 20 px, find in
  file with match count and jump, line selection model for reports: click sets
  the start line, shift-click or drag sets the range end, keyboard support with
  arrows, Home, End, Enter to set, Shift+Enter to extend. Selection writes
  file path and line range into the report form. Lines are rendered as text;
  challenge content is never executed.
- Report form fields: target file (datalist of assigned files), line start and
  end (span over 25 rejected client side and server side, max_span), category
  (the 12-value taxonomy), claimed severity (optional, informational), title
  (5 to 120 characters), root cause description (20 to 2000 characters),
  impact (up to 500), evidence (up to 2000), suggested fix (up to 500).
- Draft autosave: every 3 seconds when dirty, versioned with optimistic
  concurrency; `DRAFT_VERSION_CONFLICT` reloads the stored draft and shows the
  draft conflict notice telling the user the other tab's version won. Draft
  failures never block the workspace; the next tick retries.
- Submission: `POST /v1/submissions` with an Idempotency-Key generated per
  attempt. Server checks run in order: team membership and team status, rules
  acceptance, idempotency (same key plus same payload replays the original
  receipt even after the round ends; same key plus different payload is
  `IDEMPOTENCY_CONFLICT`), round state (`ROUND_PAUSED`, `ROUND_ENDED`,
  `ROUND_NOT_ACTIVE`) including the grace window, field validation
  (`SUBMISSION_INVALID` with per-field details), challenge assignment and file
  membership (`FILE_NOT_FOUND`), caps (`SUBMISSION_CAP_REACHED`, 12 reports
  per file excluding auto-rejected, 80 per round), and the 20 second per-file
  cooldown (`SUBMISSION_COOLDOWN` with the remaining seconds). Success returns
  202 with the receipt; the UI shows the receipt panel with the code,
  timestamp, status, and a replay marker when the response is a replay.
- Flag tab: `POST /v1/submissions` with kind ctf_flag and the exact flag code
  (4 to 200 characters). Explains that verified flags pay capped bonus points
  and wrong or duplicate codes earn nothing while every attempt is recorded.
  Only accepted while the stage is active.
- Submissions tab: drawer with the newest submissions, receipt codes, coarse
  status chips, and a link to the full history page.
- States: loading assignment shell; "No challenge assigned yet" empty state
  that explains stage status and auto-refreshes (materials appear at armed);
  file and viewer error banners with retry; stage-not-active notice inline in
  the desk (reports and flags only while active; paused explains the stopped
  timer; ended stays read-only); submit busy state; per-field server
  validation errors mapped back onto the form; cooldown, cap, and idempotency
  errors rendered in the submission error banner.

### 5.3 Submissions (/app/submissions)

- Data: `GET /v1/submissions` (15 s). Newest first, up to 200 rows.
- Behavior: counts chips (total, bug reports, flags); table of receipt, kind,
  title plus category, location, received time, and status. Before release the
  server collapses every in-flight status to "received" (INT-01 hidden
  feedback); after release the real status, matched bug code, and visible
  points appear. Rows are keyboard-navigable links to the detail page.
- States: loading shell; error banner with retry; "No submissions yet" empty
  state with the workspace shortcut.

### 5.4 Submission detail (/app/submissions/:id)

- Data: `GET /v1/submissions/{id}` (20 s). Only the author's own submissions
  resolve; other ids return 404 rather than 403 so the API does not disclose
  the existence of anyone else's filing (SEC-02).
- Panels: report as filed (EX-01, all payload fields as plain text with the
  current status chip), verdict (EX-02: matched bug and points after release;
  "Verdict hidden" chip with the receipt-as-proof explanation before release),
  receipt (EX-03, the immutable acknowledgement code).
- States: loading shell; the "Submission not found" combined state for errors
  and unknown ids; released and not-released verdict states.

### 5.5 Results (/app/results)

- Data: `GET /v1/state` (10 s) for the stage id, `GET /v1/results/{stageId}`
  (30 s). The results endpoint returns `released: false` until the stage
  releases feedback for the team.
- Released view: score breakdown (EX-01) with the total, penalties when
  nonzero, and per-component sums (functional tests, code review, evidence and
  report quality, CTF bonus, adjustments); reading-the-numbers panel (EX-02)
  explaining the components and the dispute window; ledger entries table
  (EX-03) with component, reason code, submission receipt, matched bug,
  received time, and points (negative entries in danger tone). Every entry is
  traceable to a receipt.
- States: loading shells; state or results error banners; "No stage to score"
  empty state; "Results are not released yet" panel that keeps polling.

### 5.6 Leaderboard (/app/leaderboard)

- Data: `GET /v1/state` (10 s) for visibility, `GET
  /v1/leaderboard/{stageId}` (20 s).
- Behavior: the frozen stage config (leaderboard_mode hidden) keeps the board
  from participants until release; frozen mode serves snapshots delayed by the
  configured 600 s. Snapshot table: rank, team, score, invalid reports, last
  accepted, with the tie-break order printed under the table (total score,
  then fewer invalid reports, then earlier last accepted finding, INT-12).
- States: loading shell; error banner; "No stage to rank"; hidden-for-this-
  round panel when the mode hides it; "No results published yet" when no
  snapshot exists.

### 5.7 Account surface (shell level)

There is no dedicated account page in v1. Account data lives in three places:
the console shell role chip and sign-out, the lobby team and rules panels, and
the API endpoints `GET /v1/me`, `GET /v1/me/sessions`, `DELETE
/v1/me/sessions/{id}`, and `POST /v1/me/acceptances`. Password reset is
self-service only via the reset request and reset token endpoints (no email
provider in v1; see the incident notes in the operations playbook).

## 6. Reviewer console (/review, role reviewer)

### 6.1 Review queue (/review)

- Data: `GET /v1/review/queue` (8 s). Open and claimed items in priority then
  arrival order, up to 200.
- Behavior: counts chips (in queue, open, claimed, claimed by you), filter
  buttons (all, open, claimed, mine), claim action per open row via `POST
  /v1/review/items/{id}/claim`, then navigation to the item. Claim conflicts
  (another reviewer holds the item within the 10 minute claim timeout) render
  the server message inline on the row. Participant content is listed as plain
  metadata only.
- States: loading shell; error banner with retry (background polling keeps
  retrying automatically); "Queue is empty" and per-filter empty states; claim
  error inline messages.

### 6.2 Review item (/review/items/:itemId)

- Data: `GET /v1/review/items/{itemId}`. Returns the full submission payload,
  the referenced challenge file content with the reported range highlighted,
  the team's total report count, and the item status.
- Behavior: unclaimed items show the claim banner; decided items show the
  "Already decided" banner and lock the desk. The decision form offers the six
  decision types (accept_full, accept_partial, duplicate, reject_invalid,
  unplanned_valid, needs_second_review), the five rubric sliders
  (functionality, root_cause, code_quality, testing, evidence, 0 to 1 step
  0.05), and notes (up to 2000 characters, visible to organizers in the audit
  trail). Submitting calls `POST /v1/review/items/{id}/decision`; success shows
  the "Decision recorded" banner and notes that the ledger application runs in
  the background evaluator job. Claiming from the detail page is possible when
  the reviewer arrived by direct link.
- States: loading shell; unavailable item state (decided elsewhere or deleted)
  with the back-to-queue action; claim conflict error banner; busy states on
  claim and decide.

## 7. Organizer and admin console (/admin, roles organizer and admin)

### 7.1 Operations dashboard (/admin)

- Event picker plus the event lifecycle table (EX-01): create event form
  (name, slug, duration default 180, caps default 50 participants and 12
  teams, timezone Asia/Kolkata), status transitions rendered per the backend
  state machine (draft to configured; configured to ready or back to draft;
  ready to live; live to closed; closed to finalized; finalized to archived)
  with ConfirmButton arming. Going live is blocked server side while any
  readiness item is unchecked (ADM-EV-05), and the error carries the count.
- Live operations (EX-02, 5 s): teams, participant estimate (accounts in
  teams; the API labels it participants_online_estimate and it is not live
  presence), review backlog (open items, warn tone above 10), oldest queued
  job age with dead letter count, app and gt database status chips,
  submission counts by status, and the kill switch chips (runner, AI
  assessment, telemetry from deployment settings).
- Stage control (EX-03): per stage, status chip, start and end times, the
  reason code field (required; the placeholder teaches the format, for example
  "TEC-104 projector outage"), and the actions allowed by status (seal, arm,
  start, pause, end, resume, extend 1 to 3600 seconds). End uses the danger
  ConfirmButton. Release row: Evaluate (requires ended) and Release results
  (requires ended or evaluating) with the ended > evaluating > released >
  final flow note.
- Announcement composer (EX-04): severity select (info, warning, critical) and
  body up to 1000 characters, published to every signed-in console.
- Readiness gate (EX-05): the eight seeded items (load_test_50, gt_isolation,
  backup_restore, pen_test, challenge_audit, dry_run, rules_published,
  runbooks) with check, uncheck, and N/A actions, checked timestamps, and the
  unchecked count chip that warns that going live is blocked.
- Exports (EX-06): server-side CSV downloads for results, submissions, and
  ledger.
- Audit log and chain verification (EX-07, 15 s): newest-first entries with
  seq, time, actor role, action, entity, request id, action filter, load more
  up to 500, and Verify chain which reports intact or broken with scope,
  entries, verified count, and the first break point.
- Disputes (EX-08, 20 s): filings with status, receipt, statement; resolve
  form with outcome (upheld or rejected), resolution note, and optional point
  adjustment which appends a ledger adjustment entry referencing the dispute.
- System health (EX-09, 10 s): both database probes, job counts by status,
  oldest queued job, deployment profile and environment, runner and AI
  assessment switches, and the note that code execution is disabled
  (ADR-010) and scoring is human plus organizer-run tests.
- States: per-panel loading shells, error banners with retry, empty states for
  no events, no stages, no readiness items, no audit entries, no disputes.

### 7.2 Challenge tools (/admin/challenges)

- Step-up gate: creating versions, uploading files, freezing versions, and
  recording test results require a fresh password confirmation valid 5 minutes
  (AUTH-09, ADMIN_STEP_UP_REQUIRED); the panel shows the confirm form, the
  validity countdown, and gated controls carry the step-up chip.
- Create challenge version (EX-01): slug, title, optional instructions
  markdown stored as text.
- Upload source file (EX-02): one file per call, path taken from the filename,
  max 512 KiB, stored inertly as text and never executed (SEC-03), with the
  line index rebuilt for search (FE-04). Freeze version seals it and computes
  the content hash; requires at least one file; frozen versions reject further
  uploads with GROUND_TRUTH_LOCKED.
- Publish to a stage (EX-03): attaches a sealed version to a stage and creates
  the assignment; organizer authority, no step-up needed.
- Ground-truth test results (EX-04): submission id plus tests passed and total,
  enqueues the ledger application (ADR-019 offline evaluation flow).
- Currently assigned challenge (EX-05) read from the assignments endpoint, and
  known challenge ids (EX-06) kept in this browser's localStorage because the
  API exposes no challenge-version listing endpoint.
- States: step-up gate states, per-form busy and error states, upload success
  lines with path and line count, freeze confirmation with the content hash
  prefix, empty states for ids and assignment.

### 7.3 Not found (*)

Any unmatched route renders the NotFound page with a link back to the landing
page.

## 8. Error codes the UI can surface

From the routers and deps: AUTH_RATE_LIMITED, AUTH_INVALID_CREDENTIALS,
AUTH_NOT_ACTIVATED, AUTH_FORBIDDEN (includes the disqualified message),
AUTH_TOKEN_EXPIRED (handled by silent refresh), AUTH_SESSION_REVOKED,
RULES_NOT_ACCEPTED, VALIDATION_ERROR, NOT_FOUND, PATH_INVALID,
ROUND_NOT_ACTIVE, ROUND_PAUSED, ROUND_ENDED, SUBMISSION_INVALID,
SUBMISSION_CAP_REACHED, SUBMISSION_COOLDOWN, FILE_NOT_FOUND,
IDEMPOTENCY_CONFLICT, DRAFT_VERSION_CONFLICT, GROUND_TRUTH_LOCKED,
ADMIN_STEP_UP_REQUIRED, NETWORK (client classified). Every one renders with
the code and request id so the desk can trace it.

## 9. Not implemented in v1

- Per-participant or per-team challenge variants. The assignment model allows
  a team-scoped challenge_version, but the seed publishes one shared version
  for all teams.
- Rounds beyond one main stage. The stage state machine supports ordinals,
  but only one stage is configured and operated.
- Participant file uploads. Only organizers upload content; participants file
  structured reports and flags.
- Automated test execution against participant code. The runner is disabled
  (ADR-010); functional test results are recorded offline by organizers.
- AI-assisted scoring. Disabled by default per DEC-13 until the provider gate
  in the AI tooling document passes.
- Email delivery. Invites and reset tokens are surfaced through the organizer
  console and logs, not an SMTP provider.
- A dedicated account settings page, including the sessions management UI
  (the endpoints exist without a screen).
- Self-service team join by code. Teams and membership are organizer managed;
  join codes are displayed in the lobby for identification at the desk.
- Live presence indicators and sockets. Presence is an estimate from team
  accounts; updates are polling based per the D1 realtime profile.
- An operator endpoint for the final transition (released to final) and for
  marking an account disqualified; both states exist in the model and are
  applied directly by the platform admin when needed.

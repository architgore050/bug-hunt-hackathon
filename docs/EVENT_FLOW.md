Status: implemented in this branch; describes the approved four-level event flow baseline

# Event Flow: the four-level participant experience

Source of authority: the owner-approved implementation baseline (Bug Hunt CTF
Participant Website Specification, event flow section). The flow itself is
finalized; the owner confirmed that its draft label and open annotations do not
permit redesigning the four-level structure. Where the specification leaves an
implementation detail genuinely open, this document records the chosen
development default, marks it provisional, and lists the owner decision in
`docs/KNOWNS_LIMITATIONS_AND_FOLLOWUPS.md` and
`docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md`.

The participant website specification file itself was NOT present in the
workspace for this session. Everything below is implemented from the
orchestrator baseline (four-level flow, gates, repo lock, timers, workspace
behaviors) and the existing platform architecture. Any detail that would have
come only from the missing specification is marked UNRESOLVED in the known-gaps
document rather than invented.

## 1. Terminology

- Team: the scoring unit. Exactly one team lead; members 4 to 5 (event
  configuration). One participant belongs to exactly one team per event.
- Participant: one authenticated person on a team.
- Level: one of the four event stages (Level 1 to Level 4).
- Node: one state inside a level: `explain` or `exec`. Level 1 additionally
  has the repo-lock step before its explain node.
- Flag: one bug report inside a level submission. Level 1 flags carry one
  file/line location; Level 2 flags carry an ordered list of locations.
- Repo option: one of two stacks for the same application (Option A: MERN-style
  Node/Express app; Option B: nginx + FastAPI + SQLite serving the same product
  concept). The team lead locks exactly one, once.
- Gate: the authoritative server check that decides whether a participant may
  enter a node.

Levels map onto the existing `app.stages` rows (`kind = 'level'`, ordinal
1..4). The prior single "main" stage model stays fully supported: existing
endpoints (`/v1/state`, `/v1/submissions`, `/v1/assignments`) behave exactly as
before for one-stage events, and the four-level endpoints are additive.

## 2. Node state machine

```text
LANDING -> DASHBOARD (not a node; always reachable)
L1: LOCKED_REPO? -> L1_EXPLAIN -> L1_EXEC -> L1_SUBMITTED
L2: (team gate + schedule) -> L2_EXPLAIN -> L2_EXEC -> L2_SUBMITTED
L3: (team gate + schedule) -> L3_EXPLAIN -> L3_EXEC -> L3_SUBMITTED
L4: (team gate + schedule) -> L4_EXPLAIN -> L4_EXEC -> L4_SUBMITTED -> DONE
```

Per-level participant statuses: `locked`, `available`, `in_progress`,
`submitted`, `auto_submitted`, `missed`. The pointer column in
`app.participant_pointers` holds the participant's current (level_no, node).
It advances monotonically: the domain module `app/flow.py` owns every legal
transition, and transitions that move the pointer backwards or skip states are
rejected transactionally. After a submit (manual or auto), earlier nodes of
that level are immutable: submit, draft, and content endpoints check the
pointer server-side. Route guards on the client are UX only, never a boundary.

Statuses map to rows in `app.participant_progress` (one row per user and
level). The pointer row is the single source for "where is this participant
right now".

## 3. Gates

`GET /v1/levels/{n}/gate` returns `{allowed, reason, waiting_on[]}`:

- Level 1 additionally requires the team repo lock (see section 4).
- Level N (N >= 2) opens for a participant when: the level window is open
  (stage armed or active and `starts_at` has passed), the participant's team is
  active, and every teammate has submitted or been auto-submitted for level
  N-1.
- The gate is per team, not per event. `waiting_on[]` lists teammate names and
  their per-level status so the UI can explain the wait.
- The endpoint is authoritative at call time; nothing caches a permission
  decision. Clients poll every 5 seconds while waiting and re-check on entry.
- Level windows come from the stage rows (`starts_at`, `ends_at`, status) plus
  the existing `time_adjustments` mechanism, so organizers extend or pause a
  level through the audited stage-control endpoints that already exist.

## 4. Repo lock (Level 1)

- `GET /v1/team` returns the team, members, lead flag, and the locked option
  if any. Non-leads see read-only status: waiting for the lead, or the locked
  option and who locked it.
- `POST /v1/team/repo-lock` with `{option, confirm: true}` and an
  `Idempotency-Key` header:
  - Only the team lead may lock. Non-lead: 403 `AUTH_FORBIDDEN`.
  - Concurrent clicks: one choice wins through the UNIQUE(team_id) constraint;
    later retries with the same idempotency key return the existing choice.
  - A conflicting second option: 409 `REPO_ALREADY_LOCKED` carrying the
    current choice.
  - Locking writes the choice row, creates the four team-scoped assignment
    rows (one per level stage, binding the team to the chosen challenge
    version), advances the team members' pointers into L1 explain, and writes
    one audit entry.
- The lock is immutable for participants. Organizers may set or override it
  through the audited admin endpoint (`POST /v1/admin/teams/{id}/repo-lock`)
  with a reason; the audit trail records the actor.
- Lead-no-lock policy: an explicit event configuration key
  (`levels.lead_no_lock_policy`) selects `manual` (organizer override; the
  blocked state is visible on the dashboard) or `auto_after_grace_s` (server
  auto-locks a configured default option after the disclosed grace window).
  Dev seed uses `manual`. The auto-lock path is implemented and audited; the
  production default remains an owner decision (KNOWN_GAPS).

## 5. Workspace and submissions per level

- Levels 1 and 2: read-only file serving (`/v1/repo/tree`,
  `/v1/repo/files/{path}`) scoped to the team's locked option. Flag drafts
  live in `app.level_drafts` and in the browser's IndexedDB. Flags carry file,
  ordered locations, category, title, explanation and evidence. Level 1: one
  location per flag. Level 2: one to five ordered locations per flag.
- Levels 3 and 4: the same workspace is editable. Edited files accumulate in
  the server draft (full file contents) and locally. Build/Run calls
  `POST /v1/runs`, which answers `503 RUNNER_UNAVAILABLE` because the isolated
  runner is disabled by default (ADR-010 stands; see section 8). Saving and
  submission never depend on the runner.
- `POST /v1/uploads`: multipart upload of `.zip`, `.diff`, or `.patch` for the
  participant's current level. The server enforces extension and declared
  type, size caps (configurable, dev default 5 MB), entry count cap, and
  uncompressed-size cap. ZIP inspection reads the central directory only; no
  entry is ever extracted inside the API process. Entries with absolute paths,
  `..` components, duplicate names, or device/symlink semantics are rejected
  before storage. Stored artifacts are immutable and hashed (SHA-256); the
  storage adapter writes to a private local directory in D0 with an
  object-storage-compatible interface for D1.
- `POST /v1/levels/{n}/submit` finalizes the participant's level work exactly
  once, in one transaction following the platform's ordered pattern
  (identity from token, idempotency reservation, stage row lock, one
  `clock_timestamp()` read, ordered validation, insert submission plus
  artifact binding plus evaluation job plus audit, commit, then 202 receipt).
  - Levels 1 and 2: the payload carries the flag list (possibly empty after an
    explicit zero-flag confirmation flag in the payload).
  - Levels 3 and 4: the payload references one staged artifact (upload) or
    declares that the submission is the server draft itself; the diff against
    the frozen base is computed by the evaluation path, never by the client.
  - After commit the pointer advances to the next level's explain node and the
    per-level status becomes `submitted`. Earlier nodes become immutable.
  - Empty submissions are legal and recorded as explicit empty submissions;
    they are never silently converted into anything else.

## 6. Auto-submit

A durable job (`auto_submit_levels`, enqueued periodically by the worker and
also manually triggerable from the admin console) fires for every level stage
whose effective execution close (ends_at + adjustments + grace) has passed:

- For each participant whose pointer still sits in that level's exec node with
  no accepted submission: the server submits the latest server-saved draft
  (flag list for levels 1 and 2; workspace snapshot plus computed diff for
  levels 3 and 4), marks the per-level status `auto_submitted`, and advances
  the pointer. If the draft is empty, an explicit empty submission is recorded
  under the configured empty-submission policy.
- The job uses the same transactional submission path as a manual submit, the
  database clock read once per transaction, and is idempotent under retries,
  duplicate scheduler runs, worker crashes, and a manual submit racing the
  deadline (the pointer row lock decides the single winner; the loser's
  write is a no-op).
- The browser flushing before zero is best-effort only; the scheduler is the
  authority when the participant is offline or the browser is closed.

## 7. Team, score, and results surfaces

- `GET /v1/progress`: the participant's pointer, per-level statuses, teammate
  statuses (names only, no content), and the team repo choice.
- `GET /v1/team/score`: per-level team totals and the aggregate, derived from
  the ledger (never from client state).
- Leaderboard: the existing per-stage snapshot machinery serves each level
  stage; `GET /v1/leaderboard/{stage_id}` keeps its contract.
- Team-level deduplication stays as built: award claims are unique per
  (stage, team, award unit), so one award per team per bug/root cause is the
  default; the policy key `scoring.team_dedupe` records the choice
  explicitly (dev default `one_award_per_team_per_bug`).

## 8. Runner and AI

- Runner: disabled by default (`features.runner_enabled = false`, ADR-010).
  `POST /v1/runs` answers `503 RUNNER_UNAVAILABLE`; the workspace shows a
  clear disabled state while saving and submissions continue. Enabling the
  runner later requires the isolated-runner security review; the endpoint
  contract is already stable.
- AI assessment: disabled by default (DEC-13). Unchanged in this flow.

## 9. Schedule defaults (synthetic, clearly labeled)

The dev seed ships synthetic level windows (minutes-long) so the whole flow
can be exercised locally. They are NOT event times. The production schedule
(6 December 2026, 180 minutes, Asia/Kolkata) stays an organizer
configuration task before the event is READY; see
`docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md`.

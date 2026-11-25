Status: created 2026-11-25 for the four-level event flow work

# Requirements Reconciliation

This document records source conflicts, the winning rule, the reason, the
implementation consequence, and any owner decision still needed. Precedence
follows the orchestrator baseline: (1) the owner's explicit instruction that
the four-level event flow is the approved implementation baseline, (2) the
participant website specification (attachment), (3) the locked Samvitya /
Fall Back proposal facts, (4) the system architecture and security documents,
(5) other implementation notes and code.

## R1. Two-round / one-stage model vs. four-level flow

- Conflict: `AGENTS.md`, `docs/PRODUCT_SPEC_WEBSECTIONS.md`, and the v1 code
  describe a single main stage ("only one stage is configured and operated");
  the approved baseline specifies Levels 1 to 4 with per-level explanation and
  execution nodes, team gates, and no-backtracking progression.
- Winner: the four-level flow (owner instruction, precedence 1).
- Consequence: Levels are modeled as four `app.stages` rows (`kind='level'`,
  ordinals 1 to 4) plus new progression tables. All v1 endpoints keep working
  unchanged for compatibility with the running frontend and the existing test
  suite; the four-level surface is additive (`/v1/levels/*`, `/v1/team/*`,
  `/v1/repo/*`, `/v1/uploads`, `/v1/runs`, `/v1/progress`).
- Owner decision needed: none on the model; frontend concept PRs must adapt to
  the new endpoints once the owner selects one.

## R2. The participant website specification attachment is missing

- Conflict: the orchestrator baseline makes
  `Bug_Hunt_CTF_Participant_Website_Spec.md` the mandatory primary input for
  the participant experience; the file was not present in this workspace.
- Winner: the orchestrator baseline's own flow description (levels, nodes,
  gates, timers, workspace behaviors, warnings, persistence) is implemented
  directly; nothing from the missing file is invented.
- Consequence: details that could only come from the missing file (exact
  wording, the funny-placeholder pool, the exact panel animation timing, the
  final auto-lock policy, the Level 3 side-quest content, exact level
  durations) are marked UNRESOLVED in
  `docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md` and remain configuration or
  organizer input.
- Owner decision needed: provide the specification file or confirm the
  documented defaults.

## R3. Scoring weights for the four levels

- Conflict: the v1 seed freezes provisional component weights (50/30/20 with a
  capped CTF bonus) for one stage; the baseline forbids hardcoding unapproved
  point weights for the four-level flow and requires
  `CONFIGURATION_REQUIRED` behavior for score finalization when values are
  unset.
- Winner: the baseline rule (no invented production weights).
- Consequence: per-level scoring policy lives in event configuration with
  clearly-labeled dev defaults; the readiness and publication paths require
  organizer-supplied values before results are final. The v1 weights remain
  the dev fixture values and stay marked provisional.
- Owner decision needed: approve production per-level weights, tie-break and
  penalty policy before READY.

## R4. Event schedule values

- Conflict: the proposal fixes the real event facts (6 December 2026, 180
  minutes, offline, teams of 4 to 5); the baseline forbids inventing real
  level times and requires clearly synthetic development windows.
- Winner: both, scoped: proposal facts stay the official preset and appear in
  public copy; level/node windows in the dev seed are synthetic and clearly
  labeled; production schedule configuration is an organizer task.
- Consequence: seed uses short synthetic windows; the readiness checklist
  blocks live transitions until the real schedule is configured.
- Owner decision needed: enter the production schedule before the event.

## R5. Option B challenge content

- Conflict: the baseline requires two repo options with equivalent difficulty;
  the repository contains only Option A content (Papyrus, Node/Express) with
  its ground truth.
- Winner: the baseline requirement.
- Consequence: a development-only Option B fixture (Marina, FastAPI + SQLite
  serving the same product concept) is created with an equivalent bug set
  (same count, severities, categories, point values) and clearly labeled as a
  dev fixture. It is NOT the production challenge. Final A/B repositories and
  ground truth remain organizer deliverables.
- Owner decision needed: supply or approve final challenge packages and have
  two independent reviewers certify equivalence before READY.

## R6. Runner execution

- Conflict: the baseline wants build/run integration for Levels 3 and 4 inside
  an isolated runner; ADR-010 and the existing architecture disable code
  execution until an isolated runner exists, and no such runner is available
  in the current environment.
- Winner: the architecture's safety rule (never execute untrusted code on the
  API host), which the baseline itself endorses ("disable Run by default
  rather than execute submitted code unsafely").
- Consequence: `POST /v1/runs` answers `503 RUNNER_UNAVAILABLE` with a clear
  degraded state; draft saving and artifact submission work regardless. The
  endpoint contract is stable so a runner adapter can be attached later.
- Owner decision needed: approve a runner design and capacity before enabling
  Run for the event.

## R7. Lead-no-lock policy

- Conflict: the baseline requires an explicit event configuration policy for a
  lead that never locks (organizer manual override, or configured auto-lock
  default after a disclosed grace interval) and forbids inventing the option.
- Winner: the baseline rule.
- Consequence: `levels.lead_no_lock_policy` supports `manual` (dev default)
  and `auto_after_grace_s`; when neither is configured and the deadline
  passes, entry is blocked with an organiser escalation state. Auto-lock, when
  configured, is audited and uses a disclosed default option.
- Owner decision needed: choose the production policy and default option.

## R8. Frontend concepts vs. the new API surface

- Conflict: three implemented frontend concept PRs (Incident Archive,
  Recovery Instrument, Failure Atlas) target the v1 single-stage contract;
  the approved baseline requires the four-level experience.
- Winner: the baseline flow; the concepts remain mutually exclusive
  alternatives for the owner to compare (no concept PR is merged by this
  work).
- Consequence: the backend keeps every v1 endpoint stable so all three
  concepts keep running, and documents the four-level endpoint surface in
  `docs/API_REFERENCE.md` plus a per-concept adaptation checklist in
  `docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md`.
- Owner decision needed: select one concept PR to merge and fund its
  four-level adaptation.

## R9. Naming and scope guards (unchanged)

- Echelon stays out of scope everywhere (AGENTS.md).
- The proposal facts (event identity, host, offline mode, date, duration,
  team size) are immutable presets.
- `challenge-app/ORGANIZER_ANSWER_KEY.md` stays restricted and out of every
  participant-facing surface; the Option B fixture ships its answer material
  only inside the sealed gt path in the same way.

Status: implementation plan for feat/participant-four-level-frontend, created 2026-11-26, updated 2026-11-27

# Participant Frontend Event Flow: Implementation Plan

One-page plan for the participant-facing four-level experience. It reconciles
the participant website specification (`docs/design/Bug_Hunt_CTF_Participant_Website_Spec.md`)
with the actual backend in `main` (PR #20 flow). The backend is the authority;
the points-card update adds participant-safe `max_points` and evaluation-state
fields without changing progression or scoring decisions.

## 1. Current state summary

Backend (implemented, 74-test gate): four level stages with a monotonic node
pointer (`explain` / `exec` / `done`), per-level statuses
(`locked/available/in_progress/submitted/auto_submitted/missed`), gates with
`waiting_on[]`, lead-only repo lock (idempotent, one choice per team),
versioned per-level server drafts, read-only repo delivery scoped to the
locked option, multipart artifact staging (zip/diff/patch), idempotent level
submit (202 receipt), server-side auto-submit scheduler, per-level leaderboard
snapshots, RUNNER_UNAVAILABLE run endpoints. One schedule window per level
(there is no separate explain/exec deadline). Dev seed ships synthetic
minute-scale windows and demo accounts (dev only).

Frontend (v1): React 19 + react-router 7 (declarative routes) + TanStack
Query 5 + bespoke case-file design system. Auth = in-memory access token +
`bhctf_refresh` cookie refresh (`X-BHCTF-Client` header), typed `api()` client
with `ApiRequestError` envelope handling, `RequireRole` guard, UI kit (Panel
with EX- numbering, StatusChip, Button, ConfirmButton, Field, EmptyState,
ErrorBanner, CountdownTimer, PlainMarkdown, 17 inline SVG icons). The v1
Workspace is a bespoke div-based code viewer (`.codeview`) with line-range
selection wired to a report form and versioned draft autosave to
`/v1/drafts/{challenge_id}`. No Monaco, no IndexedDB, no toast system.

Gap: the whole four-level journey (dashboard, explanations, gates, repo lock,
per-level workspaces, flag panels, artifact submission, persistence) is not
implemented. This branch implements it against the shipped backend.

## 2. Source-of-truth API/contract map (verified against handlers)

| Page / action | Endpoints (exact contracts in code) |
| --- | --- |
| Session/boot | `POST /v1/auth/login|refresh|logout`, `GET /v1/me`, `POST /v1/me/acceptances`, `GET /v1/time` |
| Dashboard | `GET /v1/progress` (pointer, per-level status+gate, teammates, repo_option), `GET /v1/team` (members, is_lead, lock info), `GET /v1/team/score`, `GET /v1/levels` (stage windows + gate_reason), `GET /v1/leaderboard/{level_stage_id}`, `GET /v1/announcements`, `GET /v1/state` |
| Continue/Resume label + target | Derived ONLY from `GET /v1/progress.pointer` (+ per-level `gate` and `GET /v1/levels` windows); never from local flags |
| Event details | `GET /v1/public/event`, `GET /v1/public/rules` |
| Level explain | `GET /v1/levels/{n}/content` (explain_markdown, instructions_markdown after lock, repo_options[], gate, ends_at_effective, is_lead), `GET /v1/levels/{n}/gate` poll every 5 s while waiting |
| Repo lock (lead) | `POST /v1/team/repo-lock` `{option: "A"|"B", confirm: true}` + `Idempotency-Key`; 409 `REPO_ALREADY_LOCKED` carries `details.option`; same-key replay returns 200 with `replay: true` |
| Workspace entry | `GET /v1/levels/{n}/workspace` (files[], editable, draft, ends_at_effective, limits{max_flags, max_span, max_locations}) |
| Repo files | `GET /v1/repo/tree?level=`, `GET /v1/repo/files/{path}?level=` (400 PATH_INVALID, 404 FILE_NOT_FOUND) |
| Drafts | `GET/PUT /v1/levels/{n}/draft` `{payload, version}`; 412 `DRAFT_VERSION_CONFLICT`; PUT only for the pointer level |
| Flag submit L1-2 | `POST /v1/levels/{n}/submit` `{flags: [{title(5..120), category(12-value taxonomy), description(>=20,<=2000), evidence(<=2000)?, claimed_severity?, locations: [{file_path, line_start, line_end}]}], confirm_empty?}` + `Idempotency-Key` -> 202 `{submission_id, receipt_code, received_at, status:"received", replay, level_no}`; L1 exactly 1 location, L2 1..5 ordered; span <= max_span(25); file must exist; line_end <= line_count + 2 |
| Artifact submit L3-4 | same endpoint with `{artifact_id}` or `{compute_diff: true}`; neither -> 422 `ARTIFACT_REQUIRED`; zero flags with `confirm_empty: true` allowed (empty submission recorded) |
| Upload | `POST /v1/uploads?level=N` multipart `file`; ext zip/diff/patch, <=6 MiB, ZIP central-directory checks -> 200 `{artifact_id, kind, filename, sha256, size_bytes, entry_count, status:"staged"}` |
| Build/Run | `POST /v1/runs` -> 503 `RUNNER_UNAVAILABLE` while disabled (`/v1/config.runner_enabled`) |
| Points/leaderboard | `GET /v1/team/score` returns cumulative points and completed-level `score / max_points`; `GET /v1/leaderboard/{level_stage_id}` uses hidden/frozen/live modes |
| Account | `GET /v1/me/sessions`, `DELETE /v1/me/sessions/{id}` (v1 Account page reused) |

Draft payload conventions the backend reads back (auto-submit + compute_diff):
L1-2 `payload.flags = [...]` (same shape as submission flags);
L3-4 `payload.files = { "<path>": "<full new content>" }` (missing path =
deletion, extra path = new file).

## 3. Route map and guard strategy

```text
/                     Landing (public, add Event details link + live state)
/login                Sign-in (existing)
/event                Event details (public, new)
/dashboard            Dashboard (participant) - primary authenticated landing
/level/:n/explain     Explanation (+ L1 repo lock section, gate Start button)
/level/:n/repo/:a|:b  Know-more page per repo option (L1)
/level/:n/run         Workspace: read-only L1-2 (flag panel), editable L3-4
                      (build panel, upload dialog, submit)
/level/:n/rules       Per-level rules page (content from stage + public rules)
/level/:n/guide       Worked example page (instructions_markdown for locked repo)
/account              Account/sessions (v1 page moved)
```

- Guards are UX only; every endpoint re-enforces authorization and the pointer.
- A single `LevelRouteGuard` resolves `GET /v1/progress` and redirects:
  submitted/older level -> current node (with a one-line reason); future or
  locked level -> current node; `done` pointer -> dashboard. Dashboard,
  `/event`, `/account` remain reachable at all times.
- After accepted submit and after gate-approved entry, `history.replace` is
  used so browser back does not reopen a completed node.
- Old `/app` routes: `/app` -> `/dashboard`; `/app/workspace` -> dashboard
  (v1 workspace retired); `/app/submissions|results|leaderboard|account` keep
  working as compatibility surfaces (level submissions appear in
  `GET /v1/submissions`).

## 4. Component/module ownership

- `src/lib/api-levels.ts` - typed four-level API boundary (all endpoints above,
  request/response types, no `any` at state boundaries). Orchestrator-owned.
- `src/lib/event-session.tsx` - progress/team/levels query hooks + polling
  intervals (progress 5 s while pointer level active, 30 s otherwise; points 5 s
  during levels / 30 s otherwise; gate 5 s while waiting), server clock offset
  via `GET /v1/time` (display only), Continue/Resume derivation.
- `src/lib/persistence.ts` - IndexedDB store (per user+level): tabs, active
  file, scroll/cursor, flag drafts, edited files, schema version. No cookies,
  no credentials, no evaluator data. Orchestrator-owned module, unit-tested
  with an in-memory fake.
- `src/components/event/ProgressBar.tsx`, `Warnings.tsx` (2-min start warning,
  5/3/1-min deadline warnings, last-minute explanation notice mapped to the
  single level window), `ConfirmModal.tsx` (focus trap, safe-action default
  focus, Esc = safe, live cooldown announcement, reusable 7 s pattern).
- Dashboard: `src/pages/participant/Dashboard.tsx` + `src/components/dashboard/*`
  (cumulative points card with completed-level score fractions, leaderboard
  card with hidden/frozen banner, level list, Continue/Resume CTA).
- Explanations + repo lock: `src/pages/participant/LevelExplain.tsx`,
  `LevelKnowMore.tsx`, `LevelRules.tsx`, `LevelGuide.tsx`,
  `src/components/lock/RepoLockSection.tsx` (7 s cooldown, idempotent lock).
- Workspace: `src/pages/participant/LevelWorkspace.tsx` shell reusing the v1
  `.codeview` viewer read-only (L1-2) with `FlagPanel` (autofill file/lines from
  selection; L2 ordered multi-location rows); editable L3-4 with a lightweight
  in-house editable editor (textarea + line gutter, case-file styling), build
  output panel (RUNNER_UNAVAILABLE honest state), upload dialog, export-diff.
- Subagents own disjoint file sets above; orchestrator owns shared infra
  (App.tsx routes, api client, event-session, persistence, workspace shell).

## 5. Autosave/restore and submission lifecycle

- Local writes debounce 800 ms; flush triggers: tab/file switch, panel close,
  `visibilitychange` hidden, route leave to dashboard, before submit, and a
  10 s heartbeat while dirty.
- Server draft PUT carries the version; 412 `DRAFT_VERSION_CONFLICT` refetches
  and reconciles (newest valid state wins; equal timestamps prefer server;
  conflict banner when materially different, never silent loss).
- Restore on workspace entry: local IndexedDB first (fast), then server draft;
  restore the newer revision; show "Restored your latest work" when a draft
  was applied.
- Save chip: `Saving...` -> `Saved locally` -> `Saved to server (vN)`;
  submit shows `Submit queued` until the 202 receipt, then
  `Submission accepted (receipt CODE)`; failures show `Save failed - retry`.
  A queued submit is never shown as accepted.
- Clear-after-ack: local per-level data is deleted ONLY after the 202 receipt;
  ambiguous/network-failed submit keeps everything and retries with the SAME
  idempotency key (replay returns the original receipt).
- Deadline: countdown reaches 0 -> flush draft, show "Time's up.
  Auto-submitting..." (no dismiss), poll progress until the pointer advances
  (server-owned auto-submit), then `history.replace` to the next node. The
  browser never marks a level submitted by itself.

## 6. Test plan and visual QA plan

- Unit (node --test SSR pattern, in-memory IndexedDB fake): Continue/Resume
  derivation per pointer/status; guard redirect matrix; repo-lock cooldown
  cannot be bypassed; concurrent lock shows canonical choice; L2 locations
  serialize in order; flag validation mirror (chars, span, locations);
  persistence save/restore; reconciliation newest-wins; clear-only-after-202;
  retry-with-same-key on network failure; runner-unavailable disables only
  run actions; upload client checks reject wrong ext/size before upload.
- Static: `npm run lint` (0 errors), `npm run build` clean, `npm test` green.
- Backend: no code change planned; suite run for contract confidence
  (baseline 73/74; `test_ctf_bonus_is_capped` fails on main before any change
  - recorded as pre-existing).
- E2E: `scripts/e2e_journey.py` (46 checks) against a seeded dev stack
  (API 8100 + worker) for the v1 loop, plus a scripted four-level API journey
  (repo lock -> workspaces -> flags -> artifacts -> completed dashboard) with
  curl/python against the same stack.
- Visual QA: real browser screenshots (landing, login, dashboard states,
  L1 explain + lock modal, L1 workspace + flag panel, L2 multi-location,
  L3 editable + build panel, L4 submit, completed dashboard, narrow-width
  informational page, waiting/locked state, runner-unavailable state) using
  the agent-browser skill against the running seeded stack; fixed in-place.

## 7. Spec/backend mismatches and how they are resolved

1. Draft contract: spec drafted `/v1/drafts/{level}`; backend ships
   `GET/PUT /v1/levels/{n}/draft` - we use the backend.
2. One window per level (no separate explain/exec deadlines): explanation
   warnings map to the single level deadline; "level N starts in 2 minutes"
   uses stage `starts_at`.
3. Leaderboard: no event-wide aggregate endpoint; dashboard shows the current
   level stage snapshot (switchable per level) - server-owned, no client math.
4. Repo options: `option_key` is `"A"`/`"B"` (uppercase); card text comes from
   `content.repo_options[]` (label + description seeded), README after lock
   only. Know-more pages render server-provided text; no fabricated content.
5. No `waiting_on` names in `/v1/progress`; gates carry them inside each
   level's `gate.waiting_on[]` (`[{name, status}]`).
6. Upload cap is 6 MiB (config), spec said 5 MB default: 6 MiB used, shown in
   the upload dialog.
7. Two 422 shapes (ApiError envelope vs FastAPI `detail`): the API client
   normalizes both into `ApiRequestError` (code `VALIDATION_ERROR` fallback).
8. `/v1/progress` has no deadlines/server_time: countdowns use
   `/v1/levels[].ends_at` (raw) + `GET /v1/time` offset, and prefer
   `ends_at_effective` from content/workspace when loaded (includes time
   adjustments).
9. Monaco is not in the repository (v1 uses a bespoke viewer): L1-2 reuse the
   existing `.codeview` viewer; L3-4 use a lightweight in-house editable
   editor consistent with the design system. No 40 MB editor dependency is
   added; the spec's Monaco references (C-5) are satisfied by an editable code
   surface with autosave, dispose-on-close tabs, and tab caps.
10. Runner is disabled (ADR-010): Build/Run panel shows the honest unavailable
    state; saving/upload/submit stay fully usable; no fake output.

## 8. Assumptions applied from documented recommendations

- Leaderboard stage choice above; polling intervals per spec defaults (5 s /
  30 s) with TanStack Query.
- Export-diff is computed client-side as a unified diff of edited files vs the
  frozen base (`GET /v1/repo/files/{path}` base content, lazily fetched for
  edited paths only); the server `compute_diff` path remains the default
  submission mode for browser-only participants.
- The `missed` teammate status blocks team gates (backend semantics) and is
  explained verbatim from `gate.reason` text.
- Event details page renders only server-provided data
  (`/v1/public/event`, `/v1/public/rules`, `/v1/levels` windows when
  signed in); genuinely unconfigured content shows a coming-soon state.
- Level 1 explanation is behind sign-in (spec D-08 recommendation).

## 9. Blocked or deferred work

- Push + PR require a valid GitHub credential: the recovered PAT in the upload
  store is rejected by GitHub (`401 Bad credentials`, tested against
  `api.github.com`). All commits are staged on
  `feat/participant-four-level-frontend`; push/PR happen the moment a fresh
  token is provided.
- Production schedule, final challenge content, score weights, side-quest
  content, lead-no-lock policy: existing documented owner decisions; the UI
  renders server state and never invents values.
- SSE/live push, watermarked file rendering, copy deterrence: out of scope
  (polling is the documented D1 pattern).

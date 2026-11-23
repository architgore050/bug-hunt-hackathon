# Frontend Integration Contract & API Surface

**Specification:** Bug Hunt CTF (Event: Fall Back)  
**Host & Organizer:** Software Development Club at VIT Bhopal University  
**Document Status:** Source of truth for all frontend implementations  
**Backend Base URL:** `/v1` (with `/health` at root)  

---

## 1. Global Platform Behaviors & Envelope Standards

### 1.1 Error Envelope (`ApiRequestError`)
Every non-2xx API error conforms to:
```json
{
  "error": {
    "code": "ROUND_NOT_ACTIVE",
    "message": "This round is not active.",
    "request_id": "req-189f72b0",
    "details": {}
  }
}
```
- **Error Codes:** Defined in `backend/app/errors.py` (e.g., `AUTH_INVALID_CREDENTIALS`, `AUTH_NOT_ACTIVATED`, `AUTH_TOKEN_EXPIRED`, `AUTH_SESSION_REVOKED`, `RULES_NOT_ACCEPTED`, `ROUND_NOT_ACTIVE`, `ROUND_PAUSED`, `ROUND_ENDED`, `SUBMISSION_INVALID`, `SUBMISSION_CAP_REACHED`, `SUBMISSION_COOLDOWN`, `IDEMPOTENCY_CONFLICT`, `DRAFT_VERSION_CONFLICT`, `FILE_NOT_FOUND`, `ADMIN_STEP_UP_REQUIRED`, `GROUND_TRUTH_LOCKED`).
- **Placeholder Note:** Codes like `AUTH_RATE_LIMITED` and `SUBMISSION_COOLDOWN` supply remaining seconds in `error.details.n`.
- **Client Presentation:** Error banners must surface both the human message, `code`, and `request_id` for desk tracing.

### 1.2 Authentication & Session Lifecycle
- **Access Tokens:** In-memory bearer token (`Authorization: Bearer <token>`). Short-lived.
- **Refresh Flow:** `POST /v1/auth/refresh` with HttpOnly cookie `bhctf_refresh` (path `/v1/auth/refresh`). Requires CSRF header `X-BHCTF-Client: 1`. 
- **Auto-Refresh:** On 401 with `AUTH_TOKEN_EXPIRED`, client silently triggers refresh, rotates family, and retries the pending request.
- **Concurrent Session Eviction:** Max 2 sessions per user. Oldest zombie or live session evicted by server automatically on login without lockout.

### 1.3 Server-Owned Time Synchronization
- **Time Authority:** Server clock from `GET /v1/time` or `GET /v1/state` (`server_time_ms`, `server_time`).
- **Skew Correction:** Client computes delta: `clockSkew = server_time_ms - Date.now()`.
- **Countdown Tick:** Local 1 Hz tick adjusted by `clockSkew`. Wall clock displayed in `Asia/Kolkata` (IST).
- **Grace Period & Adjustments:** `ends_at_effective` includes both global adjustments and per-user accommodations plus `grace_seconds`.

### 1.4 Polling Cadence (Realtime Profile D1)
- `/v1/state`: 5 seconds
- `/v1/assignments`: 15 seconds
- `/v1/submissions`: 10–15 seconds
- `/v1/announcements`: 30 seconds
- `/v1/leaderboard/{stageId}`: 20 seconds
- `/v1/results/{stageId}`: 30 seconds
- `/v1/review/queue`: 8 seconds
- `/v1/admin/events/{id}/live`: 5 seconds
- `/v1/admin/system/health`: 10 seconds
- `/v1/admin/audit`: 15 seconds
- `/v1/admin/disputes`: 20 seconds

---

## 2. Route & Screen Inventory

### 2.1 Public Surfaces (No Auth Required)
1. `/` — **Landing Page**: Event branding (Fall Back / Bug Hunt CTF), server countdown/status, brief, schedule/phases, scoring breakdown (50/30/20), conduct, rules summary, FAQ, enter/login CTA.
2. `/rules` — **Official Competition Rules**: Server-rendered markdown from `GET /v1/public/rules` with version and frozen chip.
3. `/privacy` — **Privacy Notice**: Platform data retention, logging, and participant rights.
4. `/terms` — **Terms of Use**: Rules of engagement, safe harbor, and liability.
5. `/login` — **Sign In**: Email/password authentication, redirect to role console.
6. `/activate` — **Account Activation**: Token acceptance, password complexity verification, and mandatory rules acceptance.

### 2.2 Participant Surfaces (`/app`, Role: `participant`)
1. `/app` — **Lobby**:
   - Server-synchronized round clock & status (draft, sealed, armed, active, paused, ended, evaluating, released, final).
   - Readiness checklist (API reachable, team assignment, rules acceptance with instant accept button, challenge release status).
   - Live announcements with severity badges.
   - Schedule phases & team join code badge.
2. `/app/workspace` — **Investigation & Filing Workspace**:
   - File Tree Explorer: List assigned files from `GET /v1/assignments`, search lines via `GET /v1/challenges/{id}/search?q=`.
   - Code Inspection Viewer: Line-numbered view, range selector (click start, shift-click/drag end), copy, jump-to-line.
   - Vulnerability Report Filing: Target file, line range (max 25 lines), category (12 taxonomy items), claimed severity, title, root cause description, impact, evidence, suggested fix.
   - Flag Submission Tab: CTF bonus flags (`ctf_flag`).
   - Draft Autosave: Autosave every 3s to `PUT /v1/drafts/{id}`, optimistic conflict detection (`DRAFT_VERSION_CONFLICT`).
   - Idempotency & Cooldown: Client generates unique `Idempotency-Key` per submit; displays cooldown timer on 429 `SUBMISSION_COOLDOWN`.
3. `/app/submissions` — **Submission History**: List of filed reports and flags. Status masked as `received` until release.
4. `/app/submissions/:id` — **Submission Detail**: Plaintext report viewer, HMAC receipt code, post-release verdict & points.
5. `/app/results` — **Scores & Ledger**: Released ledger entries, breakdown by component, penalty tallies.
6. `/app/leaderboard` — **Live/Frozen Leaderboard**: Rank, team, total score, invalid report penalty count, tie-break rules.

### 2.3 Reviewer Surfaces (`/review`, Role: `reviewer`, `organizer`, `admin`)
1. `/review` — **Review Queue**: Claimable submission list filtered by all, open, claimed, mine. Lock timeout (10 min).
2. `/review/items/:itemId` — **Review Desk**: Code comparison, submission payload, 6 decision choices (`accept_full`, `accept_partial`, `duplicate`, `reject_invalid`, `unplanned_valid`, `needs_second_review`), 5 rubric sliders (functionality, root_cause, code_quality, testing, evidence), and reviewer notes.

### 2.4 Organizer & Admin Surfaces (`/admin`, Roles: `organizer`, `admin`)
1. `/admin` — **Operations Control Room**:
   - Event Lifecycle: Status transitions (draft -> configured -> ready -> live -> closed -> finalized -> archived).
   - Live Operations: Online team count, review backlog, job queue age, db health, kill switches.
   - Stage Control: Seal, arm, start, pause, resume, extend (1–3600s), end, evaluate, release.
   - Broadcast Composer: Post announcements with severity (`info`, `warning`, `critical`).
   - Readiness Gate: 8 operational checklist items required before setting event live.
   - CSV Exports: Results, submissions, and audit ledger.
   - Cryptographic Audit Trail: Verification of SHA-256 hash chains.
   - Dispute Resolution: Resolve participant disputes (`upheld`, `rejected`, score adjustment).
2. `/admin/challenges` — **Challenge Authoring & Ground Truth Tools**:
   - Step-up re-authentication (5 min password confirmation window).
   - Challenge version creation, multipart file upload, version freezing.
   - Ground truth test result entry (offline test runner integration).

---

## 3. Detailed Endpoint Specification

| Endpoint | Method | Role | Payload / Params | Response |
|---|---|---|---|---|
| `/v1/time` | GET | public | None | `{server_time_ms, server_time}` |
| `/v1/public/event` | GET | public | None | `{event: {slug, name, status, starts_at, ends_at, timezone, duration_minutes, max_participants, max_teams, rules_version, format}}` |
| `/v1/public/rules` | GET | public | None | `{rules: {version, body_markdown, frozen_at, event_name}}` |
| `/health` | GET | public | None | `{status: "ok"|"degraded", database_app, database_gt, clock}` |
| `/v1/auth/login` | POST | public | `{email, password}` | `{access_token, expires_at, server_time, user: {id, email, name, role, status}}` |
| `/v1/auth/refresh` | POST | cookie | Headers: `X-BHCTF-Client: 1` | `{access_token, expires_at, server_time}` |
| `/v1/auth/logout` | POST | auth | None | `{ok: true}` |
| `/v1/auth/activate` | POST | public | `{invite_token, password, accept_rules}` | `{ok: true, email}` |
| `/v1/auth/step-up` | POST | auth | `{password}` | `{ok: true, valid_until}` |
| `/v1/me` | GET | auth | None | `{id, email, name, role, status, team: {id, name, join_code}, rules_accepted, rules_version}` |
| `/v1/me/acceptances` | POST | auth | `{version?}` | `{ok: true, rules_version}` |
| `/v1/state` | GET | auth | None | `{server_time, round: {id, name, kind, status, event_status, starts_at, ends_at_effective, grace_seconds, paused}, rules_version, announcements_version, leaderboard_version, leaderboard_visibility}` |
| `/v1/config` | GET | auth | None | Safe operational config `{stage_id, grace_seconds, scoring_weights, ctf_bonus_cap_points, limits, schedule}` |
| `/v1/assignments` | GET | participant | None | `{assignments: [{challenge_id, slug, title, version, instructions_markdown, repo_url, codespace_url, stage_id, stage_status, files: [{path, lang, size_bytes, line_count}]}]}` |
| `/v1/challenges/{id}/files/content` | GET | participant | `?path=...` | `{path, lang, content, line_count, sha256}` |
| `/v1/challenges/{id}/search` | GET | participant | `?q=...` | `[{path, line_number, text}]` (max 50) |
| `/v1/submissions` | POST | participant | `SubmissionIn`, Header: `Idempotency-Key` | `{submission_id, receipt_code, received_at, status: "received", replay, team_id}` |
| `/v1/submissions` | GET | participant | None | `[{id, kind, title, file_path, line_range, category, received_at, receipt_code, status, matched_bug_code, points}]` |
| `/v1/submissions/{id}` | GET | participant | None | Single submission payload, receipt, and post-release verdict |
| `/v1/drafts/{challengeId}` | GET/PUT | participant | `{payload, version?}` | `{payload, version, updated_at}` |
| `/v1/announcements` | GET | auth | `?limit=100` | `[{id, severity, audience, body, author, created_at}]` |
| `/v1/leaderboard/{stageId}` | GET | auth | None | `{visible, version, snapshot: [{rank, team_name, score, invalid_reports, last_accepted}], generated_at}` |
| `/v1/results/{stageId}` | GET | participant | None | `{released, total, by_component, penalties, entries: [...]}` |
| `/v1/review/queue` | GET | staff | None | `[{review_item_id, submission_id, kind, title, file_path, line_range, category, received_at, priority, status, claimed_by_me}]` |
| `/v1/review/items/{id}/claim` | POST | staff | None | `{ok: true, claimed_until}` |
| `/v1/review/items/{id}` | GET | staff | None | `{review_item_id, status, submission: {...}, file: {...}, team_total_reports}` |
| `/v1/review/items/{id}/decision` | POST | staff | `{decision, rubric: {functionality, root_cause, code_quality, testing, evidence}, notes?}` | `{ok: true}` |
| `/v1/admin/events` | GET/POST | organizer | Event metadata | List or created `{event_id}` |
| `/v1/admin/events/{id}/live` | GET | organizer | None | Live ops dashboard telemetry |
| `/v1/admin/stages/{id}/control` | POST | organizer | `{action, reason, seconds?}` | `{ok: true, status}` |
| `/v1/admin/events/{id}/announcements` | POST | organizer | `{severity, body}` | `{ok: true, announcement_id}` |
| `/v1/admin/events/{id}/readiness` | GET | organizer | None | 8 operational readiness items |
| `/v1/admin/audit/verify` | GET | organizer | None | `{scope, entries, verified, broken_at, intact}` |
| `/v1/admin/disputes` | GET | organizer | None | List of open disputes |
| `/v1/admin/disputes/{id}/resolve` | POST | organizer | `{outcome, resolution, adjust_points?}` | `{ok: true}` |

---

## 4. Taxonomy & Constant Definitions

### 4.1 Bug Categories (12-Taxonomy)
1. `authentication` — Auth bypass, token flaws, session fixation.
2. `authorization` — IDOR, privilege escalation, role confusion.
3. `injection` — SQLi, command injection, path traversal.
4. `data_handling` — Data leakage, unvalidated input, state desync.
5. `business_logic` — Race conditions, workflow bypassing, negative amounts.
6. `cryptography` — Weak keys, timing attacks, improper hashing.
7. `error_handling` — Stack trace disclosure, fail-open conditions.
8. `api_design` — Mass assignment, improper verbs, missing validation.
9. `rate_limiting` — Denial of service, missing bucket throttling.
10. `concurrency` — Double-spend, dirty reads, missing row locks.
11. `configuration` — Insecure defaults, debug flags in production.
12. `integrity` — Unsigned payloads, tamperable client state.

### 4.2 Review Decisions
- `accept_full`: Full points according to severity/rubric.
- `accept_partial`: Partial points for identified bug with minor inaccuracies.
- `duplicate`: Zero points; earlier report by another or same team already accepted.
- `reject_invalid`: Finding is invalid, working as intended, or out of scope (-5 penalty points).
- `unplanned_valid`: Valid vulnerability discovered that was not in original ground-truth seed.
- `needs_second_review`: Escalation to senior organizer or integrity officer.

### 4.3 Severity Levels
`low`, `medium`, `high`, `critical`

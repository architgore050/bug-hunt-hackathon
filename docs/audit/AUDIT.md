# Bug Hunt CTF — Repository Audit Report (Round 1)

| | |
|---|---|
| **Repository** | `devansh1012007/bug-hunt-hackathon` |
| **Audit baseline (git HEAD)** | `f1412b7eec6c92c4c168fd2b8a58182b34480387` — "Merge pull request #23 from architgore050/docs/design-no-em-dashes" (2026-11-26) |
| **Audit date** | 2026-11-27 |
| **Method** | 17 parallel spec-vs-implementation audit streams (one per baseline document / document half), plus dedicated security and code-quality streams; highest-severity evidence manually spot-checked |
| **Scope** | FastAPI backend (`backend/`), React frontend (`frontend/src`), challenge apps (`challenge-app/`, `challenge-app-option-b/`), docs (`docs/`), build/deploy surface (`scripts/`, configs) |
| **Baseline documents** | 01 Frontend Spec, 02 Backend Spec, 03 Sections & Components Spec, 07 Agentic Framework & Skills, 08 Admin Deep Spec, Bug Hunt CTF System Architecture, 01 Blind Spots & Cautions, D1 Polished Website Build Checklist (PDF), SDC Samvitya Proposal (PDF) |

## 1. Executive summary

The backend transactional core of this platform is genuinely strong: the submission transaction (row lock + single `clock_timestamp()` read), idempotent submissions with HMAC receipts, the append-only score ledger enforced by a DB trigger, ground-truth schema isolation at the SQL-role level (with a real test), refresh-token rotation with reuse detection, and the absence of classic injection/XSS sinks all match the specs' hardest invariants and were verified in code.

Around that core, however, the shipped product does not yet deliver what the baseline documents promise. Only about one in four audited requirement rows fully meets its baseline; the largest blocks (participant workspace levels 3–4, offline stack, admin surface, Answer Authority, integrity subsystem, realtime) are partially implemented or absent. Two findings are CRITICAL:

1. **First-sign-in password claim** (`backend/app/routers/auth.py:79-86`): any registered account that has not yet set a password — including invited staff accounts and disqualified users — can be taken over by anyone who knows the email, because the first typed password becomes the account password and flips status to `active`. The disqualified-status check runs *after* the claim. The code comments acknowledge this as an accepted risk; for staff accounts it is not acceptable.
2. **No participant-facing surface for source-code submission**: the promised four-level flow (editable workspace, build, upload, hidden-test run) is unreachable from the shipped UI — the frontend never calls the level/repo/upload/run endpoints, so the event's core repair-and-test loop (Proposal Parts 3–4, 50% of the main score) cannot happen through the product.

Beyond those, the HIGH-severity concentration is in: authentication/authorization hardening (unvalidated invite `role` letting organizers mint admins, `POST /auth/activate` overwriting existing accounts' passwords, default JWT secret in code, raw reset tokens printed to logs), correctness (participant results double-count penalties; concurrent same-key submissions return 500 instead of the stored receipt), integrity (audit hash chain can fork; live team-score endpoint leaks verdict totals before release), and event-blocking gaps (challenge materials readable before the round window, offline stack missing, finalization gate absent, reviewer rejection never reverses awarded points, no backups, load test never executed).

**Finding totals: 393 — 2 CRITICAL, 63 HIGH, 217 MEDIUM, 110 LOW, 1 INFO.**

### Compliance at a glance (rows as reported by each stream)

| Audit stream | Rows | Fully met | Partial | Missing / not followed | Deviation / N-A |
|---|---|---|---|---|---|
| 01 Frontend Spec §1–2 (spec01a) | 67 | 13 | 14 | 34 | 6 |
| 01 Frontend Spec §3–end (spec01b) | 148 | 0 | 64 | 80 | 4 |
| 02 Backend Spec §0–5 (spec02a) | 84 | 29 | 24 | 9 | 22 |
| 02 Backend Spec §6–end (spec02b) | 104 | 21 | 30 | 37 | 16 |
| 03 Sections Spec §0–3 (spec03a) | 49 | 16 | 17 | 10 | 6 |
| 03 Sections Spec §4–end (spec03b) | 123 | 15 | 61 | 45 | 2 |
| System Architecture §0–6 (archA) | 32 | 16 | 14 | 0 | 2 (D2 N-A) |
| System Architecture §7–end (archB) | 49 | 19 | 14 | 9 | 7 |
| 07 Agentic Framework (agentic07) | 54 | 15 | 17 | 17 | 5 |
| 08 Admin Spec Part 1 (admin08a) | 33 | 2 | 11 | 16 | 4 |
| 08 Admin Spec Parts 2–3 (admin08b) | 45 | 6 | 7 | 23 | 6 |
| D1 Build Checklist, 1st half (checklistA) | 180 | 43 | 74 | 51 | 6 process N-A |
| D1 Build Checklist, 2nd half (checklistB) | 224 | 72 | 73 | 51 | 28 |
| SDC Proposal (proposal) | 37 | 20 | 13 | 1 | 3 ops-only |
| Blind-spots register (blindspots) | 108 | 47 mitigated | 24 partial | 0 unmitigated | 37 N-A |

Taxonomies differ by stream (spec streams use DONE/PARTIAL/MISSING/DEVIATION; the proposal stream uses DELIVERED/PARTIAL/NOT-DELIVERED; the blind-spots stream uses MITIGATED/PARTIAL/UNMITIGATED for the risk register; process/sign-off columns of the build checklist are N-A because they are not code-verifiable).

### What is genuinely solid (repeatedly confirmed across streams)

- Submission transaction: stage lock, single `clock_timestamp()` read, atomic insert, idempotency keys, HMAC receipts, grace windows, caps/cooldowns.
- Append-only score ledger with award-claim arbitration, enforced by DB trigger.
- Ground-truth isolation: separate DB roles, no grants from `app_api`/worker to the GT schema, flags stored HMAC-only, answer key excluded from ingestion — with an actual isolation test.
- Auth hardening present where implemented: Argon2id, refresh-family rotation with reuse detection, concurrent session cap with eviction, generic auth errors (no enumeration), JWT aud/iss pinning.
- No classic injection sinks found: no string-built SQL in the platform code, no `dangerouslySetInnerHTML`, path traversal defended in storage, uploads constrained.
- Honest ops posture: load-test cells labeled UNRUN rather than fabricated; many gaps openly documented in `docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md`.

## 2. Methodology, severity model and caveats

- Each baseline document was audited by a dedicated stream (large documents split in halves) against the code at HEAD `f1412b7`. Every row in the per-stream status tables cites `file:line` evidence actually read by the stream.
- The five highest-severity claims were re-verified manually after the streams returned; all five held (login password claim at `auth.py:79-86`; reset token printed at `auth.py:521`; penalty double-count at `leaderboard.py:105` + `:118`; admin/review routes imported into the single SPA bundle at `App.tsx:16-19`; unvalidated invite role at `admin.py:470-511`).
- Severity: **CRITICAL** = exploitable by an unauthenticated/participant actor, data loss, or a broken core flow; **HIGH** = major spec violation, exploitable-with-preconditions weakness, or event blocker; **MEDIUM** = partial implementation / robustness gap; **LOW** = minor deviation, naming, polish; **INFO** = contextual note.
- Caveats: (1) rows are requirement-weighted, not effort-weighted — a missing one-line check and a missing subsystem both count as one row; (2) the repo self-identifies as D0/D1 v1 and openly documents several gaps — the audit records spec gaps regardless of documentation, but the "documented owner decision" cases are noted as such in the detailed sections; (3) D2/production-only requirements were judged N-A; (4) the two challenge apps intentionally contain bugs for participants — intended challenge bugs were not counted as defects (streams cross-checked `challenge-app/ORGANIZER_ANSWER_KEY.md` and the ground-truth docs), only accidental vulnerabilities that leak beyond their app; (5) the build checklist's sign-off/process columns cannot be verified from code and are N-A.

## 3. Prioritized fix roadmap

Findings are grouped into GitHub issues (label `audit`, milestone "Audit Round 1"). The waves below are the recommended execution order; each wave lists the dedicated issue topics with the underlying finding IDs.

**Wave 0 — security and correctness, before any participant joins (P0)**
1. Close the first-sign-in password claim + staff takeover path (F-S03A-03, F-ARA-17, F-B02B-01, F-BSP-03, F-CKLA-05, F-SEC-03, F-B02A-15) — require invite-token activation, never set passwords at login, re-check status before/after.
2. Fix `POST /auth/activate` password overwrite of existing accounts (F-SEC-02).
3. Validate invite `role` against an allowlist (F-S03A-02, F-SEC-01).
4. Remove default JWT secret from code; fail closed without env secret (F-B02A-03).
5. Stop printing raw password-reset tokens to logs (F-B02A-04, F-BSP-09).
6. Fix penalty double-count in participant results (F-S03B-02, F-QLT-01).
7. Gate `GET /v1/team/score` on stage release — kill the verdict oracle (F-BSP-01).

**Wave 1 — event blockers**
Participant submission surface / four-level flow (F-PRP-01, F-F01B-01, F-AG07-02, F-S03B-06, F-S03B-07); runner + hidden functional tests (F-B02B-02, F-PRP-02); offline persistence stack (F-F01A-01, F-CKLA-02, F-AG07-15, F-ARA-10); outbox dispatcher (F-ARB-01); finalization gate (F-CKLA-06); reviewer-rejection reversal (F-ARB-04); same-key 500 race (F-CKLB-06, F-ARB-05, F-B02A-06); audit-chain fork + checkpoints (F-CKLB-01, F-CKLB-02, F-ARB-06, F-ARB-07); pre-window content access + sealed bundles (F-CKLA-01, F-S03B-05, F-CKLB-07, F-BSP-02); round controls typed confirmation (F-CKLA-08).

**Wave 2 — admin, integrity and ops hardening**
Admin MFA/step-up on destructive ops (F-S03A-05, F-ARA-23, F-CKLA-04, F-AD8A-02, F-AD8A-03); split admin/reviewer code out of the participant bundle (F-CKLB-05, F-F01A-02, F-F01B-02, F-ARA-09, F-AD8A-11); process/DB-role separation for the GT trust boundary (F-ARA-01, F-ARB-03, F-B02A-02, F-B02A-14); tenant scoping (F-AD8A-01); admin route map completion (F-AD8A-04); answer packs + candidate-bug queue (F-AD8B-01, F-AD8B-02); mid-event correction protocol (F-AD8B-03, F-CKLA-07); integrity subsystem (F-S03A-01, F-S03B-04, F-CKLA-03); backups/WAL/restore drill (F-ARB-02, F-CKLB-04); execute the D1 load test (F-CKLB-03, F-AG07-05); activation flow UX (F-S03A-04).

**Wave 3 — quality and spec polish**
TypeScript strict mode (F-QLT-03); service-layer extraction for god routers (F-QLT-02); frontend test program (F-F01B-03); SSE/realtime (F-S03B-01); response envelope (F-B02A-01); practice environment (F-S03B-03); 07 framework reconciliation (F-AG07-01); plus all grouped medium/low findings (per-stream issues).

### Full finding index

The complete index of all 393 findings, ordered by severity, follows. Each row's full evidence, impact and recommended fix are in the dedicated GitHub issues and in the detailed sections below.

#### P0 - CRITICAL

| ID | Severity | Stream | Area | Title |
|---|---|---|---|---|
| F-PRP-01 | CRITICAL | proposal | participant-experience/submissions | No participant-facing surface for the promised source-code submission (Parts 3-4) |
| F-S03A-03 | CRITICAL | spec03a | ATH-01/ATH-02 Login & Activation | First-sign-in password claim allows account takeover of pre-activated accounts and reactivates disqualified/pending ones |

_2 findings._

#### P1 - HIGH

| ID | Severity | Stream | Area | Title |
|---|---|---|---|---|
| F-AD8A-01 | HIGH | admin08a | admin-backend/tenant-scope | No tenant scoping in admin API; cross-tenant queries are not rejected (spec 1.6, patch E.4/R-36) |
| F-AD8A-02 | HIGH | admin08a | admin-lifecycle/security | Irreversible finalization and other destructive lifecycle transitions lack step-up and reason |
| F-AD8A-03 | HIGH | admin08a | auth/admin-signin | No MFA on admin sign-in; first-login password-set enables takeover of invited staff accounts |
| F-AD8A-04 | HIGH | admin08a | admin-frontend/routes | Route map largely unimplemented: ~40 of ~50 admin routes have no page |
| F-AD8B-01 | HIGH | admin08b | backend/gt-schema | Answer-pack data model entirely missing (gt.answer_packs, gt.answer_pack_entries, gt.answer_pack_links; one_active_pack index; two-approver activation |
| F-AD8B-02 | HIGH | admin08b | backend/review+gt | gt.candidate_bugs and the unplanned-bug queue (/challenges/:id/candidate-bugs) missing |
| F-AD8B-03 | HIGH | admin08b | backend/admin+worker | Mid-event correction protocol (patch E.3) not implemented: no impact-preview dry run, no two-approver approval, no announcement preview/leak guard, no |
| F-AG07-01 | HIGH | agentic07 | framework/process | The 07 sub-agent framework (A0-A11) was not adopted; a different build framework was used |
| F-AG07-02 | HIGH | agentic07 | A5 participant frontend | Shipped participant frontend does not implement the approved four-level flow |
| F-ARA-01 | HIGH | archA | System topology / trust domains (§1.3, § | Single participant-facing API process holds the ground-truth DB credential |
| F-ARA-17 | HIGH | archA | Participant session design (§6.1) | Login allows takeover of any account with a NULL password hash |
| F-ARA-23 | HIGH | archA | Admin authentication (§6.4) | Admin plane has no MFA and no Cloudflare Access; step-up is password re-entry only |
| F-ARB-01 | HIGH | archB | realtime/outbox | Transactional outbox has no dispatcher; intents written but never delivered |
| F-ARB-02 | HIGH | archB | backup/DR | No automated backup, WAL archiving, or tested restore |
| F-ARB-03 | HIGH | archB | trust boundaries | Participant-facing API process holds gt_admin credentials and serves gt endpoints |
| F-ARB-04 | HIGH | archB | scoring | Reviewer rejection does not reverse auto-awarded points or release the award claim |
| F-B02A-01 | HIGH | spec02a | Conventions/Response envelope | Success response envelope {data, meta{request_id, server_time}} not implemented on any endpoint |
| F-B02A-02 | HIGH | spec02a | Topology/Process roles | Participant and admin API merged into one process/port/DB role; no separate worker_evaluator/scheduler/runner_gateway roles |
| F-B02A-03 | HIGH | spec02a | Configuration/Secrets | Default JWT secret baked into code; no *_FILE secret support and no boot-time override check |
| F-B02A-04 | HIGH | spec02a | Logging/Security | Raw password-reset token printed to stdout/logs |
| F-B02B-01 | HIGH | spec02b | auth/API-01 | First-login password claim enables account pre-claim takeover |
| F-B02B-02 | HIGH | spec02b | runner/API-11 | Runner protocol (§10) entirely unimplemented; /runs is a stub |
| F-BSP-01 | HIGH | blindspots | integrity | Live team score leak via GET /v1/team/score breaks hidden feedback (verdict oracle) |
| F-BSP-02 | HIGH | blindspots | time | Challenge content readable before the round window opens (no pre-delivery, no starts_at check) |
| F-BSP-03 | HIGH | blindspots | auth | First-login password claim enables takeover of unactivated accounts |
| F-CKLA-01 | HIGH | checklistA | participant/lobby | No encrypted per-participant bundle pre-delivery or timed key release (LB-04a S1, LB-04b, CH-10a) |
| F-CKLA-02 | HIGH | checklistA | workspace/offline | Offline outbox with in-order idempotent replay missing (WS-08a S1) |
| F-CKLA-03 | HIGH | checklistA | integrity | Integrity console and signal catalogue entirely missing (IN-01..IN-06, SIG-01..SIG-05) |
| F-CKLA-04 | HIGH | checklistA | admin/security | Admin plane shares participant origin; no MFA; no 60-min idle sessions (ADM-01a/ADM-01b S1) |
| F-CKLA-05 | HIGH | checklistA | auth/activation | First-login account claiming bypasses invite activation (ATH-02a/02b S2, documented deviation) |
| F-CKLA-06 | HIGH | checklistA | finalization | Finalization gate absent: release not blocked by pending reviews, disputes, or audit-chain verification (RS-03a S1) |
| F-CKLA-07 | HIGH | checklistA | ground-truth | No post-freeze ground-truth correction path with impact preview (GT-05a S1, RS-01a) |
| F-CKLA-08 | HIGH | checklistA | live-ops | Round controls neither broadcast nor typed-confirmation protected (LV-02a S1) |
| F-CKLB-01 | HIGH | checklistB | audit-chain/DB-07a/G3-08 | Audit hash chain can fork under concurrent same-scope writes |
| F-CKLB-02 | HIGH | checklistB | audit-chain/DB-07a/G3-08 | No external signed audit checkpoints despite docstring claim |
| F-CKLB-03 | HIGH | checklistB | load-test/OBS-05a/G4-02/RDY-02 | D1 load test never executed; every results cell UNRUN |
| F-CKLB-04 | HIGH | checklistB | backups/OBS-06a/DB-09a/OBJ-03a/G4-03/RDY | No automated backups, WAL archiving or restore drill |
| F-CKLB-05 | HIGH | checklistB | frontend-build/FEA-01a/PR-02 | Admin and reviewer screens ship in the participant bundle |
| F-CKLB-06 | HIGH | checklistB | idempotency/API-04a/G2-01 | Concurrent same-key submissions return 500 instead of the stored receipt |
| F-CKLB-07 | HIGH | checklistB | bundle-sealing/G2-06 | No per-participant sealed bundles or T0 key release |
| F-F01A-01 | HIGH | spec01a | 2.5/2.6/2.7 Local storage & offline | Offline persistence stack (IndexedDB bhctf-v1, outbox, local drafts) entirely missing |
| F-F01A-02 | HIGH | spec01a | 1.2 Repository layout | Participant bundle ships admin/review consoles; no app split and no CI leak grep |
| F-F01B-01 | HIGH | spec01b | participant/workspace | Levels 3-4 flow (editable Monaco workspace, BuildPanel, uploads, diff export) entirely missing |
| F-F01B-02 | HIGH | spec01b | architecture/bundle | Participant bundle contains admin and reviewer routes (spec MUST NOT) |
| F-F01B-03 | HIGH | spec01b | testing | Section 7 testing program essentially absent (no Vitest/RTL/Playwright/axe/MSW) |
| F-PRP-02 | HIGH | proposal | evaluation/hidden-tests | Predefined and hidden functional tests are manual-only; no automated testing of repaired apps |
| F-QLT-01 | HIGH | quality | data-layer | Participant results totals double-count penalties |
| F-QLT-02 | HIGH | quality | architecture | God routers: business logic, validation and raw SQL all inline; no service layer |
| F-QLT-03 | HIGH | quality | typing | TypeScript strict mode is disabled for the whole frontend |
| F-S03A-01 | HIGH | spec03a | 1.1 Permission matrix / §0 Roles | integrity_officer role and integrity console absent; audit-log row cannot be satisfied |
| F-S03A-02 | HIGH | spec03a | 1.1 Permission matrix / §3 Auth | Organizer can mint admin accounts via unvalidated invite role (privilege escalation) |
| F-S03A-04 | HIGH | spec03a | ATH-02 Activation | Activation flow incomplete: no frontend page, query-string token, no strength meter or breached-password check, no re-request path |
| F-S03A-05 | HIGH | spec03a | ATH-06 Admin sign-in | Admin sign-in has no MFA, no Cloudflare Access, no 60-minute inactivity bound; step-up is password-only |
| F-S03B-01 | HIGH | spec03b | realtime/backend | REALTIME module (SSE /v1/stream) not implemented; all updates are polling |
| F-S03B-02 | HIGH | spec03b | results/backend | Participant results endpoint double-counts penalties |
| F-S03B-03 | HIGH | spec03b | practice | Practice environment (section 8) entirely missing |
| F-S03B-04 | HIGH | spec03b | integrity | Integrity subsystem missing: signals, telemetry endpoint, console, integrity_officer role |
| F-S03B-05 | HIGH | spec03b | challenges/backend | No encrypted bundle pre-fetch or key release; materials served in plaintext at armed |
| F-S03B-06 | HIGH | spec03b | workspace/frontend | Workspace core UX gaps: no Monaco, no multi-tab, no command palette, no offline outbox |
| F-S03B-07 | HIGH | spec03b | lobby/frontend | LB-03 workspace tour missing |
| F-SEC-01 | HIGH | security | authorization | Invite creation accepts any role: organizer can mint admin accounts |
| F-SEC-02 | HIGH | security | authentication | POST /auth/activate overwrites the password of any existing account |
| F-SEC-03 | HIGH | security | authentication | First-login claim flow: NULL password_hash accounts are claimable and disqualified accounts get re-activated |

_63 findings._

#### P2 - MEDIUM

| ID | Severity | Stream | Area | Title |
|---|---|---|---|---|
| F-AD8A-05 | MEDIUM | admin08a | admin-backend/roles | Fine-grained admin roles (author, ground-truth, operator, content editor, super admin, integrity officer, auditor) not implemented |
| F-AD8A-06 | MEDIUM | admin08a | admin-frontend/shell | Shell deviates from spec 1.2: no left nav, environment chip, Cmd-K search, presence, nav badges or degraded status strip |
| F-AD8A-07 | MEDIUM | admin08a | admin-frontend/components | All 20 spec components C-80..C-99 are missing |
| F-AD8A-08 | MEDIUM | admin08a | admin-frontend/ux-rules | Destructive-action pattern incomplete: no EffectPreview, dry run, undo indicator or typed-count bulk confirmation |
| F-AD8A-09 | MEDIUM | admin08a | admin-backend/exports | Exports: fixed kinds, inline delivery (no expiring link) and no audit entry |
| F-AD8A-10 | MEDIUM | admin08a | admin-backend/state-preview | GET /admin/participants/{pid}/state and the /preview, /debug routes are missing (patch E.4) |
| F-AD8A-11 | MEDIUM | admin08a | admin-frontend/architecture | One SPA/origin serves both the participant and the admin console |
| F-AD8A-12 | MEDIUM | admin08a | admin-frontend/pagination | Lists lack totals and cursor pagination; Load more refetches with a bigger limit and views silently truncate |
| F-AD8A-13 | MEDIUM | admin08a | admin-frontend/ux-rules | Sensitive-view rule (red 'Sensitive, access logged' border) not implemented anywhere |
| F-AD8A-14 | MEDIUM | admin08a | admin-frontend/disputes | Disputes not visible to reviewers (spec: /disputes = reviewer or organizer) |
| F-AD8B-04 | MEDIUM | admin08b | backend/evaluator | unplanned_valid decision regenerates review items in a loop with no terminal state |
| F-AD8B-05 | MEDIUM | admin08b | backend/ledger-schema | Ledger origin discriminator (patch R-33) missing |
| F-AD8B-06 | MEDIUM | admin08b | backend/gt-authoring | GT authoring validation gaps: no canonical-file existence check, no line-range bounds, anchor cap 8 vs spec 1-10, award-unit id not generated |
| F-AD8B-07 | MEDIUM | admin08b | frontend/admin | Authoring UX and safety checks absent: no ground-truth page, no matchability check, no overlap warning, no per-bug draft/publish, no answer-authority  |
| F-AD8B-08 | MEDIUM | admin08b | backend/gt-schema | weight_multiplier (patch R-31) missing from the bug model |
| F-AD8B-09 | MEDIUM | admin08b | backend/evaluator | Reviewer acceptance of a never-claimed report scores nothing (manual-decision gap) |
| F-AG07-03 | MEDIUM | agentic07 | A1 spec contract | No machine-checkable API contract (no openapi.yaml, errors.yaml, schemas, copy catalog) |
| F-AG07-05 | MEDIUM | agentic07 | A2 data modeler | Capacity work missing: no 200-user synthetic seed, no EXPLAIN plans, load test UNRUN |
| F-AG07-06 | MEDIUM | agentic07 | A3 participant API | server_time is not carried on every response |
| F-AG07-07 | MEDIUM | agentic07 | A3 participant API | Rate limiting is in-process/in-memory and 429s lack a Retry-After header |
| F-AG07-08 | MEDIUM | agentic07 | A3 participant API | Expected database failures surface as 500 INTERNAL_ERROR instead of 503 |
| F-AG07-10 | MEDIUM | agentic07 | A4 admin API | Live-operation reasons not enforced at >= 10 characters |
| F-AG07-11 | MEDIUM | agentic07 | A4 admin API | Kill switch is environment config, not an audited feature_flags row with cache invalidation |
| F-AG07-12 | MEDIUM | agentic07 | A4 admin API / scoring | reverses_entry_id never used in production code paths |
| F-AG07-15 | MEDIUM | agentic07 | A5 participant frontend | Offline resilience and sync-state UX requirements not implemented |
| F-AG07-18 | MEDIUM | agentic07 | A6 admin frontend | Admin FE hard rules unmet: prod banner, sensitive border, refresh cadence, pagination |
| F-AG07-19 | MEDIUM | agentic07 | A7 runner | Runner not implemented; runs disabled by design (documented waiver) |
| F-AG07-20 | MEDIUM | agentic07 | A8 AI assessor | AI assessor not implemented; disabled by default (documented waiver) |
| F-AG07-21 | MEDIUM | agentic07 | A9 integration | Integration evidence incomplete: no contract suite, no Playwright e2e, no fault tests, load UNRUN |
| F-AG07-23 | MEDIUM | agentic07 | A11 ops/content | Ops/content readiness incomplete: runbooks unrehearsed, content not keyed by (stage, repo option), no compose.lock |
| F-ARA-03 | MEDIUM | archA | System topology (§3.1, §3.3, §4.1-§4.3) | D1 deployment artifacts do not exist (compose, Caddy, cloudflared, Pages routing, systemd) |
| F-ARA-04 | MEDIUM | archA | Component inventory / DB roles (§3.1, §3 | DB role model deviates: no admin_api or read-only evaluator; gt_admin over-privileged |
| F-ARA-06 | MEDIUM | archA | Edge/WAF/headers (§4.4) | CSP, HSTS and Permissions-Policy are not deployed anywhere |
| F-ARA-09 | MEDIUM | archA | Frontend structure (§5.1) | Participant SPA bundle statically includes admin and reviewer screens |
| F-ARA-10 | MEDIUM | archA | Frontend state ownership (§5.2) | No IndexedDB draft buffer or unsent queue; the four-state UI contract is unmet |
| F-ARA-11 | MEDIUM | archA | API contract and versioning (§5.3) | Hand-written API client; no OpenAPI generation, no runtime schema validation, no X-Min-Client-Version |
| F-ARA-16 | MEDIUM | archA | API retry policy (§5.3, §8.1 client side | Client discards the idempotency key on submission failure, defeating lost-response recovery |
| F-ARA-18 | MEDIUM | archA | Participant session design (§6.1) | Access tokens use HS256 instead of the specified EdDSA/Ed25519 |
| F-ARA-21 | MEDIUM | archA | Refresh rotation race (§6.2) | No Web Locks / BroadcastChannel serialization of refresh across tabs |
| F-ARA-24 | MEDIUM | archA | Admin authentication (§6.4) | Sensitive organizer operations (stage control, release, time adjust, ledger correction) skip step-up |
| F-ARB-05 | MEDIUM | archB | submissions/idempotency | Concurrent same-key idempotency requests race to an unhandled 500 |
| F-ARB-06 | MEDIUM | archB | audit | Audit hash-chain head not serialized per event scope |
| F-ARB-07 | MEDIUM | archB | audit | No external signed audit checkpoints |
| F-ARB-08 | MEDIUM | archB | evaluation | Auto-accept enabled by default without the blind-validation gate |
| F-ARB-09 | MEDIUM | archB | evaluation | Evaluator version never recorded; no evaluations entity |
| F-ARB-10 | MEDIUM | archB | challenge lifecycle | Challenge lifecycle state machine partial; publication immutability not DB-enforced |
| F-ARB-11 | MEDIUM | archB | deployment | No D1 deployment artifacts (Compose/Caddy/cloudflared) or ARM64 build validation |
| F-ARB-12 | MEDIUM | archB | observability | Observability signals below the required minimum |
| F-ARB-13 | MEDIUM | archB | challenge delivery | Round-based delivery model replaced by 4-level flow; no encrypted bundle or watermarking |
| F-B02A-05 | MEDIUM | spec02a | Conventions/Error catalog | Error catalog code/status mismatches and missing canonical codes (DRAFT_VERSION_CONFLICT 412 not 409; 413 returns SUBMISSION_INVALID) |
| F-B02A-06 | MEDIUM | spec02a | Conventions/Idempotency | Idempotency store not per spec: scoped (author,key) not (principal,route), no retention, missing on uploads, race yields 500 |
| F-B02A-07 | MEDIUM | spec02a | Conventions/Pagination | Cursor-based pagination absent (no cursor, no meta.next_cursor, no HMAC-signed cursors) |
| F-B02A-08 | MEDIUM | spec02a | Logging/Observability | Structured JSON request logging absent: only startup/shutdown logs, none of the required fields |
| F-B02A-09 | MEDIUM | spec02a | Conventions/Request headers | X-Client-Version minimum-version gate missing (CLIENT_TOO_OLD 426 unreturnable) |
| F-B02A-10 | MEDIUM | spec02a | Request pipeline/Phase 1 | Phase-1 gaps: Content-Length-only body cap, no content-type check, no IP-level rate limit, unvalidated path IDs yield 500 |
| F-B02A-11 | MEDIUM | spec02a | Request pipeline/Reads | Reads do not use read-only sessions with a short statement timeout |
| F-B02A-12 | MEDIUM | spec02a | Configuration | Configuration surface deviates wholesale from spec variable groups (no PG_*/STORAGE_KIND/AI_*/RUNNER_*/SMTP_*/staging/FEATURE_*) |
| F-B02A-13 | MEDIUM | spec02a | Stack/Structure/Budgets | Tooling and structure deviations: no mypy --strict, single uvicorn (no Gunicorn workers), sync psycopg (no asyncpg), no lockfile, no boundaries CI |
| F-B02A-14 | MEDIUM | spec02a | Modules and boundaries | Ground-truth schema read/written directly from the API process (admin router uses gt_session) |
| F-B02A-15 | MEDIUM | spec02a | Request pipeline/AuthN | Login accepts any typed password for accounts with an empty password_hash (bootstrap takeover path) |
| F-B02A-16 | MEDIUM | spec02a | Conventions/Request headers | Draft optimistic concurrency uses body version instead of If-Match; DRAFT_VERSION_CONFLICT is 412 not 409 |
| F-B02A-17 | MEDIUM | spec02a | Conventions/Time | server_time not carried on responses; timestamps serialized with +00:00 instead of Z |
| F-B02B-03 | MEDIUM | spec02b | consent/API-02 | Consent API (GET/POST /consent) missing; consent reduced to rules acceptance |
| F-B02B-04 | MEDIUM | spec02b | state/API-04 | /state ETag/If-None-Match/304 and state_versions record missing |
| F-B02B-05 | MEDIUM | spec02b | leaderboard/API-04 | /leaderboard has no since/304 conditional semantics |
| F-B02B-06 | MEDIUM | spec02b | repo/API-05 | Repo content watermarking missing |
| F-B02B-07 | MEDIUM | spec02b | repo/API-05 | GET /repo/symbol?name= missing |
| F-B02B-08 | MEDIUM | spec02b | uploads/API-10 | Upload lifecycle incomplete: validate/get/delete endpoints and status=ok submit gate missing |
| F-B02B-09 | MEDIUM | spec02b | receipts/API-12 | GET /receipts/{id} missing; POST dispute not idempotent; GET own disputes missing |
| F-B02B-10 | MEDIUM | spec02b | admin-auth/API-13 | Cloudflare Access assertion, ADMIN_AUTH_MODE and staging/prod boot refusal missing |
| F-B02B-11 | MEDIUM | spec02b | admin-config/API-14 | Event config edits do not require step-up |
| F-B02B-12 | MEDIUM | spec02b | admin-participants/API-15 | CSV participant import (dry run then commit) missing |
| F-B02B-13 | MEDIUM | spec02b | admin-gt/API-16 | Ground-truth read side missing; no audit-on-view |
| F-B02B-14 | MEDIUM | spec02b | admin-live/API-17 | Kill switches not togglable at runtime; force-open/force-close missing |
| F-B02B-15 | MEDIUM | spec02b | admin-scoring/API-19 | Answer packs, rescore (dry-run), leaderboard admin modes and finalize checklist missing |
| F-B02B-16 | MEDIUM | spec02b | admin-ops/API-20 | /admin/integrity missing; exports are inline CSV, not expiring links |
| F-B02B-17 | MEDIUM | spec02b | health/API-21 | /readyz and /metrics missing; /healthz is /health with DB probe only |
| F-B02B-18 | MEDIUM | spec02b | state-machines/§7.1 | Submission state machine has no append-only event log (app.submission_events) |
| F-B02B-19 | MEDIUM | spec02b | state-machines/§7.4 | Node pointer lacks version/adjusted_by/adjusted_reason; no organizer adjustment surface |
| F-B02B-20 | MEDIUM | spec02b | jobs/§8.1 | Job queue: no dedupe_key, lease/heartbeat and backoff deviate from spec |
| F-B02B-21 | MEDIUM | spec02b | jobs/§8.2-8.3 | 12+ job kinds missing; no advisory-lock scheduler |
| F-B02B-22 | MEDIUM | spec02b | evaluation/§9.2 | Level-2 multi-location match rule deviates from spec |
| F-B02B-23 | MEDIUM | spec02b | evaluation/§9.4 | AI assessment entirely missing |
| F-B02B-24 | MEDIUM | spec02b | rate-limits/§11 | Rate limits: in-memory per-process only, several rows missing, values deviate |
| F-B02B-25 | MEDIUM | spec02b | auth/hygiene | Password reset token printed to process stdout |
| F-B02B-26 | MEDIUM | spec02b | hygiene/§13 | HSTS missing; no __Secure- cookie prefix; Secure flag tied only to environment=='production' |
| F-B02B-27 | MEDIUM | spec02b | hygiene/§13 | No graceful shutdown drain or lease release |
| F-BSP-04 | MEDIUM | blindspots | platform-security | No Content-Security-Policy header anywhere |
| F-BSP-05 | MEDIUM | blindspots | integrity | Wide-span reports score full location match; span width never weighted (shotgun padding viable) |
| F-BSP-06 | MEDIUM | blindspots | integrity | No per-team watermarking, file-order shuffling, or similarity/timing analysis |
| F-BSP-07 | MEDIUM | blindspots | integrity | Unplanned-bug promotion has no endpoint and no deterministic rescore |
| F-BSP-08 | MEDIUM | blindspots | data | Ground-truth anchors never computed or validated on the production authoring path |
| F-BSP-09 | MEDIUM | blindspots | platform-security | Password-reset token printed to process logs |
| F-BSP-10 | MEDIUM | blindspots | platform-security | Rate limiter is in-process only, resets on restart, and never evicts keys |
| F-BSP-11 | MEDIUM | blindspots | auth | Admin surface protected by password-only step-up; no MFA, no separate deployment or DB role |
| F-BSP-12 | MEDIUM | blindspots | integrity | A/B variant equivalence unvalidated and self-selected per team |
| F-CKLA-09 | MEDIUM | checklistA | errors | 429 responses lack Retry-After header (ERC-02 S1-part, ATH-01c) |
| F-CKLA-10 | MEDIUM | checklistA | submissions/validation | Report field limits deviate from spec on both client and server (WS-04a S1-part) |
| F-CKLA-11 | MEDIUM | checklistA | participants/admin | Disqualify/reinstate/merge with two-person approval missing (PT-04a S2) |
| F-CKLA-12 | MEDIUM | checklistA | workspace/keyboard | Keyboard shortcut set and command palette missing (KBD-01 S2, KBD-03) |
| F-CKLA-13 | MEDIUM | checklistA | workspace/ux | Connection states and degraded banner not wired (CMP-14 S2, STP-04, WS-01d) |
| F-CKLA-14 | MEDIUM | checklistA | review | No auto double review, SLA/age timers, or capacity forecast (RV-04a/03b/01a/05a, RVC-01a S2) |
| F-CKLA-15 | MEDIUM | checklistA | public/status | No external status page (PUB-05a S2) |
| F-CKLA-16 | MEDIUM | checklistA | public/rules | Rules PDF not generated at publish time (PUB-02b S2) |
| F-CKLA-17 | MEDIUM | checklistA | admin/audit | Role management missing; audit viewer search incomplete (RM-01a, AU-01a S2) |
| F-CKLA-18 | MEDIUM | checklistA | live-ops/adjustments | Time adjustments unbounded, no two-person approval (LV-06a S2, ACC-05a) |
| F-CKLA-19 | MEDIUM | checklistA | challenges/ground-truth | Pre-freeze validation report incomplete; no anchor hashes (CH-05a S2, GT-02a) |
| F-CKLA-20 | MEDIUM | checklistA | challenges/authoring | Unplanned-defect audit workflow missing (CH-06a S2) |
| F-CKLA-21 | MEDIUM | checklistA | accessibility/ci | No automated axe checks in CI (ACC-03 S2, ACC-01 tracking) |
| F-CKLA-22 | MEDIUM | checklistA | practice | Practice environment entirely missing (PR-01a..PR-04a S2/S1) |
| F-CKLB-08 | MEDIUM | checklistB | admin-auth/G3-01 | Admin access has no MFA; step-up is password re-entry only |
| F-CKLB-09 | MEDIUM | checklistB | rate-limiting/API-12a/NET-01 | Rate limiting is in-process only; concurrency cap is dead config |
| F-CKLB-10 | MEDIUM | checklistB | outbox/API-11a/G2-10 | Outbox dispatcher is dead code and delivers nothing |
| F-CKLB-11 | MEDIUM | checklistB | security-headers/EDG-13a/G4-01 | No CSP, HSTS or Permissions-Policy headers |
| F-CKLB-12 | MEDIUM | checklistB | editor/FEA-08a/G1-04 | Monaco editor entirely absent |
| F-CKLB-13 | MEDIUM | checklistB | offline-drafts/FEA-03a/G2-11/AT-19/PR-31 | No IndexedDB draft buffer or offline submission queue |
| F-CKLB-14 | MEDIUM | checklistB | api-client/FEA-04a | API client is hand-written; no OpenAPI generation or staleness check |
| F-CKLB-15 | MEDIUM | checklistB | evaluation-replay/EVS-01a/WRK-05a/API-13 | Evaluation records lack engine version, ruleset hash and candidate set |
| F-CKLB-16 | MEDIUM | checklistB | determinism/EVS-06a | No recorded-corpus determinism replay test in CI |
| F-CKLB-17 | MEDIUM | checklistB | notifications/API-16a | No email/notification capability at all |
| F-CKLB-18 | MEDIUM | checklistB | review-console/G3-02 | Review console lacks SLA timers, double review and calibration |
| F-CKLB-19 | MEDIUM | checklistB | scoring-fairness/G3-03/AT-16/AT-15 | Unplanned-finding promotion and rescoring runs do not exist |
| F-CKLB-20 | MEDIUM | checklistB | scheduler/WRK-06a | No scheduler leader lock; auto-submit scan runs unguarded on every worker |
| F-CKLB-21 | MEDIUM | checklistB | integrity/G3-06 | Integrity module and console entirely absent |
| F-CKLB-22 | MEDIUM | checklistB | db-schemas/DB-01a/PRX-03a | practice and integrity schemas absent; role DDL not in migrations |
| F-CKLB-23 | MEDIUM | checklistB | monitoring/OBS-01a/OBS-04a/G4-05/RDY-06 | No external monitoring, status page, alerting or external pen test |
| F-CKLB-29 | MEDIUM | checklistB | auto-accept/EVS-02a | Auto-accept is live without the 99% precision validation gate |
| F-F01A-03 | MEDIUM | spec01a | 1.1 Stack | TypeScript not compiled in strict mode |
| F-F01A-04 | MEDIUM | spec01a | 1.1 Stack | Stack substitutions: React 19, declarative router, no Zustand, no react-hook-form+zod, no generated client, oxlint |
| F-F01A-05 | MEDIUM | spec01a | 1.1 Stack | Monaco editor absent; custom read-only line viewer instead |
| F-F01A-06 | MEDIUM | spec01a | 1.1 Testing | Frontend test toolchain (Vitest/RTL/Playwright/axe/MSW) absent; one node:test SSR check |
| F-F01A-07 | MEDIUM | spec01a | 2.1 Boot sequence | Boot gaps: no /config.json, single-sample clock sync, no X-Min-Client-Version gate |
| F-F01A-08 | MEDIUM | spec01a | 2.2 Session handling | No cross-tab refresh coordination (Web Locks / BroadcastChannel) |
| F-F01A-09 | MEDIUM | spec01a | 2.2 Session handling | Session-expired UX (P-23) and 'signed in on another device' variant missing |
| F-F01A-10 | MEDIUM | spec01a | 2.3 Route guards | Guards check role only; no state fetch, node-pointer comparison or redirect-with-toast |
| F-F01A-11 | MEDIUM | spec01a | 2.4 Polling manager | Polling deviations: fixed intervals, no jitter/backoff/visibility/online triggers; leaderboard not version-gated |
| F-F01A-12 | MEDIUM | spec01a | 2.6 Draft sync | Draft sync: 3s fixed interval, no pagehide/sendBeacon flush, conflict auto-discards local edits, no status chips |
| F-F01A-13 | MEDIUM | spec01a | 2.7 Outbox / idempotency | Idempotency key discarded on failed attempt, breaking the stability guarantee |
| F-F01A-14 | MEDIUM | spec01a | 2.8 Warnings/notifications | No toast, no blocking modal, escalation at 10/2 min instead of 5/3/1, dead OfflineBanner, no catalog keys |
| F-F01A-15 | MEDIUM | spec01a | 2.9 Connection indicator | No connection indicator in the workspace header (5 states) |
| F-F01A-16 | MEDIUM | spec01a | 2.10 Maintenance/kill switches | No flags/maintenance in /v1/state and no P-24 maintenance page |
| F-F01A-17 | MEDIUM | spec01a | 2.12 Error handling | No React error boundary per route or panel |
| F-F01A-18 | MEDIUM | spec01a | 2.11 Keyboard shortcuts | Workspace shortcut table and shortcut help dialog unimplemented |
| F-F01A-19 | MEDIUM | spec01a | 1.4 Device support | No unsupported-device gate (P-24) for execution pages (width>=1024 + pointer) |
| F-F01A-20 | MEDIUM | spec01a | 1.5 Build/config | No CSP defined (inline-script ban, worker-src) anywhere |
| F-F01B-04 | MEDIUM | spec01b | design-tokens | Design token system diverges from 3.1/3.2 (names, no light theme, no override, contrast edge cases) |
| F-F01B-05 | MEDIUM | spec01b | design-tokens | Motion tokens incomplete: single 120ms speed, linear easing, no 200/300ms or easing tokens |
| F-F01B-06 | MEDIUM | spec01b | components/foundation | Foundation component gaps: Button loading/aria-busy and 40px target, counter live regions, tab keyboard nav, text-only StatusChip, markdown subset |
| F-F01B-07 | MEDIUM | spec01b | components/foundation | No Modal, ConfirmModal or Toast components (C-07/C-08/C-09) |
| F-F01B-08 | MEDIUM | spec01b | components/event | Event components missing/partial: no ProgressBar, no LevelCard/GateButton, countdown lacks onZero refetch and uses 2-min warning |
| F-F01B-09 | MEDIUM | spec01b | components/event | No ConnectionIndicator or sync StatusChip in workspace header (C-28/C-29) |
| F-F01B-10 | MEDIUM | spec01b | workspace/draft-sync | DraftSync partial: 3s interval only, no merge prompt on 409, no pagehide/sendBeacon flush, no local persistence (C-55) |
| F-F01B-11 | MEDIUM | spec01b | participant/pages | Participant page set incomplete: consent gate, activation/reset, dashboard elements, event details, team, system check, announcements, support, system |
| F-F01B-12 | MEDIUM | spec01b | participant/dispute | Dispute submission lacks idempotency key, deadline countdown and status tracking (P-16) |
| F-F01B-13 | MEDIUM | spec01b | participant/workspace | Auto-submit client UX missing: no 5/3/1-minute warnings, no 'Time's up. Auto-submitting...' flow (P-10) |
| F-F01B-14 | MEDIUM | spec01b | pages/conventions | Page conventions unmet: static document title only, no focus-to-heading on route change |
| F-F01B-15 | MEDIUM | spec01b | i18n/copy | No copy catalog: all user-facing strings hard-coded inline |
| F-F01B-16 | MEDIUM | spec01b | admin/pages | Admin surface thin: 19 of 35 A-pages missing; no stage-creation UI at all |
| F-F01B-17 | MEDIUM | spec01b | admin/ui-rules | Admin UI rules partial: reasons not required for event transitions/dispute resolution, read-only kill switches, no sensitive-data banner, direct-downl |
| F-F01B-18 | MEDIUM | spec01b | admin/review | Review workbench and disputes partial: no AI panel, ground-truth excerpt, run result or second reviewer (C-66, A-22, A-23) |
| F-PRP-03 | MEDIUM | proposal | ctf/side-quests | CTF quest variety under-delivered: no planted token in Git history; only 2 flags vs 100-pt cap |
| F-PRP-04 | MEDIUM | proposal | teams/eligibility | Team size 4-5 is published but never enforced by code |
| F-PRP-05 | MEDIUM | proposal | event-config/schedule | Production schedule and level windows are not configured (synthetic dev windows only) |
| F-PRP-06 | MEDIUM | proposal | rules/operations | No operator surface to disqualify or suspend a team |
| F-QLT-04 | MEDIUM | quality | architecture | Worker/domain module imports private helpers from a router (layering inversion) |
| F-QLT-05 | MEDIUM | quality | code-style | __import__() antipattern in 12 places |
| F-QLT-06 | MEDIUM | quality | error-handling | Unhandled API exceptions and job failures leave no server-side log |
| F-QLT-07 | MEDIUM | quality | config-ops | Password-reset token printed to stdout unguarded in all environments |
| F-QLT-08 | MEDIUM | quality | duplication | Evaluator logic copy-pasted between evaluator.py and evaluator_level.py |
| F-QLT-09 | MEDIUM | quality | duplication | matching.decide and decide_multi duplicate the scoring/threshold logic |
| F-QLT-10 | MEDIUM | quality | typing | Nine admin endpoints take untyped body: dict with hand-rolled validation |
| F-QLT-11 | MEDIUM | quality | data-layer | Seed silently continues when a GT anchor pattern misses; Option-A ingestion duplicates the helper |
| F-QLT-12 | MEDIUM | quality | dead-code | ORM model layer (~740 lines) is dead code duplicating the SQL schema |
| F-QLT-13 | MEDIUM | quality | tests | Frontend coverage: a single SSR XSS test for 6,348 lines of UI |
| F-QLT-14 | MEDIUM | quality | docs | Docs report stale test counts and omit six test files |
| F-QLT-15 | MEDIUM | quality | frontend | Workspace.tsx is a 963-line god component with a duplicated draft-hydration block |
| F-QLT-16 | MEDIUM | quality | error-handling | Reviewer decision needs_second_review dead-ends the submission |
| F-QLT-17 | MEDIUM | quality | data-layer | release_feedback is N+1: one gt session per submission plus repeated stage-max queries |
| F-QLT-18 | MEDIUM | quality | duplication | Frontend hand-copies the backend state machines |
| F-QLT-19 | MEDIUM | quality | config-ops | No startup guard against production running on dev-default secrets/DB URLs |
| F-QLT-20 | MEDIUM | quality | error-handling | Concurrent audit writes can fork the hash chain, making audit_verify report a false break |
| F-S03A-06 | MEDIUM | spec03a | ATH-01 Login | Login gaps: no show/hide toggle, no Turnstile after 3 failures, no Retry-After on lockout, silent oldest-session eviction, no activation redirect |
| F-S03A-07 | MEDIUM | spec03a | ATH-03 Password reset | Password reset: no email delivery (raw token printed to logs/organizer console) and no frontend pages |
| F-S03A-08 | MEDIUM | spec03a | ATH-04 Rules/consent acknowledgement | Consent reduced to a single lobby button; no blocking screen, separate checkboxes or telemetry/proctoring notice; client can pre-accept arbitrary vers |
| F-S03A-09 | MEDIUM | spec03a | ATH-05 Session management | Sessions: no approximate location, no 'sign out other sessions', no session-revoked notice/state clear |
| F-S03A-10 | MEDIUM | spec03a | 1.1 Permission matrix | Practice environment capability missing for all four roles |
| F-S03A-11 | MEDIUM | spec03a | 1.2 Visual/layout system | Dark-only theme: no light theme, selector, persistence, or system-preference detection |
| F-S03A-12 | MEDIUM | spec03a | 1.2 Visual/layout system | Workspace not resizable multi-pane; no min-viewport guidance, <1024 px notice, or unsupported-browser blocking notice |
| F-S03A-13 | MEDIUM | spec03a | 1.3 Shared components | Most shared components missing: Toast, Dialog/ConfirmDialog, Select/Combobox, DataTable, Tabs/Tree/SplitPane, CodeView (Monaco), Skeleton, ConnectionI |
| F-S03A-14 | MEDIUM | spec03a | 1.4 Keyboard shortcuts | Keyboard shortcuts absent (no palette, quick-open, cross-file search, panel toggles, Alt+N, Ctrl+Enter, Alt+1-9, F8, ? help) |
| F-S03A-15 | MEDIUM | spec03a | 1.5 Accessibility | No automated axe checks in CI (and no recorded screen-reader pass) |
| F-S03A-16 | MEDIUM | spec03a | 1.6 Localization | UI strings not externalized to message catalogs |
| F-S03A-17 | MEDIUM | spec03a | 1.7 State patterns | No degraded/polling-fallback or kill-switch banner; polling is the only mode |
| F-S03A-18 | MEDIUM | spec03a | PUB-02 Rules page | No downloadable PDF at publish time; time and grace rules section missing from the rules document |
| F-S03A-19 | MEDIUM | spec03a | PUB-03 Terms/privacy/consent | Privacy notice not aligned to DPDP Act 2023; no rights statement, proctoring/integrity-signal disclosure, or prize-eligibility terms |
| F-S03A-20 | MEDIUM | spec03a | PUB-04 FAQ | No dedicated FAQ page/route; required topics (supported browsers, connection drop, workspace usage) missing |
| F-S03A-21 | MEDIUM | spec03a | PUB-05 Status page | Status page missing entirely (no external host, component status, incidents, or maintenance) |
| F-S03B-08 | MEDIUM | spec03b | lobby/frontend | LB-02 system check covers only 4 items and never blocks entry |
| F-S03B-09 | MEDIUM | spec03b | state/backend | Event/stage resolution ignores the caller's event (latest-wins across all events) |
| F-S03B-10 | MEDIUM | spec03b | submissions | SUB-01: no filters, no reviewer reason codes, dispute window not time-bounded |
| F-S03B-11 | MEDIUM | spec03b | leaderboard | LBD-01: no own-row highlight/pin, search, pagination or provisional badge; live-mode constraints unenforced |
| F-S03B-12 | MEDIUM | spec03b | results | RES-01/RES-02: rank, per-challenge totals, bugs missed, certificate and public results missing |
| F-S03B-13 | MEDIUM | spec03b | workspace/report-form | WS-04 field-rule deviations and missing affordances |
| F-S03B-14 | MEDIUM | spec03b | review | Review queue: no matcher features/confidence/SLA, no automatic double review, decision possible without claim |
| F-S03B-15 | MEDIUM | spec03b | disputes | Dispute resolution independence and participant notification unenforced |
| F-S03B-16 | MEDIUM | spec03b | rescoring | Rescoring runs and finalization checklist missing |
| F-S03B-17 | MEDIUM | spec03b | audit/backend | Audit chain verification covers only global scope of the app DB; GT audit rows land in the separate GT database |
| F-S03B-18 | MEDIUM | spec03b | admin/backend | Admin API on same host/audience; step-up is password re-entry; no idempotency keys on admin mutations |
| F-S03B-19 | MEDIUM | spec03b | notifications | Notifications module absent (no email invites, reminders, results or dispute mails) |
| F-S03B-20 | MEDIUM | spec03b | matching/scoring | Matching/scoring model deviates from spec 13.2/13.4 |
| F-S03B-21 | MEDIUM | spec03b | scoring/backend | Leaderboard snapshots event-driven only; no interval snapshot job; responses not cacheable |
| F-S03B-22 | MEDIUM | spec03b | admin/frontend+backend | Admin console feature gaps (participants, challenges, GT tooling, analytics, exports) |
| F-S03B-23 | MEDIUM | spec03b | workspace/frontend | Pause UX partial: no full-width banner, inputs remain editable |
| F-SEC-04 | MEDIUM | security | authorization | DELETE /me/sessions/{id} revokes another user's refresh tokens (IDOR) |
| F-SEC-05 | MEDIUM | security | secrets | Default JWT secret and dev DB credentials ship in code with no production fail-fast |
| F-SEC-06 | MEDIUM | security | secrets | Password-reset tokens are printed to stdout/logs |
| F-SEC-07 | MEDIUM | security | web | In-process rate limiter: per-worker limits, restart resets, unbounded key growth |

_217 findings._

#### P3 - LOW / INFO

| ID | Severity | Stream | Area | Title |
|---|---|---|---|---|
| F-AD8A-15 | LOW | admin08a | admin-frontend/i18n-time | Timestamps hardcoded to IST; no UTC tooltip; event timezone column ignored |
| F-AD8A-16 | LOW | admin08a | admin-frontend/ux-rules | Request IDs are plain text, not clickable/copyable and do not search the audit log |
| F-AD8B-10 | LOW | admin08b | backend/gt-schema | Category and severity taxonomies deviate from spec enums |
| F-AD8B-11 | LOW | admin08b | backend/gt-schema | Aliases are weighted keywords, not alternative locations {file, lines[]} |
| F-AD8B-12 | LOW | admin08b | backend/gt-schema | Field-name deviations: canonical_file/canonical_patch_md/reference_explanation_md/award_unit_id vs implementation |
| F-AG07-04 | LOW | agentic07 | A1 error catalog | Unknown error code silently degrades to HTTP 400 instead of failing loudly |
| F-AG07-09 | LOW | agentic07 | A3 participant API | Staged uploads cannot be deleted before submit |
| F-AG07-13 | LOW | agentic07 | A4 admin API | Force-advance playbook not implemented (no adjusted_by/adjusted_reason) |
| F-AG07-14 | LOW | agentic07 | A4 admin API | MFA absent; step-up is password re-entry only (documented waiver) |
| F-AG07-16 | LOW | agentic07 | A5 participant frontend | document.title never set per page (one-h1 rule is met) |
| F-AG07-17 | LOW | agentic07 | A5 participant frontend | No focus-trapped modals exist; modal rules untestable |
| F-AG07-22 | LOW | agentic07 | A10 security/audit | Audit-chain verification is an admin endpoint, not a CI-enforced tool |
| F-ARA-02 | LOW | archA | D1 targets (§2.1) | Load-test tool measures API only; no server-side vs end-to-end latency split |
| F-ARA-05 | LOW | archA | Component inventory (§3.3) | Object storage is a local directory, not a private bucket |
| F-ARA-07 | LOW | archA | Request limits (§4.4) | Body-size limit trusts Content-Length only; malformed value yields 500 and chunked bodies skip the check |
| F-ARA-08 | LOW | archA | Rate limits (§3.3, §4.4) | In-process rate limiter resets on restart and multiplies per worker |
| F-ARA-12 | LOW | archA | Clock (§5.4) | Clock offset estimated from a single sample instead of lowest-RTT multi-sample |
| F-ARA-13 | LOW | archA | Realtime (§5.5) | /state polls at a fixed 5 s even outside an active round |
| F-ARA-14 | LOW | archA | Editor (§5.6) | Bespoke read-only viewer instead of the specified Monaco editor |
| F-ARA-15 | LOW | archA | Search (§5.6) | Repository search is bounded and rate-limited but not paginated |
| F-ARA-19 | LOW | archA | Participant session design (§6.1) | No kid claim in access tokens |
| F-ARA-20 | LOW | archA | Participant session design (§6.1) | Argon2id hashing not explicitly bounded by a semaphore/thread pool |
| F-ARA-22 | LOW | archA | Refresh rotation race (§6.2) | Refresh-successor encryption key derived from the JWT secret |
| F-ARA-25 | LOW | archA | Authorization model (§6.5) | No PostgreSQL RLS as defense in depth |
| F-ARB-14 | LOW | archB | scoring | Award uniqueness scoped (stage, team, unit) instead of (tenant, participant, round, unit) |
| F-ARB-15 | LOW | archB | rate limiting | Rate limiting is a per-process in-memory bucket |
| F-ARB-16 | LOW | archB | db roles | gt_admin granted write on gt and ALL on app schema (exceeds evaluator need) |
| F-ARB-17 | LOW | archB | jobs | No lease renewal for long jobs; dead letters only visible via admin endpoint |
| F-ARB-18 | LOW | archB | submissions | CTF flag submissions bypass caps and cooldowns |
| F-ARB-19 | LOW | archB | security headers | No Content-Security-Policy header |
| F-ARB-20 | LOW | archB | request pipeline | Request timeout not enforced in the API pipeline |
| F-ARB-21 | LOW | archB | data model | practice schema from 9.2 not present |
| F-ARB-22 | LOW | archB | release management | CI lacks backend type-check and an image/digest release path |
| F-B02A-18 | LOW | spec02a | Budgets | Body cap 512 KiB vs spec 1 MiB; 2 MiB response cap not enforced |
| F-B02A-19 | LOW | spec02a | Conventions/URLs | Stages addressed by ordinal level number instead of a stable stage_key; no Deprecation/Sunset mechanism |
| F-B02A-20 | LOW | spec02a | Stack/Object storage | Only the filesystem storage adapter; no MinIO/S3 option despite spec pluggability |
| F-B02A-21 | LOW | spec02a | Profiles/Load target | Load target qualification pending at every N; tool cannot run the N=100/200 points |
| F-B02A-22 | LOW | spec02a | Request pipeline/Locking | Lock order deviates (progress pointer locked before stage row); caps via COUNT without quota-row FOR UPDATE |
| F-B02A-23 | LOW | spec02a | Conventions/Response envelope | Copy catalog / copy_key in meta absent; error messages hardcoded |
| F-B02B-28 | LOW | spec02b | auth/API-01 | Auth path/shape naming deviations |
| F-B02B-29 | LOW | spec02b | public/API-03 | Public event shape/cache deviations; /content/event-details missing |
| F-B02B-30 | LOW | spec02b | drafts/API-08 | Draft contract deviations |
| F-B02B-31 | LOW | spec02b | submit/API-09 | Level submit request/response shape deviations |
| F-B02B-32 | LOW | spec02b | review/API-18 | Reviewer decision reason not required; stage-control reason min length unenforced |
| F-B02B-33 | LOW | spec02b | testing/§12 | Testing layer gaps vs §12 |
| F-B02B-34 | LOW | spec02b | repo-lock/API-06 | GET /team/repo-lock absent as standalone endpoint |
| F-B02B-35 | LOW | spec02b | evaluation/§9.2 | Match decisions do not persist matcher_version/rule_set_hash and features |
| F-B02B-36 | LOW | spec02b | ledger/§9.5 | Ledger origin typing and CHECK(num_nonnulls=1) constraint missing |
| F-B02B-37 | LOW | spec02b | hygiene/§13 | CORS allow_credentials on all routes |
| F-B02B-38 | LOW | spec02b | state/API-04 | /announcements pagination and /team/score shape deviations |
| F-B02B-39 | LOW | spec02b | api-paths | Assorted admin/ops path naming deviations |
| F-BSP-13 | LOW | blindspots | data | Root-cause group is not the award unit; one group can be paid multiple times |
| F-BSP-14 | LOW | blindspots | frontend | No IndexedDB draft queue, offline resubmission, or React error boundaries |
| F-BSP-15 | LOW | blindspots | frontend | No X-Min-Client-Version / stale-client reload mechanism |
| F-BSP-16 | LOW | blindspots | frontend | Challenge upload has no file-count cap and the repo tree is not virtualized |
| F-BSP-17 | LOW | blindspots | evaluation | Review queue lacks SLA timers and blind double review |
| F-BSP-18 | LOW | blindspots | platform-security | Backend dependencies not hash-pinned; no lockfile or scanning evidence |
| F-CKLA-23 | LOW | checklistA | exports | Exports synchronous, unsigned, non-expiring (RS-05a S2-part, EX-01a) |
| F-CKLA-24 | LOW | checklistA | leaderboard | Leaderboard snapshot served no-store instead of cacheable 10s (LBD-01c) |
| F-CKLA-25 | LOW | checklistA | workspace/polish | Workspace and leaderboard polish gaps (grouped S3) |
| F-CKLA-26 | LOW | checklistA | components/countdown | Countdown lacks role=timer and 5/1-minute announcements (CMP-09) |
| F-CKLA-27 | LOW | checklistA | errors/client | Client rewrites catalog error wording (ERC-03 S2-part) |
| F-CKLA-28 | LOW | checklistA | workspace/deadline | Deadline UX lacks 'Time is up' banner and final summary (WS-11a S1-part) |
| F-CKLA-29 | LOW | checklistA | login | Login screen lacks show/hide toggle, routed account states, Turnstile (ATH-01b S3) |
| F-CKLA-30 | LOW | checklistA | account/sessions | Session list lacks location; no session_revoked handling (ATH-05a S3) |
| F-CKLA-31 | LOW | checklistA | database/defense-in-depth | No PostgreSQL row-level security behind the app layer (PMX-04 S3) |
| F-CKLB-24 | LOW | checklistB | clock/FEA-06a | Clock offset estimated from a single sample |
| F-CKLB-25 | LOW | checklistB | request-limits/API-02a | Body-size limit only enforced when Content-Length is present |
| F-CKLB-26 | LOW | checklistB | captcha/EDG-15a/AUTH-08 | No Turnstile at activation or password reset |
| F-CKLB-27 | LOW | checklistB | jobs/WRK-04a | Job kinds share one retry policy; no jitter, no per-kind metrics |
| F-CKLB-28 | LOW | checklistB | clock/leaderboard | Leaderboard snapshot cutoff uses the app server clock |
| F-F01A-21 | LOW | spec01a | 1.5 Build/config | Runtime config.json, source-map tracker and asset caching policies unimplemented |
| F-F01A-22 | LOW | spec01a | 2.8/2.13 Copy catalog | No copy catalog; all user-facing strings hardcoded inline |
| F-F01A-23 | LOW | spec01a | 2.12 Error handling | Error envelope lacks a 'Copy details' action |
| F-F01A-24 | LOW | spec01a | 2.13 i18n/time | Time zone hardcoded to Asia/Kolkata with literal 'IST' instead of the event's zone |
| F-F01B-19 | LOW | spec01b | components/lists | Lists and panes not virtualised or resizable; file tree lacks arrow-key navigation (C-14, C-15, C-41) |
| F-F01B-20 | LOW | spec01b | participant/login | Login page copy contradicts itself about account creation; first-sign-in password capture lacks strength meter |
| F-F01B-21 | LOW | spec01b | components/event | Leaderboard does not pin own team row; score card has no animation or live-region announce (C-24, C-25) |
| F-F01B-22 | LOW | spec01b | admin/misc | EXTRA/deviations worth recording: localStorage challenge-id memory, self-hosted fonts, inline confirm/receipt substitutions |
| F-PRP-07 | LOW | proposal | registration | No participant self-registration or team-join flow (fully organizer-driven) |
| F-PRP-08 | LOW | proposal | scoring | Per-level score weights, tie-break and penalty policy remain provisional |
| F-PRP-09 | LOW | proposal | documentation | Doc drift and pre-publication hazards (stale test counts; handbook example leaks a real defect) |
| F-PRP-10 | LOW | proposal | levels-3-4 | Level 3 side-quest content and Level 4 rubric are wired but empty (owner input pending) |
| F-PRP-11 | LOW | proposal | challenge-content | Option B challenge is a development fixture; production A/B packages pending equivalence certification |
| F-QLT-21 | LOW | quality | architecture | No-op role check reads as a restriction but is none |
| F-QLT-22 | LOW | quality | typing | Invalid callable annotations and unbounded rate-limit bucket keys |
| F-QLT-23 | LOW | quality | code-style | Function-level inline imports scattered across the backend |
| F-QLT-24 | LOW | quality | config-ops | Backend runtime dependencies are lower-bound only with no lockfile |
| F-QLT-25 | LOW | quality | duplication | Challenge fixtures: intentional parallel implementations with manual parity maintenance |
| F-S03A-22 | LOW | spec03a | §0 Conventions | Challenge URLs use UUIDs, not slugs |
| F-S03A-23 | LOW | spec03a | §0/1.6 Time formatting | UI timezone formatter hard-codes Asia/Kolkata instead of taking the event timezone |
| F-S03A-24 | LOW | spec03a | §0 API conventions | Admin API served from the same host/app as the participant API (audience-only separation) |
| F-S03A-25 | LOW | spec03a | 1.2 Visual system | Design token names deviate from spec set; fonts are static weights, not a variable font |
| F-S03A-26 | LOW | spec03a | 1.3 Shared components | Component-level deviations: Button lacks secondary/loading; ConfirmButton not typed-phrase; Countdown lacks role=timer and 10/5/1-min thresholds; Stat |
| F-S03A-27 | LOW | spec03a | 1.1 Permission matrix | Manual score adjustment is admin-only while the matrix allows organizer for rescoring/finalization |
| F-S03A-28 | LOW | spec03a | 1.5 Accessibility | Accommodation request field not reachable from the participant profile |
| F-S03A-29 | LOW | spec03a | PUB-01 Landing page | Landing performs an extra dynamic call GET /v1/time beyond the spec's single cached event fetch |
| F-S03A-30 | LOW | spec03a | PUB-03/ATH-01 Copy consistency | Terms/Login copy claims accounts are created automatically on first sign-in, contradicting backend rejection of unregistered emails |
| F-S03B-24 | LOW | spec03b | announcements/backend | Announcements not scoped by event or audience |
| F-S03B-25 | LOW | spec03b | rate-limiting/backend | 429s carry no Retry-After header; rate limiter is in-process |
| F-S03B-26 | LOW | spec03b | challenges/admin | Challenge version lifecycle collapsed (no REVIEWED/ARCHIVED states) |
| F-S03B-27 | LOW | spec03b | admin/timezone | Scheduling/timezone handling thinner than specified (no T-minus calendar, IST hardcoded) |
| F-S03B-28 | LOW | spec03b | state-machines/backend | Missing terminal transitions: stage RELEASED->FINAL and submission DISPUTED->RESOLVED |
| F-S03B-29 | LOW | spec03b | nfr/ci | NFR instrumentation gaps: no OpenAPI contract tests, no axe a11y CI, thin metrics story |
| F-S03B-30 | LOW | spec03b | product/extraneous | EXTRA: four-level participant flow replaces the spec's Round 1/Round 2 model |
| F-SEC-08 | LOW | security | web | No Content-Security-Policy or X-Frame-Options headers |
| F-SEC-09 | LOW | security | upload | Upload/body size checks trust Content-Length and read-before-check |
| F-SEC-10 | LOW | security | web | Negative limit query params bypass result caps |
| F-SEC-11 | LOW | security | secrets | Hardcoded dev credentials in seed and helper scripts |
| F-SEC-12 | LOW | security | injection | Challenge app: unplanned second XSS sink in the notes list render |
| F-SEC-13 | INFO | security | design | Intended challenge weaknesses confirmed contained; Option B fixture carries two unplanned auth gaps |

_111 findings._

---

## 4. Detailed audit by baseline document

Each subsection below is the full report of one audit stream: a per-section status table (every requirement row with evidence) followed by that stream's findings with impact and recommended fix.

### 4.1 01 Frontend Specification, sections 1-2 - stack, budgets, global behavior (`spec01a`)

# Spec 01 Frontend — Sections 1–2 Compliance Audit

- **Agent:** spec01a (Task ID 3-a)
- **Baseline document:** `/home/z/my-project/upload/01_Frontend_Spec (1).md`
- **Sections covered:** §1 Stack/structure/budgets (1.1–1.5), §2 Global behavior (2.1–2.13)
- **Repo audited:** `/home/z/my-project/bug-hunt-hackathon` (frontend/ + cross-cutting backend endpoints)
- **HEAD:** `f1412b7eec6c92c4c168fd2b8a58182b34480387` (2026-11-26)
- **Method:** read-only; every row below verified against actual code (Read/Grep), not file names.
- **Overall shape:** the implemented frontend is a single Vite SPA (React 19, declarative React Router, TanStack Query, hand-rolled fetch wrapper) that covers the happy-path console flows well, but nearly all of the spec's resilience/global-infrastructure layers (IndexedDB, outbox, polling manager policy, notifications, connection indicator, maintenance mode, CSP, error boundaries) are absent or deviate.

## Status table

| Spec ref | Requirement (short) | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| 1.1 | TypeScript `strict: true`, no implicit any | PARTIAL | frontend/tsconfig.app.json:1-26; tsconfig.node.json:1-23 | `tsc -b` in build, but no `strict`/`noImplicitAny` flag anywhere |
| 1.1 | React 18 | DEVIATION | frontend/package.json:19 | React 19.3.1 |
| 1.1 | Vite, ES modules, hashed filenames | DONE | frontend/package.json:31; vite.config.ts:7-31 | Vite 8; default content-hashed assets |
| 1.1 | React Router data router (loaders, `beforeLoad`) | DEVIATION | frontend/src/main.tsx:34; src/App.tsx:23-85 | Declarative `<BrowserRouter>`+`<Routes>`; no data router → guards are render-time (see 2.3) |
| 1.1 | TanStack Query | DONE | package.json:18; used throughout src/pages | caching/retry/polling in use |
| 1.1 | Zustand for UI state | MISSING | package.json:13-32 | no client-state library |
| 1.1 | react-hook-form + zod | MISSING | Workspace.tsx:88-97, 345-364 | hand-rolled useState forms + manual validation |
| 1.1 | Tailwind + CSS variables for tokens | DONE | src/styles/app.css:1-2; styles/tokens.css | `@import 'tailwindcss'` + token vars |
| 1.1 | Monaco, self-hosted, lazy-loaded | MISSING | Workspace.tsx:608-645; package.json:13-32 | custom read-only line viewer, no editor |
| 1.1 | `idb` local storage | MISSING | package.json:13-32 | no IndexedDB anywhere (grep: 0 matches) |
| 1.1 | API client generated from OpenAPI | MISSING | src/lib/api.ts:1-181; src/lib/types.ts:1-2 | hand-written wrapper + types |
| 1.1 | Vitest/RTL/Playwright/axe/MSW tests | MISSING | package.json:10; frontend/tests/submission_payload.test.mjs:1-29 | one `node --test` SSR check only |
| 1.1 | ESLint(strict)+Prettier+`tsc --noEmit` in CI | PARTIAL | package.json:9,29; .github/workflows/ci.yml:232-240 | oxlint + `tsc -b && vite build` in CI; no Prettier |
| 1.2 | apps/participant+apps/admin+packages/* layout | MISSING | LS frontend/src; App.tsx:35-82 | single `src/` tree, one bundle |
| 1.2 | Participant app MUST NOT contain admin routes; CI grep of participant build | MISSING | App.tsx:16-19, 54-82 (static admin imports); ci.yml:216-240 (no such check) | admin/review routes shipped to every visitor |
| 1.3 | Performance budgets (JS chunks, LCP/INP/CLS, editor, memory) | UNVERIFIED | — | no budget instrumentation/CI budget gate; Monaco chunk moot (no Monaco) |
| 1.4 | Execution pages: width ≥1024 + pointer, else P-24 | MISSING | grep `matchMedia\|1024\|unsupported` in src → none; app.css:917-926 | workspace merely collapses on narrow screens |
| 1.4 | Informational pages responsive from 360 px | PARTIAL | app.css:114, 699, 857, 917, 926 | breakpoints at 560–1180 px; 360 px not specifically verified |
| 1.5 | Runtime config from `/config.json` (API base, min client version, flags) | MISSING | frontend/public/ (only favicon.svg); grep `config.json` → none | API base baked as relative path + Vite proxy (vite.config.ts:12-21) |
| 1.5 | Source maps uploaded to error tracker, not public | MISSING | — | no error tracker integration |
| 1.5 | index.html revalidated; assets immutable 1-year | MISSING | — | no serving/caching config beyond dev/preview server |
| 1.5 | CSP forbids inline scripts; explicit `worker-src` | MISSING | frontend/index.html:1-18 (no meta CSP); backend/app/main.py:85-92 (no CSP header) | |
| 2.1 | Load shell, read /config.json | MISSING | frontend/public/; main.tsx:1-41 | boot = React render + AuthProvider restore only |
| 2.1 | `GET /v1/time` 3 samples → lowest-latency offset | PARTIAL | src/pages/Landing.tsx:11-19, 22-33 | single sample per 60 s poll on Landing only; offset also derived per `/v1/state` fetch |
| 2.1 | Silent refresh → token in memory | DONE | src/lib/auth.tsx:41-66; src/lib/api.ts:62-89 | `POST /v1/auth/refresh`, credentials included |
| 2.1 | If signed in: `GET /v1/me`, then `GET /v1/state` | PARTIAL | auth.tsx:36-39 (`/v1/me`); state fetched per-page (Lobby.tsx:33-37, Workspace.tsx:114-118) | `/v1/state` not fetched at boot |
| 2.1 | Check `X-Min-Client-Version`, blocking reload screen | MISSING | grep frontend+backend → no match (backend main.py:64-92 sets only X-Request-Id etc.) | |
| 2.2 | Access token in memory only | DONE | api.ts:44-52; auth.tsx:74, 89 | module variable; never persisted |
| 2.2 | Refresh across tabs via Web Locks (BroadcastChannel fallback) | MISSING | api.ts:60-89 | single in-flight promise per tab only |
| 2.2 | Expired refresh → save drafts, P-23 "Session expired", return to same node | PARTIAL | auth.tsx:44-60 (status→anon); chrome.tsx:156-158 (redirect to /login) | no P-23 screen, no draft-restore offer; Login does return via `state.from` (Login.tsx:19-22, 30-31) |
| 2.2 | D-19 other-device variant "Signed in on another device" | MISSING | Account.tsx:15-30; grep → none | sessions list exists, no variant message |
| 2.3 | Guard (a) ensure signed in | DONE | chrome.tsx:138-158 (`RequireRole`, waits for restore) | |
| 2.3 | Guard (b)+(c) fetch state, compare node pointer/level status | MISSING | chrome.tsx:160-185 (role check only) | no node-pointer logic anywhere |
| 2.3 | Guard (d) redirect forward with toast; server re-checks | PARTIAL | chrome.tsx:172-184 (403 panel, no toast); server re-check confirmed (backend state.py:47, submissions.py auth deps) | |
| 2.4 | `GET /v1/state` aggregate endpoint | PARTIAL | backend state.py:45-94 | has server_time, round, announcements_version, leaderboard_version+visibility; missing kill-switch flags, min client version, gate hints |
| 2.4 | 5 s ±20% jitter in round; 30 s outside round | DEVIATION | Lobby.tsx:21,36 (fixed 5 s); Workspace.tsx:117 (fixed 5 s) | no jitter; no out-of-round 30 s mode |
| 2.4 | Tab hidden 30 s; immediate refresh on visibility | MISSING | main.tsx:25 (`refetchOnWindowFocus: false`); no visibility handling | React Query pauses background refetch when hidden (default) but no policy |
| 2.4 | Triggers: focus, `online`, mutation, route change | MISSING | main.tsx:24-26; grep `'online'` → none | invalidation after mutation only (Workspace.tsx:403, 444) |
| 2.4 | Error backoff 5→10→20→30 s + "Reconnecting" | MISSING | main.tsx:24 (`retry: 1`); fixed refetchIntervals | no backoff, no reconnecting state |
| 2.4 | Leaderboard only when `leaderboard_version` changed (`?since=`) | MISSING | Leaderboard.tsx:8-21 (20 s poll regardless); backend leaderboard.py:46-60 (no `since`) | |
| 2.4 | Last good state in memory + IndexedDB | PARTIAL | TanStack keeps stale data in memory; no IndexedDB cache | OfflineBanner exists but unused (chrome.tsx:190-208) |
| 2.5 | IndexedDB `bhctf-v1` stores (workspace/files/flags/outbox/cache/ui) | MISSING | grep `indexedDB\|idb\|bhctf-v1` in frontend → 0 matches | drafts are server-only (PUT /v1/drafts, Workspace.tsx:200-207) |
| 2.5 | Stores wiped on sign-out; stage data deleted after 202 ack | MISSING | auth.tsx:83-92 (logout = API call + state reset) | nothing local to wipe |
| 2.5 | IDB unavailable → memory mode + persistent warning | MISSING | — | |
| 2.6 | Triggers: 10 s after last change, file switch, panel close, visibilitychange, pagehide (sendBeacon), Dashboard nav | PARTIAL | Workspace.tsx:187-239 (3 s interval, dirty flag) | no visibilitychange/pagehide/sendBeacon; unmount may lose last ≤3 s of edits |
| 2.6 | Only changed files, `base_version`, 512 KB limit | DEVIATION | Workspace.tsx:193-203 (single form payload + version) | N/A file model; payload versioning equivalent exists |
| 2.6 | 409 `DRAFT_VERSION_CONFLICT` → merge prompt (Keep mine / Use server / Compare) | MISSING | Workspace.tsx:209-234 | auto-loads server version and discards local edits; notice shown (line 230) |
| 2.6 | Status chips: Saved locally / to server / Offline / queued / accepted | PARTIAL | Workspace.tsx:814-816 ("draft saved \<time\>") | one textual state only |
| 2.7 | Stable `Idempotency-Key` on must-survive mutations | PARTIAL | api.ts:121, 178-181; Workspace.tsx:378-383, 433-438 | key sent, but reset on failure before retry (see F-F01A-13) |
| 2.7 | Outbox store, backoff retry while online, shown as *queued* | MISSING | grep `outbox` in frontend → 0 matches | offline mutation = error banner (Workspace.tsx:404-419) |
| 2.8 | Toast: 6 s auto-dismiss, polite live region | MISSING | grep `toast` → none; receipt rendered inline (Workspace.tsx:662-674) | |
| 2.8 | Banner persistent until resolved | PARTIAL | ui/components.tsx:267-301 (ErrorBanner); chrome.tsx:190-208 (OfflineBanner, unused) | |
| 2.8 | Blocking alert modal, focus trapped | MISSING | no modal component anywhere (grep) | "Time's up" shows as countdown text only |
| 2.8 | Inline field errors | DONE | ui/components.tsx:226-236; Workspace.tsx:345-364, 697+ | |
| 2.8 | Escalation at 5/3/1 min | DEVIATION | ui/components.tsx:332-343 (10 min, 2 min); lib/format.ts:82-88 | thresholds 10/2 instead of 5/3/1 |
| 2.8 | Copy catalog keys (`warn.deadline.5m`) | MISSING | all strings inline, e.g. components.tsx:335-341; Workspace.tsx:230 | |
| 2.9 | Connection indicator in workspace header (5 states, colour+icon+text) | MISSING | Workspace.tsx:467-481 (header has status chip/countdown only) | per-panel ErrorBanner instead |
| 2.10 | `state.flags` hide/disable features with explanation | PARTIAL | backend state.py:77-94 (no flags); Leaderboard.tsx:49-56 (hidden w/ explanation); Lobby.tsx:182-183 (runner/ai flags displayed) | leaderboard visibility handled; Run/Build/announcements/uploads toggles N/A |
| 2.10 | `maintenance=true` → P-24 page + status link; admin sign-in | MISSING | grep `maintenance` in frontend → none | |
| 2.11 | Workspace shortcut table (Ctrl+P, +\, +B, +Shift+F, +Enter, +Shift+Enter, Esc, ?) | MISSING | grep `ctrlKey\|metaKey` → only Workspace.tsx:296-299 (Home/End guards); viewer-local keys at 286-311 | no quick open/split/flag panel (features absent), no Esc, no help dialog |
| 2.11 | Shortcuts must not override native text-editing keys | DONE | Workspace.tsx:286-311 | vacuously satisfied (no global shortcuts exist) |
| 2.12 | Error boundary per route/panel | MISSING | grep `ErrorBoundary\|componentDidCatch` → 0 matches | any render crash blanks the whole app |
| 2.12 | Error envelope: show `message` + `request_id` + Copy details | PARTIAL | api.ts:99-176 (envelope parsed); ui/components.tsx:282-291 (code+request shown as text) | no "Copy details" button (grep `clipboard` → none) |
| 2.12 | Unknown errors: "Something went wrong. Your work is saved." (if true) | PARTIAL | ui/components.tsx:279 | generic message; no sync-state-aware variant |
| 2.13 | English only | DONE | throughout | |
| 2.13 | Strings via catalog keys | MISSING | e.g. Workspace.tsx:230, components.tsx:335-341 | |
| 2.13 | Dates in event TZ (Asia/Kolkata) with zone abbreviation | DONE | lib/format.ts:3-48 (`IST` suffix on all formats) | |
| 2.13 | Countdowns time-zone independent | DONE | format.ts:82-101; Workspace.tsx:863-879; components.tsx:315-359 | ms arithmetic only |

## Findings

### F-F01A-01 — HIGH — Offline persistence stack (IndexedDB `bhctf-v1`, outbox, local drafts) entirely missing
- **Evidence:** grep `indexedDB|idb|bhctf-v1|outbox` across `frontend/` → 0 matches; `frontend/package.json:13-32` (no `idb` dependency); `frontend/src/pages/participant/Workspace.tsx:187-239` (autosave is a 3 s server PUT of component state only); `Workspace.tsx:404-419` (failed submission shows an error, nothing queued).
- **Spec ref:** §2.5, §2.6, §2.7.
- **Impact:** All §2.5 stores, the §2.6 pagehide/`sendBeacon`/visibilitychange flush, and the §2.7 outbox (stable idempotent retry of submits/draft sync while offline) are unimplemented. During the flaky-network scenarios the spec was written for, participants lose unsaved edits (up to 3 s plus the last dirty interval on tab close/navigation) and cannot queue submissions; there is no "queued" or "Offline: changes kept" state.
- **Fix:** Add a `storage` package using `idb` with the six spec'd stores (`workspace`, `files`, `flags`, `outbox`, `cache`, `ui`); mirror the last good `/v1/state` and drafts into IndexedDB; enqueue draft-sync/submit mutations into `outbox` keyed by stable `Idempotency-Key`, retry with backoff on `online`, and surface *queued* status in the workspace.

### F-F01A-02 — HIGH — Participant bundle ships admin/review consoles; no app isolation and no CI leak grep
- **Evidence:** `frontend/src/App.tsx:16-19, 54-82` (review + admin pages statically imported into the single participant-facing app); no `frontend/apps/*` or `frontend/packages/*` (repo LS); `.github/workflows/ci.yml:216-240` (frontend-quality job runs lint/test/build only — no grep of participant build output for admin route names / ground-truth words / secret patterns).
- **Spec ref:** §1.2 ("participant app MUST NOT import from `apps/admin` or contain admin routes. A CI check greps the participant build output…").
- **Impact:** Every participant downloads admin and reviewer UI code (route names, admin copy, API surface) in the initial bundle. Server-side role checks prevent actual access, but the isolation requirement — designed to keep ground-truth-adjacent strings and admin route names out of participant hands and out of the participant attack surface — is unmet.
- **Fix:** Split into `apps/participant` / `apps/admin` builds with shared `packages/*`, lazy-load per-role consoles, and add the CI build-output grep (admin route names, ground-truth vocabulary, secret patterns) before the participant artifact is published.

### F-F01A-03 — MEDIUM — TypeScript not compiled in strict mode
- **Evidence:** `frontend/tsconfig.app.json:1-26` and `frontend/tsconfig.node.json:1-23` — neither sets `strict` or `noImplicitAny` (only `noUnusedLocals/Parameters`, `noFallthroughCasesInSwitch`).
- **Spec ref:** §1.1 ("TypeScript, `strict: true`, no implicit any").
- **Impact:** Implicit `any` and null-unsafety are allowed; contract drift the spec wants caught at compile time slips through (e.g., `details as Record<string, unknown>` casts in `lib/api.ts:160-163` go unchecked).
- **Fix:** Add `"strict": true` (or at minimum `noImplicitAny`, `strictNullChecks`) to both tsconfigs and fix resulting errors.

### F-F01A-04 — MEDIUM — Multiple stack substitutions vs §1.1 (React 19, declarative router, no Zustand, no RHF+zod, no generated client, oxlint)
- **Evidence:** `frontend/package.json:19` (react 19.3.1, spec says 18); `main.tsx:34` + `App.tsx:23-85` (declarative `BrowserRouter`/`<Routes>`, not the data router with loaders/`beforeLoad`); no Zustand (no client-state store); forms hand-rolled with `useState` + manual validation (`Workspace.tsx:88-97, 345-364`) instead of react-hook-form + zod; `lib/api.ts:1-181` + `lib/types.ts` hand-maintained instead of OpenAPI-generated; `package.json:9,29` — `oxlint`, no ESLint/Prettier.
- **Spec ref:** §1.1 (stack table rows).
- **Impact:** Loss of the spec's stated guarantees: compile-time catch of API drift, shared runtime validation, `beforeLoad` guards (see F-F01A-10), single lint/format standard.
- **Fix:** Document intentional deviations or converge: adopt `createBrowserRouter` with loaders, generate the client from the backend OpenAPI schema in CI, add zod schemas for forms.

### F-F01A-05 — MEDIUM — Monaco editor absent; custom read-only code viewer instead
- **Evidence:** `frontend/src/pages/participant/Workspace.tsx:608-645` (hand-built line-numbered div viewer with click/shift-click selection); `package.json:13-32` (no `monaco-editor` dependency).
- **Spec ref:** §1.1 ("Editor: Monaco, self-hosted, lazy-loaded, only needed language workers").
- **Impact:** The workspace chunk budget (§1.3), `worker-src` CSP story (§1.5), and all Monaco-driven interactions (quick open, split, selection→flag shortcuts §2.11) are moot. The replacement is functional for read-only reporting but is a different product surface than spec'd.
- **Fix:** If the read-only viewer is the accepted event design, record the deviation in the spec; otherwise integrate self-hosted Monaco lazily with same-origin workers.

### F-F01A-06 — MEDIUM — Frontend test toolchain (Vitest, Testing Library, Playwright, axe-core, MSW) absent
- **Evidence:** `frontend/package.json:10` (`"test": "node --test"`); sole test `frontend/tests/submission_payload.test.mjs:1-29` (one SSR XSS-rendering check); `.github/workflows/ci.yml:235-237` runs only that.
- **Spec ref:** §1.1 (Tests row), §1.1 quality gate.
- **Impact:** No unit tests for polling/draft/conflict logic, no component tests, no e2e, no accessibility (axe) checks, no MSW-based offline/outbox simulation — precisely the behaviors that are deviating.
- **Fix:** Add Vitest + RTL for lib/components, Playwright journey tests, axe checks on the console pages, MSW handlers for conflict/offline paths.

### F-F01A-07 — MEDIUM — Boot sequence gaps: no `/config.json`, no 3-sample clock sync, no min-client-version gate
- **Evidence:** `frontend/public/` contains only `favicon.svg` (no config.json; grep `config.json` → 0 in src); `Landing.tsx:11-19` (single-sample `/v1/time` per 60 s poll); `auth.tsx:41-66` (boot = refresh + `/v1/me` only; `/v1/state` fetched per-page later); grep `X-Min-Client-Version|min_client` across frontend and backend → 0 matches (backend `main.py:64-92` never sets it).
- **Spec ref:** §2.1 steps 1, 2, 5.
- **Impact:** No blocking "Reload to update" path — a stale client can keep running an event against a newer API; clock offset is a single-sample estimate per page instead of the lowest-latency of 3 samples; runtime feature flags cannot be configured post-build.
- **Fix:** Serve `/config.json` (API base, min client version, flag defaults), sample `/v1/time` 3× at boot picking lowest latency, and honour an `X-Min-Client-Version` response header (or config value) with a blocking screen.

### F-F01A-08 — MEDIUM — No cross-tab refresh coordination (Web Locks / BroadcastChannel)
- **Evidence:** `frontend/src/lib/api.ts:60-89` — `refreshSession()` shares one in-flight promise per tab only; grep `BroadcastChannel|navigator.locks` → 0 matches. Backend rotates the refresh cookie on every use (`backend/app/routers/auth.py:250-356`) with a limited reuse-grace window (auth.py:278).
- **Spec ref:** §2.2.
- **Impact:** Two open tabs refreshing near-simultaneously can present the old (rotated) cookie; outside the grace window the backend's reuse detection revokes the entire session (auth.py:301-306), force-logging the user out mid-round.
- **Fix:** Wrap `performRefresh` in `navigator.locks.request` with a `BroadcastChannel` fallback so one tab refreshes and broadcasts the result; keep a short memory cache of the access token keyed by expiry.

### F-F01A-09 — MEDIUM — Session-expired UX (P-23) and "signed in on another device" variant missing
- **Evidence:** `auth.tsx:44-60` (restore failure silently sets `status: 'anon'`); `chrome.tsx:156-158` (guard redirects to `/login`); Account page lists sessions (`Account.tsx:15-30`) but no D-19 detection or P-23 variants anywhere (grep).
- **Spec ref:** §2.2.
- **Impact:** Users are bounced to the login form with no "Session expired" explanation, no "drafts remain and can be restored" offer (moot until F-F01A-01 is fixed), and no other-device messaging.
- **Fix:** On refresh failure set a reason (`expired` / `revoked-other-session`) and render the P-23 screen; after re-login, return to the saved node (`state.from` already plumbed in `Login.tsx:19-22, 30-31`).

### F-F01A-10 — MEDIUM — Route guards check role only; no state fetch / node-pointer comparison / redirect-with-toast
- **Evidence:** `frontend/src/components/chrome.tsx:138-188` — `RequireRole` waits for session restore, verifies role, renders a 403 panel; no `/v1/state` fetch, no node-pointer or level-status comparison, no forward redirect or toast. Server-side re-check confirmed (backend `state.py:47`, `submissions.py` role deps).
- **Spec ref:** §2.3.
- **Impact:** Participants can navigate directly into pages whose stage preconditions fail and discover it via empty states/API errors instead of a guided redirect; the spec's (c)+(d) convenience layer is absent.
- **Fix:** With a data router, move guards into `beforeLoad`: fetch `/v1/state`, compare node pointer/level statuses, `<Navigate replace>` forward with a toast when blocked.

### F-F01A-11 — MEDIUM — Polling manager: fixed intervals, no jitter/backoff/visibility/online triggers; leaderboard not version-gated
- **Evidence:** `main.tsx:24-26` (`retry: 1`, `refetchOnWindowFocus: false`); fixed `refetchInterval`s: Lobby 5 s (`Lobby.tsx:21,36`), Workspace state 5 s + assignments 15 s (`Workspace.tsx:112-118`), Leaderboard state 10 s + snapshot 20 s regardless of `leaderboard_version` (`Leaderboard.tsx:8-21`); no `?since=` support (backend `leaderboard.py:46-60`); announcements polled separately every 30 s (`Lobby.tsx:43-47`); no `'online'` listener (grep).
- **Spec ref:** §2.4.
- **Impact:** Poll stampedes are synchronized (no ±20% jitter) across all clients every 5 s; no degradation ladder on errors; window focus/online don't refresh; leaderboard is re-downloaded every 20 s even when unchanged; hidden tabs keep the previous data but have no defined 30 s policy; last-good-state is memory-only.
- **Fix:** Centralize a single state-poll hook: interval by round status with jitter, backoff 5→10→20→30 s on failure, `refetchOnWindowFocus` + `online` triggers, refetch-on-visibility, gate the leaderboard query on `leaderboard_version` changes (add `?since=` server-side), and persist last-good state (ties into F-F01A-01).

### F-F01A-12 — MEDIUM — Draft sync: 3 s fixed interval, no pagehide/sendBeacon flush, conflict auto-discards local edits, no status chips
- **Evidence:** `Workspace.tsx:187-239` — `setInterval(…, 3000)` driven by a `dirty` ref (spec: 10 s after last change); no `visibilitychange`/`pagehide`/`sendBeacon` (grep → 0); on `DRAFT_VERSION_CONFLICT` it re-GETs and overwrites the local form with the server payload, sets `dirty.current = false` (`Workspace.tsx:209-234`) instead of the Keep mine / Use server / Compare prompt; status reduced to "draft saved \<time\>" text (`Workspace.tsx:814-816`).
- **Spec ref:** §2.6.
- **Impact:** Two tabs editing → the later save silently throws away one tab's newer input (notice line 230 tells the user to "re-apply your newest edits" — but they were overwritten in state). Closing/navigating the tab within the unsaved window loses edits (no flush).
- **Fix:** Debounce saves to 10 s after last keystroke; add `visibilitychange`/`pagehide` flush via `sendBeacon`; on 409 open a merge prompt offering Keep mine / Use server / Compare; implement the five status chip states.

### F-F01A-13 — MEDIUM — Idempotency key discarded on failed attempt, breaking the stability guarantee
- **Evidence:** `Workspace.tsx:404-419` (report submit catch: `setSubmitError(err); idemKey.current = ''` on *any* `ApiRequestError`, including `network: true` from `api.ts:131-138`); same for flags at `Workspace.tsx:445-451`; key generated per attempt via `newIdempotencyKey()` (`api.ts:178-181`).
- **Spec ref:** §2.7 ("stable `Idempotency-Key`… retried with backoff").
- **Impact:** If the first POST reached the server but the response was lost (exactly the flaky-network case the key exists for), the participant's next click re-submits with a *new* key → duplicate report, consuming per-file/per-round caps and potentially scoring penalties.
- **Fix:** Keep the key stable across retries of the same logical submission; regenerate only after a definitive server rejection (4xx validation) or explicit user reset; pair with the outbox retry (F-F01A-01).

### F-F01A-14 — MEDIUM — Warning/notification system: no toasts, no blocking modals, wrong escalation thresholds, dead OfflineBanner
- **Evidence:** grep `toast` → 0; receipts render inline (`Workspace.tsx:662-674`); no modal/focus-trap component (grep); escalation announces at 10 min and 2 min (`ui/components.tsx:332-343`) with CSS thresholds to match (`lib/format.ts:82-88`) instead of 5/3/1; `OfflineBanner` defined in `chrome.tsx:190-208` but imported nowhere; messages hardcoded, no catalog keys.
- **Spec ref:** §2.8.
- **Impact:** "Time's up" and deadline-critical moments surface only as a red countdown and an aria-live string; there is no persistent top banner, no trap-required action for blocking states, and the 3-minute/1-minute escalations never fire.
- **Fix:** Add a small toast queue (6 s auto-dismiss, `role="status"`), a persistent banner slot in `ConsoleShell`, a focus-trapped modal for blocking alerts, and escalate at 5/3/1 min; move strings to a copy catalog.

### F-F01A-15 — MEDIUM — No connection indicator in the workspace header
- **Evidence:** `Workspace.tsx:467-481` (header contains status chip + countdown only); connection problems surface as per-panel `ErrorBanner`s (`Workspace.tsx:483`, `ui/components.tsx:267-301`); no Online/Reconnecting/Offline/Server degraded/Runner unavailable states (grep → 0).
- **Spec ref:** §2.9.
- **Impact:** During connectivity loss participants have no persistent, always-visible status; they must infer it from scattered panel errors; "Server degraded"/"Runner unavailable" are not representable at all (no flags in `/v1/state`, see F-F01A-16).
- **Fix:** Add a header indicator component driven by the state-poll health (query failure/retry state + `/v1/state` flags) with the five states as icon+text+colour.

### F-F01A-16 — MEDIUM — Maintenance mode and kill-switch flags not in `/v1/state`; no P-24 page
- **Evidence:** backend `state.py:77-94` — `/v1/state` returns no `flags` or `maintenance` field (grep `maintenance` in frontend → 0); kill switches exist only in the admin live-ops payload (`lib/types.ts:297-306`; `admin/Dashboard.tsx:344-350`); participant-side partial equivalents: `leaderboard_visibility` with an explained hidden state (`Leaderboard.tsx:49-56`) and `runner_enabled`/`ai_assessment_enabled` displayed in Lobby config (`Lobby.tsx:182-183`).
- **Spec ref:** §2.10.
- **Impact:** Organizers cannot hide/disable leaderboard, uploads, or AI displays for participants via `state.flags` (leaderboard hidden-ness is stage-config-driven only); there is no maintenance page, so a degraded platform is experienced as scattered errors.
- **Fix:** Add `flags` (incl. `maintenance`) to the `/v1/state` aggregate; render P-24 with the status link when `maintenance=true` (allow admin sign-in); gate the spec'd features on the flags with explanations.

### F-F01A-17 — MEDIUM — No React error boundary anywhere
- **Evidence:** grep `ErrorBoundary|componentDidCatch|getDerivedStateFromError` across `frontend/` → 0 matches.
- **Spec ref:** §2.12 ("Error boundary per route and per major panel").
- **Impact:** Any unexpected render-time exception (e.g., malformed API payload hitting an unchecked cast such as `Workspace.tsx:163` `p.line_start` handling) unmounts the entire SPA to a blank page — no recovery, no request_id, no support info.
- **Fix:** Add route-level boundaries in `App.tsx` and panel-level boundaries inside `ConsoleShell`/`Panel` showing the error envelope with request_id and a retry/reload action.

### F-F01A-18 — MEDIUM — Workspace keyboard shortcuts and shortcut help unimplemented
- **Evidence:** grep `ctrlKey|metaKey` in `Workspace.tsx` → only Home/End guards (lines 296-299); viewer-local keys (arrows/Home/End/Enter/Shift+Enter) at `Workspace.tsx:286-311`; no quick-open, split, sidebar, flag-panel, run/build, Esc, or `?` help dialog (grep → none).
- **Spec ref:** §2.11.
- **Impact:** The spec'd keyboard ergonomics for the 180-minute round are absent (some are N/A given the read-only viewer redesign); nothing can close a panel/modal via Esc because none exist; participants get no discoverability help.
- **Fix:** Implement at minimum `Esc` (close overlays), `?` (shortcut help dialog), and quick-open file search over the file tree; align the rest with the shipped workspace model.

### F-F01A-19 — MEDIUM — No unsupported-device gate (P-24) for execution pages
- **Evidence:** grep `matchMedia|1024|unsupported|P-24` in `frontend/src` → 0 (only byte-format constants in `format.ts:60-62`); workspace grid collapses under 1180/860 px (`app.css:917-926`) but remains the same interaction model on a phone.
- **Spec ref:** §1.4.
- **Impact:** On narrow/no-pointer devices the workspace renders in a cramped but "supported" state instead of the explicit unsupported-device page, harming usability and producing degraded submissions rather than a clear message.
- **Fix:** Gate `/app/workspace` (and future execution pages) on `window.matchMedia('(min-width: 1024px) and (pointer: fine)')`; render P-24 otherwise.

### F-F01A-20 — MEDIUM — No CSP (inline-script ban, worker-src) anywhere
- **Evidence:** `frontend/index.html:1-18` (no CSP meta tag; body has no inline script, so a policy would be trivial); backend `main.py:85-92` sets only `X-Content-Type-Options`, `Referrer-Policy`, `Cache-Control` (grep `Content-Security-Policy` → 0).
- **Spec ref:** §1.5.
- **Impact:** The defense-in-depth layer against injected markup (e.g., submission descriptions rendered in team-visible UIs) is absent; also blocks nothing if Monaco/`worker-src` arrives later.
- **Fix:** Add a strict CSP (`default-src 'self'`; `script-src 'self'`; `worker-src 'self'`; `style-src 'self' 'unsafe-inline'` if needed for inline styles) as a meta tag and/or backend header on the SPA host.

### F-F01A-21 — LOW — Runtime config, source-map handling and asset caching policies unimplemented
- **Evidence:** no `/config.json` (see F-F01A-07); API base implied by same-origin + Vite proxy (`vite.config.ts:12-21`); no error-tracker or source-map upload step (grep); no immutable/1-year asset caching or `index.html` revalidation config (dev/preview servers only).
- **Spec ref:** §1.5.
- **Impact:** Deployment flexibility (API base override) and cache-correctness are unaddressed; acceptable for the current single-origin dev setup but gaps for production.
- **Fix:** Generate `/config.json` at deploy time, add a static-host config with hashed immutable assets and no-cache `index.html`, upload sourcemaps to the tracker (if one is adopted).

### F-F01A-22 — LOW — No copy catalog; all user-facing strings hardcoded inline
- **Evidence:** e.g. `ui/components.tsx:335-341` ("10 minutes remaining"), `Workspace.tsx:230` (draft conflict notice), `chrome.tsx:196-198` (offline banner) — no `packages/copy`, no key system (grep).
- **Spec ref:** §2.8 (final paragraph), §2.13.
- **Impact:** Wording changes require code edits; the future-language path the spec reserves is closed.
- **Fix:** Extract user-facing strings into a keyed catalog module and consume via a `t(key)` helper.

### F-F01A-23 — LOW — Error envelope lacks a "Copy details" action
- **Evidence:** `ui/components.tsx:282-291` — `ErrorBanner` prints `code: … · request: …` as plain text; grep `clipboard|Copy details` → 0.
- **Spec ref:** §2.12.
- **Impact:** Support escalations require manual transcription of the request id.
- **Fix:** Add a copy button that puts `code`, `request_id`, and timestamp on the clipboard with a confirmation.

### F-F01A-24 — LOW — Time zone hardcoded to Asia/Kolkata with literal "IST" instead of the event's zone
- **Evidence:** `lib/format.ts:3-48` — fixed `IST` constant and literal `" IST"` suffixes; `PublicEvent.timezone` field exists (`lib/types.ts:48`) but is never read (grep `timezone` in src → types only).
- **Spec ref:** §2.13.
- **Impact:** Correct for the default event, but if the event record publishes any other zone, every schedule/deadline label silently shows IST; zone abbreviation is a hardcoded string rather than derived.
- **Fix:** Read `timezone` from the event/public endpoints, format via `Intl.DateTimeFormat` with `timeZoneName: 'short'`, default to Asia/Kolkata.

## EXTRA (implemented, not in §1–2 scope; notable only)

- **Step-up re-auth panel** (`src/components/StepUp.tsx:10-60`, backend `auth.py:472-482`) — privileged admin operations require password re-confirmation; good security posture, spec'd in the backend/auth docs rather than §1–2.
- **Session management UI** (`Account.tsx:15-30` + backend `/v1/me/sessions`) — device session list and revocation; complements §2.2 but not itself a §2.2 requirement.
- **Admin challenges page persists known ids in `localStorage`** (`admin/Challenges.tsx:23-32`) — uses raw localStorage where the spec'd storage layer is IndexedDB; harmless convenience, contradicts the "all local state in `bhctf-v1`" model once that lands.
- **Em-dash/placeholder hygiene CI job** (`.github/workflows/ci.yml:242-257`) — beyond §1.1's quality gate; no participant-build secret grep though (see F-F01A-02).

---

### 4.2 01 Frontend Specification, sections 3-end - design tokens, component catalog, testing (`spec01b`)

# Frontend Spec Audit — spec01b (Task 3-b)

- **Agent:** spec01b
- **Task ID:** 3-b
- **Baseline document:** `/home/z/my-project/upload/01_Frontend_Spec (1).md` (01 Frontend Specification)
- **Sections covered:** §3 Design tokens, §4 Component catalog (4.1–4.4), §5 Participant pages, §6 Admin pages, §7 Frontend testing and acceptance (to end of document)
- **Repo audited:** `/home/z/my-project/bug-hunt-hackathon` at HEAD `f1412b7eec6c92c4c168fd2b8a58182b34480387` (2026-11-26), read-only
- **Scope of code:** `frontend/src` (App.tsx, components/, lib/, pages/, styles/, ui/, tests)
- **Context note:** the implemented product is a single-stage "Fall Back" debugging competition (read-only code inspection + bug report/CTF-flag desk) with reviewer and organizer consoles. The spec describes a four-level event flow with repo choice, editable Monaco stages, build/run and uploads. Many spec items are therefore absent rather than partially built; this is a deliberate product-model reduction (see `docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md`, `backend` ADR notes) but still a spec-compliance gap and is reported as such.

## Overall verdict

The implementation is a coherent, security-conscious React SPA that satisfies the *spirit* of the component/page model for the reduced event format, with strong points: idempotent submissions, XSS-safe text rendering, server-clock-synced countdowns with polite SR announcements, reduced-motion support, generic login errors, role guards and step-up gating. It does **not** implement the spec's four-level flow, Monaco editing, the separate participant/admin apps, the design-token system, or the testing program. Roughly half of the catalogued components/pages are missing or replaced by simpler equivalents.

## Status summary

| Status | Count (spec refs) |
|---|---|
| DONE | 0 (no ref is fully met as specified; closest are folded into PARTIAL rows) |
| PARTIAL | 64 |
| DEVIATION | 4 |
| MISSING | 80 |

Findings: **22** — HIGH 3, MEDIUM 15, LOW 4.

---

## Per-section status table

Legend: DONE / PARTIAL / MISSING / DEVIATION. Paths are relative to repo root.

### §3 Design tokens

| Spec ref | Requirement (short) | Status | Evidence | Notes |
|---|---|---|---|---|
| 3.1 | Semantic colour roles (bg, surface, surface-raised, border, text, text-muted, accent, accent-contrast, success, warning, danger, info, focus-ring, overlay, editor-bg) | DEVIATION | frontend/src/styles/tokens.css:3-16 | A semantic palette exists but under different names (`--ink`, `--panel`, `--panel-2`, `--line`, `--line-strong`, `--paper`, `--muted`, `--signal`, `--ok/warn/danger/info`). No `focus-ring` token (focus uses `--signal` outline, app.css:30-34), no `overlay`, no `editor-bg`. |
| 3.1 | Light + dark values per role; dark default in workspace, rest follows OS; user override in `ui` store | PARTIAL | frontend/src/styles/app.css:10-12 (`color-scheme: dark` only) | Dark-only design; no light theme, no OS-follow, no user override store. |
| 3.1 | Contrast ≥ 4.5:1 text, ≥ 3:1 UI | PARTIAL | frontend/src/styles/app.css:1004 (`--line-no` `#5d666f` on panel ≈2.9:1); app.css:425-428 (placeholder `#6d757e` ≈3.4:1) | Body/`--muted` colours pass (≈7:1); line numbers and placeholders fall below thresholds. |
| 3.2 | UI: system sans stack; code: monospace, ligatures off | DEVIATION | frontend/src/styles/tokens.css:18-20; frontend/src/main.tsx:7-15 | Self-hosted Fraunces/Archivo/IBM Plex Mono via Fontsource (CSP-friendly, no CDN) instead of system stack; ligatures not explicitly disabled for mono. |
| 3.2 | Type scale 12/14/16/18/20/24/30/36; line-height 1.5/1.3 | PARTIAL | frontend/src/styles/app.css:19 (15px body), app.css:123-143 (display sizes via clamp) | Body is 15px/1.55; headings 1.05 (spec: 1.3). Scale not tokenised. |
| 3.2 | Spacing 4px scale; radius 4/8/12; z-index layer tokens | DEVIATION | frontend/src/styles/tokens.css:22-23 (radius 3px/2px); app.css:773-779 (hardcoded `z-index: 30` on topbar) | "Case File" design system intentionally uses radius ≤3px; no z-index layer scale; spacing informal. |
| 3.3 | Motion tokens 120/200/300ms, ease-out/in; progress expand 150ms; flag panel reveal 280ms | PARTIAL | frontend/src/styles/tokens.css:24 (`--speed: 120ms` only); app.css:192, 305 (linear transitions) | Single speed token, linear easing; no 200/300ms tokens, no easing tokens, no progress-bar/flag-panel animations (those components don't exist). |
| 3.3 | Reduced motion → instant/0ms fades, no parallax | DONE (within 3.3) | frontend/src/styles/app.css:41-50; app.css:887-894 (pulse gated behind `prefers-reduced-motion: no-preference`) | Correctly implemented; countdown pulse disabled under reduced motion. |

### §4.1 Foundation components

| Spec ref | Requirement (short) | Status | Evidence | Notes |
|---|---|---|---|---|
| C-01 | Button: variant/size/loading/disabled/`aria-busy`; ≥40px target; loading keeps width | PARTIAL | frontend/src/ui/components.tsx:132-166; frontend/src/styles/app.css:298 (9px 16px padding ≈37px tall) | variant/size/disabled/title/ariaLabel present; no `loading` prop, no `aria-busy`, no width preservation; below 40px min target. |
| C-02 | IconButton with required label | PARTIAL | frontend/src/ui/components.tsx:132-166 (Button `ariaLabel` prop used with icon-only content, e.g. Workspace.tsx:565-571, 590-592) | Covered via `Button` + `aria-label`; no dedicated component, label not enforced by type. |
| C-03 | TextInput/Textarea: label/error/hint/counter; counter live region at limit | PARTIAL | frontend/src/ui/components.tsx:211-236 (Field: label, hint, `role="alert"` error); Workspace.tsx:756, 766, 776, 787, 798 (counters as plain hint text) | Field wrapper good; counters are static hint text, not live regions. |
| C-04 | Checkbox/Radio: real inputs, large hit area | PARTIAL | frontend/src/styles/app.css:447-473 (native `input[type=checkbox]` restyled, 16px); no radio inputs anywhere in frontend/src | Custom checkbox is a real input but only 16px hit area; radios unused (selects instead); error state not styled. |
| C-05 | Select/Combobox incl. async, file suggestions | PARTIAL | frontend/src/styles/app.css:401-423 (`.select`); Workspace.tsx:706-710 (`<datalist>` suggestions for file paths) | Native select + datalist; no async combobox. |
| C-06 | Tabs with arrow-key navigation | PARTIAL | frontend/src/pages/participant/Workspace.tsx:650-660 (`role=tablist/tab`, `aria-selected`) | Correct ARIA roles but no arrow-key navigation, no `tabpanel` roles, no focus management. |
| C-07 | Modal: focus trap, returns focus, Esc | MISSING | no `role="dialog"`/`aria-modal` in frontend/src (grep) | No modal component exists at all. |
| C-08 | ConfirmModal: cooldownSeconds, safe default | PARTIAL | frontend/src/ui/components.tsx:169-207 (ConfirmButton two-step confirm, 6s auto-disarm) | Deliberate inline replacement; no cooldownSeconds prop, no focus trap/safe-default focus (it's inline, not modal). |
| C-09 | Toast / ToastRegion (polite live region) | MISSING | no toast in frontend/src (grep: `toast` only as aria-live spans, components.tsx:354, Workspace.tsx:568) | No toast system; statuses rendered inline. |
| C-10 | Banner: severity/action/dismissible; role=status/alert | PARTIAL | frontend/src/styles/app.css:532-584 (banner tones); components.tsx:267-301 (ErrorBanner `role=alert`) | Good banner styling + roles; no dismiss action, not dismissible per instance. |
| C-11 | Tooltip/Popover: keyboard and touch triggers | PARTIAL | native `title` attributes only (e.g. components.tsx:32, Workspace.tsx:898, StepUp.tsx:97) | Native tooltips only; no keyboard-triggerable popover component. |
| C-12 | Skeleton/Spinner/EmptyState/ErrorState; skeletons match layout | PARTIAL | components.tsx:240-249 (EmptyState), 251-265 (LoadingShell/Line), 267-301 (ErrorBanner) | Empty/Error states solid; LoadingShell is a text label, not a layout-matching skeleton (CLS risk); no spinner. |
| C-13 | Badge/StatusChip: text plus icon | PARTIAL | components.tsx:83-90 (StatusChip text-only); icons.tsx:35 (`aria-hidden`) | Chips are text-only; status conveyed without icon (spec asks icon+text for warnings; tones do vary colour+text). |
| C-14 | Card/Panel/SplitPane resizable | PARTIAL | components.tsx:94-128 (Panel); no SplitPane in frontend/src | Panel solid; workspace is a fixed 3-col grid (app.css:910-930), no resizable split. |
| C-15 | Table/List virtualised | PARTIAL | frontend/src/styles/app.css:625-672 (`.table`); Leaderboard.tsx:75-103; Results.tsx:131-193 | Plain HTML tables, not virtualised; acceptable at current scale, spec requires virtualised for leaderboard/admin. |
| C-16 | Markdown/RichContent, strict sanitiser | PARTIAL | components.tsx:367-423 (PlainMarkdown — renders as React text children, never builds HTML) | Safe by construction (XSS test: frontend/tests/submission_payload.test.mjs:7-29); subset only (h1/h2/h3/ul/p — no links/tables/images). |

### §4.2 Event components

| Spec ref | Requirement (short) | Status | Evidence | Notes |
|---|---|---|---|---|
| C-20 | ProgressBar event-wide, nav landmark, % for SR | MISSING | no progress bar component; ConsoleShell chrome.tsx:102-135 has no progress bar | Nothing equivalent; lobby shows round status only. |
| C-21 | Countdown server-synced; never decides lateness; on zero refetch | PARTIAL | components.tsx:315-359; format.ts:82-88; Workspace.tsx:474-480, 863-879 | Uses server offset (`clockOffset`); displays 00:00:00 at zero and announces "Time is up", but no refetch-on-zero wiring; thresholds 10min/2min (spec: 10/1/zero announcements). |
| C-22 | LevelCard statuses | MISSING | no level cards; Lobby.tsx:78-120 shows a single round clock | Single-stage model; no per-level cards. |
| C-23 | TeamPanel: members, lead badge, per-member status, repo choice | PARTIAL | Lobby.tsx:195-213 (team name, join code, event status) | No member list, lead badge, per-member status or repo choice. |
| C-24 | ScoreCard: animates on change, live region announce | PARTIAL | Results.tsx:88-111 (static score total in plain span) | No animation, no live-region announcement on change. |
| C-25 | Leaderboard: pins own row, frozen/hidden banners, reorder animation | PARTIAL | Leaderboard.tsx:49-108 (hidden/no-snapshot/frozen states); no own-row pin, no animation | Hidden/frozen messaging good; my-team pin and reduced-motion-safe reorder animation absent. |
| C-26 | GateButton: backend check, polls while waiting | MISSING | no gate button; workspace opens directly (App.tsx:42) | No gate/start-button flow. |
| C-27 | AnnouncementBar: dismissible per id, critical persist | PARTIAL | Lobby.tsx:216-236 (announcements with severity chips, timestamps) | Shown in lobby panel; not dismissible per id, no critical persistence, no bar above workspace. |
| C-28 | ConnectionIndicator in workspace header (§2.9 states) | MISSING | frontend/src/components/chrome.tsx:190-208 (OfflineBanner exists but is **not used** anywhere) | Workspace header (Workspace.tsx:467-481) has no connection indicator. |
| C-29 | StatusChip (sync): 5 sync states from §2.6 | PARTIAL | Workspace.tsx:814-816 (plain "draft saved …"/"autosaves every 3s" text) | No chip state machine; only a plain-text draft-saved line; no queued/accepted states. |
| C-30 | RepoOptionCard | MISSING | no repo options in frontend/src | Repo-choice flow not implemented (single challenge assignment). |
| C-31 | RepoLockSection | MISSING | no repo-lock UI | — |
| C-32 | ExplainContent with screenshots, lazy images | MISSING | Assignment has `instructions_markdown` (frontend/src/lib/types.ts:123) but no page renders it | Field exists in type; never displayed to participants. |

### §4.3 Workspace components

| Spec ref | Requirement (short) | Status | Evidence | Notes |
|---|---|---|---|---|
| C-40 | WorkspaceShell: resizable regions, layout persisted | PARTIAL | frontend/src/styles/app.css:910-930 (fixed 250px/1fr/380px grid); Workspace.tsx:499-857 | Fixed responsive grid; no resizable regions, no per-stage layout persistence. |
| C-41 | FileExplorer: virtualised, keyboard tree, search, own repo only | PARTIAL | Workspace.tsx:499-557 (tree with `role=tree`/`treeitem`, aria-selected); 528-544 (server-side search form) | Real tree roles; no virtualisation, no arrow-key tree navigation; search is a different (server full-text) feature. |
| C-42 | EditorPane: Monaco with tabs, read-only L1-2 / editable L3-4, tab cap 8 | DEVIATION | Workspace.tsx:608-638 (custom read-only line renderer with `.line-no`); no Monaco (grep: 0 hits) | Custom read-only code viewer (click/drag/keyboard line selection, find-in-file) — solid for read-only inspection, but Monaco, tabs and any editable mode are absent. |
| C-43 | EditorSplit: two panes, same file, independent scroll | MISSING | no split in frontend/src | — |
| C-44 | QuickOpen `Ctrl/Cmd+P` fuzzy file search | MISSING | no keybinding; nearest is server-side text search Workspace.tsx:322-333 and datalist Workspace.tsx:706-710 | Ctrl/Cmd+P not bound. |
| C-45 | FlagPanel bottom panel (Website Spec §3.5) | MISSING | report desk is a right-hand column, not a bottom panel (Workspace.tsx:649-856) | Layout deviation folded here. |
| C-46 | FlagForm: file/lines/explanation; L2 locations list | MISSING | replaced by a different report model (Workspace.tsx:689-818: title, category, severity, description, impact, evidence, fix) | Different (richer) form; multi-location not supported. |
| C-47 | LocationRow validation vs tree/file length | MISSING | client checks only span ≤25 and N≤M (Workspace.tsx:348-354); file existence only via datalist suggestion | Server re-validates (VALIDATION_ERROR handled, Workspace.tsx:404-414). |
| C-48 | FlagList with add/delete, per-flag validity, max flags message | MISSING | single form, one report at a time; server caps surfaced as errors (Workspace.tsx:410-414) | — |
| C-49 | PlaceholderPicker | MISSING | no placeholder picker | — |
| C-50 | BuildPanel Run/Build states | MISSING | no run/build anywhere in participant frontend (runner disabled by deployment: Dashboard.tsx:756-759) | — |
| C-51 | OutputViewer | MISSING | — | — |
| C-52 | UploadDropzone (zip/diff upload) | MISSING | only admin file upload (Challenges.tsx:114-132, plain `<input type=file>`) | Participant upload path absent. |
| C-53 | DiffExportButton | MISSING | — | — |
| C-54 | SubmitDialog: summary, "can't go back", idempotent submit | DEVIATION | Workspace.tsx:374-423 — direct submit button + `Idempotency-Key` (api.ts:121, 178-181); inline receipt panel (Workspace.tsx:662-674) | Idempotency DONE; no confirmation dialog, no summary, no "can't go back" warning; receipt replay flag handled (`receipt.replay`). |
| C-55 | DraftSync implements §2.6 | PARTIAL | Workspace.tsx:187-239 (3s interval autosave, dirty flag), 209-234 (409 DRAFT_VERSION_CONFLICT → server version wins + notice), 149-185 (restore) | No 10s-after-last-change debounce, no file-switch/pagehide/`sendBeacon` flush, no "Keep mine/Use server/Compare" merge prompt, no local IndexedDB persistence (draft lost on reload if server unreachable). |

### §4.4 Admin components

| Spec ref | Requirement (short) | Status | Evidence | Notes |
|---|---|---|---|---|
| C-60 | DataTable server-paginated (cursor) | PARTIAL | Dashboard.tsx:550-640 (audit: `limit` + Load more, max 500); other tables load full lists (e.g. DisputesSection 644-728, EventsSection 64-208) | No cursor pagination; limit-based growth only. |
| C-61 | FilterBar saved filters, URL-synced | PARTIAL | Dashboard.tsx:551-555 (audit action filter, client-side); review/Queue.tsx:13, 79-89 (status filter buttons) | Filters exist but client-side only, not URL-synced, not saved. |
| C-62 | StepUpDialog re-authentication | PARTIAL | StepUp.tsx:10-88 (StepUpPanel, POST /v1/auth/step-up, 5-min window), 91-93 (`needsStepUp`); used in Challenges.tsx:60-61, 202 | Functional step-up (password); inline panel not dialog; only wired into challenge content ops. |
| C-63 | ReasonDialog before pausing/rescoring/overriding | PARTIAL | Dashboard.tsx:374-394 (reason field required to enable stage actions; extend includes reason 242-256) | Reason required for stage control only — not for event lifecycle transitions (81-92) or dispute resolution (655-675). |
| C-64 | DiffViewer for config/challenge revisions | MISSING | — | — |
| C-65 | ChecklistEditor with owner and state | PARTIAL | Dashboard.tsx:459-514 (check/uncheck/na per item; `owner` in type types.ts:312 but never rendered) | State editing works; owner/evidence link not shown. |
| C-66 | ReviewWorkbench: report, code view, AI panel, decision form | PARTIAL | review/ItemDetail.tsx:164-232 (payload as text + file with highlighted range), 236-290 (decision + rubric 0–1 sliders) | No AI panel, no ground-truth excerpt, no official run result, no AI override. |
| C-67 | KillSwitchPanel toggles with confirmation/state/history | PARTIAL | Dashboard.tsx:344-350 (read-only chips: `{k}: on/off`) | Display only — no toggles, no confirmation, no history. |
| C-68 | ScheduleEditor with validation | MISSING | schedule displayed read-only in Lobby.tsx:163-190 | No editor. |
| C-69 | JsonConfigEditor | MISSING | — | — |
| C-70 | AuditEntryView with before/after, chain verification | PARTIAL | Dashboard.tsx:550-640 (entries table + chain verify banner 589-597) | No before/after (redacted) fields, no export, no checkpoint status. |

### §5 Participant pages (conventions: title/heading/landmark, focus management, loading/error/offline states)

| Spec ref | Requirement (short) | Status | Evidence | Notes |
|---|---|---|---|---|
| §5 conv. | Every page sets document title | PARTIAL | static `<title>` frontend/index.html:12; no `document.title` anywhere in frontend/src (grep) | Single static title; per-route titles missing. |
| §5 conv. | Focus moves to page heading on route change | MISSING | no focus management in frontend/src | — |
| §5 conv. | Loading/error/offline states per page | PARTIAL | LoadingShell/ErrorBanner used consistently (e.g. Lobby.tsx:71-72, Submissions.tsx:37-38); offline state = generic network error (api.ts:131-138) | Consistent pattern, but no dedicated offline state or last-good-cache paint. |
| P-01 | Landing `/` hero/brief/rules/links/footer, states, server-time countdown | PARTIAL | Landing.tsx:346-421 (hero, sign-in), 94-132 brief, 259-301 conduct+rules link; EventStatusStrip 21-92 (server time via /v1/time, countdown); footer chrome.tsx:49-84 | No "Go to dashboard" when signed in (nav shows "Open console" chrome.tsx:33-37); no status/support links in footer; SR announcements at 10min/2min vs spec 10/1/zero. |
| P-02 | Sign-in: identifier+password, states, forgot link, no enumeration | PARTIAL | Login.tsx:24-95 (generic server errors, `autocomplete=current-password`, no tokens in URL); no forgot-password link; email-only (no username) | Header copy contradicts footer copy (see F-F01B-20); no dedicated rate-limit state (server message only). |
| P-03 | Consent gate: checkboxes, versions, blocks all pages, PDF download | PARTIAL | Lobby.tsx:134-145 ("Accept rules" button → POST /v1/me/acceptances, auth.tsx:99-102); server enforces acceptance (backend/app/deps.py:121) | No `/consent` page, no explicit checkboxes/telemetry notices, doesn't block navigation client-side (server rejects instead), no PDF download. |
| P-04 | Activation + password reset pages | MISSING | Login page states accounts need no activation (Login.tsx:45-51); backend exposes /auth/activate, /auth/password/reset-request (backend/app/routers/auth.py:6-7) but no frontend UI | Reset-by-email unreachable from UI. |
| P-05 | Dashboard `/dashboard` (ScoreCard, Leaderboard, LevelCards, TeamPanel, Resume) | PARTIAL | replaced by `/app` Lobby (App.tsx:41; Lobby.tsx) with Team panel, announcements, shortcuts; ScoreCard/LevelCards/Resume/progress bar absent | Route and layout deviate. |
| P-06 | Event details `/event` with TOC/anchors | MISSING | landing covers a brief only; content endpoint `/v1/public/event` used for status strip (Landing.tsx:27-31) | — |
| P-07 | Level 1 explanation + repo lock | MISSING | no repo options / lock flow (no `/v1/team/repo-lock` in frontend) | — |
| P-08 | Know-more repo pages | MISSING | — | — |
| P-09 | Explanation pages L2-4 | MISSING | — | — |
| P-10 | Execution pages L1-2 (read-only editor, flags, submit flow, auto-submit) | DEVIATION | Workspace.tsx (see C-40..C-55 rows) | Implemented as a single read-only workspace + report/flag desk; different endpoints (/v1/assignments, /v1/challenges/{id}/files/content, /v1/drafts/{challengeId}, /v1/submissions — Workspace.tsx:111, 128, 154, 200, 381); idempotent submit DONE; auto-submit client UX missing (F-F01B-13). |
| P-11 | Execution pages L3-4 (editable, BuildPanel, upload, diff export) | MISSING | no editable editor/run/upload/export in frontend/src (grep: no monaco, no /v1/runs, no uploads) | See F-F01B-01. |
| P-12 | Rules page, searchable, versioned | PARTIAL | Rules.tsx:7-50 (`/rules`, version + frozen date via `/v1/public/rules`) | Versioned and server-served; no search/TOC, no side-panel mode. |
| P-13 | Guide/worked-example page | MISSING | — | — |
| P-14 | Receipt page (code, time, counts, status) | PARTIAL | Workspace.tsx:662-674 (inline receipt), Submissions.tsx, SubmissionDetail.tsx:38-84 (receipt code, status, payload) | Receipt code/status/time shown; no dedicated page, no counts summary. |
| P-15 | Results `/results` (score by level/component, rank, dispute link) | PARTIAL | Results.tsx:18-201 (`/app/results`; totals by component, penalties, ledger entries, inline dispute) | Rank/tie-break note lives on leaderboard page instead (Leaderboard.tsx:104-106); per-flag outcomes only when released (correct). |
| P-16 | Dispute form: item, reason limit, deadline, status, idempotent | PARTIAL | DisputeForm.tsx:15-113 (10–1000 chars, ConfirmButton, server errors surfaced) | No idempotency key on POST (39-42), no deadline countdown, no status tracking of filed disputes (F-F01B-12). |
| P-17 | Team page (members, roles, per-level status) | MISSING | only Lobby team summary (Lobby.tsx:195-213) | — |
| P-18 | Profile + sessions | PARTIAL | Account.tsx:50-66 (name, email, role, rules version), 68-124 (device sessions + revoke via ConfirmButton) | No change-password form, no data-request link. |
| P-19 | System check (IndexedDB, WebCrypto, Web Locks, clock drift, …) | MISSING | Lobby readiness (Lobby.tsx:123-160) checks team/rules/round only; no device capability checks | — |
| P-20 | Practice mode (optional) | MISSING | — | Optional feature; acceptable. |
| P-21 | Announcements page | PARTIAL | announcements only in Lobby panel (Lobby.tsx:216-236); no dedicated page | — |
| P-22 | Support page (FAQ search, report form w/ request_id) | MISSING | footer says "Platform questions go to the organizers" (chrome.tsx:57-61) | No support page/form. |
| P-23 | Session-state pages (expired/elsewhere/disabled/DQ) | PARTIAL | RequireRole redirects to /login when refresh fails (chrome.tsx:156-158; auth.tsx:41-66); error banners elsewhere | No dedicated session-expired/other-device screens. |
| P-24 | System pages (not started, ended, maintenance, unsupported, 403, 404, 500, offline) | PARTIAL | NotFound.tsx:5-46 (EX-404); access denied EX-403 (chrome.tsx:172-181); round "ended/evaluating/released" notices (Workspace.tsx:690-696) | No maintenance/unsupported-device/offline/500 pages. |

### §6 Admin pages

| Spec ref | Requirement (short) | Status | Evidence | Notes |
|---|---|---|---|---|
| A-01 | Admin sign-in + MFA (TOTP/WebAuthn) | PARTIAL | same /login for all roles (App.tsx:32); step-up = password only (StepUp.tsx:30-33) | No MFA, no Cloudflare-Access identity step. |
| A-02 | Admin home (health, transitions, queue ages, backlog, readiness, audit) | PARTIAL | Dashboard.tsx:766-830 composes all sections | Good coverage of the reduced model. |
| A-03 | Events list | PARTIAL | Dashboard.tsx:133-177 (name, slug, status, caps, versions) | No participant counts; embedded, not `/events`. |
| A-04 | Event detail/config, revisions, diff, publish freeze | MISSING | — | — |
| A-05 | Stage configuration | MISSING | UI says stages are created "via the stage API" (Challenges.tsx:286; Dashboard.tsx:356-358) | No stage-creation UI at all. |
| A-06 | Schedule editor with validation | MISSING | — | — |
| A-07 | Participants + CSV import | MISSING | — | Teams/accounts come from seed scripts (backend/seed.py). |
| A-08 | Teams management | MISSING | — | — |
| A-09 | Repo options admin | MISSING | N/A (no repo options in product) | — |
| A-10 | Challenge packages list (status, versions, hashes) | PARTIAL | Challenges.tsx:353-371 (localStorage id list only); no listing endpoint (noted Challenges.tsx:178-182) | Ids kept per browser; no status/version/hash list. |
| A-11 | Challenge upload + validation report | PARTIAL | Challenges.tsx:232-262 (single-file upload, freeze shows hash 134-139); no validation report (paths/sizes/langs/anchors) | — |
| A-12 | Challenge detail (files, tree, hashes, freeze/seal/publish) | PARTIAL | Challenges.tsx:312-351 (assigned challenge file list w/ line counts+sizes); freeze+publish 141-150 | Read-mostly; no tree browser or review state. |
| A-13 | Ground-truth editor (bugs, locations, aliases, severity) | PARTIAL | only test-results recorder Challenges.tsx:291-310 (POST .../ground-truth/test-results) | No bug/location/alias editor UI. |
| A-14 | Test cases editor | MISSING | — | — |
| A-15 | Rubric editor | PARTIAL | reviewer rubric sliders exist (ItemDetail.tsx:259-278) but no admin editor, no weights-sum-1 check, no hash | — |
| A-16 | Matcher harness | MISSING | — | — |
| A-17 | Content editor (pages, versions, screenshot library, copy catalog, placeholder pool) | MISSING | rules/event content comes from seed/backend | — |
| A-18 | Live ops console (round state, pause/resume/extend w/ reason, queue, announcements, kill switches) | PARTIAL | Dashboard.tsx:212-291 (stage control + extend + reason), 300-351 (metrics), 431-452 (announcements) | No per-participant lookup, no force-open/close. |
| A-19 | Kill switches (toggles, confirmation, reason, history) | PARTIAL | read-only chips (Dashboard.tsx:344-350) | No toggles. |
| A-20 | Announcements (compose, schedule, severity, audience, expire) | PARTIAL | Dashboard.tsx:431-452 (severity + body) | No schedule/audience/expiry. |
| A-21 | Review queue (filters, capacity, backlog forecast) | PARTIAL | review/Queue.tsx:17-48 (poll 8s, claim), 79-89 (all/open/claimed/mine filters); backlog count on Dashboard.tsx:319-323 | No stage/age/severity/assignee filters, no forecast. |
| A-22 | Review workbench (matcher features, GT excerpt, AI, run result, decision) | PARTIAL | review/ItemDetail.tsx (see C-66) + decisions incl. unplanned/duplicate/needs-second-review (types.ts:377-384) | No AI panel/GT excerpt/run result/AI override. |
| A-23 | Disputes (evidence, second reviewer, decision) | PARTIAL | Dashboard.tsx:644-728 (resolve with outcome + points adjustment) | No second-reviewer assignment, no evidence view beyond statement. |
| A-24 | Rescoring (scope, dry-run diff, execute) | MISSING | — | — |
| A-25 | Leaderboard control (mode, freeze, snapshot, tie-break preview) | MISSING | visibility set server-side only | — |
| A-26 | Finalization checklist + irreversible confirm | PARTIAL | event transition `closed→finalized` via ConfirmButton (Dashboard.tsx:31-38, 160-169) | No checklist gate in UI (readiness panel exists for `ready→live`). |
| A-27 | Runner console | MISSING | runner disabled by deployment (Dashboard.tsx:756-759) | — |
| A-28 | AI console | MISSING | — | — |
| A-29 | Integrity console (two-approver DQ) | MISSING | — | — |
| A-30 | Audit viewer (search/filter, chain, checkpoint, export) | PARTIAL | Dashboard.tsx:550-640 (filter + chain verification) | No export, no checkpoint status, no before/after. |
| A-31 | Exports (results, submissions, ledger, audit, participant data; expiring links) | PARTIAL | Dashboard.tsx:518-548 (results/submissions/ledger CSV via direct blob download, StepUp.tsx:109-119) | Audit + participant-data exports missing; delivered as immediate client download, not expiring links. |
| A-32 | System health (services, DB, disk/WAL, backup age, queues) | PARTIAL | Dashboard.tsx:732-762 (DBs, jobs, queue age, profile, environment) | No disk/WAL/backup/restore drill data. |
| A-33 | Readiness checklist (owner, evidence link, blocks go-live) | PARTIAL | Dashboard.tsx:459-514 (state editing, unchecked blocker chip 487) | Owner/evidence link not shown; enforcement is server-side. |
| A-34 | Users and roles (MFA state, disable, step-up) | MISSING | — | — |
| A-35 | Settings (rules/consent versions, retention, templates) | MISSING | — | — |
| §6 UI rules | Confirm modal + reason + audit for every sensitive action | PARTIAL | reason required for stage control (Dashboard.tsx:363-394); ConfirmButton on end-round/transitions/resolve (Dashboard.tsx:388, 160-168, 718); audit written server-side | Event transitions and dispute resolution have no reason field. |
| §6 UI rules | Sensitive-data banner + log views on GT/test/rubric pages | PARTIAL | step-up gate exists (Challenges.tsx:202, 211-229) but no persistent "ground-truth visible" banner | — |
| §6 UI rules | Tables never load whole dataset | PARTIAL | audit limited (Dashboard.tsx:552-556); events/disputes/queue load all rows | — |
| §6 UI rules | Current event + environment shown; red banner on production | PARTIAL | event picker (Dashboard.tsx:791-800); environment in system health only (752) | No red production banner. |
| §6 UI rules | Exports server-side via expiring links | PARTIAL | content generated server-side but downloaded directly (StepUp.tsx:109-119) | — |

### §7 Frontend testing and acceptance

| Spec ref | Requirement (short) | Status | Evidence | Notes |
|---|---|---|---|---|
| Unit | clock offset, polling backoff, draft diffing, schemas, countdown thresholds, flag validation, placeholder picker | PARTIAL | only frontend/tests/submission_payload.test.mjs:7-29 (XSS text-escape, node:test) | `fmtCountdown`/`countdownPhase` (format.ts:82-101) untested. |
| Component | each C-xx in all states with axe | MISSING | no component tests; no Testing Library (package.json:13-32) | — |
| Integration (MSW) | guards, gates, outbox, conflict merge, kill-switch UI | MISSING | no MSW | — |
| E2E (Playwright) | four-level journey, refresh, offline, auto-submit | MISSING | no Playwright; scripts/e2e_journey.py exercises backend only | — |
| Accessibility | keyboard-only + SR pass, contrast, reduced motion | MISSING | no axe-core; reduced motion done in CSS only | — |
| Visual regression | key pages at 1280/1440/1920 | MISSING | — | — |
| Performance | Lighthouse budgets, Monaco chunk check | MISSING | no Lighthouse/CI config | — |
| Bundle checks | no admin code/secrets in participant build | MISSING (violated structurally) | single SPA: App.tsx:23-85 includes `/review` + `/admin` routes; no CI grep check | See F-F01B-02. |
| Cross-browser | Chrome/Edge/Firefox smoke | MISSING | — | — |
| Acceptance | 16 scenarios + titles/headings/landmarks + copy catalog + sync-state text + reduced motion | PARTIAL | reduced motion DONE (app.css:41-50); headings/landmarks present; titles static (index.html:12); copy catalog absent; sync-state text partial (Workspace.tsx:814-816) | See F-F01B-14/15. |

---

## Findings

### F-F01B-01 — HIGH — Levels 3–4 flow (editable Monaco workspace, BuildPanel, uploads, diff export) entirely missing
- **Spec ref:** §1.2/§4.3 C-42 (editable), C-50–C-53; §5 P-09, P-11
- **Evidence:** frontend/src/pages/participant/Workspace.tsx:608-638 (custom read-only line viewer); grep of frontend/src returns no `monaco`, no `/v1/runs`, no upload/diff components; App.tsx:35-52 (only one workspace route). Deployment explicitly disables the runner (Dashboard.tsx:756-759 "Code execution is disabled in this deployment (ADR-010)").
- **Impact:** The spec's core participant journey (four levels, editable code, run/build with output, zip/diff upload, pre-submit validation) does not exist; the product implements a single read-only inspection + report event. Major spec violation (though internally consistent with the reduced backend).
- **Fix:** Either implement editable stages (Monaco lazy-loaded, BuildPanel, UploadDropzone, DiffExportButton, /v1/runs polling) or formally amend the spec/acceptance to the single-stage model and record the scope decision in the requirements reconciliation doc.

### F-F01B-02 — HIGH — Participant bundle contains admin and reviewer routes (spec MUST NOT)
- **Spec ref:** §1.2 rule ("participant app MUST NOT … contain admin routes"); §7 bundle checks/acceptance
- **Evidence:** frontend/src/App.tsx:23-85 — one SPA serves participant (`/app`), reviewer (`/review`) and organizer (`/admin`) consoles (admin at App.tsx:69-82); no CI grep check exists (no CI config in repo for it).
- **Impact:** All admin route code, labels and endpoint paths ship to every participant browser; violates an explicit MUST NOT and the acceptance criterion "the participant bundle contains no admin routes". Mitigated by RequireRole guards (chrome.tsx:138-188) and server-side authorization, so this is a spec/architecture violation, not an exploit.
- **Fix:** Split into participant and admin builds (or code-split consoles behind separate entry points with a CI grep on the participant output), or amend the spec to bless a role-guarded monolith.

### F-F01B-03 — HIGH — §7 testing program essentially absent
- **Spec ref:** §7 (Unit/Component/Integration/E2E/Accessibility/Visual/Performance/Bundle/Cross-browser) + acceptance
- **Evidence:** frontend/package.json:10 (`"test": "node --test"`) and :13-32 (no vitest, no @testing-library, no playwright, no axe-core, no msw); the only test is frontend/tests/submission_payload.test.mjs:7-29.
- **Impact:** None of the spec's nine test layers exist beyond one XSS-render regression; guard redirects, countdown thresholds, draft-conflict handling, a11y and bundle guarantees are unverified, and the acceptance criteria cannot be demonstrated.
- **Fix:** Add Vitest + RTL unit/component suites (format.ts countdown/offset, Workspace validation, components), MSW integration tests, Playwright journey, axe checks in CI, and a bundle-size/no-admin-routes CI check.

### F-F01B-04 — MEDIUM — Design token system diverges from §3.1/§3.2
- **Spec ref:** §3.1, §3.2
- **Evidence:** frontend/src/styles/tokens.css:3-28 (different role names: `--ink/--panel/--signal/…`; radius 3px/2px; single `--speed`); app.css:10-12 (dark-only, `color-scheme: dark`); no light theme, no OS-follow, no `ui` store override; app.css:1004 line-number colour ≈2.9:1 and app.css:425-428 placeholder ≈3.4:1 (below the 4.5:1/3:1 requirement); app.css:773-779 hardcoded `z-index: 30` (no layer scale).
- **Impact:** Token consumers cannot be spec-compliant by construction; light-mode/dark-toggle support missing; two contrast edge cases fail WCAG-derived thresholds.
- **Fix:** Rename/alias tokens to the spec roles, add a light palette + `ui`-store override, define z-index layer tokens, and raise `--line-no`/placeholder colours above 3:1/4.5:1.

### F-F01B-05 — MEDIUM — Motion tokens incomplete (§3.3)
- **Spec ref:** §3.3
- **Evidence:** tokens.css:24 (`--speed: 120ms` only); app.css:192, 305 (linear transitions); no 200/300ms tokens, no ease-out/ease-in tokens, no 150ms progress-expand or 280ms reveal (components absent). Positive: reduced-motion is fully honoured (app.css:41-50; pulse gated at app.css:887-894).
- **Impact:** Motion cannot be tuned per spec; consistent but off-spec pacing and easing.
- **Fix:** Add `--motion-fast/base/slow` and easing tokens and apply them to transitions; keep the existing reduced-motion block.

### F-F01B-06 — MEDIUM — Foundation component gaps (C-01/C-03/C-06/C-13/C-16)
- **Spec ref:** §4.1
- **Evidence:** Button has no `loading`/`aria-busy` and ≈37px height (components.tsx:132-166; app.css:298); Field counters are static hints, not live regions (Workspace.tsx:756, 766, 787); report tabs lack arrow-key navigation and `tabpanel` roles (Workspace.tsx:650-660); StatusChip is text-only (components.tsx:83-90); PlainMarkdown handles only h1/h2/h3/ul/p (components.tsx:367-423).
- **Impact:** A11y gaps (keyboard tab nav, live counters, 40px targets); loading state on submit buttons is text-swap only ("Filing", Workspace.tsx:810-813).
- **Fix:** Add `loading` prop with `aria-busy` and fixed-width spinner to Button; give tabs roving tabindex + arrow keys + tabpanels; make counters `aria-live="polite"`; add icons to status chips; extend PlainMarkdown (links/tables) while keeping the safe text rendering.

### F-F01B-07 — MEDIUM — No Modal, ConfirmModal or Toast components (C-07/C-08/C-09)
- **Spec ref:** §4.1
- **Evidence:** no `role="dialog"`/`aria-modal`/toast in frontend/src (grep); confirmations are inline two-step ConfirmButton (components.tsx:169-207); notifications are inline banners/receipts (Workspace.tsx:662-674).
- **Impact:** No focus-trapped dialogs for blocking alerts (e.g. "Time's up", repo-not-locked class messages); no transient toasts ("Draft saved", "Flag added" class feedback), so feedback is either permanent or absent; two-step inline confirm is weaker than a modal with safe-default focus for destructive actions.
- **Fix:** Implement a small Modal (focus trap, restore focus, Esc) + ToastRegion (polite live region, 6s auto-dismiss) and route blocking alerts and confirmations through them; keep ConfirmButton for low-risk inline confirms.

### F-F01B-08 — MEDIUM — Event components missing/partial (C-20, C-21, C-22, C-26)
- **Spec ref:** §4.2
- **Evidence:** no event-wide ProgressBar anywhere (ConsoleShell chrome.tsx:102-135 lacks one); no LevelCard/GateButton; CountdownTimer announces at 10min/2min (components.tsx:333-342, format.ts:85-87) vs spec 10/1/zero, and does not refetch state at zero — Workspace countdown just shows 00:00:00 (Workspace.tsx:863-879) with no `onZero` wiring; lobby countdown same (Lobby.tsx:91-104).
- **Impact:** Participants lose global event progress context; at deadline the UI can sit at 00:00:00 without refreshing state until the next poll tick; warning cadence deviates.
- **Fix:** Add a ProgressBar nav landmark; add `onZero` callback to CountdownTimer that triggers a state refetch; align warning thresholds with §2.8/P-01 (10/1/zero announcements).

### F-F01B-09 — MEDIUM — No ConnectionIndicator or sync StatusChip in the workspace header (C-28, C-29)
- **Spec ref:** §4.2 (refers §2.9/§2.6)
- **Evidence:** Workspace header (Workspace.tsx:467-481) has no connection indicator; `OfflineBanner` exists but is unused (chrome.tsx:190-208, no call sites); sync feedback is a plain text line "draft saved …" (Workspace.tsx:814-816) with no chip states for saved-to-server/queued/accepted.
- **Impact:** Offline/degraded states are invisible during the round; the acceptance criterion "every mutation shows the right sync-state text" is unmet.
- **Fix:** Mount a connection indicator driven by query state in the workspace header; implement the five sync states as a StatusChip fed by draft/submit request state.

### F-F01B-10 — MEDIUM — DraftSync partial: no debounce triggers, no merge prompt, no local persistence (C-55)
- **Spec ref:** §4.3 C-55 (implements §2.6)
- **Evidence:** Workspace.tsx:187-239 (3s interval PUT, dirty flag); 409 DRAFT_VERSION_CONFLICT handling unilaterally loads the server version and tells the user to re-apply edits (Workspace.tsx:209-234); no file-switch/visibility/pagehide/`sendBeacon` flush; no IndexedDB copy (grep: no indexedDB/idb in frontend/src), drafts live only in React state + server.
- **Impact:** Edits made in the last <3s before tab close/navigation can be lost; multi-tab conflicts lose the user's newer text instead of offering Keep mine/Use server/Compare; a failed draft save with no network shows no queued/offline state.
- **Fix:** Debounce 10s after last change + flush on visibilitychange/pagehide (sendBeacon), persist a local draft copy, and present a merge prompt on 409.

### F-F01B-11 — MEDIUM — Participant page set incomplete (P-03, P-04, P-05, P-06, P-17, P-19, P-21, P-22, P-24)
- **Spec ref:** §5
- **Evidence:** no /consent page (acceptance button in Lobby.tsx:134-145 only, no checkboxes/PDF, no client-side blocking — server enforces via backend/app/deps.py:121); no /activate or /reset UI (backend endpoints exist, auth.py:6-7); dashboard replaced by Lobby (App.tsx:41) without ScoreCard/Resume/LevelCards; no /event details page; no /team page (members never listed anywhere); no system-check page (Lobby readiness checks team/rules only, Lobby.tsx:123-160); no /announcements or /support pages; system pages limited to 404 (NotFound.tsx) and 403 (chrome.tsx:172-181).
- **Impact:** Participants cannot self-serve password resets, view team membership, run pre-event device checks, review all announcements, or reach support; consent UX relies on server rejection rather than a guided gate.
- **Fix:** Add the missing pages (at minimum: consent gate, password reset, team, support, announcements list, maintenance/unsupported-device pages) or descope them explicitly in the spec.

### F-F01B-12 — MEDIUM — Dispute submission lacks idempotency, deadline and status tracking (P-16)
- **Spec ref:** §5 P-16
- **Evidence:** DisputeForm.tsx:39-42 — POST /v1/submissions/{id}/dispute with **no** `idempotencyKey` (unlike Workspace.tsx:378-383); no deadline countdown; no list/status view of the user's own disputes (only a success banner, DisputeForm.tsx:65-77).
- **Impact:** A double-click or retry after a network hiccup can file a duplicate dispute or surface a confusing error; participants cannot see the dispute window or track outcomes.
- **Fix:** Attach `newIdempotencyKey()` to the dispute POST, show the announced dispute window countdown, and list my disputes with status on the results page.

### F-F01B-13 — MEDIUM — Auto-submit client UX missing (P-10)
- **Spec ref:** §5 P-10 (auto-submit: 5/3/1-minute warnings, "Time's up. Auto-submitting…", poll-then-redirect)
- **Evidence:** Workspace.tsx:690-696 shows a static notice when the stage is not active; countdown colours change at 10min/2min (Workspace.tsx:874-879) but there are no escalation toasts at 5/3/1 minutes and no zero-time "auto-submitting" flow; draft flush on deadline is absent (only the 3s autosave).
- **Impact:** Participants get no escalating deadline warnings and no clear signal that their pending draft was auto-submitted by the server (backend/app/auto_submit.py handles server-side auto-submit).
- **Fix:** Add threshold warnings via the toast/banner system and, at zero, show a blocking "Time's up — auto-submitting…" state that polls /v1/state until the server confirms, then navigates.

### F-F01B-14 — MEDIUM — Page conventions unmet: no per-route document title, no focus-to-heading (§5)
- **Spec ref:** §5 conventions; §7 acceptance ("every page has a title, heading and landmark")
- **Evidence:** static title only (frontend/index.html:12); no `document.title` assignment anywhere in frontend/src (grep); no focus management on route change (no useRef/focus calls in pages).
- **Impact:** Screen-reader and tab history UX degrades; acceptance criterion fails on the title half (headings/landmarks are present: e.g. `<main id="main">` chrome.tsx:41,129).
- **Fix:** Add a tiny `usePageTitle`/route-change focus hook (focus the h1) in the layout components.

### F-F01B-15 — MEDIUM — No copy catalog; all user-facing strings hard-coded (§2.8/§7 acceptance)
- **Spec ref:** §7 acceptance ("all warnings come from the copy catalog")
- **Evidence:** every message is an inline literal (e.g. Workspace.tsx:352-363 validation texts, DisputeForm.tsx:29-35, components.tsx:279-281); no `packages/copy` equivalent (grep: no catalog module).
- **Impact:** Wording cannot be changed without code changes; acceptance criterion unmet; some copy inconsistencies slip through (see F-F01B-20).
- **Fix:** Extract warning/error strings into a keyed catalog module (`warn.deadline.5m` style) and reference by key.

### F-F01B-16 — MEDIUM — Admin surface thin: 19 of 35 A-pages missing (A-04–A-09, A-14, A-16, A-17, A-24, A-25, A-27–A-29, A-34, A-35 …)
- **Spec ref:** §6
- **Evidence:** only `/admin` (Dashboard.tsx:766-830) and `/admin/challenges` (Challenges.tsx) exist (App.tsx:69-82); no stage-creation UI — the UI itself instructs using the raw API (Challenges.tsx:286 "stages are created via the stage API"; Dashboard.tsx:356-358); no participants/teams/import, config/diff, schedule editor, rescoring, leaderboard control, runner/AI/integrity consoles, users/roles, settings.
- **Impact:** Organizers must drop to curl/seed scripts for stage setup, teams, rescoring and finalization steps; several spec'd operator safeguards (dry-run rescoring, leaderboard modes, two-approver DQ) have no UI.
- **Fix:** Prioritize stage-creation/schedule UI and rescoring dry-run; descope the rest explicitly or note them as API-only in the spec.

### F-F01B-17 — MEDIUM — Admin UI rules partially enforced (reason fields, kill-switch toggles, sensitive banner, exports, pagination)
- **Spec ref:** §6 Admin UI rules
- **Evidence:** reason required for stage control only (Dashboard.tsx:363-394); event lifecycle transitions (Dashboard.tsx:81-92) and dispute resolution (655-675) have no reason field; kill switches are read-only chips (344-350); no persistent "sensitive data visible" banner on the ground-truth page (Challenges.tsx has step-up but no banner, 202-229); exports delivered as immediate blob downloads (StepUp.tsx:109-119) not expiring links; disputes/events/queue tables load all rows (644-728, 133-177); no red production banner (environment only in SystemHealth 752).
- **Impact:** Sensitive actions can be performed without a recorded reason in the UI flow (server audit still records the action); kill-switch and export operations deviate from the stated safety model.
- **Fix:** Require a reason input for every destructive/sensitive action (transitions, resolves); add a sensitive-data banner component; switch exports to server-issued expiring links; paginate admin tables.

### F-F01B-18 — MEDIUM — Review workbench and disputes partial (C-66, A-22, A-23)
- **Spec ref:** §4.4 C-66; §6 A-22, A-23
- **Evidence:** ItemDetail.tsx:236-290 — decision select + rubric sliders + notes; no matcher-feature display, no ground-truth excerpt (permitted roles), no official run result, no AI assessment panel/override; Dashboard.tsx:686-724 — dispute resolve with outcome/points but no second-reviewer assignment or evidence attachments.
- **Impact:** Reviewers decide with less context than spec'd; the two-reviewer integrity path for disputes is absent.
- **Fix:** Add the missing context panels behind role checks and a second-reviewer assignment flow.

### F-F01B-19 — LOW — Lists/panes not virtualised or resizable (C-14, C-15, C-41)
- **Spec ref:** §4.1 C-14/C-15; §4.3 C-41
- **Evidence:** plain tables (Leaderboard.tsx:75-103, Results.tsx:131-193, Submissions.tsx:50-95); fixed grid workspace (app.css:910-930); file tree rendered flat without virtualisation or arrow-key tree navigation (Workspace.tsx:508-524).
- **Impact:** Performance risk only at large scale (hundreds of files/rows); keyboard tree navigation missing for SR/keyboard users.
- **Fix:** Add virtualisation when data grows; implement WAI-ARIA tree keyboard pattern (arrow keys) on the file tree.

### F-F01B-20 — LOW — Login page copy contradicts itself about account creation (P-02)
- **Spec ref:** §5 P-02
- **Evidence:** Login.tsx:45-51 ("unregistered emails are rejected with a generic error … if you are registered but have no password yet, the password you type becomes your password") vs Login.tsx:88-91 ("No account yet? Just sign in with your email id - your account is created on first sign-in"). Backend rejects unregistered emails (backend/app/routers/auth.py:70-87).
- **Impact:** Misleads unregistered users into thinking self-registration works; also documents a risky first-sign-in password-capture flow without a strength meter (spec P-04 requires one where passwords are set).
- **Fix:** Correct the footer copy; if first-sign-in password capture stays, add a password-strength indicator and minimum-length hint.

### F-F01B-21 — LOW — Leaderboard/score presentation gaps (C-24, C-25)
- **Spec ref:** §4.2
- **Evidence:** Leaderboard.tsx:87-95 — no own-team row pinning/highlight; no reorder animation; Results.tsx:89-99 — score total is a static span, no change animation or live-region announcement.
- **Impact:** Minor UX/a11y polish gaps; frozen/hidden messaging itself is good (49-65).
- **Fix:** Highlight the user's team row; animate + politely announce score changes.

### F-F01B-22 — LOW — EXTRA/deviation notes worth recording
- **Spec ref:** §1.2/§4.4 (context)
- **Evidence:** (a) admin challenge ids persisted in `localStorage` because no listing endpoint exists (Challenges.tsx:19-36, 178-182) — unspec'd workaround; (b) self-hosted Fontsource fonts instead of a system sans stack (main.tsx:7-15) — CSP-friendly deviation; (c) two-step ConfirmButton pattern and inline receipt panel replace spec'd modal flows (components.tsx:169-207; Workspace.tsx:662-674) — consistent deliberate substitution; (d) XSS-safe text rendering with a regression test (SubmissionPayload.tsx:1-33; tests/submission_payload.test.mjs) — positive security practice beyond minimum.
- **Impact:** Low; worth keeping in the traceability record so the deviations are intentional.
- **Fix:** Document (a)–(c) in the spec reconciliation; keep (d).

---

## Positive observations (not findings)

- Idempotency keys on report/flag submissions and shared-refresh single-flight (Workspace.tsx:378/383; api.ts:60-89, 178-181).
- Participant-submitted content rendered as text only, with an automated escape regression test (SubmissionPayload.tsx; review/ItemDetail.tsx:178-193).
- Server-clock-synced countdowns with polite SR announcements and reduced-motion gating (format.ts:72-101; components.tsx:315-359; app.css:41-50, 887-894).
- Generic login errors (no user enumeration) mirrored in UI copy (Login.tsx:88-91 vs backend auth.py:70-87).
- Role guards with session-restore loading state and EX-403 panel (chrome.tsx:138-188); server re-checks rules acceptance and roles on every request (backend/app/deps.py:121).

---

### 4.3 02 Backend Specification, sections 0-5 - profiles, conventions, topology, pipeline (`spec02a`)

# Backend Spec 02 Audit — Sections 0–5 (spec02a)

- **Agent:** spec02a (Task ID 3-c)
- **Baseline document:** /home/z/my-project/upload/02_Backend_Spec.md (patched v0.2)
- **Sections covered:** §0 Profiles and load target; §1 Stack/structure/budgets (1.1–1.5 incl. configuration); §2 Conventions (2.1–2.8); §3 Topology; §4 Modules and boundaries; §5 Request pipeline
- **Repo audited:** /home/z/my-project/bug-hunt-hackathon/backend (READ-ONLY)
- **HEAD:** f1412b7eec6c92c4c168fd2b8a58182b34480387 (2026-11-26)

All evidence cites files/lines actually read. Status legend: DONE / PARTIAL / MISSING / DEVIATION.

---

## Section 0 — Profiles and load target

| Spec ref | Requirement (short) | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| §0 | Profiles dev / staging / prod | DEVIATION | backend/app/config.py:19-20; backend/.env.example:11-12 | `profile` values are `d0-local` \| `d1-free-vm`, `environment` is `development` \| `production`; no staging concept; no boot-time refusals per profile |
| §0 | Same-host runner: allowed (dev), no real data (staging), separate VM or off (prod) | DONE | config.py:51 (`runner_enabled=False`); app/routers/levels.py:1168-1187 | Runner disabled by default (`/v1/runs` always 503 RUNNER_UNAVAILABLE) — the "or off" option; no runner VM / runner_gateway integration exists |
| §0 | External integrations pluggable; remote provider in privacy notice | PARTIAL | config.py:51-53 (AI off); app/storage.py:34-54 (FS adapter only); app/routers/auth.py:519-521 (no email provider; reset token printed to logs) | AI and runner are pluggable via kill switches; storage has only the FS adapter (no MinIO/S3); email is absent entirely — see F-B02A-04 |
| §0 | Load target 200+ concurrent; announced cap only after passing load profile at N=50/100/200 | PARTIAL | docs/LOAD_TEST_REPORT.md:3 (all cells UNRUN); scripts/load_test.py:4-10 (models 60 pollers, 10-report burst) | Docs are honest (cap 50, measurement pending, ADR-011 gate); the 200+ target is not qualified at any N; load-test tool itself never modeled N=100/200 |

## Section 1 — Stack, structure and budgets

| Spec ref | Requirement (short) | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| §1.1 | Python 3.12 + `mypy --strict` on module boundaries | DEVIATION | ruff.toml:5; backend/requirements-dev.txt:3-6 (ruff, bandit, pip-audit); .github/workflows/ci.yml (no mypy step) | Python 3.12 target confirmed (ruff `target-version`, CI `python-version: '3.12'`); no mypy config or CI step anywhere — type gate entirely absent (F-B02A-13) |
| §1.1 | FastAPI modular monolith | DONE | backend/app/main.py:45-52 | FastAPI app factory; modular-ish flat package |
| §1.1 | Uvicorn workers under Gunicorn master; workers = min(2×vCPU, 4) | DEVIATION | scripts/run_dev.sh:36 (single `uvicorn` process, port 8100); requirements.txt:5 (uvicorn only, no gunicorn) | Single-process uvicorn; no Gunicorn master, no worker-count policy (F-B02A-13) |
| §1.1 | DB driver asyncpg (runtime), psycopg (migrations) | DEVIATION | backend/app/config.py:24-26 (`postgresql+psycopg://`); app/db.py:29-44 (sync engines); tests/conftest.py:26-27 | psycopg sync for everything incl. runtime; all handlers are sync `def` (F-B02A-13) |
| §1.1 | PostgreSQL 16 Compose service | DEVIATION | scripts/dev_db.sh (local binaries, port 5434, PG17 per docs/LOAD_TEST_REPORT.md:26); no compose/Dockerfile in repo (repo root listing) | No Compose services at all; PG 17 auto-detected locally, not 16/Compose |
| §1.1 | Job queue `app.jobs` with FOR UPDATE SKIP LOCKED | DONE | backend/app/jobs.py:41-64; backend/worker.py:29-52; migrations/0001_init.sql:28 | Claim uses `UPDATE … FOR UPDATE SKIP LOCKED` with lease; retries/backoff/dead-letter |
| §1.1 | Cache: in-process, version-keyed (§6.4); PG quota rows | PARTIAL | app/deps.py:30-39 (in-process rate bucket); app/routers/state.py:45-94 (no version-keyed response cache, no state_versions) | In-process bucket exists; the version-keyed `/state` cache of §6.4 is not implemented (out of my scope but affects the §1.1 stack row) |
| §1.1 | Object storage: FS adapter (dev) or MinIO (staging); R2 (prod) | PARTIAL | app/storage.py:23-54 (FS only); config.py:48 (`artifact_storage_dir`) | Only the filesystem adapter; no STORAGE_KIND/minio/s3 selection (F-B02A-20) |
| §1.1 | Auth: Argon2id, JWT access, opaque refresh | DONE | app/security.py:27 (Argon2id OWASP-min params), 74-94 (JWT), 56-57 (opaque refresh `token_urlsafe`) | Also rotation + reuse detection (auth.py:250-357) |
| §1.1 | OpenAPI generated at startup; docs off in staging/prod | PARTIAL | app/main.py:50-51 (`docs_url`/`openapi_url` only when `environment == "development"`) | Interactive docs off in prod — but OpenAPI is fully disabled in prod rather than generated (contract discipline weakened); no staging |
| §1.1 | Tests: pytest, httpx, testcontainers, pytest-asyncio, schemathesis | DEVIATION | backend/requirements.txt:14-16; tests/conftest.py:35-46 (subprocess `dev_db.sh`, no testcontainers); no schemathesis/pytest-asyncio anywhere | pytest + real PG via scripts; CI uses a GH service container; no testcontainers, no schemathesis fuzzing, no async tests |
| §1.1 | Lint: Ruff, mypy --strict, bandit | DEVIATION | ruff.toml; requirements-dev.txt:3-5; .github/workflows/ci.yml (ruff check/format, bandit -ll, pip-audit) | Ruff + bandit + pip-audit present; mypy absent (F-B02A-13) |
| §1.1 | Pin versions in pyproject.toml and lockfile; updates by PR | DEVIATION | backend/requirements.txt (mix of `==` and `>=`, e.g. `sqlalchemy>=2.0.44`); no pyproject.toml, no lockfile in repo | Partial pins only; no pyproject/lock (F-B02A-13) |
| §1.2 | apps/ + packages/ layout (api_participant, api_admin, worker_*, scheduler, runner_gateway, packages/core…) | DEVIATION | repo layout: backend/app/{main,config,db,deps,errors,security,jobs,audit,storage,flow,scoring,matching,evaluator,evaluator_level,auto_submit,models_*}.py + routers/ (LS backend/app) | Flat single `app` package; none of the six apps exist as processes |
| §1.2 | `api_participant` must not import `api_admin`, `evaluation.ground_truth`, `answers`, `ai` | DONE | imports grep of backend/app/routers: participant-facing routers (public, auth, state, challenges, levels, submissions, leaderboard, announcements) import only db/deps/errors/security/audit/flow/storage/jobs | Rule holds by convention; but participant and admin share ONE app (see §1.3) |
| §1.2 | Import boundaries enforced in CI (`pytest -m boundaries`) | MISSING | backend/pytest.ini:1-5 (no markers); .github/workflows/ci.yml (no boundaries job) | No boundary enforcement mechanism |
| §1.3 | Process roles: api_participant :8000 / app_api; api_admin :8001 / admin_api; worker_general; worker_evaluator / evaluator; scheduler (advisory lock leader); runner_gateway :8002 / runner_gw | DEVIATION | app/main.py:97-110 (ALL routers incl. admin mounted on one app); scripts/run_dev.sh:36-37 (one uvicorn + one worker); app/config.py:24-26 (only `app_api` + `gt_admin` DSNs); scripts/dev_db.sh:99-106 (roles: app_api, gt_admin, scheduler only) | Participant + admin APIs merged into one process/port; one generic worker runs evaluator + outbox + scheduler duties (worker.py:39-45 auto-submit inline); `scheduler` role created but unused by code; admin_api/worker/evaluator/runner_gw roles absent (F-B02A-02) |
| §1.4 | Request body cap 1 MB JSON; uploads separate | DONE (stricter) | config.py:42 (`max_body_bytes = 512*1024`), 47 (`max_upload_bytes = 6 MB`); main.py:69-84 | 512 KiB JSON cap (stricter than spec); enforcement is Content-Length-only (F-B02A-10) |
| §1.4 | Response body cap 2 MB | MISSING | no response-size cap anywhere in app/ (grep; main.py middleware only adds headers) | No response cap mechanism |
| §1.4 | Deadline-rush burst: 200 submits/60 s, zero duplicates, zero 5xx | PARTIAL | submissions.py:123-139 (dedupe by unique key) BUT submissions.py:263-294 (no ON CONFLICT → IntegrityError → 500 on concurrent same-key retry) | Duplicate protection via UNIQUE ok; concurrent duplicate-key retries produce 500 (F-B02A-06) |
| §1.4 | Latency/throughput targets (p95 etc.) | PARTIAL | docs/LOAD_TEST_REPORT.md:3,53-60 (all cells UNRUN) | Targets are declared as unmeasured; no claim made — spec-compliant posture, but budgets unproven |
| §1.5 | Env vars read at boot | DONE | app/config.py:15-16, 60-65 (pydantic-settings; validated at startup) | |
| §1.5 | Spec variable groups (PG_*, JWT_TTL, ARGON2_PARAMS, COOKIE_SECURE, ADMIN_AUTH_MODE, STORAGE_KIND, AI_*, RUNNER_*, SMTP_*, ENV=dev\|staging\|prod, FEATURE_*) | DEVIATION | config.py:19-57 (DATABASE_URL_APP/GT, JWT_SECRET, JWT_ALGORITHM, ACCESS_TOKEN_TTL_S, REFRESH_TTL_S, COOKIE_DOMAIN, MAX_SESSIONS_PER_USER, MAX_BODY_BYTES, RUNNER_ENABLED, AI_ASSESSMENT_ENABLED, TELEMETRY_ENABLED…); .env.example | Entirely different, smaller variable set; no staging value; no ADMIN_AUTH_MODE/COOKIE_SECURE/ARGON2_PARAMS (F-B02A-12) |
| §1.5 | Secrets read from files (`*_FILE`), never baked into image | DEVIATION | config.py:32 (`jwt_secret: str = "dev-only-insecure-secret-replace-me"`); no `*_FILE` support anywhere (grep) | Dev default secret in code; env-only override, no file-based secrets (F-B02A-03) |
| §1.5 | SPA reads /config.json from the API | DEVIATION | app/routers/state.py:97-139 (`GET /v1/config`, authenticated); frontend/src/pages/participant/Lobby.tsx:40 | SPA reads an authenticated `/v1/config` endpoint, not `/config.json` |

## Section 2 — Conventions

| Spec ref | Requirement (short) | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| §2.1 | Base path `/v1`; additive only; Deprecation/Sunset headers | PARTIAL | app/main.py:110 (`prefix="/v1"`); no Deprecation/Sunset header handling anywhere (grep) | `/v1` DONE; no deprecation-header mechanism exists (nothing deprecated yet — N/A today) |
| §2.1 | Path IDs are UUIDv7 (time-sortable); ID never sole access control | DONE | app/db.py:81-88 (uuid7 impl); used at submissions.py:260, levels.py:1004, auth.py:140; ownership scoping e.g. submissions.py:395, 430-437 | Generated IDs are UUIDv7; access always re-scoped by author/team |
| §2.1 | Plural nouns; verb sub-paths (`/stages/{k}/submit`, `/runs/{id}/cancel`) | PARTIAL | routers: `/submissions`, `/drafts`, `/announcements`, `/levels/{n}/submit` (levels.py:872); `/runs` POST exists (levels.py:1168) but no `/runs/{id}/cancel` (runs disabled) | Mostly followed; cancel sub-path absent because runs are stubbed |
| §2.1 | Stages addressed by stable `stage_key` (L1/L2), not ordinal | DEVIATION | levels.py:872 (`/levels/{level_no}/submit` with `level_no: int`), flow.py:19 (`LEVEL_COUNT = 4` hard-coded) | Four-level flow addressed by ordinal 1-4, not a configurable stage_key (F-B02A-19) |
| §2.2 | `Authorization: Bearer <jwt>` on protected routes | DONE | app/deps.py:55-63 (get_principal via HTTPBearer), 91-118 (role gates) | |
| §2.2 | `X-Request-Id` optional; server generates | DONE | main.py:66-67 (accept or `uuid4().hex[:16]`), 86 (echoed on every response); errors.py:73 | |
| §2.2 | `Idempotency-Key` on submit, repo-lock, upload, run | PARTIAL | submissions.py:96, levels.py:877 (submit — required); levels.py:471 (repo-lock — required); levels.py:789-796 (upload — NOT required); levels.py:1168-1178 (run — not required, stub) | Missing on uploads and runs (F-B02A-06) |
| §2.2 | `If-Match: <version>` on draft PUT | MISSING | submissions.py:463-520 and levels.py:423-461: version passed in body (`DraftIn.version`), not If-Match header (grep confirms no If-Match anywhere) | Semantically equivalent optimistic concurrency, but not via the spec'd header (F-B02A-16) |
| §2.2 | `X-Client-Version` checked against minimum version | MISSING | no such header in code (grep `client_version` → none); only `X-BHCTF-Client` presence check for refresh CSRF (deps.py:176-177); no CLIENT_TOO_OLD error in catalog | No minimum-client-version gate at all (F-B02A-09) |
| §2.3 | Success envelope `{"data": …, "meta": {"request_id", "server_time"}}` | MISSING | e.g. submissions.py:328-338 (`_receipt` bare dict), 383 (`{"submissions": …}`), announcements.py:29-41, leaderboard.py:57-62, levels.py:1088-1095 | No route returns the data/meta envelope; request_id only as header (F-B02A-01) |
| §2.3 | Error envelope `{"error": {code, message, details, request_id}}` | DONE | errors.py:67-73 (`body = {"error": {…}}`, X-Request-Id header), 76-80 (unhandled → INTERNAL_ERROR 500) | Shape matches spec exactly |
| §2.3 | `message` from copy catalog; `copy_key` in meta when applicable | MISSING | errors.py:16-54 (messages hardcoded in CATALOG); no copy_key concept (grep) | |
| §2.4 | Canonical error catalog (names + HTTP codes); 409 for state conflicts (not 423) | DEVIATION | errors.py:16-54: `DRAFT_VERSION_CONFLICT: (412, …)` (spec: 409); main.py:74-77 (413 body-too-large → `SUBMISSION_INVALID`, spec `PAYLOAD_TOO_LARGE`); missing: AUTH_SESSION_EXPIRED/SUPERSEDED, AUTH_CONSENT_REQUIRED (has RULES_NOT_ACCEPTED), AUTH_STEP_UP_REQUIRED (has ADMIN_STEP_UP_REQUIRED), STAGE_* canonical (only ROUND_*), GATE_BLOCKED (has TEAM_GATE_BLOCKED), ALREADY_SUBMITTED (has LEVEL_ALREADY_SUBMITTED), UPLOAD_TOO_LARGE/TYPE_UNSUPPORTED/INVALID (has ARTIFACT_INVALID), RUN_COMMAND_UNKNOWN, CLIENT_TOO_OLD, PAYLOAD_TOO_LARGE, MAINTENANCE, UPSTREAM_UNAVAILABLE (has SERVICE_DEGRADED), INTERNAL (has INTERNAL_ERROR); extra unspec'd `KEY_NOT_AVAILABLE: 425`, `SUBMISSION_COOLDOWN`, `RUN_LANGUAGE_UNSUPPORTED`; AUTH_RATE_LIMITED has no `Retry-After` header (deps.py:33-39, errors.py:73) | Broad overlap, many renames/remappings, one explicit code violation (412 vs 409) (F-B02A-05) |
| §2.5 | Key: opaque 8–128 chars, scoped to (principal, route) | PARTIAL | submissions.py:96 and levels.py:471/877 (`min_length=8, max_length=80`); scope is `(author_id, key)` only — migrations/0001_init.sql:391 `UNIQUE (author_id, idempotency_key)` | Max 80 not 128; no route component (a key used on `/v1/submissions` collides with `/v1/levels/{n}/submit` — both check app.submissions) (F-B02A-06) |
| §2.5 | Store in `app.idempotency` with payload_hash, response_status, response_body, created_at, expires_at | MISSING | migrations/0001_init.sql:365-399 (no such table; key stored on app.submissions), levels.py:485-497 (repo-lock key on app.team_repo_choices) | No dedicated store, no stored response, no expiry/retention |
| §2.5 | Same key + same hash → original response (even after deadline) | DONE | submissions.py:135-139 (replay returns stored receipt, comment "even if the round has since ended"); levels.py:907-917 | |
| §2.5 | Same key + different hash → IDEMPOTENCY_CONFLICT | DONE | submissions.py:136-137; levels.py:908-909; levels.py:492-495 (repo-lock) | |
| §2.5 | Retention: event+7d (submit/repo-lock/upload), 24h others; reservation via INSERT…ON CONFLICT | MISSING | no expires_at/retention anywhere; reservation is SELECT-then-INSERT (submissions.py:124-134), no ON CONFLICT — only repo-lock catches IntegrityError (levels.py:529-537) | Concurrent same-key submit retries hit the UNIQUE constraint → unhandled → 500 (F-B02A-06) |
| §2.6 | Persisted timestamps UTC | DONE | migrations/0001_init.sql:385, 389 (`TIMESTAMP WITH TIME ZONE`); db_now via `clock_timestamp()` (db.py:73-75) | |
| §2.6 | Deadlines via `clock_timestamp()` inside submission tx after stage-row lock | DONE | submissions.py:148 (stage `FOR UPDATE`) then 157 (`SELECT clock_timestamp()`); levels.py:927-928 (stage FOR UPDATE then clock) | Matches ADR-012 |
| §2.6 | Responses ISO-8601 with `Z` | DEVIATION | e.g. submissions.py:332, auth.py:184: `datetime.isoformat()` → `+00:00` suffix, never `Z` | Functional equivalent; not the spec'd format |
| §2.6 | Every response carries `server_time` | MISSING | only auth.py:184, 298, 357 and state.py:25, 63, 78 include server_time; all other responses lack it | Client clock-offset sync impossible from most responses (F-B02A-01/F-B02A-17) |
| §2.7 | Cursor pagination `?limit&cursor`, `meta.next_cursor`, HMAC-signed opaque cursors | MISSING | announcements.py:15-27 (`limit` capped at 100, no cursor); submissions.py:350 (`LIMIT 200`); review.py:38 (`LIMIT 200`); grep: no `cursor`/`next_cursor` anywhere | No cursor pagination at all (F-B02A-07) |
| §2.8 | Structured JSON logs: ts, level, request_id, route, method, status, duration_ms, principal, team_id, event_id, client_version, error_code, remote_ip_hash | MISSING | main.py:34 (plain `basicConfig`), 40-42 (only startup/shutdown logs); no access-log middleware (grep `log.` in app/ → main.py only) | No request logging, none of the required fields (F-B02A-08) |
| §2.8 | Never log tokens/passwords/source text/ground truth/raw AI; allow-list redaction in middleware | DEVIATION | auth.py:521 (`print(f"[dev-mail] password reset token for …: {raw}")` — raw reset token to stdout/logs); no redaction middleware (grep) | Direct violation: a bearer-equivalent secret (password-reset token) written to logs (F-B02A-04); on the plus side nothing else logs request data |

## Section 3 — Topology (patch B5)

| Spec ref | Requirement (short) | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| §3 | Frontend nginx container / edge proxy / Cloudflare | MISSING (repo) | repo root has no nginx/compose/edge-proxy config; scripts/run_dev.sh:36 (bare uvicorn); frontend is Vite dev (README) | No deployment topology assets in repo; documented in docs/DEPLOYMENT_RUNBOOK.md (systemd/env-file per RELEASE_PLAN_D1.md:17) |
| §3 | APIs as Compose services; admin behind Cloudflare Access; separate tunnels; no published host ports | DEVIATION | main.py:97-110 (single app serves participant AND admin routes on 127.0.0.1:8100) | Admin API co-hosted with participant API — the spec's separate admin host/Access boundary cannot be applied (F-B02A-02) |
| §3 | PostgreSQL internal network only, never public | DONE | scripts/dev_db.sh (binds 127.0.0.1:$PGPORT; roles created locally); conftest.py:26 (127.0.0.1) | Local-only binding |
| §3 | Object storage: local FS (dev) → MinIO → R2 with off-host backups | PARTIAL | app/storage.py:23-54 (FS adapter only) | No MinIO/S3 backend, no off-host backup mechanism (F-B02A-20) |
| §3 | Runner: same-host container (dev) → separate VM (prod) or off | DONE (off) | config.py:51 (`runner_enabled=False`); levels.py:1168-1187 (`/v1/runs` → 503) | "Off" path implemented; runner_gateway and runner VM protocol absent (see §1.3) |
| §3 | Admin auth: shared secret (dev) → Access → Access+MFA | DEVIATION | deps.py:109-118 (admin = JWT role check); deps.py:141-162 (step-up = re-typed password, 5 min); auth.py:466-493 (`POST /auth/step-up`) | No shared-secret mode (fine — refused everywhere), no Cloudflare Access/MFA integration; step-up is password-based (documented ADR-008 deferral) |
| §3 | Normative: no participant-supplied code executes on the main VM | DONE | storage.py:57-91 (zip metadata only, never extracted/executed); runner disabled (config.py:51) | No code execution of uploads anywhere in the API process |

## Section 4 — Modules and boundaries

| Spec ref | Requirement (short) | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| §4 | auth (sessions/tokens/consent/MFA) | PARTIAL | deps.py:55-162, security.py, auth.py:250-493 (rotation/reuse), deps.py:121-138 (rules consent gate) | No MFA (documented ADR-008); consent = rules acceptance only |
| §4 | events (events/stages/schedules/repo options/gate) | PARTIAL | admin.py:48-437 (event/stage control), flow.py:compute_gate (levels.py:241-252), admin repo options in admin.py | Functionality exists inside admin router + flow; no module layering as spec'd |
| §4 | teams / members / repo lock | PARTIAL | levels.py:467-583 (repo-lock, lead-only, idempotent), levels.py:586-615 (team view) | Lead-only lock + replay + conflict done |
| §4 | progress (node pointer, sub-states) | DONE | flow.py:19-70 (node machine, monotonic pointer), get_pointer_for_update (levels.py:920) | Solid: server-owned monotonic pointer |
| §4 | drafts (put/get/merge, version conflicts) | PARTIAL | submissions.py:468-520, levels.py:400-461 (put/get with version); no merge; version in body not If-Match | F-B02A-16 |
| §4 | submissions (submit transaction; no evaluation.ground_truth import) | DONE | submissions.py:92-325, levels.py:872-1095; imports of routers/ never touch gt (grep) | |
| §4 | uploads (intake, validation) | PARTIAL | levels.py:789-866 (intake + zip inspection storage.py:57-91) | No Idempotency-Key, no async validation job (validated inline) (F-B02A-06) |
| §4 | runs (jobs, command allow-list) | DEVIATION | levels.py:1165-1187 (stub: always RUNNER_UNAVAILABLE; no cancel; no command allow-list) | Contract placeholder only |
| §4 | evaluation (matcher + scoring orchestration; no api_admin import) | DONE | evaluator.py:22-24 (gt_session + matching + scoring), evaluator_level.py | Runs in worker; matching.py/scoring.py separated; participant routers never import it |
| §4 | answers (answer packs, corrections — admin only) | PARTIAL | admin.py:748-890 (ground-truth bugs/flags/test-results endpoints, organizer+step-up) | Admin writes gt directly from the API process — spec reserves gt for worker_evaluator (F-B02A-14) |
| §4 | ai (provider adapter, scorer) | MISSING (by design) | config.py:52 (`ai_assessment_enabled=False`); no ai module | DEC-13 deferral, documented; §0 allows pluggable/off |
| §4 | ledger (append-only, claims; not imported by submissions) | DONE | migrations/0002_score_ledger_immutable.sql; scoring.py (add_ledger_entry, claim_award_unit); only admin router + evaluator import scoring (grep) | Immutable ledger enforced in DB |
| §4 | leaderboard (snapshots) | DONE | scoring.py build_leaderboard/save_snapshot; leaderboard.py:21-62 serves snapshots | |
| §4 | review (queue, decisions; no gt) | DONE | review.py:17-60 (app_session only, no gt import; staff-only deps.py:100-106) | |
| §4 | integrity (signals, cases) | MISSING | no integrity module anywhere (grep) | No anti-collusion signals in v1 |
| §4 | audit (chain, checkpoints; audit.emit/verify) | DONE | audit.py:20-66 (hash-chained, same-tx), 69-95 (verify); admin.py:1043-1049 exposure | No external signed checkpoints (documented deferral) |
| §4 | runner (protocol client) | MISSING | no runner client module; /runs stub only (levels.py:1165) | Runner off by default — consistent with §0 |
| §4 | Boundary enforcement in CI | MISSING | pytest.ini:1-5 (no markers); ci.yml (no boundaries job) | Convention only |

## Section 5 — Request pipeline (patch B6)

| Spec ref | Requirement (short) | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| §5.1 | 1. Request ID accept/generate | DONE | main.py:66-67, 86 | |
| §5.1 | 2. Body size + content-type limits before tx | PARTIAL | main.py:69-84 (Content-Length check only; `int(cl)` may raise on malformed header → 500; no content-type check; chunked bodies bypass) | F-B02A-10 |
| §5.1 | 3. IP-level rate limit (generous) | MISSING | deps.py:30-39 (in-process bucket keyed by identity/route, e.g. `submit:{p.id}` submissions.py:101); IP keying only for login/reset/register (auth.py:56-58, 502; auth.py:212) | No general IP-level pre-auth limiter (F-B02A-10) |
| §5.1 | 4. Authenticate (JWT sig/expiry) + client version | PARTIAL | deps.py:55-88 (pinned-alg JWT, session revocation, token_version) | Client-version check missing (F-B02A-09) |
| §5.1 | 5. Coarse authorization (role per route) | DONE | deps.py:91-118; per-route `require_role(...)` e.g. submissions.py:99, state.py:47 | |
| §5.1 | 6. Static schema validation (Pydantic) | PARTIAL | submissions.py:48-68, levels.py:162-180 (types/lengths/enums) | Path IDs are plain `str` — malformed UUIDs fail later at SQL CAST → 500 INTERNAL_ERROR instead of 404/422 (e.g. submissions.py:395, leaderboard.py:26-33) (F-B02A-10) |
| §5.2 | 7. Load principal / session not revoked / consent current inside tx | PARTIAL | deps.py:65-87 (session check in its own short session/tx, not the mutation tx); consent gate deps.py:121-138 (separate tx) | Auth checks run in a separate transaction before the mutation (TOCTOU window; token_version mitigates) |
| §5.2 | 8. Reserve idempotency key (INSERT…ON CONFLICT); replay stops here | PARTIAL | submissions.py:123-139, levels.py:895-917 (SELECT-then-INSERT; UNIQUE catches races but no ON CONFLICT handling → 500 on concurrent same-key retry; repo-lock does handle it: levels.py:529-537) | F-B02A-06 |
| §5.2 | 9. Lock stage-state row FOR UPDATE | DONE | submissions.py:141-154 (`FOR UPDATE` on stage); levels.py:927 | |
| §5.2 | 10. Read `clock_timestamp()` once | DONE | submissions.py:157; levels.py:928 | |
| §5.2 | 11. Domain validation (stage open, gate, assignment/ownership, spans, caps) | DONE | submissions.py:171-239 (state → validation → assignment/file → caps/cooldown, ordered); levels.py:931-1001 (state → gate → repo lock → payload/artifact) | Ordered, first-failing-rule-wins |
| §5.2 | 12. Lock participant quota row FOR UPDATE briefly | MISSING | caps implemented as COUNT queries without row locks (submissions.py:207-225, 216-225); levels path serialized per-participant via pointer lock (levels.py:920) | v1 route caps can oversell under same-author concurrency (F-B02A-22) |
| §5.2 | 13. Write domain rows + submission_event + job + outbox intent + audit entry | DONE | submissions.py:263-314 (submission + enqueue jobs + outbox_events + audit_write in one tx); levels.py:1022-1078 | |
| §5.2 | 14. Commit; build envelope with server_time | PARTIAL | app_session commits on exit (db.py:47-57); response built after commit but WITHOUT spec envelope/server_time (submissions.py:315-325) | F-B02A-01 |
| §5 | Lock order: idempotency → stage state → progress → quota → writes | DEVIATION | levels.py:919-927: pointer (progress) locked BEFORE stage row; v1 route locks stage only; no quota lock | Reversed progress/stage order vs spec (no cross-flow deadlock found, but the declared order is not followed) (F-B02A-22) |
| §5 | Reads use read-only session with short statement timeout | MISSING | every read handler uses the same read-write `app_session()` (e.g. announcements.py:16, submissions.py:344, review.py:30); no `statement_timeout` anywhere (grep) | F-B02A-11 |
| §5 | Routes contain no scoring logic | DONE | participant routers import neither scoring nor evaluator (imports grep); scoring only in evaluator/scoring/admin adjustments | |

---

## Findings

### F-B02A-01 — HIGH — Success response envelope (data/meta) and server_time entirely absent
- **Evidence:** backend/app/routers/submissions.py:328-338 (`_receipt` returns bare dict), 383, 460; backend/app/routers/announcements.py:29-41; backend/app/routers/leaderboard.py:57-62; backend/app/routers/levels.py:1088-1095; backend/app/main.py:85-92 (middleware adds only headers). `server_time` appears only in auth.py:184,298,357 and state.py:25,63,78.
- **Impact:** Wholesale violation of the §2.3/§2.6 core API contract: no `{"data", "meta":{request_id, server_time}}` on any success response; clients built to the spec envelope cannot parse responses, and the spec'd client clock-sync mechanism (server_time on every response) does not exist.
- **Fix:** Add a response wrapper (FastAPI custom `route_class`/middleware or a `respond(data, request)` helper) that emits `{"data": …, "meta": {"request_id", "server_time": <db UTC ISO-8601 Z>}}`, and route all success returns through it; keep the existing error envelope.

### F-B02A-02 — HIGH — §1.3/§3 process-role separation absent: participant and admin API are one process/port/DB role
- **Evidence:** backend/app/main.py:97-110 (admin, admin_levels mounted alongside participant routers on one app); scripts/run_dev.sh:36-37 (single uvicorn + one generic worker); backend/app/config.py:24-26 (only app_api + gt_admin DSNs); scripts/dev_db.sh:99-106 (roles app_api, gt_admin, scheduler only — no admin_api/worker/evaluator/runner_gw); backend/worker.py:39-45 (scheduler duties inline in worker).
- **Impact:** The topology's security boundary (admin on 127.0.0.1:8001 admin-host-only, Cloudflare Access, separate admin_api DB role) cannot be enforced; the admin surface is reachable on the same origin as the participant API; worker, evaluator and scheduler roles are not least-privilege separated (worker runs as app_api; the `scheduler` role exists but is unused).
- **Fix:** Split into api_participant/api_admin apps (or at minimum mount admin under a separate listener/origin per §1.3), create and use per-process DB roles (admin_api, worker, evaluator, scheduler), and move the auto-submit scheduler into its own leader-elected process (advisory lock) per §1.3.

### F-B02A-03 — HIGH — §1.5 default JWT secret baked into code; no file-based secret support
- **Evidence:** backend/app/config.py:32 (`jwt_secret: str = "dev-only-insecure-secret-replace-me"`); security.py:29 (Fernet key derived from it), 121 (receipt HMAC), 129 (flag HMAC) — all keyed on this value; no `*_FILE` support anywhere (grep).
- **Impact:** Spec: "No secret is ever baked into an image." A deployment that forgets the override silently runs with a public secret → forgeable admin JWTs, decryptable refresh-token successors, forgeable receipts/flags. There is no boot-time check that the secret was changed for non-dev environments.
- **Fix:** Fail fast at startup when `environment == "production"` and jwt_secret equals the dev default (or is unset); add `JWT_SECRET_FILE` (and `*_FILE` generally) reading from mounted files per §1.5.

### F-B02A-04 — HIGH — §2.8 raw password-reset token printed to stdout/logs
- **Evidence:** backend/app/routers/auth.py:519-521 (`print(f"[dev-mail] password reset token for {email}: {raw}")` — the raw bearer-equivalent reset token goes to stdout, which run_dev.sh redirects into logs/api.log; run_dev.sh:36).
- **Impact:** Direct violation of §2.8 "Never logged: tokens". Anyone with log/ops access (or a log aggregation pipeline) can reset any account's password; also leaks registered email addresses into logs.
- **Fix:** Remove the print; persist the reset link for organizer-console retrieval (as the code comment claims) in a staff-only table/admin view, or send via a real SMTP provider; add the allow-list redaction middleware §2.8 requires.

### F-B02A-05 — MEDIUM — §2.4 error catalog: code/status mismatches and missing canonical codes
- **Evidence:** backend/app/errors.py:31 (`DRAFT_VERSION_CONFLICT` → 412; spec patch B3 mandates 409), errors.py:37 (`KEY_NOT_AVAILABLE` → 425, unspec'd), main.py:74-77 (413 → `SUBMISSION_INVALID`, spec `PAYLOAD_TOO_LARGE` 413); missing spec codes: STAGE_NOT_OPEN/PAUSED/CLOSED (only ROUND_* at errors.py:24-26), AUTH_SESSION_EXPIRED/SUPERSEDED, AUTH_CONSENT_REQUIRED (RULES_NOT_ACCEPTED at :23), AUTH_STEP_UP_REQUIRED (ADMIN_STEP_UP_REQUIRED at :39), GATE_BLOCKED (TEAM_GATE_BLOCKED at :44), ALREADY_SUBMITTED, UPLOAD_TOO_LARGE/TYPE_UNSUPPORTED/INVALID (ARTIFACT_INVALID at :46), RUN_COMMAND_UNKNOWN, CLIENT_TOO_OLD, PAYLOAD_TOO_LARGE, MAINTENANCE, UPSTREAM_UNAVAILABLE, INTERNAL (INTERNAL_ERROR at :53); AUTH_RATE_LIMITED raised without `Retry-After` header (deps.py:33-39; errors.py:73 sets only X-Request-Id).
- **Impact:** Spec-built clients keying on stable codes (e.g. DRAFT_VERSION_CONFLICT 409, PAYLOAD_TOO_LARGE 413) get wrong semantics; the STAGE_* canonical names required by patch B3 do not exist; 429 responses lack Retry-After.
- **Fix:** Map DRAFT_VERSION_CONFLICT to 409, add PAYLOAD_TOO_LARGE for body-cap rejections, add the missing catalog entries (with ROUND_* as aliases), attach `Retry-After` to AUTH_RATE_LIMITED/SUBMISSION_COOLDOWN/RUN_RATE_LIMITED.

### F-B02A-06 — MEDIUM — §2.5 idempotency store not implemented per spec; missing on uploads; race can 500
- **Evidence:** migrations/0001_init.sql:374,391 (key on app.submissions, `UNIQUE(author_id, idempotency_key)`, VARCHAR(80)); submissions.py:96 (max_length=80 vs spec 8–128); reservations are SELECT-then-INSERT without ON CONFLICT — submissions.py:124-134/263-294 and levels.py:896-917/1022-1050 (only repo-lock handles the unique violation: levels.py:529-537); uploads require no Idempotency-Key (levels.py:789-796); no route scoping, no response_status/response_body, no created_at/expires_at retention (event+7d/24h).
- **Impact:** Scope is (author, key) not (principal, route): the same key used on two different POST routes collides; concurrent same-key retries (the exact burst-retry case §1.4 targets: "zero 5xx") hit the UNIQUE constraint and surface as 500 INTERNAL_ERROR; uploads are not idempotent at all; keys never expire.
- **Fix:** Create `app.idempotency (principal_id, route, key UNIQUE, payload_hash, response_status, response_body, created_at, expires_at)`; reserve with `INSERT … ON CONFLICT` and on conflict return the stored response (or IDEMPOTENCY_CONFLICT on hash mismatch); require the header on `/v1/uploads`; set retention per §2.5.

### F-B02A-07 — MEDIUM — §2.7 cursor-based pagination absent
- **Evidence:** backend/app/routers/announcements.py:15-27 (`limit` query param capped at 100, no cursor); submissions.py:350 (`ORDER BY received_at DESC LIMIT 200`); review.py:38 (`LIMIT 200`); grep confirms no `cursor`/`next_cursor` in the backend.
- **Impact:** No `meta.next_cursor`, no opaque HMAC-signed cursors: clients cannot page past fixed caps (data silently truncated), and offset-style iteration is impossible; violates §2.7 outright.
- **Fix:** Introduce `?limit&cursor` handlers with HMAC-signed opaque cursors (key from settings, rotation-ready) and `meta.next_cursor` on list endpoints (announcements, submissions, review queue, admin lists).

### F-B02A-08 — MEDIUM — §2.8 structured request logging absent
- **Evidence:** backend/app/main.py:34 (plain-text `logging.basicConfig`), 40-42 (only startup/shutdown log lines); grep of `log.` across backend/app shows no request logging; no middleware captures route/method/status/duration_ms/principal/team_id/event_id/client_version/error_code/remote_ip_hash (security.ip_hash exists at security.py:132-135 but is unused for logging).
- **Impact:** No observability for the §1.4 budgets (p95 latency, 5xx rates), no request correlation in logs beyond the X-Request-Id header, no security-event trail outside the audit table.
- **Fix:** Add a JSON logging formatter plus an access-log middleware emitting the §2.8 field set (use `security.ip_hash` for remote_ip_hash), with the allow-list redaction pass.

### F-B02A-09 — MEDIUM — §2.2 X-Client-Version minimum-version gate missing
- **Evidence:** No occurrence of X-Client-Version/client_version in backend (grep); the only client header check is `x-bhctf-client` presence for refresh CSRF (deps.py:176-177); no CLIENT_TOO_OLD/426 in errors.py:16-54.
- **Impact:** Spec'd client-age enforcement (426 CLIENT_TOO_OLD) cannot be returned; a stale SPA that corrupts data (e.g. old draft schema) cannot be locked out during an event.
- **Fix:** Read X-Client-Version in middleware, compare against a configurable minimum, return 426 CLIENT_TOO_OLD, and log client_version per §2.8.

### F-B02A-10 — MEDIUM — §5 phase-1 gaps: Content-Length-only body cap, no content-type check, no IP-level limiter, unvalidated path IDs → 500
- **Evidence:** main.py:71-72 (limit enforced only when a parseable `content-length` header exists; `int(cl)` itself can raise on junk → 500); no content-type validation anywhere in middleware; rate limiting is per-identity/route in-process (deps.py:30-39; submissions.py:101) with IP keys only on login/reset/register (auth.py:56-58, 212, 502); path params are plain `str` cast to uuid in SQL — malformed IDs raise DB cast errors surfaced as 500 INTERNAL_ERROR (submissions.py:395-404, leaderboard.py:26-33, levels.py e.g. `_team_choice` usage; no UUID validation in routers).
- **Impact:** Chunked/lie-about-length bodies bypass the pre-tx size cap (memory exhaustion risk); unauthenticated endpoints lack a pre-auth IP limit (venue-NAT friendly limit of §5.1 step 3); junk IDs produce 500s (spec: 404/422) and pollute 5xx metrics against the §1.4 "zero 5xx" burst budget.
- **Fix:** Enforce a streaming body cap (reject when reading beyond the limit), validate content-type per route, add a generous global IP-level limiter in middleware, and type path ids as UUID (or validate before CAST) returning 404/VALIDATION_ERROR.

### F-B02A-11 — MEDIUM — §5 reads do not use read-only sessions with a statement timeout
- **Evidence:** All GET handlers open the read-write `app_session()` (db.py:47-57) — e.g. announcements.py:16, submissions.py:344, review.py:30, leaderboard.py:23; grep shows no `statement_timeout` and no read-only session anywhere (db.py:29-37 sets only connect_timeout=5).
- **Impact:** A slow query holds a pool connection indefinitely (pool_size 8 + overflow 4, config.py:27-28); under 200 pollers the pool exhausts, violating the §1.4 read p95 and `/state` p95 budgets; reads can also take implicit write locks via the same session factory.
- **Fix:** Add a read-only engine/session (`SET default_transaction_read_only`, `options="-c statement_timeout=500ms"`) and use it for GET routes per §5.

### F-B02A-12 — MEDIUM — §1.5 configuration surface deviates wholesale
- **Evidence:** backend/app/config.py:15-57 vs spec §1.5: no PG_HOST/PG_PORT/PG_DB/PG_USER/PG_PASSWORD/PG_POOL_MIN/MAX (uses DATABASE_URL_APP/GT, db_pool_size/db_max_overflow); no JWT_TTL/REFRESH_TTL naming (ACCESS_TOKEN_TTL_S/REFRESH_TOKEN_TTL_S exist), no ARGON2_PARAMS (hardcoded security.py:27), no COOKIE_SECURE (secure tied to `environment=="production"` at auth.py:38), no ADMIN_AUTH_MODE, no STORAGE_KIND/STORAGE_BUCKET/STORAGE_ENDPOINT, no AI_* / RUNNER_* / SMTP_* groups, no ENV=dev|staging|prod (`environment` is development|production only), no FEATURE_* (uses RUNNER_ENABLED/AI_ASSESSMENT_ENABLED/TELEMETRY_ENABLED); backend/.env.example mirrors this set.
- **Impact:** Deployments scripted to the spec's variable contract cannot configure this service; staging profile cannot be expressed; Argon2 parameters cannot be tuned without code change; object-store/AI/runner/email pluggability declared in §1.1 has no configuration hooks.
- **Fix:** Either implement the spec's variable groups (aliases are fine) or record a documented deviation; at minimum add STORAGE_KIND, ARGON2_PARAMS, COOKIE_SECURE, ENV=staging handling and *_FILE secret-file loading.

### F-B02A-13 — MEDIUM — §1.1/§1.2 tooling & structure deviations: no mypy, no gunicorn workers, sync psycopg, no lockfile, no boundaries CI
- **Evidence:** ruff.toml (ruff only); backend/requirements-dev.txt:3-6 (ruff, bandit, pip-audit — no mypy); .github/workflows/ci.yml (no mypy step); scripts/run_dev.sh:36 (single uvicorn, no gunicorn/workers= min(2×vCPU,4)); config.py:24/db.py:29-44 (sync psycopg, no asyncpg); requirements.txt:6-7 (`sqlalchemy>=2.0.44`, `psycopg[binary]>=3.2.10` — no lockfile/pyproject); backend layout is a flat `app/` package (LS backend/app) vs the spec's apps/+packages/ tree; no `pytest -m boundaries` (pytest.ini:1-5).
- **Impact:** The spec'd quality gate (mypy --strict on module boundaries), multi-worker ASGI topology, async driver and pinned lockfile are all absent — type drift ships to runtime, single-process API caps concurrency headroom for the 200-participant target, and dependency versions float between installs.
- **Fix:** Add mypy --strict to CI (at least on package boundaries), introduce a Gunicorn+UvicornWorkers entrypoint, add a lockfile (uv/pip-tools), and add boundary tests (import-linter or pytest marker) for the participant/admin/gt rules.

### F-B02A-14 — MEDIUM — §1.3/§4 ground-truth schema read/written from the API process (admin router)
- **Evidence:** backend/app/routers/admin.py:26 (imports `gt_session`), 759 and 825 (`with gt_session() as gts:` writing gt bugs/flags); the same process serves participant traffic (main.py:97-110); db.py:41 (gt_engine from config DATABASE_URL_GT available to the whole app).
- **Impact:** Spec reserves gt access to the worker_evaluator process/role only; here the merged API process holds gt_admin credentials, so any RCE/SSRF in the participant-facing process exposes ground truth (answers) — the gt/app DB-role isolation (test_gt_isolation.py) protects against SQL-level mistakes, not process-level compromise.
- **Fix:** Move gt writes (admin ground-truth endpoints) behind a job executed by the evaluator worker (or a separate admin process), and keep gt credentials out of the participant API process.

### F-B02A-15 — MEDIUM — §5.1/§2.2 login accepts any password for accounts with an empty hash (password bootstrap)
- **Evidence:** backend/app/routers/auth.py:79-86 ("Registered but no password set yet: the password typed now becomes the password" — `UPDATE app.users SET password_hash=…` on login); comment at 74-75 acknowledges the accepted risk. Current code paths always set a hash (seed.py:568, 796; auth.py:221, 416), so the branch is latent.
- **Impact:** Any future path (ops script, partial seed, invite flow change) that leaves `password_hash` NULL turns login into account takeover by anyone who knows the email; also blurs the §6.1 login/activate separation and bypasses password policy (min length not enforced here).
- **Fix:** Reject login for NULL-hash accounts with AUTH_INVALID_CREDENTIALS (or route them through the invite/activate flow); enforce password_min_length in this branch if kept.

### F-B02A-16 — MEDIUM — §2.2 draft optimistic concurrency uses body version instead of If-Match; conflict is 412 not 409
- **Evidence:** backend/app/routers/submissions.py:463-520 and levels.py:423-461: `DraftIn.version` body field compared against the locked row; no If-Match header anywhere (grep); DRAFT_VERSION_CONFLICT status 412 (errors.py:31) vs spec 409 (patch B3).
- **Impact:** Spec'd clients sending `If-Match` are ignored (a stale tab overwrites silently when body version is omitted — submissions.py:511 `if body.version is not None` makes the check optional); wrong status code breaks error handling keyed on 409.
- **Fix:** Accept and require `If-Match: <version>` on draft PUT (reject without it), return 409 DRAFT_VERSION_CONFLICT on mismatch, and stop honoring the body version field.

### F-B02A-17 — MEDIUM — §2.6 server_time not carried on responses; timestamps not `Z`-suffixed
- **Evidence:** server_time present only at auth.py:184, 298, 357 and state.py:25, 63, 78 (all other responses lack it, e.g. submissions.py:328-338, levels.py:1088-1095); serialization is `datetime.isoformat()` producing `+00:00` (e.g. submissions.py:332, 368; levels.py:913) instead of the spec'd `Z`.
- **Impact:** Clients cannot keep their clock offset current from ordinary responses (spec §2.6) and must parse two timestamp shapes; spec-compliant consumers expecting `Z` still parse `+00:00`, but strict parsers fail.
- **Fix:** Emit `server_time` in the meta envelope (see F-B02A-01) and normalize ISO-8601 output to trailing `Z`.

### F-B02A-18 — LOW — §1.4 body cap 512 KiB (spec 1 MiB); response cap 2 MiB unenforced
- **Evidence:** backend/app/config.py:42 (`max_body_bytes = 512*1024`); no response-size cap anywhere (grep; main.py middleware only sets headers).
- **Impact:** JSON bodies between 512 KiB and 1 MiB are rejected though spec allows them (stricter, low impact); oversized responses (large leaderboard snapshots / file content >2 MiB) are never truncated or rejected.
- **Fix:** Raise the JSON cap to 1 MiB or record the deviation; add a response-size guard (413/UPSTREAM trim) for the 2 MiB budget.

### F-B02A-19 — LOW — §2.1 stages addressed by ordinal level number, not a stable stage_key
- **Evidence:** backend/app/routers/levels.py:872 (`/levels/{level_no}/submit`, `level_no: int`), 241 (`/levels/{level_no}/gate`); flow.py:19 (`LEVEL_COUNT = 4` hard-coded four-level flow); stage UUIDs are used only in admin/leaderboard paths.
- **Impact:** Spec's rationale (events configurable with different stage sets, stable keys like L1/L2) is unmet: the URL surface is hard-wired to exactly four ordinal levels; no Deprecation/Sunset header mechanism exists for future changes.
- **Fix:** Accept a stable `stage_key` path segment resolved to the configured stage, keep ordinals only as a display value; add a helper for Deprecation/Sunset headers for future additive changes.

### F-B02A-20 — LOW — §1.1/§1.5 object storage: only the FS adapter; no MinIO/S3 option
- **Evidence:** backend/app/storage.py:23-54 (filesystem save; `artifact_storage_dir` config only); config.py:48; no STORAGE_KIND/STORAGE_BUCKET/STORAGE_ENDPOINT (grep, .env.example).
- **Impact:** The declared pluggability (FS dev → MinIO staging → R2 prod with off-host backups) has no selectable backend; staging/prod deployments cannot satisfy the storage topology with code as-is (interface is adapter-ready per the docstring).
- **Fix:** Add a STORAGE_KIND-dispatched adapter (local, minio/s3 via boto3) behind the existing `save/inspect` interface and the §1.5 env vars.

### F-B02A-21 — LOW — §0/§1.4 load target: qualification pending at every N (50/100/200)
- **Evidence:** docs/LOAD_TEST_REPORT.md:3 ("SCRIPT READY, MEASUREMENT PENDING… never produced accepted numbers"), 53-60 (results table all UNRUN); scripts/load_test.py:4-10 (tool models 60 pollers/10-burst only, no N=100/200 mode).
- **Impact:** The 200+ concurrent-participant target is unqualified; the spec requires the announced cap to be the largest N that passed the full profile — docs currently comply (cap 50 pending), but the tooling cannot even run the N=100/200 points.
- **Fix:** Extend scripts/load_test.py to parameterized N (50/100/200) with the §1.4 deadline-rush burst (200 submits/60 s, zero 5xx) and record measured p50/p95/p99 before any capacity claim.

### F-B02A-22 — LOW — §5 lock order and quota-row locking deviate
- **Evidence:** levels.py:919-927 (participant pointer locked FOR UPDATE before the stage row — spec order is stage state before progress; v1 submissions.py:141-154 locks only the stage); caps enforced via COUNT queries without quota-row FOR UPDATE (submissions.py:207-225).
- **Impact:** The declared deadlock-prevention order is not followed (no cross-flow deadlock identified today, but the invariant is unverifiable); v1 per-file/per-round caps can be exceeded by a few under same-author concurrency (levels path is serialized by the pointer lock).
- **Fix:** Lock in the spec order (idempotency → stage → progress → quota) in the levels flow; add a per-author quota/counter row locked FOR UPDATE for cap checks on the v1 route.

### F-B02A-23 — LOW — §2.3 copy catalog / copy_key absent
- **Evidence:** backend/app/errors.py:16-54 (user-facing strings hardcoded per code in CATALOG); no copy_key in meta anywhere (grep).
- **Impact:** Message changes require code changes and cannot be localized/A-B tested; the spec'd `copy_key` correlation for displayed text is unavailable.
- **Fix:** Move messages to a copy catalog table/dict and include `meta.copy_key` when a user-facing message is returned.

---

## EXTRA (implemented but unspec'd, notable)

- **Hash-chained audit log with verify endpoint** (audit.py:20-95; admin.py:1043-1049): exceeds §4's audit.emit/verify expectations; DB-enforced immutability (migrations/0002).
- **Refresh-token family rotation with reuse detection + successor encryption** (auth.py:250-357; security.py:60-68): implements §1.1 opaque refresh with rotation and family revocation beyond the listed scope.
- **Session cap with zombie reclaim and oldest-eviction** (auth.py:93-139): stronger than the §4 auth module description.
- **`/v1/auth/register` admin endpoint** (auth.py:202-247): not in the §6.1 catalog (spec uses invite activation only) — reasonable but unspec'd (also relates to F-B02A-15's bootstrap branch).
- **Deadline auto-submit scheduler** (auto_submit.py, worker.py:39-45): server-side authority for deadline submits (§ scheduler duties in §1.2) implemented inside the generic worker rather than a scheduler process — see F-B02A-02.

## Summary counts

- Requirements tracked (rows above): 84 — DONE 29, PARTIAL 24, DEVIATION 22, MISSING 9 (tallied from the per-section tables; several are deployment/tooling rather than runtime code).
- Findings: 23 — HIGH 4, MEDIUM 13, LOW 6, CRITICAL 0.

---

### 4.4 02 Backend Specification, sections 6-end - API catalog (`spec02b`)

# Backend Spec 02 Audit — Sections 6 to end (API catalog, state machines, jobs, evaluation, runner, rate limits, testing, hygiene)

- **Agent:** spec02b (audit subagent)
- **Task ID:** 3-d
- **Baseline document:** `/home/z/my-project/upload/02_Backend_Spec.md` (02 Backend Specification, patched v0.2)
- **Sections covered:** §6 (API catalog, API-01 … API-21 incl. 6.4.1), §7 (State machines), §8 (Background jobs), §9 (Evaluation and AI assessment), §10 (Runner protocol), §11 (Rate limits), §12 (Testing), §13 (Platform hygiene)
- **Repo HEAD:** `f1412b7eec6c92c4c168fd2b8a58182b34480387` (2026-11-26)
- **Method:** Every requirement was checked against actual code in `backend/app/routers/*.py`, `backend/app/{deps,security,errors,config,db,storage,jobs,flow,matching,evaluator,evaluator_level,scoring,auto_submit,audit,main}.py`, `backend/worker.py`, `backend/migrations/*.sql`, `backend/tests/*`, `backend/pytest.ini`. READ-ONLY audit; no files modified, no tests run.

## Per-section status table

| Spec ref | Requirement (short) | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| 6.1 API-01 | POST /auth/login `{identifier,password}`, sets refresh cookie | DEVIATION | backend/app/routers/auth.py:54-192 | Field is `email` not `identifier`; cookie set; rate limits differ from §11; HIGH flaw see F-B02B-01 |
| 6.1 | POST /auth/refresh rotates token, serialized | DONE | auth.py:250-357 | Rotation + grace-window reuse detection implemented; serialization via grace window, not row lock |
| 6.1 | POST /auth/logout revokes session | DONE | auth.py:360-381 | Revokes session + refresh family |
| 6.1 | POST /auth/activate (invite token, sets password) | DONE | auth.py:390-463 | Single-use invite; replay returns NOT_FOUND rather than original result (minor) |
| 6.1 | POST /auth/reset/request, no enumeration | DEVIATION | auth.py:500-523 | Path is `/auth/password/reset-request`; generic response OK; token printed to log (F-B02B-25) |
| 6.1 | POST /auth/reset/confirm | DEVIATION | auth.py:531-572 | Path is `/auth/password/reset`; sets password, bumps token_version, revokes sessions |
| 6.1 | GET /me: name, team, role, consent state | PARTIAL | auth.py:575-611 | Returns `rules_accepted` only; no privacy/telemetry/ai consent versions (API-02 shape) |
| 6.2 API-02 | GET /consent `{rules,privacy,telemetry,ai,accepted}` | MISSING | no /consent route (route grep across backend/app) | Only rules acceptance exists |
| 6.2 | POST /consent; non-consent routes → AUTH_CONSENT_REQUIRED | MISSING | deps.py:121-138; auth.py:659-692 | Substitute: POST /me/acceptances + `RULES_NOT_ACCEPTED` (403) gate; different code/shape |
| 6.3 API-03 | GET /event/public cacheable 30s | DEVIATION | routers/public.py:13-45; main.py:90-91 | Path `/public/event`; `Cache-Control: public, max-age=10` (10s not 30s); shape differs (no brief/maintenance) |
| 6.3 | GET /content/event-details (sanitized Markdown) | MISSING | no route | Only `/public/rules` serves markdown |
| 6.3 | GET /time `{server_time, tz}` | DONE | routers/state.py:21-25 | Returns `server_time_ms`/`server_time`; no tz field (minor) |
| 6.4 API-04 | GET /state aggregate for SPA poll | DONE | routers/state.py:45-94 | Round + versions + rules_version; shape differs from §6.4.1 model |
| 6.4 | GET /progress node states/deadlines | DONE | routers/levels.py:663-697 | Pointer, per-level gates, teammates |
| 6.4 | GET /leaderboard?since= → 304 if unchanged | DEVIATION | routers/leaderboard.py:21-62 | Path `/leaderboard/{stage_id}`; no `since`, no 304/ETag |
| 6.4 | GET /team members, lead, per-member status, repo choice | DONE | routers/levels.py:586-615 | Full choice + per-member level map + pointer |
| 6.4 | GET /team/score `{score, version, last_updated}` | PARTIAL | routers/levels.py:618-657 | Returns per-level totals + released flag; no version/last_updated |
| 6.4 | GET /announcements paginated | PARTIAL | routers/announcements.py:14-41 | `limit` param capped at 100; no cursor/offset pagination |
| 6.4.1 | state_versions record, ETag, If-None-Match 304, in-process cache | MISSING | routers/state.py:45-94; migrations/0001_init.sql (no state_versions table) | Versions computed inline each request; no ETag |
| 6.5 API-05 | GET /repo/tree team's option, watermarked paths | PARTIAL | routers/levels.py:717-741 | Team-scoped tree; no watermarking |
| 6.5 | GET /repo/files/{path} watermarked, ETag, private no-store | PARTIAL | routers/levels.py:744-783; main.py:89 | Cache-Control OK (middleware); no ETag; no watermark; traversal guarded |
| 6.5 | GET /repo/search?q= server-side, paginated, rate limited | DEVIATION | routers/challenges.py:146-172; levels.py (no /repo/search) | `/challenges/{id}/search`, LIMIT 50 no pagination, 30/min vs spec 20/min |
| 6.5 | GET /repo/symbol?name= from sealed index | MISSING | no route | No symbol lookup endpoint |
| 6.6 API-06 | POST /team/repo-lock lead-only once, Idem-Key, 409 w/ existing | DONE | routers/levels.py:467-583; migrations/0003:28-40 | Full contract incl. IntegrityError race handling and REPO_ALREADY_LOCKED details |
| 6.6 | GET /team/repo-lock current choice or null | MISSING | route grep; levels.py:586-615 | No standalone endpoint; choice exposed inside GET /team |
| 6.7 API-07 | GET /stages/{key}/gate `{allowed,reason,waiting_on[]}`, ≤2s | DEVIATION | routers/levels.py:241-252; flow.py:235-341 | Path `/levels/{level_no}/gate`; shape matches; computed per request (never cached) |
| 6.8 API-08 | PUT /drafts `{workspace,files,flags,base_version}` → `{version,server_saved_at}`, 409 stale, ≤512KB | PARTIAL | routers/levels.py:423-461; submissions.py:487-520; errors.py:31 | Version conflict returns 412 not 409; response lacks `server_saved_at`; version in body not If-Match; 512KB via global body cap (main.py:68-72) |
| 6.8 | GET /drafts latest server draft | DONE | levels.py:400-420; submissions.py:468-484 | Two draft surfaces (level drafts + v1 drafts) |
| 6.9 API-09 | POST /stages/{key}/submit L1-2 flags / L3-4 upload → 202 receipt | DEVIATION | routers/levels.py:872-1095 | Path `/levels/{n}/submit`; `artifact_id`/`compute_diff` vs `kind:"upload"`; returns `{submission_id, receipt_code, received_at, status}` vs `{receipt_id, accepted_at}`; idempotency contract fully implemented |
| 6.10 API-10 | POST /uploads multipart zip/diff/patch, streamed, cap, magic, sha256, 201 stored | PARTIAL | routers/levels.py:789-866; storage.py:57-91 | Returns 200 not 201, `{artifact_id, status:"staged"}` not `{upload_id,"stored"}`; zip metadata inspection; no magic-number check for diff/patch; never unpacked OK |
| 6.10 | POST /uploads/{id}/validate → 202 job | MISSING | no route; no `upload_validate` handler | Validation is synchronous metadata-only at upload |
| 6.10 | GET /uploads/{id} status | MISSING | no route | |
| 6.10 | DELETE /uploads/{id} only before submit | MISSING | no route | Staged artifacts cannot be removed |
| 6.10 | Submit requires status=ok (deferred validation) | MISSING | levels.py:972-1001 | Submit only requires artifact `status='staged'`; no validation state machine |
| 6.11 API-11 | POST /runs `{stage_key,command_id,workspace}` | MISSING | routers/levels.py:1168-1178 | Stub returns RUNNER_UNAVAILABLE; runner_enabled default False; no command allow-list |
| 6.11 | GET /runs/{id} result | MISSING | levels.py:1181-1187 | Stub |
| 6.11 | POST /runs/{id}/cancel | MISSING | no route | |
| 6.12 API-12 | GET /receipts/{id} | MISSING | no route | Receipts only inside /submissions list/detail |
| 6.12 | GET /results after finalization only | DEVIATION | routers/leaderboard.py:65-125 | Path `/results/{stage_id}`; gated on feedback release (correct behavior, different path) |
| 6.12 | POST /disputes idempotent | PARTIAL | routers/submissions.py:426-460 | Path `/submissions/{id}/dispute`; not idempotent (no dedupe key/unique constraint) |
| 6.12 | GET /disputes own disputes | MISSING | no participant route | Only /admin/disputes (admin.py:1178-1191) |
| 6.13 API-13 | Cloudflare Access assertion + MFA + step-up 5 min | MISSING (step-up DONE) | deps.py:141-162; auth.py:470-493 | CF Access absent (documented in code comment); step-up = re-entered password, 5 min, server-side — implemented and used by GT endpoints |
| 6.13 | ADMIN_AUTH_MODE; refuse boot staging/prod+shared_secret | MISSING | config.py:15-58 | No admin auth mode at all; no staging environment value; no boot refusal check |
| 6.13 | POST /admin/auth/step-up | DEVIATION | auth.py:470-493 | Exists at `/auth/step-up`; 5-min validity `valid_until` returned |
| 6.13 | POST /admin/auth/logout | MISSING | no route | Only /auth/logout |
| 6.14 API-14 | /admin/events CRUD | PARTIAL | admin.py:48-93, 202-214 | Create + list only; no read-one/update/delete |
| 6.14 | /admin/events/{id}/config revisioned; freeze; step-up | PARTIAL | admin.py:153-199 | Revision + freeze + audit implemented; step-up NOT required (F-B02B-10) |
| 6.14 | /admin/events/{id}/stages | DONE | admin.py:241-276 | Create with rule_set_hash |
| 6.14 | /admin/events/{id}/schedule | MISSING | no route | Windows set via stage control start/extend only |
| 6.14 | /admin/events/{id}/repo-options | DONE | admin_levels.py:141-184 | Upsert option; step-up; audit |
| 6.14 | /publish freezes configuration | PARTIAL | admin.py:106-144 (readiness gate, status flow); 153-199 (freeze flag) | Config freeze exists, but no single publish endpoint that freezes all |
| 6.15 API-15 | participants CSV import (dry run, commit) | MISSING | admin.py:514-530 (list only); 476-511 (single invites) | |
| 6.15 | /admin/events/{id}/teams | PARTIAL | admin.py:439-467 | Create only; no list/update |
| 6.15 | /teams/{tid}/lock-repo override, records adjusted_by | DEVIATION | admin_levels.py:39-138 | Path `/admin/teams/{id}/repo-lock`; records locked_by/lock_source='admin_override'/audit_reason; step-up + audit |
| 6.16 API-16 | challenges CRUD/upload/seal/publish | PARTIAL | admin.py:542-729 | create/upload/freeze/seal/publish present; no validate step, no list/delete |
| 6.16 | /admin/challenges/{id}/ground-truth GET and PUT | PARTIAL | admin.py:748-851 | Write-only POSTs (bugs/flags) via gt_session + step-up; no GET, no generic PUT |
| 6.16 | every GT view writes audit entry w/ purpose | MISSING | no GT view endpoints | Moot given no views |
| 6.17 API-17 | /admin/events/{id}/live snapshot | DONE | admin.py:945-996 | Real counts, queue age, health |
| 6.17 | pause/resume/extend (reason ≥10 chars) | DONE | admin.py:291-394 | Reason required but min length not enforced (F-B02B-31) |
| 6.17 | /admin/events/{id}/announcements | DONE | admin.py:891-912 | Audit written |
| 6.17 | /admin/events/{id}/switches (kill switches) | MISSING | admin.py:991-995 | Read-only display of env flags; no toggle endpoint |
| 6.17 | stages force-open/force-close | MISSING | admin.py:279-288 (legal transitions only) | |
| 6.18 API-18 | /admin/review/queue | DEVIATION | routers/review.py:28-62 | Path `/review/queue`, staff role; behavior matches |
| 6.18 | /admin/review/{id} detail | DEVIATION | review.py:103-159 | `/review/items/{id}` |
| 6.18 | /admin/review/{id}/decide (reason required) | PARTIAL | review.py:170-247 | `/review/items/{id}/decision`; `notes` optional, not required |
| 6.18 | /admin/disputes | DONE | admin.py:1178-1258 | List + resolve + optional ledger adjustment |
| 6.18 | /admin/candidate-bugs | MISSING | no route | |
| 6.19 API-19 | answer-packs + activation (two approvers, step-up) | MISSING | no route | |
| 6.19 | /admin/events/{id}/rescore (dry run then execute) | MISSING | no rescore endpoint | Manual adjustments exist (admin.py:1261-1301) but no dry-run rescore |
| 6.19 | /admin/events/{id}/leaderboard (mode/freeze/publish) | MISSING | no route; visibility only via release job (admin.py:418) | |
| 6.19 | /admin/events/{id}/finalize (checklist, irreversible) | PARTIAL | admin.py:96-144 | `closed→finalized` transition exists; no server-side checklist re-verification; not irreversible (`finalized→archived` allowed) |
| 6.20 API-20 | /admin/health | DEVIATION | admin.py:1304-1322 | Path `/admin/system/health`; real probes |
| 6.20 | /admin/audit (search + chain verify) | DONE | admin.py:1043-1075; audit.py:69-95 | Action filter + hash-chain verify endpoint |
| 6.20 | /admin/exports (expiring links) | DEVIATION | admin.py:1078-1172 | Inline CSV content stored in app.exports; no expiring links |
| 6.20 | /admin/integrity | MISSING | no route | |
| 6.21 | GET /healthz internal | DEVIATION | main.py:112-118 | Path `/health`; returns 200/503 with DB probe |
| 6.21 | GET /readyz (schema head, clock <100ms, disk) | MISSING | no route; db.py:97-112 probe checks DB only | |
| 6.21 | GET /metrics (Prometheus, compose only) | MISSING | no route | |
| 7.1 | submission event log append-only (app.submission_events) | MISSING | migrations/0001_init.sql (no table); evaluator.py:169-208; review.py:226-230 | Status is updated in place on app.submissions |
| 7.2 | run state machine | MISSING | no runs | |
| 7.3 | session machine (REVOKED/SUPERSEDED) | PARTIAL | auth.py:103-129; 545-562 | Revoke paths implemented; SUPERSEDED not modeled (eviction reuses revoked) |
| 7.4 | pointer version/adjusted_by/adjusted_reason; "Adjusted by organizer" | PARTIAL | migrations/0003:43-50; flow.py:123-136 | Forward-only enforced; only `updated_at`; no organizer adjustment API or display |
| 7.5 | repo lock UNSET→LOCKED, UNIQUE(team_id) | DONE | migrations/0003:28-40; levels.py:529-537 | DB-enforced unique + race handling |
| 8.1 | jobs: SKIP LOCKED, lease 60s/heartbeat 20s, backoff 5s×2^n cap 5min, dedupe_key | PARTIAL | jobs.py:21,24-38,41-64,74-99 | SKIP LOCKED ✓; lease 120s no heartbeat; backoff [10,60,300,900]; no dedupe_key column (F-B02B-19) |
| 8.1 | SIGTERM: stop claiming, release leases | MISSING | worker.py:29-52 | No signal handling |
| 8.2 | job catalog (19 kinds) | PARTIAL | jobs.py handlers; evaluator.py:107-644; evaluator_level.py:97; auto_submit.py:296 | Present: evaluate (2), create_review_item, verify_flag, apply_review_outcome, apply_test_results, release_feedback, refresh_leaderboard, dispatch_outbox, auto_submit_levels. Missing: ai_assess, run_official, run_practice, upload_validate, stage_transition, rescore, send_email, integrity_analyze, retention_purge, idempotency_prune, chain_verify (scheduled), draft_compact, clock_check, seal_bundles/export |
| 8.3 | scheduler elected via advisory lock | MISSING | worker.py:29-52 | Single worker loop assumed; auto-submit re-scanned every 10s in-loop |
| 8.4 | auto-submit (draft→flags, workspace→diff, empty, pointer) | DONE | auto_submit.py:28-293; tests/test_flow_auto_submit.py | Same-path idempotent, missed-status for no-lock teams, pointer forward |
| 9.1 | pipeline RECEIVED→…→LEDGERED with separate ai/run jobs | PARTIAL | evaluator.py:107-208; evaluator_level.py:97 | Equivalent statuses implemented (received/matched_auto/needs_review/rejected_auto/duplicate/decided); no separate ai_assess/run_official jobs |
| 9.2 | deterministic matcher rules (incl. L2 ≥ceil(0.5×locations)) | PARTIAL | matching.py:121-270 | Single-location rule close to spec; L2 uses mean-best-score ≥0.9 instead of ≥50%-of-locations (F-B02B-21); category never decides alone ✓; determinism pure ✓; matcher_version/rule_set_hash not persisted per decision |
| 9.3 | hidden test cases, runner executes, evaluator compares | PARTIAL | migrations/0001 gt.gt_test_cases; admin.py:854-880; evaluator.py:407-452 | Organizer-recorded offline results (ADR-019) instead of runner; output_fraction = passed/total ✓; timeouts/faults N/A |
| 9.4 | AI assessment (input assembly, JSON contract, cap, retries, reproducibility, calibration) | MISSING | no assessor code; config.py:52 flag only | Kill switch default off; no provider adapter at all |
| 9.5 | ledger origin columns + CHECK(num_nonnulls=1); claims per unit | PARTIAL | migrations/0001:488-512; 0002:1-16; scoring.py:68-101 | Append-only DB trigger ✓; reversal entries ✓; award_claims UNIQUE(stage,team,unit) ✓; but no origin_type/gt_award_unit_id/ap_entry_id/manual_decision_id CHECK; claim is team-level not participant-level |
| 9.6 | snapshots with version/mode/tie-break; debounced build | PARTIAL | scoring.py:126-183; evaluator.py:579-630; leaderboard.py:34-56 | hidden serves nothing ✓, frozen delay ✓, tie-break ✓; built per submit job, not debounced 2s |
| 10.1-10.5 | runner protocol (gateway, claim/heartbeat/result, sandbox, admission) | MISSING | levels.py:1168-1187 (stub); config.py:51 | Deliberate ADR-010 kill-switch default off; no gateway/runner endpoints or sandbox |
| 11 | rate limit table (values, keys, failure-delay, Argon2 semaphore) | PARTIAL | deps.py:30-39; auth.py:57-58; levels.py:722,751,796,881; submissions.py:101; challenges.py:112,152 | In-memory per-process bucket; many rows match loosely, several missing entirely (F-B02B-24) |
| 12 | testing layers | PARTIAL | backend/tests/* (auth, matching, scoring, gates, repo lock, uploads, idempotency, auto-submit, authorization, gt isolation), scripts/load_test.py | Contract (schemathesis), fault injection, mutation, parallel-20 idempotency, boundaries marker absent (F-B02B-32) |
| 13 | CORS exact allow-list | DONE | main.py:54-62; config.py:68-69 | `allow_credentials=True` on all routes (spec: only /auth/refresh) — minor |
| 13 | refresh cookie HttpOnly/Secure/Strict/Path, __Secure- prefix | PARTIAL | auth.py:29-46; config.py:20 | HttpOnly ✓, SameSite=Strict ✓, Path=/v1/auth/refresh (tighter) ✓; Secure only when environment=="production"; no `__Secure-` prefix |
| 13 | CSRF origin + custom header | DONE | deps.py:170-177; auth.py:252 | Refresh is the only cookie route; both checks enforced |
| 13 | HSTS, nosniff, Referrer-Policy, no-store | PARTIAL | main.py:85-92 | nosniff ✓, Referrer-Policy ✓, private/no-store ✓; HSTS missing |
| 13 | OpenAPI disabled in staging/prod | DONE | main.py:50-51 | Enabled only in development |
| 13 | clock offset check 60s; readyz fails >100ms | MISSING | no route; db.py:97-112 | |
| 13 | CF-Connecting-IP only via Tunnel | PARTIAL | auth.py:56; deps.py (peer addr only) | Never trusts CF header (safe); no tunnel detection |
| 13 | graceful shutdown (drain 30s, release leases) | MISSING | main.py:38-42; worker.py:29-52 | Lifespan logs only |

**Row counts:** DONE 21 · DEVIATION 16 · PARTIAL 30 · MISSING 37 (104 requirement rows).

## Findings

### F-B02B-01 — HIGH — First-login "password claim" enables account pre-claim takeover
- **Spec ref:** §6.1 API-01 (login must verify credentials; passwords are set only via activate/reset)
- **Evidence:** backend/app/routers/auth.py:70-86 — `elif not user["password_hash"]:` → the typed password is hashed and stored, account activated. Code comment admits: "NOTE: this is a risk we are willing to take for this event."
- **Impact:** Any party who knows the email of a registered-but-not-yet-activated participant (e.g., seeded/invited accounts, visible on team pages) can "sign in" first with any password and permanently take over the account, including team membership and level progress. Classic pre-claim/account-takeover flaw; violates the invite-activation flow in API-01.
- **Fix:** Remove the claim-on-first-login branch. Users without a password must go through `/auth/activate` (invite token) or a verified reset; login must only ever `verify_password`.

### F-B02B-02 — HIGH — Runner protocol (§10) entirely unimplemented; /runs is a stub
- **Spec ref:** §10.1-10.5; §6.11 API-11
- **Evidence:** backend/app/routers/levels.py:1168-1187 (POST /runs and GET /runs/{id} always raise `RUNNER_UNAVAILABLE` or NOT_FOUND); no `/runner/claim|heartbeat|result` routes anywhere; config.py:51 `runner_enabled: bool = False`; no cancel endpoint.
- **Impact:** Major spec subsystem (runner gateway, pull protocol, sandbox lifecycle, admission control, one-concurrent-run limit, `RUN_RATE_LIMITED`) missing. Participants cannot run code at all; the spec's practice-run flow and hidden-test execution path do not exist. Mitigation: deliberate, documented kill-switch default-off (ADR-010) and evaluation falls back to drafts/diffs + organizer-recorded test results, so the core submission flow still works.
- **Fix:** Either land the runner gateway + protocol or record the deviation formally in the spec (mark §10/§6.11 as out-of-scope for v1) and remove the dead contract from the API surface.

### F-B02B-03 — MEDIUM — Consent API (API-02) missing; consent reduced to rules acceptance
- **Spec ref:** §6.2
- **Evidence:** No `/consent` route (full route grep); substitute: auth.py:659-692 (`POST /me/acceptances`), deps.py:121-138 (`require_rules_accepted` raises `RULES_NOT_ACCEPTED`).
- **Impact:** Spec requires `{rules_version, privacy_version, telemetry_version, ai_version, accepted}` and `AUTH_CONSENT_REQUIRED` on all non-consent routes until accepted. Only rules acceptance exists; privacy/telemetry/AI consent versions are not tracked or enforced (telemetry/AI are currently disabled flags, which limits exposure).
- **Fix:** Add GET/POST `/v1/consent` returning the four versions + accepted map, gate non-consent routes on full acceptance (reuse `require_rules_accepted`), or amend the spec.

### F-B02B-04 — MEDIUM — `/state` ETag/If-None-Match/304 and `state_versions` record missing
- **Spec ref:** §6.4.1 (patch B8)
- **Evidence:** backend/app/routers/state.py:45-94 computes versions inline (announcement count, max leaderboard version) on every request; no `state_versions` table in migrations/0001_init.sql; no ETag header anywhere in routers.
- **Impact:** The 200+ concurrent participants load profile relies on cheap 304s for the 5s poll loop; without them every poll does full aggregate queries. Correctness is unaffected (no stale pointer possible since nothing is cached).
- **Fix:** Add `state_versions` (progress_version per participant, score_version per team, event-level leaderboard/flags/announcement versions), cache serialized state keyed by the version tuple, emit ETag, honor If-None-Match with 304.

### F-B02B-05 — MEDIUM — `/leaderboard` has no `since`/304 semantics
- **Spec ref:** §6.4
- **Evidence:** backend/app/routers/leaderboard.py:21-62 — `GET /leaderboard/{stage_id}` always returns the latest eligible snapshot; no version compare.
- **Impact:** Extra payload on every poll; spec's conditional-request contract unimplemented (path also differs).
- **Fix:** Accept `since` (or ETag) and return 304 when the snapshot version is unchanged.

### F-B02B-06 — MEDIUM — Repo content watermarking missing (API-05 / patch R-14)
- **Spec ref:** §6.5
- **Evidence:** backend/app/routers/levels.py:717-783 — `/repo/tree` and `/repo/files/{path}` return raw DB rows (path/lang/content/sha256); no watermark code exists anywhere in backend/app.
- **Impact:** Watermark-based leak tracing (sharing repo content across teams) is impossible; content is served verbatim.
- **Fix:** Inject per-team watermark into served file content/paths per spec R-14, or document the deviation.

### F-B02B-07 — MEDIUM — `GET /repo/symbol?name=` missing
- **Spec ref:** §6.5
- **Evidence:** No symbol route (route grep); only line-substring search at challenges.py:146-172 against `app.challenge_file_lines`.
- **Impact:** Symbol lookup from the sealed index (part of the participant workspace UX for levels 3-4) unavailable.
- **Fix:** Add a symbol index (or extend `challenge_file_lines` with symbol rows) and the `/repo/symbol` endpoint.

### F-B02B-08 — MEDIUM — Upload lifecycle incomplete (API-10)
- **Spec ref:** §6.10 (patch B9)
- **Evidence:** backend/app/routers/levels.py:789-866 (POST /uploads returns 200, `{artifact_id, status:"staged"}` not 201 `{upload_id,"stored"}`); no POST `/uploads/{id}/validate`, no GET `/uploads/{id}`, no DELETE `/uploads/{id}` (route grep); submit path levels.py:972-1001 only requires artifact `status='staged'` — no `ok`/validation state; no `upload_validate` job (jobs handler registry).
- **Impact:** Spec's staged→validating→ok/failed pipeline (unpack limits, path rules, patch dry-run against the team's base snapshot, performed on the runner) does not exist; participants cannot check or delete staged uploads; "submit requires status=ok / deferred re-validation" unenforced.
- **Fix:** Add the validate/get/delete endpoints and an `upload_validate` job (initially in-process with the same zip inspection rules), extend artifact status machine to `staged|validating|ok|failed|bound`, gate submit on `ok` (or `deferred`).

### F-B02B-09 — MEDIUM — Receipts/disputes surface incomplete and disputes not idempotent (API-12)
- **Spec ref:** §6.12
- **Evidence:** No `GET /receipts/{id}` (receipts only inside submissions.py:341-419); `POST /submissions/{id}/dispute` (submissions.py:426-460) inserts a new `app.disputes` row on every call (no unique/dedupe key) — spec marks it "Idempotent"; no participant `GET /disputes`.
- **Impact:** Repeated dispute clicks create duplicate disputes and repeatedly flip the submission status; participants cannot list their own disputes.
- **Fix:** Add an idempotency key or `UNIQUE(submission_id)` constraint (one open dispute per submission), return the existing dispute on replay, and add `GET /disputes` + `GET /receipts/{id}`.

### F-B02B-10 — MEDIUM — Admin auth hardening from API-13 missing (CF Access, ADMIN_AUTH_MODE boot refusal)
- **Spec ref:** §6.13 (patch B10)
- **Evidence:** deps.py:141-162 (step-up is a re-entered password; comment documents CF Access as production path); config.py:15-58 (no `ADMIN_AUTH_MODE`, no `staging` environment value, no boot-time refusal); no `/admin/auth/logout`; step-up lives at `/auth/step-up` (auth.py:470-493).
- **Impact:** The spec's staging/prod boot guard against shared-secret admin auth cannot be violated only because no shared-secret mode exists; admin accounts are protected solely by app password + optional step-up; no MFA/CF assertion layer.
- **Fix:** Implement ADMIN_AUTH_MODE with the boot-refusal check for staging/prod + shared_secret, add `/admin/auth/step-up` and `/admin/auth/logout` (or amend spec to the password+step-up model).

### F-B02B-11 — MEDIUM — Event config edits do not require step-up
- **Spec ref:** §6.14 ("configuration edits require step-up")
- **Evidence:** backend/app/routers/admin.py:153-154 — `revise_config(... p: Principal = Depends(require_organizer))`; no `step_up_verified`. Contrast GT endpoints (admin.py:543, 568, 651, 749, 822, 855) which do use step-up.
- **Impact:** Any organizer session (no recent re-auth) can freeze/revise scoring weights and stage config — a sensitive action per spec.
- **Fix:** Add `step_up_verified` to the config revision endpoint (and to stage control, per §6.17 sensitivity).

### F-B02B-12 — MEDIUM — CSV participant import (dry run then commit) missing
- **Spec ref:** §6.15
- **Evidence:** admin.py:514-530 (list only) and 476-511 (single invite creation); no CSV import route.
- **Impact:** Bulk onboarding for 200+ participants must be scripted by hand; the dry-run validation step does not exist.
- **Fix:** Add `POST /admin/events/{id}/participants/import?dry_run=true|false` with row-level error reporting.

### F-B02B-13 — MEDIUM — Ground-truth read side missing; no audit-on-view
- **Spec ref:** §6.16
- **Evidence:** admin.py:748-851 — only write endpoints (`ground-truth/bugs`, `ground-truth/flags`, `ground-truth/test-results`); no GET ground truth, no generic PUT; every view audit requirement is moot (no views). Writes use gt_session + step-up ✓.
- **Impact:** Organizers cannot inspect ground truth through the API (must use psql), and the "every view writes an audit entry with the view's purpose" anti-casual-browsing control is absent.
- **Fix:** Add GET ground-truth (step-up + audit-with-purpose) and a generic PUT, or amend spec.

### F-B02B-14 — MEDIUM — Kill switches not togglable at runtime; force-open/close missing
- **Spec ref:** §6.17
- **Evidence:** admin.py:991-995 — `/admin/events/{id}/live` returns `kill_switches` read from process settings (`settings.runner_enabled` etc.); no `/admin/events/{id}/switches` mutation route; no `force-open|force-close` stage routes (admin.py:279-288 allows only legal transitions).
- **Impact:** During an incident the operations play (disable AI/runner/submissions without a restart) cannot be executed; stage emergencies need direct DB intervention.
- **Fix:** Persist switches in `app.events.config.features` and add the switches mutation endpoint; add force-open/close stage overrides with mandatory reason + audit.

### F-B02B-15 — MEDIUM — Answer packs, rescore, leaderboard admin, finalize checklist missing (API-19)
- **Spec ref:** §6.19
- **Evidence:** No routes for answer-packs/rescore/leaderboard-mode (route grep); admin.py:1261-1301 is a raw manual adjustment (admin-only, audit ✓) but no dry-run rescore; admin.py:96-103 allows `finalized → archived` and finalize has no server-side checklist re-verification (only the pre-live readiness gate at admin.py:117-126).
- **Impact:** The corrections/rescoring/finalization governance (two approvers, step-up, dry-run, irreversible finalization) — the platform's score-integrity backstop — is not implemented.
- **Fix:** Implement the four endpoints per spec, or explicitly rescope §6.19 to the manual-adjustment path with compensating audit controls.

### F-B02B-16 — MEDIUM — `/admin/integrity` missing; exports are inline CSV, not expiring links
- **Spec ref:** §6.20
- **Evidence:** No `/admin/integrity` route; admin.py:1078-1172 returns CSV content in the JSON body (also stored in `app.exports`) rather than server-generated expiring links.
- **Impact:** Integrity-signals surface absent; large exports flow through the API response body (memory/latency) with no link expiry/ownership model.
- **Fix:** Add the integrity endpoint and switch exports to stored artifacts with short-lived signed URLs.

### F-B02B-17 — MEDIUM — `/readyz` and `/metrics` missing; `/healthz` is `/health`
- **Spec ref:** §6.21 (patch B12)
- **Evidence:** main.py:112-118 (only `/health`, 200/503 on DB probe); no schema-head, clock-offset (<100 ms) or free-disk checks (db.py:97-112 probes DB only); no Prometheus `/metrics`.
- **Impact:** Compose/orchestration readiness and monitoring contracts from the spec unimplemented; clock-drift and disk pressure go undetected until failure.
- **Fix:** Add `/readyz` (DB reachable + migration head + clock offset + disk threshold) and `/metrics`; rename or alias `/health` → `/healthz`; keep both off the Tunnel route.

### F-B02B-18 — MEDIUM — Submission state machine has no append-only event log
- **Spec ref:** §7.1
- **Evidence:** No `app.submission_events` table (migrations/0001_init.sql, 0002, 0003); statuses are updated in place: evaluator.py:169-174, 183-208; review.py:226-230; submissions.py:449.
- **Impact:** The transition history required for dispute resolution and audit (who moved what, when, in which transaction) exists only partially via jobs/audit rows; status is not "the latest event".
- **Fix:** Add `app.submission_events (id, submission_id, from_status, to_status, actor, at)` with a trigger/transactional write and derive the displayed status from it.

### F-B02B-19 — MEDIUM — Node pointer lacks `version`, `adjusted_by`, `adjusted_reason`
- **Spec ref:** §7.4 (patch B11)
- **Evidence:** migrations/0003_four_level_flow.sql:43-50 (`participant_pointers` has only user/event/level/node/updated_at); flow.py:123-136 (advance updates level_no/node/updated_at); no organizer pointer-adjustment route or "Adjusted by organizer" display field.
- **Impact:** Organizer-driven forward adjustments and their transparency to participants are impossible; forward-only enforcement itself is correct and race-safe.
- **Fix:** Add the three columns, an admin adjustment endpoint (forward-only, reason required), and surface `adjusted_by/adjusted_reason` in `/progress` and `/team` payloads.

### F-B02B-20 — MEDIUM — Job queue: no dedupe_key, lease/heartbeat and backoff deviate
- **Spec ref:** §8.1
- **Evidence:** jobs.py:24-38 (`enqueue` has no dedupe key; app.jobs table migrations/0001:28-41 has no dedupe_key column); jobs.py:41-64 (lease 120 s default, no heartbeat); jobs.py:21 (`RETRY_BACKOFF_S = [10, 60, 300, 900]` vs spec 5s×2^n jitter capped 5 min); no SIGTERM handling (worker.py:29-52).
- **Impact:** Duplicate pending jobs are possible (retries of the enqueue path, e.g. resubmitted outbox or repeated admin trigger); handlers mostly self-deduplicate via unique constraints, but correctness is not queue-enforced; crashed workers hold leases up to 120 s.
- **Fix:** Add `dedupe_key` with a partial unique index on pending jobs; lease 60 s + 20 s heartbeat; spec backoff curve; SIGTERM handler that stops claiming and releases leases.

### F-B02B-21 — MEDIUM — Job catalog gaps and no advisory-lock scheduler
- **Spec ref:** §8.2, §8.3
- **Evidence:** Handler registry (evaluator.py:107-644, evaluator_level.py:97, auto_submit.py:296) covers evaluate/create_review_item/verify_flag/apply_review_outcome/apply_test_results/release_feedback/refresh_leaderboard/dispatch_outbox/auto_submit_levels. Missing: ai_assess, run_official, run_practice, upload_validate, stage_transition (level_schedules `fire_at`), rescore, send_email, integrity_analyze, retention_purge, idempotency_prune, chain_verify (scheduled — only manual endpoint admin.py:1043-1047), draft_compact, clock_check, seal_bundles/export. worker.py:29-52 — single loop, no advisory-lock election.
- **Impact:** 12+ specified maintenance jobs absent (retention/pruning cause unbounded growth of drafts/idempotency rows; clock check absent); running two workers would double-scan (auto-submit remains safe via pointer locks, but scheduling is not single-flight by design).
- **Fix:** Register the missing handlers on the existing queue, add level schedule rows + stage_transition job, and take a PostgreSQL advisory lock for scheduler leadership.

### F-B02B-22 — MEDIUM — Level-2 multi-location match rule deviates from spec
- **Spec ref:** §9.2 (rule 3)
- **Evidence:** backend/app/matching.py:202-270 (`decide_multi`) — a flag matches when the *mean of best per-location scores* ≥0.9 with category/alias gates; spec requires a match when at least `ceil(0.5 × locations)` of its locations match that unit's anchors.
- **Impact:** Deterministic but different accept/review boundary than specified: a 4-location L2 flag with 2 perfect anchors and 2 zero scores scores 0.5 → needs_review, where the spec would count 2/4 ≥ 0.5·4 → match. Scoring outcomes can diverge from the spec's intent.
- **Fix:** Rewrite `decide_multi` to count locations whose best anchor score meets the tolerance rule and gate on `count ≥ ceil(0.5 × len(locations))`, or amend the spec to the mean-score definition (tests exist for the current behavior).

### F-B02B-23 — MEDIUM — AI assessment (§9.4) entirely missing
- **Spec ref:** §9.4
- **Evidence:** No provider adapter/assess code anywhere in backend/app; config.py:52 `ai_assessment_enabled: bool = False`; no ai_assess job (see F-B02B-21).
- **Impact:** The whole AI component (input assembly, strict JSON contract, `ai_points = ai_cap × Σ`, injection containment via platform-computed points, reproducibility stores, κ ≥ 0.6 calibration gate) is unimplemented. Currently harmless because the flag is off and the `ai_assessment` component never enters the ledger.
- **Fix:** Either implement §9.4 behind the kill switch or amend the spec to mark AI assessment as post-v1; keep the flag default-off invariant tested.

### F-B02B-24 — MEDIUM — Rate limits: in-memory only, several rows missing, values deviate
- **Spec ref:** §11 (patch B7)
- **Evidence:** deps.py:30-39 (single-process `_bucket` defaultdict); auth.py:57-58 (login: 20/min per IP vs spec 120/min; 10/min per email vs 5/min sliding with 60 s failure-delay after 5 failures/10 min — failure counting not implemented); no rate limit on `/auth/refresh`, `GET /state` (state.py:45), `PUT /drafts` (levels.py:423, submissions.py:487), gate checks (levels.py:241), admin mutations, public reads; uploads 20/min vs 6 (levels.py:796); level submit 10/min vs 6 (levels.py:881); v1 submit 30/min (submissions.py:101); search 30/min vs 20 (challenges.py:152); repo file reads 120/min ✓ (levels.py:751, challenges.py:112); no Argon2 semaphore (security.py:27 used directly in handlers).
- **Impact:** Spec §11's protection profile is not met: multi-worker deployments multiply the in-memory limits; CPU can be saturated by concurrent Argon2 hashing during login bursts; draft PUT and state polling are unprotected. Correctness-critical caps (submission caps/cooldown/idempotency) are DB-backed ✓, so scoring integrity is unaffected.
- **Fix:** Move limiter state to Redis/Postgres or accept documented per-worker limits; add the missing route limits; implement failure-count-based login delay; gate password hashing behind a vCPU-sized semaphore.

### F-B02B-25 — MEDIUM — Password reset token written to process log/stdout
- **Spec ref:** §6.1 API-01 (reset request); §13 hygiene
- **Evidence:** auth.py:519-521 — `print(f"[dev-mail] password reset token for {email}: {raw}")` with comment that v1 has no email provider; invite tokens are likewise returned to the organizer console (admin.py:511).
- **Impact:** Anyone with log access (ops staff, log aggregation) can reset any participant's password; in production this is a credential-disclosure channel. Documented as v1 behavior in DEPLOYMENT_RUNBOOK, but the print is unconditional (not gated on environment).
- **Fix:** Gate dev-mail on `settings.environment == "development"`, store the token only in a dedicated outbox table surfaced through the organizer UI (as done for invites), and never log raw tokens.

### F-B02B-26 — MEDIUM — HSTS missing; cookie `__Secure-` prefix and staging `Secure` flag gap
- **Spec ref:** §13
- **Evidence:** main.py:64-92 (middleware sets nosniff/Referrer-Policy/Cache-Control; no Strict-Transport-Security); auth.py:29-46 (`secure=settings.environment == "production"`; name `bhctf_refresh` without `__Secure-` prefix; config.py:20 has only development|production, no staging).
- **Impact:** TLS-deployment hardening from the spec is incomplete; in a staging-like deployment without the exact string "production", the refresh cookie would be sent over plain HTTP.
- **Fix:** Add HSTS when served over TLS; rename cookie to `__Secure-bhctf_refresh`; set `secure=True` unless explicitly in local development.

### F-B02B-27 — MEDIUM — No graceful shutdown drain / lease release
- **Spec ref:** §13
- **Evidence:** main.py:38-42 (lifespan only logs "shutdown complete"); worker.py:29-52 (no SIGTERM/SIGINT handling; in-flight handler + claimed lease simply die and rely on lease expiry).
- **Impact:** Deploys/restarts drop in-flight requests and jobs mid-lease; leases linger up to 120 s before requeue; the spec's 30 s drain + lease release is absent.
- **Fix:** Install SIGTERM handlers: stop accepting connections, drain ≤30 s, mark running jobs back to queued (or extend lease), then exit.

### F-B02B-28 — LOW — Auth path/shape naming deviations (API-01)
- **Spec ref:** §6.1
- **Evidence:** auth.py:49-51 (`LoginIn.email` vs spec `{identifier, password}`); auth.py:500 (`/auth/password/reset-request` vs `/auth/reset/request`); auth.py:531 (`/auth/password/reset` vs `/auth/reset/confirm`); activate replay returns NOT_FOUND (auth.py:408-411) instead of an idempotent original result.
- **Impact:** API-client/generated-schema drift vs the spec; harmless functionally.
- **Fix:** Align paths/field names with the spec or regenerate the spec from the OpenAPI schema as the source of truth.

### F-B02B-29 — LOW — Public event shape/cache deviations (API-03)
- **Spec ref:** §6.3
- **Evidence:** public.py:13-45 (`/public/event` vs `/event/public`; returns slug/status/duration/max_* /format instead of `{name, starts_at, ends_at, tz, brief, rules_summary, maintenance}`); main.py:90-91 (`Cache-Control: public, max-age=10` vs spec 30 s).
- **Impact:** Cosmetic/contract drift only; no data leak (public subset only).
- **Fix:** Align response shape and cache TTL, or update the spec.

### F-B02B-30 — LOW — Draft contract deviations (API-08)
- **Spec ref:** §6.8
- **Evidence:** errors.py:31 (`DRAFT_VERSION_CONFLICT` → 412, spec says 409); levels.py:451, 510-520 and submissions.py:510-520 return `{version}` without `server_saved_at`; optimistic concurrency via `body.version` instead of `If-Match`; no per-file `base_hash`.
- **Impact:** Behavior equivalent (stale write rejected, versioned), but clients written to the spec will mis-map status codes/fields.
- **Fix:** Align status code and response fields; optionally accept `If-Match` as an alias for the version.

### F-B02B-31 — LOW — Level submit response shape deviations (API-09)
- **Spec ref:** §6.9
- **Evidence:** levels.py:1088-1095 returns `{submission_id, receipt_code, received_at, status, replay, level_no}` vs spec `202 {receipt_id, accepted_at, status}`; request uses `artifact_id`/`compute_diff` instead of `{kind:"upload", upload_id}` (levels.py:177-181).
- **Impact:** Contract drift; functionality (idempotency, receipt, 202) present.
- **Fix:** Rename fields to match spec or regenerate spec from OpenAPI.

### F-B02B-32 — LOW — Reviewer decision "reason required" not enforced
- **Spec ref:** §6.18 (`decide` — reason required)
- **Evidence:** review.py:170-178 (`DecisionIn.notes: str | None` optional); stage control reason minimum 10 chars also unenforced (admin.py:294-297, only non-empty).
- **Impact:** Weaker audit narrative for decisions/ops actions than the spec demands.
- **Fix:** Make `notes`/reason required with min length 10.

### F-B02B-33 — LOW — Testing layers gaps vs §12
- **Spec ref:** §12
- **Evidence:** Present: unit (test_matching, test_scoring), integration flow tests incl. idempotency (test_idempotency.py:26 — 5 sequential replays, not 20 parallel), concurrency (test_flow_repo_lock.py:60 concurrent locks), security (test_authorization, test_gt_isolation, upload fuzzing test_flow_uploads), auto-submit races, load script scripts/load_test.py. Missing: Schemathesis/OpenAPI contract tests, fault-injection suite, determinism (3× official run — N/A), mutation testing, migration pg_dump-diff test, `pytest -m boundaries` marker (pytest.ini has no markers).
- **Impact:** Coverage of error envelope and crash-recovery paths below the spec's bar.
- **Fix:** Add schemathesis + fault-injection suites, the 20-way parallel idempotency test, a migration round-trip diff test, and the boundaries marker.

### F-B02B-34 — LOW — `GET /team/repo-lock` absent as standalone endpoint
- **Spec ref:** §6.6
- **Evidence:** Route grep — only POST /team/repo-lock (levels.py:467); current choice is embedded in GET /team (levels.py:586-615) and GET /levels/{n}/content (levels.py:294).
- **Impact:** Functionally covered; clients polling just the lock state fetch the whole team payload.
- **Fix:** Add the thin GET endpoint returning `{option, locked_at, locked_by}` or null.

### F-B02B-35 — LOW — Match decisions do not persist `matcher_version`/`rule_set_hash`
- **Spec ref:** §9.2 (rule 6)
- **Evidence:** evaluator.py:155-168 — features recorded only inside the ledger `note` string; `rule_set_hash` is computed per stage (admin.py:244-245) but not stored on the decision/result row; no matcher version constant.
- **Impact:** "The same inputs must give the same result" is testable in code, but result reproducibility/audit (which rule version produced this score) is not persisted.
- **Fix:** Store matcher_version + rule_set_hash (+ full feature JSON) on a decision row (see also F-B02B-18).

### F-B02B-36 — LOW — Ledger origin constraint (`CHECK num_nonnulls=1`) and origin typing missing
- **Spec ref:** §9.5
- **Evidence:** migrations/0001_init.sql:488-512 — columns are `submission_id`, `award_unit_id`, `actor_id` (no `origin_type`, no `gt_award_unit_id`/`ap_entry_id`/`manual_decision_id`, no `CHECK (num_nonnulls(...) = 1)`); append-only trigger ✓ (migrations/0002:13-16); reversals ✓ (`reverses_entry_id`).
- **Impact:** The structural guarantee that every entry has exactly one origin is not DB-enforced (manual adjustments use `actor_id`, awards use `award_unit_id`, test results use `submission_id`); team-level claim uniqueness exists (award_claims UNIQUE(stage,team,unit), scoring.py:83-101) but the spec's per-participant claim key is per-team in practice (D-02 team dedupe).
- **Fix:** Add `origin_type` + the three origin columns with the num_nonnulls CHECK, or amend spec to the implemented origin model.

### F-B02B-37 — LOW — CORS credentials allowed on all routes
- **Spec ref:** §13
- **Evidence:** main.py:55-62 — `allow_credentials=True` globally; spec restricts credentials to `/auth/refresh`.
- **Impact:** Low risk: the only credential cookie is Path-scoped to `/v1/auth/refresh`, so cross-origin credentialed reads of other routes are not possible with this cookie.
- **Fix:** Narrow `allow_credentials` per-route (custom middleware) for spec fidelity.

### F-B02B-38 — LOW — `/announcements` pagination and `/team/score` shape deviations
- **Spec ref:** §6.4
- **Evidence:** announcements.py:15-27 (`limit` capped at 100, no cursor/since token); levels.py:618-657 (`/team/score` returns per-level components + `released_total`, no `{score, version, last_updated}`).
- **Impact:** Contract drift; no correctness issue.
- **Fix:** Add a cursor (e.g., `before_id`) and the version/last_updated fields (the version data exists via leaderboard snapshots).

### F-B02B-39 — LOW — §6.20/§6.21/§7.2 path naming deviations
- **Spec ref:** §6.18, §6.20, §6.21
- **Evidence:** review endpoints under `/review/...` instead of `/admin/review/...` (review.py:28, 103, 178); `/admin/system/health` vs `/admin/health` (admin.py:1304); `/health` vs `/healthz` (main.py:112); `/admin/teams/{id}/repo-lock` vs `/admin/events/{id}/teams/{tid}/lock-repo` (admin_levels.py:39); `/results/{stage_id}` vs `/results` (leaderboard.py:65).
- **Impact:** Pure naming drift; behavior present.
- **Fix:** Align paths with the spec or regenerate the spec from the implemented OpenAPI.

## Notable EXTRA behavior (not requested by spec, flagged for completeness)
- `POST /auth/register` (admin-only account creation, auth.py:202-247) and `POST /admin/jobs/auto-submit` (admin_levels.py:231-245), `GET /config` (state.py:97-139), `/admin/events/{id}/levels/bootstrap` (admin_levels.py:248-289), `GET /admin/events/{id}/progress` (admin_levels.py:187-228) — all properly guarded and audited; no security concern found.
- Legacy v1 surface (`POST /submissions` bug_report/ctf_flag, `/assignments`, `/challenges/{id}/files/content`) coexists with the four-level surface; both enforce ownership and stage rules.

## Summary counts
- **Requirement rows:** 104 — DONE 21, DEVIATION 16, PARTIAL 30, MISSING 37.
- **Findings:** 39 — CRITICAL 0, HIGH 2 (F-B02B-01, F-B02B-02), MEDIUM 25 (F-B02B-03 … F-B02B-27), LOW 12 (F-B02B-28 … F-B02B-39). See `spec02b.jsonl` for the authoritative per-finding records.

---

### 4.5 03 Sections & Components Specification, sections 0-3 - global, public site, authentication (`spec03a`)

# Audit Report — Spec 03, Sections 0–3 (Conventions, Global, Public site, Authentication)

- **Agent:** spec03a (Task ID 3-e)
- **Baseline document:** /home/z/my-project/upload/03-specification.md ("Specification of Sections and Components")
- **Sections covered:** §0 Conventions; §1 Global specification (1.1–1.7); §2 Public site (PUB-01…PUB-05); §3 Authentication (ATH-01…ATH-06). Frontend and backend both audited.
- **Repo / HEAD:** /home/z/my-project/bug-hunt-hackathon @ `f1412b7eec6c92c4c168fd2b8a58182b34480387` (2026-11-26)
- **Method:** read-only inspection; every status below verified against actual code (file:line), not file names.

## Status legend
DONE / PARTIAL / MISSING / DEVIATION. Section 3 of this repo is a documented v1 scope reduction (docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md); several deviations are acknowledged in code comments — noted, but still reported.

## Per-section status table

| Spec ref | Requirement (short) | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| §0 Roles incl. `integrity_officer` | DEVIATION | backend/app/models_app.py:65 | integrity_officer folded into reviewer "for v1" → F-S03A-01 |
| §0 UUIDv7 for all entities | DONE | backend/app/db.py:81-88; auth.py:140,412 | used on every insert path |
| §0 Time: RFC 3339 UTC API; UI event tz + abbreviation | PARTIAL | backend/app/routers/state.py:21-25; frontend/src/lib/format.ts:3-49 | API ✓; UI hard-codes IST, ignores event timezone → F-S03A-23 |
| §0 API base `/v1`; admin API separate host+audience | PARTIAL | backend/app/main.py:97-110; backend/app/security.py:81 | `/v1` ✓; same host/app for admin, JWT audience only → F-S03A-24 |
| §0 Error envelope `{error:{code,message,request_id,details}}` | DONE | backend/app/errors.py:16-80; main.py:64-92 | X-Request-Id header too |
| §0 Bearer auth except refresh (cookie) | DONE | backend/app/deps.py:55-57; auth.py:29-46; frontend/src/lib/api.ts:116-121 | HttpOnly, path-scoped cookie |
| §0 Idempotency-Key required on POST /submissions | DONE | backend/app/routers/submissions.py:96-130 | Header(min_length=8); client api.ts:121 |
| §0 Validation client + server | DONE | frontend/src/pages/participant/Workspace.tsx:345-372; submissions.py (server-side) | server authoritative (422 details mapped back) |
| §0 Slugs only for events/challenges in URLs | DEVIATION | backend/app/routers/challenges.py:109,146 | challenge URLs use UUIDs → F-S03A-22 |
| 1.1 View landing/rules/status public | DONE | frontend/src/App.tsx:23-30; backend/app/routers/public.py:13-70 | |
| 1.1 Activate account / log in (public) | DEVIATION | backend/app/routers/auth.py:54-192 | CRITICAL first-sign-in password claim → F-S03A-03 |
| 1.1 Participate in assigned rounds (participant) | DONE | backend/app/routers/levels.py:199-880 (gates); frontend/src/pages/participant/Workspace.tsx | |
| 1.1 Practice environment (4 roles) | MISSING | no /practice route or flag anywhere (grep: only docs mentions) | F-S03A-10 |
| 1.1 View own submissions and results (participant) | DONE | frontend/src/pages/participant/Submissions.tsx, SubmissionDetail.tsx, Results.tsx; App.tsx:43-45 | |
| 1.1 Review queue (reviewer/organizer/admin) | DONE | backend/app/routers/review.py:29,66,104,179 (require_staff); frontend/src/pages/review/Queue.tsx | |
| 1.1 Create/edit events, rounds, challenges (organizer+admin) | DONE | backend/app/routers/admin.py:49,107,154,242,543 (require_organizer) | |
| 1.1 Edit ground truth with step-up | DONE | backend/app/routers/admin.py:749,822,855,568 (step_up_verified) | |
| 1.1 Live operations (pause, extend, broadcast) | DONE | backend/app/routers/admin.py:292 (control_stage), :891 (announcements) | |
| 1.1 Rescoring, finalization (organizer+admin) | PARTIAL | backend/app/routers/admin.py:398 (release_results, organizer ✓); admin.py:1262 (manual_adjustment admin-only) | F-S03A-27 |
| 1.1 User and role management (admin only) | DEVIATION | backend/app/routers/auth.py:203 (register, admin ✓); admin.py:470-473,477-511 + auth.py:414-424 (invite path unvalidated) | F-S03A-02 |
| 1.1 Integrity console (integrity_officer) | MISSING | models_app.py:65; no integrity routes | F-S03A-01 |
| 1.1 Audit log read (organizer+admin+IO) | PARTIAL | backend/app/routers/admin.py:1051 (require_organizer) | IO role absent |
| 1.1 System health (organizer+admin) | DONE | backend/app/routers/admin.py:1305; main.py:112-118 | |
| 1.2 Theme dark default + light, selectable, persisted, system-pref | MISSING | frontend/src/styles/app.css:10-12 (color-scheme: dark only); tokens.css:3-27 single palette; no data-theme/matchMedia (grep) | F-S03A-11 |
| 1.2 Self-hosted fonts; code font 12–20px default 14 | DONE | frontend/src/main.tsx:7-15; Workspace.tsx:83,565-571 | static weights, not variable font (LOW, F-S03A-25) |
| 1.2 Color token set + WCAG 2.2 AA | DEVIATION | frontend/src/styles/tokens.css:3-27 | different token names; contrast not machine-checked here |
| 1.2 Resizable multi-pane workspace; min 1280×720; <1024 notice; responsive to 360 | PARTIAL | frontend/src/pages/participant/Workspace.tsx (fixed 3-pane, CSS grid); no viewport checks (grep innerWidth/matchMedia: none) | F-S03A-12 |
| 1.2 Motion minimal; prefers-reduced-motion; <150 ms | DONE | frontend/src/styles/app.css:41-50; tokens.css:24 (--speed: 120ms) | |
| 1.2 Unsupported-browser blocking notice | MISSING | no UA/browser checks anywhere in frontend/src | part of F-S03A-12 |
| 1.3 Shared components (16 named) | PARTIAL | frontend/src/ui/components.tsx (Button, Field, Chip, StatusChip, ConfirmButton, Countdown, Panel, EmptyState, LoadingShell, ErrorBanner, CheckRow); MISSING: Toast, Dialog, ConfirmDialog (typed phrase), Select/Combobox, DataTable, Tabs/Tree/SplitPane, CodeView (Monaco), Skeleton, ConnectionIndicator | F-S03A-13, F-S03A-26 |
| 1.4 Keyboard shortcuts (palette, quick-open, search, panels, Alt+N, Ctrl+Enter, Alt+1-9, F8, `?`) | MISSING | frontend/src/pages/participant/Workspace.tsx:286-311 (only arrows/Home/End/Enter); grep ctrlKey/metaKey/altKey: no shortcuts | F-S03A-14 |
| 1.5 WCAG 2.2 AA; focus ≥2px 3:1 | PARTIAL | app.css:30-34 (2px focus outline ✓); no skip link; no a11y CI | F-S03A-15 |
| 1.5 Full keyboard operation incl. editor controls | PARTIAL | Workspace.tsx:286-311,586-589 (viewer + find keyboard) | shortcuts missing (1.4) |
| 1.5 SR labels for landmarks/controls; timers at thresholds only | PARTIAL/DONE | chrome.tsx:31,110 (nav aria-label), main.tsx id="main"; components.tsx:332-343 (threshold-only announcements ✓) | |
| 1.5 Font adjust (code+UI), high-contrast theme, reduced motion | PARTIAL | Workspace.tsx:565-571 (code only); app.css:41-50 (reduced motion ✓); no UI-font control, no high-contrast | |
| 1.5 Accommodation field in profile; ACCOMMODATION reason code | PARTIAL | models_app.py:73 (column); admin.py:923-924 (reason code ✓); no API/UI to submit note | F-S03A-28 |
| 1.5 Automated axe checks in CI + manual SR pass | MISSING | .github/workflows/ci.yml:16-257 (no axe/a11y job) | F-S03A-15 |
| 1.6 Message catalogs; no concatenated sentences | MISSING | strings inline across frontend/src/pages/*, ui/components.tsx; no i18n layer | F-S03A-16 |
| 1.6 Single tz formatter from event timezone | PARTIAL | frontend/src/lib/format.ts:3,5-28 (hard-coded Asia/Kolkata) | F-S03A-23 |
| 1.6 Plain digits for numbers/points | DONE | frontend/src/lib/format.ts:65-69 | |
| 1.7 Loading skeleton >200 ms, no hiding spinners | PARTIAL | ui/components.tsx:251-265 (LoadingShell/LoadingLine placeholders, no skeleton, no timing logic) | LOW |
| 1.7 Empty state explains why + next action | DONE | ui/components.tsx:240-249; Lobby.tsx:208-212 | |
| 1.7 Error: human message + request_id + retry | DONE | ui/components.tsx:267-301 (ErrorBanner shows code + request id + Retry) | |
| 1.7 Degraded banner on polling fallback / kill switch | MISSING | no SSE anywhere; polling only (Lobby.tsx:36, Workspace.tsx:117); no kill-switch banner | F-S03A-17 |
| PUB-01 Landing content + countdown; only cached GET /v1/public/event | DONE | frontend/src/pages/Landing.tsx:303-421 (FAQ inline), :21-91 (countdown w/ server offset); public.py:13-45; main.py:90-91 (Cache-Control) | extra /v1/time call (LOW, F-S03A-29) |
| PUB-02 Versioned rules; version + last-modified shown; PDF at publish | PARTIAL | frontend/src/pages/Rules.tsx:20-25 (version + frozen date ✓); public.py:48-70 (markdown only, no PDF); seed.py:431-473 (no time/grace section) | F-S03A-18 |
| PUB-03 Terms/privacy/consent; DPDP Act 2023; consent {version,accepted_at,ip} | PARTIAL | frontend/src/pages/Privacy.tsx, Terms.tsx; auth.py:659-692 + migrations/0001_init.sql:99-108 (record ✓) | F-S03A-19 |
| PUB-04 FAQ page (scoring, workspace, browsers, connection drop, contact) | MISSING | no /faq route (App.tsx:23-32); inline FAQ on Landing.tsx:303-344 lacks browser/connection/workspace topics | F-S03A-20 |
| PUB-05 Status page hosted outside provider | MISSING | no status page/host; only /health JSON (main.py:112-118) | F-S03A-21 |
| ATH-01 Login fields/behavior/edge cases | PARTIAL | backend auth.py:54-192; frontend Login.tsx:7-95; api.ts:44-48 (token in memory); Login.tsx:19-22 (redirect to last route ✓); errors.py:17 (generic message ✓) | F-S03A-03, F-S03A-06 |
| ATH-02 Activation via emailed single-use invite | PARTIAL/DEVIATION | backend auth.py:390-463 (single-use ✓), admin.py:498 (48 h ✓); NO frontend page (App.tsx); token in query param (admin.py:511); no strength meter/breached-list (backend/app/security.py); no re-request path | F-S03A-03, F-S03A-04 |
| ATH-03 Password reset request/link/set; revoke + token_version++ | PARTIAL | backend auth.py:500-523 (generic response ✓, 30 min ✓), :531-572 (revokes all + bumps ✓); token printed to logs (auth.py:519-521); no frontend pages | F-S03A-07 |
| ATH-04 Blocking consent screen; records {version,accepted_at,ip}; gate | PARTIAL | backend deps.py:121-138 + submissions.py:100, levels.py:199 (gate ✓); auth.py:659-692 (record ✓); frontend only a checklist button Lobby.tsx:134-145 | F-S03A-08 |
| ATH-05 Sessions list (device, location, last seen); sign out others; silent refresh; revoked notice | PARTIAL | backend auth.py:614-652 (device+times, NO location); frontend Account.tsx:68-124 (per-row revoke, no sign-out-others); api.ts:62-89 (silent refresh ✓); no revoked notice (api.ts:141-147) | F-S03A-09 |
| ATH-06 Admin sign-in behind Access + MFA; 60-min sessions; MFA step-up ≤5 min | DEVIATION | same login for all roles (auth.py:54); no MFA anywhere; step-up = password, 5 min window (auth.py:470-493; deps.py:141-162, documented); no 60-min admin inactivity TTL (config.py:34-35: 600 s access / 3-day refresh for all) | F-S03A-05 |

## Findings

---

### F-S03A-01 — HIGH — `integrity_officer` role and integrity console absent; audit-log access row cannot be satisfied
- **Evidence:** backend/app/models_app.py:65 (`integrity_officer folded into reviewer for v1, documented`); no integrity routes in backend/app/routers/ (git ls-files); permission-matrix row "Integrity console" and the integrity_officer column of "Audit log (read)" have no implementation.
- **Impact:** Major permission-matrix violation (§0, §1.1). Integrity workflows (dispute/integrity review) must be performed under the reviewer role, losing the separation of duties the spec mandates; integrity officers gain reviewer powers they should not have.
- **Fix:** Either implement the role + console (routers, role checks, UI section) or renegotiate the spec. At minimum, gate the review console so integrity work is attributable, and record the scope cut in the spec/requirements reconciliation as an approved deviation.

### F-S03A-02 — HIGH — Organizer can mint admin accounts via unvalidated invite role (privilege escalation)
- **Evidence:** backend/app/routers/admin.py:470-473 (`InviteIn.role: str = "participant"`, no pattern/whitelist); admin.py:477-511 (`create_invite` is `require_organizer` and stores `body.role` verbatim, returns the raw invite token); backend/app/routers/auth.py:414-424 (`activate` inserts a user with `role=inv["role"]` unvalidated). Contrast: `/auth/register` explicitly blocks non-admin creating admin/organizer (auth.py:207-211).
- **Impact:** An organizer (who per the matrix may NOT manage users/roles) can create an invite with `role: "admin"`, receive the activation token in the console response, activate it, and obtain a full admin account. Breaks the "User and role management = admin only" row and the invite trust model.
- **Fix:** Whitelist `InviteIn.role` to `participant` (maybe `reviewer`) with a pydantic pattern; reject admin/organizer roles unless the caller is admin; mirror the register() check inside `create_invite`/`activate`; add a test.

### F-S03A-03 — CRITICAL — First-sign-in password claim: account takeover of any pre-activated account; reactivates disqualified/pending accounts
- **Evidence:** backend/app/routers/auth.py:76-86 — on `POST /v1/auth/login`, if the email exists and `password_hash` is NULL, the submitted password is hashed and stored and `status` is set to `'active'`, with no invite token, no proof of identity. The disqualified check runs only afterwards (auth.py:90-91), so a disqualified/pending user without a password is silently un-disqualified. Frontend advertises this flow (Login.tsx:46-51, 88-91).
- **Impact:** Anyone who knows a registered-but-not-yet-activated email (the normal state after organizer invite creation; emails are guessable campus addresses) can claim the account by simply signing in first. This is a direct account-takeover vector and destroys the ATH-02 activation security model (single-use emailed invite token). It also flips account status, bypassing disqualification. The code comment acknowledges "this is a risk we are willing to take" (auth.py:75), but the spec is unambiguous.
- **Fix:** Remove the password-claim branch from login: reject `AUTH_NOT_ACTIVATED` when `password_hash IS NULL` and direct the user to activation. If the no-invite onboarding is a hard requirement, gate first-password set behind an emailed single-use token (same as ATH-02) and never modify `status` outside the activation/decision paths.

### F-S03A-04 — HIGH — ATH-02 activation flow incomplete: no frontend page, query-string token, no strength meter, no breached-password check, no re-request path
- **Evidence:** Frontend has no `/activate` route (frontend/src/App.tsx:23-84; grep "activate" in frontend/src: none). Backend builds `activation_url = "/activate?invite={raw}"` (admin.py:511) — query param, not a URL fragment removed after read (spec ATH-02). `security.py` has no breached-password list check and no strength meter exists anywhere (grep). No "request new invite" endpoint rate-limited 1/10 min for expired links (no such route in auth.py). Single-use + 48 h expiry are correct (auth.py:408-411, admin.py:498).
- **Impact:** The activation journey is unusable by participants (no UI), the token leaks into server/proxy logs and browser history via the query string, and weak/breached passwords are accepted. Expired-invite users have no self-service recovery.
- **Fix:** Add the activation page (read token from `location.hash`, strip after read, strength meter, breached-password list, ATH-04 consent checkboxes); return the token in the URL fragment; add `POST /auth/invites/re-request` rate-limited 1 per 10 min.

### F-S03A-05 — HIGH — ATH-06 admin sign-in: no MFA, no Cloudflare Access, no 60-minute admin inactivity, step-up is password-only
- **Evidence:** Admins authenticate through the same `POST /v1/auth/login` as participants (auth.py:54-192; no role-specific path). No TOTP/WebAuthn implementation anywhere (grep totp/webauthn/mfa: none). Step-up = re-entered password with 5-minute server-side validity (auth.py:470-493; deps.py:141-162 — comment: "In v1 without MFA infrastructure, step-up is implemented as a re-entered password"). Admin token TTLs are identical to participants: 600 s access, 3-day refresh (config.py:34-38); no 60-minute inactivity rule. Admin API served from the same app/host under `/v1/admin` (main.py:97-110).
- **Impact:** Full platform control (ground truth, scoring, users) is protected by a single password factor, contradicting ATH-06 and the §0 "admin API under a separate host and audience" convention. A phished/reused admin password yields total compromise, including step-up (same password).
- **Fix:** Add TOTP or WebAuthn for organizer/admin roles at login and for step-up; enforce a 60-minute admin session inactivity bound (refresh-token TTL cap for staff roles); document/host the admin console behind an access proxy before go-live.

### F-S03A-06 — MEDIUM — ATH-01 login gaps: no show/hide password toggle, no Turnstile after 3 failures, no Retry-After on lockout, auto-eviction instead of consent, no "not activated" handling
- **Evidence:** Login.tsx:70-81 (plain `type="password"`, no toggle); no captcha/Turnstile anywhere (grep: none); rate limiter raises `AUTH_RATE_LIMITED` (deps.py:33-39) rendered by errors.py:20 as a message with `n = window_s` (the full window, not remaining time) and no `Retry-After` response header (errors.py:67-73); limiter is in-process per worker (deps.py:30). Concurrent-session cap (2) silently evicts the oldest live session (auth.py:93-138) instead of offering "end the oldest session after password re-entry"; there is no "account not activated → direct to activation" path in login (moot only because of F-S03A-03).
- **Impact:** Weaker brute-force protection than specified (per-process counter + no captcha), poor lockout UX (clients cannot honor Retry-After), and spec'd user consent for evicting an existing session is bypassed.
- **Fix:** Add password visibility toggle; add Turnstile (or equivalent) after 3 failures keyed on account+IP; emit `Retry-After` and the true remaining seconds (move the limiter to Redis/DB or accept and document single-worker); offer oldest-session termination with password re-entry instead of silent eviction.

### F-S03A-07 — MEDIUM — ATH-03 password reset: no email delivery (token printed to logs/organizer console); no frontend reset pages
- **Evidence:** backend/app/routers/auth.py:519-521 — reset token `print(...)` to stdout, comment "v1: no email provider configured... surfaced through the organizer console and dev logs". No reset-request/reset UI (App.tsx has no route; Login.tsx has no "forgot password" link). Backend mechanics are correct: rate-limited 3/600 s, generic response (auth.py:500-523), 30-minute single-use token, revokes all sessions and increments `token_version` (auth.py:531-572).
- **Impact:** Participants cannot self-recover; anyone with log/console access can reset any account's password and take it over (the token is printed in plaintext). Generic-response protection is undermined when the token is displayed to staff.
- **Fix:** Integrate an email provider before the event (or hand tokens over only via an audited, step-up-gated console screen, never logs); add the request/reset frontend pages; stop printing raw tokens.

### F-S03A-08 — MEDIUM — ATH-04 consent is a single lobby button, not a blocking screen with rules summary, separate checkboxes and telemetry/proctoring notice
- **Evidence:** frontend/src/pages/participant/Lobby.tsx:134-145 — one "Accept rules" `Button` inside a readiness checklist; no blocking screen on first login, no scrollable summary, no separate checkboxes for rules vs privacy/consent, no telemetry/proctoring notice. Backend record is correct `{rules_version, accepted_at, ip_hash}` (auth.py:659-692; migrations/0001_init.sql:99-108) and the gate is enforced server-side (deps.py:121-138; submissions.py:100; levels.py:199,243,259,322,402,425,474,665,721,750,795,880). `/me/acceptances` accepts a client-supplied `version` (auth.py:655-669) — the gate checks the current version so old accepts don't satisfy it, but a user can pre-accept a not-yet-published version without ever seeing its text.
- **Impact:** Consent evidence quality is weaker than the legal-facing spec (no acknowledgment surface for privacy/telemetry, no per-document opt-in, acceptance possible before text is published).
- **Fix:** Build the blocking consent screen (rules summary + privacy + optional telemetry checkbox, shown whenever `rules_version` changes); have the server derive the version (ignore/validate client-supplied values against the published set).

### F-S03A-09 — MEDIUM — ATH-05 session management: no approximate location, no "sign out other sessions", no session-revoked notice/state clear
- **Evidence:** backend auth.py:614-636 returns `device` (user-agent), `created_at`, `last_seen_at` — no location (only a hashed IP is stored, sessions table has `ip_hash` models_app.py:85 but it is not rendered). frontend/src/pages/participant/Account.tsx:68-124 — per-row "Revoke" only; the page text itself states "there is no single global sign-out button". Silent refresh exists (api.ts:62-89, single-flight). Mid-session revocation is not handled: only `AUTH_TOKEN_EXPIRED` triggers refresh (api.ts:141-147); on `AUTH_SESSION_REVOKED` the stale user state stays and errors render per-query.
- **Impact:** Spec'd self-service session hygiene is incomplete; a revoked user sees a broken console instead of a clear "signed out elsewhere" notice.
- **Fix:** Show approximate location (e.g., from stored IP at login, coarse), add "sign out other sessions", and handle 401 `AUTH_SESSION_REVOKED` globally (clear token + user state, show notice, redirect to /login preserving drafts).

### F-S03A-10 — MEDIUM — Practice environment capability missing for all four roles (1.1 matrix row)
- **Evidence:** No practice endpoint/route/flag anywhere: grep "practice" in backend/app and frontend/src yields no implementation (only docs prose). Permission-matrix row "Practice environment (participant, reviewer, organizer, admin)" has no backing feature.
- **Impact:** Matrix violation; reviewers/organizers cannot rehearse, participants cannot practice.
- **Fix:** Ship a small practice challenge + staff-accessible practice mode, or formally descope in the requirements reconciliation doc.

### F-S03A-11 — MEDIUM — No light theme, no theme selector, no persistence, no system-preference detection (1.2)
- **Evidence:** frontend/src/styles/app.css:10-12 (`html { color-scheme: dark }`); tokens.css:3-27 defines a single dark palette; grep for `data-theme|prefers-color-scheme|matchMedia` in frontend: no theme logic; no toggle in any header (chrome.tsx:24-135).
- **Impact:** Spec 1.2 violation; users with light-preference/accessibility needs cannot switch; "high-contrast theme" (1.5) equally absent.
- **Fix:** Define a light token set, add `[data-theme]` override, persist choice in localStorage, default from `prefers-color-scheme`, add a header toggle (also satisfies 1.5 high-contrast direction).

### F-S03A-12 — MEDIUM — Workspace layout: not resizable multi-pane, no min-viewport/1280×720 guidance, no <1024 "use a larger screen" notice, no unsupported-browser blocking notice (1.2)
- **Evidence:** frontend/src/pages/participant/Workspace.tsx (static 3-pane grid, no drag handles; grep `resize` in app.css: only `textarea resize: vertical` line 389); no `innerWidth`/`matchMedia`/`1024` checks in frontend/src (grep: none); no browser-support detection or blocking notice.
- **Impact:** Layout cannot be adapted by participants; spec'd graceful degradation and compatibility guardrails are absent, so small/unsupported screens get an untested experience.
- **Fix:** Add pane resizing (persisted), a viewport-width guard with the spec'd notice, and a UA/feature check with the supported-browser list; verify the public pages down to 360 px.

### F-S03A-13 — MEDIUM — Shared component library largely missing: Toast, Dialog/ConfirmDialog, Select/Combobox, DataTable, Tabs/Tree/SplitPane, CodeView (Monaco), Skeleton, ConnectionIndicator (1.3)
- **Evidence:** frontend/src/ui/components.tsx (entire file) implements only Chip/StatusChip/Panel/Button/ConfirmButton/Field/EmptyState/LoadingShell/LoadingLine/ErrorBanner/KVRow/SectionHeading/CheckRow/CountdownTimer/PlainMarkdown. Grep for `Toast|Dialog|DataTable|SplitPane|Combobox|ConnectionIndicator|Skeleton|Monaco` across frontend/src: no component matches. Announcements/errors are inline banners; there is no live-region toast system, no modal with focus trap/ESC, no sortable/virtualized table, no connection state machine (only an on-demand `OfflineBanner`, chrome.tsx:190-208).
- **Impact:** Cross-cutting UX/ARIA patterns specified once in 1.3 and reused everywhere (workspace, review, admin) are missing, degrading consistency and accessibility.
- **Fix:** Either implement the missing primitives (with tests) or descope them in the spec; priority: Dialog (focus trap), Toast (aria-live, max 3), ConnectionIndicator (online/reconnecting/degraded/offline).

### F-S03A-14 — MEDIUM — §1.4 keyboard shortcuts absent (no command palette, quick-open, cross-file search, panel toggles, Alt+N, Ctrl+Enter, Alt+1-9, F8, `?` help)
- **Evidence:** Only arrow/Home/End/Enter/Shift+Enter in the code viewer (Workspace.tsx:286-311) and Enter in the find box (Workspace.tsx:586-589); grep for `ctrlKey|metaKey|altKey` in frontend/src finds no shortcut handling; no `?` help UI.
- **Impact:** Power-user flows and the accessibility parity promised by 1.4 are missing from the shipped workspace.
- **Fix:** Implement a keyboard map (at minimum Ctrl+Enter submit, Alt+N new report, `?` help) with the "not while typing except Ctrl/Cmd" rule.

### F-S03A-15 — MEDIUM — No automated axe checks in CI (1.5)
- **Evidence:** .github/workflows/ci.yml:16-257 — jobs: secret-scan, backend-quality, backend-tests, backend-e2e, frontend-quality (lint/npm audit/test/build), docs-hygiene. No axe-core, Lighthouse-a11y, or Playwright a11y step; no manual screen-reader pass record in the repo.
- **Impact:** WCAG 2.2 AA regressions (focus order, labels, contrast) ship undetected.
- **Fix:** Add an axe run (e.g., axe-core/playwright or Lighthouse CI) over landing/login/lobby/workspace routes; record the pre-event NVDA/VoiceOver pass.

### F-S03A-16 — MEDIUM — No message catalogs / i18n externalization of UI strings (1.6)
- **Evidence:** All copy is inline JSX text across frontend/src/pages/* and ui/components.tsx (e.g., Login.tsx:44-51, Lobby.tsx:79-120); no catalogs, no i18n module (grep i18n/intl catalog: none; Intl used only for date formatting, format.ts:5-28).
- **Impact:** Violates the externalization requirement; sentence-level review/translation and error-catalog alignment (§15) become impossible.
- **Fix:** Extract strings to a catalog module (even a single-locale TS dictionary) with keyed lookup; forbid concatenated sentences via lint rule.

### F-S03A-17 — MEDIUM — No degraded-state banner for realtime fallback / kill switch; polling is the only mode (1.7)
- **Evidence:** No SSE/WebSocket anywhere (grep EventSource/WebSocket: none); clients poll `/v1/state` every 5 s (Lobby.tsx:21,36; Workspace.tsx:114-118). No persistent banner for polling fallback or kill-switch state (only the manual OfflineBanner, chrome.tsx:190-208). state.py:3-4 documents "clients poll /state every ~5 s (spec 12.1 D1 realtime profile)".
- **Impact:** Degradation is invisible to participants; the 1.7 requirement (and the kill-switch UX) is unimplemented even though the infrastructure (announcement of degraded mode) is trivial in a polling client.
- **Fix:** Add a connection/degraded banner driven by poll failures and a `degraded`/kill-switch flag from `/v1/state` or `/v1/config`.

### F-S03A-18 — MEDIUM — PUB-02 rules: no downloadable PDF generated at publish time; time and grace rules section absent from the rules document
- **Evidence:** backend/app/routers/public.py:48-70 serves markdown only; no PDF generation anywhere (grep pdf: only docs). Seeded RULES_MD (backend/seed.py:431-473) covers eligibility, conduct, prohibited resources, scoring/penalties, tie-break, appeals, consequences, safe harbor — but no "time and grace rules" section (grace is only surfaced in the lobby UI, Lobby.tsx:114-116).
- **Impact:** The rules page cannot be archived/printed as specified; participants must discover grace rules from UI hints.
- **Fix:** Render a PDF (server-side) at publish time and link it; add the time/grace section to the frozen rules document.

### F-S03A-19 — MEDIUM — PUB-03 privacy notice not aligned to DPDP Act 2023; no rights statement, no proctoring/integrity-signal disclosure, no prize-eligibility terms
- **Evidence:** frontend/src/pages/Privacy.tsx:1-55 (data stored / not done / retention; no DPDP reference, no enumerated rights or request channel beyond "contact the coordinators", no proctoring or integrity-signals disclosure); Terms.tsx:1-65 (conduct terms ✓, but no prize-eligibility terms). Consent record itself is implemented (auth.py:659-692; Privacy.tsx:16-17 mentions sessions/submissions).
- **Impact:** Legal-facing content required by PUB-03/ATH-04 is thinner than specified; consent capture exists but the notice it points to is incomplete.
- **Fix:** Extend the privacy page: purposes, retention references, rights + contact for requests, integrity signals/proctoring statement, prize eligibility in terms; keep versions synchronized with ATH-04 consent.

### F-S03A-20 — MEDIUM — PUB-04 FAQ: no dedicated page/route; required topics (supported browsers, connection drop, workspace usage) missing
- **Evidence:** No `/faq` route (App.tsx:23-32); FAQ lives as a landing section (Landing.tsx:303-344) covering registration, reports, scoring, feedback, platform-vuln reporting — but not supported browsers, what to do when the connection drops, or how to use the workspace.
- **Impact:** Participants lack the self-service answers the spec targets; the landing page must carry content meant for a dedicated page.
- **Fix:** Add the /faq route with the five required topics and link it from the nav/footer.

### F-S03A-21 — MEDIUM — PUB-05 status page missing (no external status host, component status, incidents, maintenance)
- **Evidence:** No status page in repo or deployment config (grep status.example: none); the closest artifact is the backend JSON `/health` probe (main.py:112-118; db.py:97-112).
- **Impact:** Participants have no authoritative availability view during the event; incidents/maintenance cannot be communicated per PUB-05.
- **Fix:** Stand up an external status page (even a static host updated by the communications lead) and link it from the footer/landing.

### F-S03A-22 — LOW — Challenge URLs use UUIDs, not slugs (§0)
- **Evidence:** backend/app/routers/challenges.py:109 (`/challenges/{challenge_id}/files/content`), :146 (`/challenges/{challenge_id}/search`); levels.py routes likewise use IDs; events do use slugs in some responses (public.py:33).
- **Impact:** Minor convention deviation (§0 "Slugs only for events and challenges in URLs"); no security issue since IDs are UUIDv7.
- **Fix:** Accept/emit slugs for challenge URLs or record the deviation.

### F-S03A-23 — LOW — UI timezone formatter hard-codes Asia/Kolkata instead of taking the event timezone (§0, 1.6)
- **Evidence:** frontend/src/lib/format.ts:3 (`const IST = 'Asia/Kolkata'`), :5-28 formatters pinned to IST; the event `timezone` returned by the API (public.py:38) is never consumed.
- **Impact:** Correct for this single event, but any timezone change (or multi-event reuse) breaks silently — violates the "single formatter that takes the event timezone" requirement.
- **Fix:** Parameterize the formatter with the event timezone (fall back to IST), derive the abbreviation from the formatter.

### F-S03A-24 — LOW — Admin API served from the same host/app as the participant API (§0)
- **Evidence:** backend/app/main.py:97-110 mounts admin routers under the same `/v1` app; only the JWT `aud` claim differs (security.py:81); CORS list is shared (config.py:57, main.py:55-62).
- **Impact:** The "separate host and audience" convention is only half-met (audience yes, host no), concentrating the admin attack surface on the participant-facing origin.
- **Fix:** Document the accepted risk or split the admin app onto its own origin/host at deployment time.

### F-S03A-25 — LOW — Design token names deviate from the spec set; fonts are static weights, not a variable font (1.2)
- **Evidence:** tokens.css:3-27 uses `--ink/--panel/--panel-2/--line/--paper/--muted/--signal/--ok/--warn/--danger/--info` instead of `bg/surface/surface-raised/border/text/text-muted/accent/success/warning/danger/info`; main.tsx:7-15 imports fixed 400/500/600/700 font files rather than one variable font.
- **Impact:** Naming/portability friction; contrast pairs are plausible (dark background + light text) but not verified here — see F-S03A-15 for the CI gap that would prove it.
- **Fix:** Rename tokens (or add an alias layer) and switch to variable font files; verify WCAG AA pairs with the axe CI job.

### F-S03A-26 — LOW — Component-level deviations: Button lacks secondary/loading state; ConfirmButton not a typed-phrase confirm; Countdown lacks role="timer" and 10/5/1-min thresholds; StatusChip has no icon (1.3)
- **Evidence:** ui/components.tsx:132-166 (Button: primary/ghost/danger only, no loading prop — busy handled ad hoc in Login.tsx:82), :169-207 (ConfirmButton arm/confirm two-click, not "type the phrase"), :315-359 (CountdownTimer: no `role="timer"`; announces "10 minutes"/"2 minutes"/"Time is up" instead of 10/5/1), :83-90 (StatusChip = text+color, no icon; CheckRow does use icons, :449-479).
- **Impact:** Minor spec deviations; the missing `role="timer"` and icon-less status chip are the only user-facing a11y deltas.
- **Fix:** Add `role="timer"`, a secondary variant + loading prop, typed-phrase confirm for irreversible ops, and icons on StatusChip; align threshold announcements to 10/5/1 min.

### F-S03A-27 — LOW — Manual score adjustment is admin-only while the matrix allows organizer for "Rescoring, finalization" (1.1)
- **Evidence:** backend/app/routers/admin.py:1262 (`manual_adjustment` = `require_admin`); release/finalization endpoints are `require_organizer` (admin.py:398), matching the matrix for finalization.
- **Impact:** Organizers cannot apply mid-event score corrections they are allowed by the matrix; benign tightening.
- **Fix:** Confirm intent: keep admin-only and descope in the matrix, or widen to `require_organizer` with step-up.

### F-S03A-28 — LOW — Accommodation request field not reachable from the participant profile (1.5)
- **Evidence:** `users.accommodation_note` exists (models_app.py:73; migrations/0001_init.sql:93) and the ACCOMMODATION reason code is enforced for time adjustments (admin.py:923-924), but no API endpoint or UI field lets a participant submit the note (Account.tsx:50-66 renders profile facts only).
- **Impact:** Accommodations must be collected out-of-band; the ADM-LV-06 chain starts with no input surface.
- **Fix:** Add a profile field (Account page + `PATCH /me`) writing `accommodation_note`, surfaced to organizers.

### F-S03A-29 — LOW — Landing performs an extra dynamic call (`GET /v1/time`) beyond PUB-01's allowed `GET /v1/public/event` (PUB-01)
- **Evidence:** frontend/src/pages/Landing.tsx:12-18, 22-33 (react-query calls to `/v1/time` and `/v1/public/event`, refetch 60 s); backend state.py:21-25.
- **Impact:** Minor: one additional cached public call (it powers the countdown's server-clock offset). Arguably within the spirit ("no dynamic API calls beyond a cached event fetch").
- **Fix:** Fold server time into the `/v1/public/event` payload or document the exception.

### F-S03A-30 — LOW — Frontend copy contradicts backend: "account is created automatically on first sign-in" (Terms/Login) vs backend rejection of unregistered emails
- **Evidence:** frontend/src/pages/Terms.tsx:13-16 and Login.tsx:88-91 claim self-service account creation on first sign-in; backend rejects unknown emails with `AUTH_INVALID_CREDENTIALS` (auth.py:76-78). Terms also fails to mention that pre-activation accounts can be claimed (see F-S03A-03).
- **Impact:** Confusing/misleading user-facing legal copy; users will believe sign-up is open.
- **Fix:** Align the copy with the actual flow once F-S03A-03 is resolved.

---

## Verified-as-DONE highlights (no finding)
- Error envelope + request IDs on every error path (errors.py:16-80; main.py:64-92).
- Argon2id hashing with OWASP params, pinned-algorithm JWT with aud/iss, refresh-token rotation with reuse detection and family revocation (security.py:27-112; auth.py:250-311).
- Refresh cookie: HttpOnly, SameSite=Strict, path-scoped to `/v1/auth/refresh`, Origin + client-header CSRF check (auth.py:29-46; deps.py:170-177).
- Rules-acceptance gate enforced server-side on every submission/levels path (deps.py:121-138; submissions.py:100; levels.py:199 et al.).
- Idempotency-Key required and honored with payload-hash conflict detection (submissions.py:96-130).
- Generic invalid-credentials message; no account enumeration on login/register/reset-request (auth.py:76-78, 234-236, 522-523; errors.py:17).
- Landing/rules/privacy/terms pages with self-hosted fonts, reduced-motion support, 2 px focus outlines, threshold-only timer announcements (main.tsx:7-15; app.css:30-50; components.tsx:332-343).

---

### 4.6 03 Sections & Components Specification, sections 4-end - lobby, workspace, results, integrity (`spec03b`)

# Spec-vs-Implementation Audit — Agent spec03b (Task 3-f)

- **Baseline document:** `/home/z/my-project/upload/03-specification.md` (Bug Hunt CTF — Specification of Sections and Components)
- **Repo:** `/home/z/my-project/bug-hunt-hackathon` @ HEAD `f1412b7eec6c92c4c168fd2b8a58182b34480387` (2026-11-26)
- **Scope:** Section 4 (Lobby) through end of document (§4–§17), frontend and backend.
- **Method:** Every requirement located in code and verified by reading the implementation (Read/Grep only; no code modified, no tests run).
- **Overall:** The delivered system is a coherent single-event platform (custom code viewer, polling-based updates, component-weighted scoring, four-level flow) that satisfies the *transactional heart* of the spec (§10.4 submissions, idempotency, receipts, error catalog, GT isolation, step-up, audit chain) but implements none of the realtime (SSE), pre-fetch/encryption, practice, integrity, or analytics subsystems, and only partially implements the workspace/admin UX layers.

## Status summary

| Status | Count |
|---|---|
| DONE | 15 |
| PARTIAL | 61 |
| MISSING | 45 |
| DEVIATION | 2 |
| **Findings: HIGH 7 · MEDIUM 16 · LOW 7** | 30 |

## Per-requirement status table

### §4 Lobby

| Spec ref | Requirement (short) | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| LB-01 | Event overview, schedule, personal status, countdown | PARTIAL | frontend/src/pages/participant/Lobby.tsx:59-190; backend/app/routers/state.py:45-94 | Round clock + countdown + readiness rows present; schedule shows generic phases, not round start/end per round; countdown to next round only for latest stage |
| LB-02 | Automated system checks (browser, clock, SSE, IndexedDB, Monaco…), entry blocked on fail | PARTIAL | Lobby.tsx:123-160 | Only 4 checks (API reachable, team, rules, round window); no browser/size/clock-offset/SSE/IndexedDB checks; no entry blocking on fail |
| LB-03 | Interactive 5-step workspace tour, replayable, completion recorded | MISSING | grep "tour" over frontend/src: no match | No tour component anywhere |
| LB-04 | Encrypted bundle pre-fetch at SEALED/ARMED with progress + integrity check | MISSING | backend/app/routers/challenges.py:32-48,109-143 | No bundle or key endpoints at all; files served in plaintext once stage is armed/active |
| LB-05 | Announcements banner + list, live via SSE, unread count | PARTIAL | Lobby.tsx:216-236; backend/app/routers/announcements.py:14-41 | Polling list (30 s) with severity chips; no SSE, no unread count, no banner strip |
| LB-06 | At T0 button auto-changes to "Enter workspace"; key release triggers decrypt | PARTIAL | Lobby.tsx:146-159 | Static "Open workspace" link always present; no T0 auto-change, no key release/decryption (countdown + status chip do update automatically) |

### §5 Competition workspace

| Spec ref | Requirement (short) | Status | Evidence | Notes |
|---|---|---|---|---|
| §5 layout | Resizable/collapsible multi-pane; layout persists per participant | MISSING | Workspace.tsx:499 (`.workspace` CSS grid) | Fixed 3-pane grid; no resize, no collapse, no persistence |
| WS-01 | HUD: countdown w/ thresholds, score hidden, ConnectionIndicator, pause banner | PARTIAL | Workspace.tsx:466-481,874-879 | Countdown + warn/critical colors ✓, score correctly not shown; no ConnectionIndicator, no outbox count; pause = chip + notice, not full-width banner; inputs stay editable |
| WS-02 | Explorer: file list/tree, viewed marks, per-file report count, keyboard nav, context menu | PARTIAL | Workspace.tsx:500-557 | Flat grouped list; no per-file report count, no viewed marks, no breadcrumbs, no context menu/copy-path; tree rows are focusable buttons but no arrow-key tree nav |
| WS-03 | Monaco read-only, tabs (limit 20), markers, find/go-to-line, friction controls | PARTIAL | Workspace.tsx:559-646 | Custom div viewer (no Monaco); single file (no tabs); find-in-file ✓; font size ✓; no go-to-line, no wrap toggle, no reported-line markers, no copy friction controls |
| WS-04 | Report panel fields + caps display + duplicate-draft guard + paste counter | PARTIAL | Workspace.tsx:688-818,345-364; backend/app/routers/submissions.py:75-89 | Core fields ✓ with server validation; deviations: description min 20 (spec 40), evidence always optional, no related-locations UI in this workspace, no "reports left" counter, no overlapping-range note, no paste-length counter |
| WS-05 | Submissions drawer: statuses, receipt, read-only detail, pending outbox retry | PARTIAL | Workspace.tsx:906-963; submissions.py:341-383 | Drawer tab lists own reports w/ receipts ✓ coarse pre-release status ✓; no outbox/"Sending…" retry (no offline queue) |
| WS-06 | Command palette (open files, panels, shortcuts, search) | MISSING | grep "command palette"/Ctrl+K over frontend/src: no match | None of §1.4 shortcuts implemented anywhere |
| WS-07 | In-workspace announcement banner/toast + stored list in HUD | MISSING | Workspace.tsx (no announcement rendering) | Announcements exist only in the Lobby panel |
| WS-08 | Connection states, offline usability, ordered outbox flush, 503/429 backoff, re-auth dialog | PARTIAL | frontend/src/lib/api.ts:116-176 | 401 silent-refresh retry ✓, network error banner ✓; no ConnectionIndicator, no offline outbox, no backoff on 429/503, no blocking re-auth dialog preserving drafts |
| WS-09 | Round-1 file chips w/ per-file cap counts, cooldown messaging, 5-min draft reminder | PARTIAL | Workspace.tsx:407-414,810-817; submissions.py:205-239 | Cooldown + caps enforced server-side with friendly messages ✓; no per-file count chips, no 5-min reminder |
| WS-10 | Round-2: search, symbols, evidence required, related locations, optional sandbox | PARTIAL | Workspace.tsx:322-341; challenges.py:146-172 | Server-side search ✓ (limit 50); no symbol index/peek, evidence optional, related locations only in the separate levels flow, no sandbox |
| WS-11 | End of round: read-only, "Time is up", grace, summary of acknowledged reports | PARTIAL | Workspace.tsx:690-696,810; submissions.py:172-180 | Server enforces ROUND_ENDED past effective end+grace ✓; UI disables submit when stage ends and shows notice; no automatic end summary of acknowledged reports |

### §6–§8 Submissions history, results, practice

| Spec ref | Requirement (short) | Status | Evidence | Notes |
|---|---|---|---|---|
| SUB-01 | History table w/ filters, detail w/ outcome + bug code + points, dispute ≤1000 chars in window | PARTIAL | Submissions.tsx:9-99; SubmissionDetail.tsx:38-86; submissions.py:341-460; DisputeForm.tsx:12-113 | Table + detail + 1000-char dispute ✓; no round/status filters (UI or API), no reviewer reason code shown, dispute gated on release but no appeal-window end |
| LBD-01 | Leaderboard modes, own row pinned, search, pagination, provisional badge | PARTIAL | Leaderboard.tsx:7-111; leaderboard.py:21-62; evaluator.py:579-628 | hidden/frozen(+delay)/live modes honored ✓ tie-break columns ✓; no own-row highlight/pin, no search, no pagination, no provisional badge; accepted-findings count not shown (invalid count instead); live-mode constraints (§13.3) not enforced |
| RES-01 | Breakdown, rank, per-challenge totals, bugs missed, certificate | PARTIAL | Results.tsx:18-201; leaderboard.py:65-125 | Component breakdown + ledger entries w/ dispute ✓; no rank, no per-challenge totals, no bugs-missed, no certificate; total double-counts penalties (F-S03B-02) |
| RES-02 | Public results page w/ signed results file | MISSING | frontend/src/App.tsx:23-30 (routes) | No public results route; no signed results export |
| PR-01 | Practice environment, separate data, no leaderboard effect | MISSING | grep "practice" backend/app + frontend/src: no match | Entire §8 unimplemented |
| PR-02 | Practice content (R1 set + R2 repo + answer key) | MISSING | — | — |
| PR-03 | Immediate feedback mode for practice | MISSING | — | — |
| PR-04 | Namespaced practice endpoints + isolation CI test | MISSING | — | — |

### §9 Admin console

| Spec ref | Requirement (short) | Status | Evidence | Notes |
|---|---|---|---|---|
| ADM-EV-01 | Create/edit events (name, slug, TZ, dates, capacity, mode, rules v, retention) | PARTIAL | admin.py:48-93; Dashboard.tsx:179-205 | name/slug/duration/caps ✓; TZ fixed default, no dates/mode/retention editing |
| ADM-EV-02 | Create rounds w/ kind, ordinal, schedule start, caps, modes, penalty, telemetry, sandbox | PARTIAL | admin.py:220-276 (DEFAULT_STAGE_CONFIG 227-238) | config caps/modes/penalty/tolerance ✓; kind is `main`/`level` (not round1/round2), no scheduled start (set at "start" action), no telemetry/sandbox flags |
| ADM-EV-03 | Config revisions w/ reason; freeze at publication; diff view | PARTIAL | admin.py:153-199 | revisions + reason + rule_set_hash + freeze ✓; no diff view; stage config not locked at arm/publish |
| ADM-EV-04 | State machine view w/ allowed transitions as buttons | DONE | admin.py:96-144; Dashboard.tsx:31-51,160-170 | Event + stage transitions rendered as confirm buttons matching backend maps |
| ADM-EV-05 | Readiness checklist w/ owner; going live blocked while unchecked | DONE | admin.py:117-126,1002-1040; Dashboard.tsx:459-514 | Gate enforced server-side on `live` transition |
| ADM-EV-06 | Calendar/timeline of T-minus milestones | MISSING | Dashboard.tsx (no calendar) | Only stage start/end strings in live ops |
| ADM-PT-01 | CSV import w/ mapping, dry run, commit | MISSING | admin.py:476-530 | Single-invite creation only |
| ADM-PT-02 | Send/resend invites, track activation | PARTIAL | admin.py:476-511,514-530 | Invite token returned in console (no email); activation state listed; no resend/rate limit |
| ADM-PT-03 | Participant detail (sessions, submissions, flags, adjustments, notes) | PARTIAL | admin.py:514-530 | Flat list (email, role, team, activated) only |
| ADM-PT-04 | Reset pwd, revoke sessions, disqualify (2-person), reinstate, merge | MISSING | grep admin.py/auth.py: no such endpoints | Only status checks for disqualified accounts (deps.py:82-83) |
| ADM-PT-05 | Seat/device assignment + export | MISSING | — | — |
| ADM-PT-06 | Role management (admin only) | PARTIAL | auth.py:202-203 (`/auth/register`, admin) | Create user w/ role; no edit/role UI |
| ADM-CH-01 | Challenge editor (metadata + files) | PARTIAL | admin.py:536-563,566-633; Challenges.tsx:212-262 | slug/title/instructions + per-file upload; no language/difficulty/points metadata |
| ADM-CH-02 | Safe archive upload (limits, path checks, inert blobs) | DEVIATION | admin.py:566-633 | Single-file text upload (not archives): size + traversal checks ✓ inert storage ✓; symlinks/device files N/A |
| ADM-CH-03 | File viewer w/ anchors for GT editor | MISSING | — | — |
| ADM-CH-04 | Version lifecycle DRAFT→REVIEWED→FROZEN→SEALED→PUBLISHED→ARCHIVED, immutable | PARTIAL | admin.py:586-590,650-685,704-705 | draft→sealed(frozen)→published; REVIEWED/ARCHIVED missing; writes blocked after seal ✓ |
| ADM-CH-05 | Validation report before freezing (line counts, hashes, bug codes, severity dist) | PARTIAL | admin.py:650-685 | Requires ≥1 file; content_hash ✓; no line-count range/anchor/uniqueness/severity checks |
| ADM-CH-06 | Unplanned-defect audit workflow (2 reviewers, promote/ignore) | MISSING | review.py:202-207 (unplanned_valid → needs_review only) | No promotion/ignore workflow |
| ADM-CH-07 | Variant equivalence validation | MISSING | — | — |
| ADM-CH-08 | Watermark slot editor + preview | MISSING | grep "watermark": none in code | No watermarking anywhere (§10.3 file watermarking also absent) |
| ADM-CH-09 | Preview mode (organizer plays challenge) | MISSING | — | — |
| ADM-CH-10 | Bundle sealing per participant | MISSING | — | No bundles |
| ADM-GT-01 | Create bugs (code, severity, points, RCG, explanation) | PARTIAL | admin.py:748-811 | API-only (no UI); fields ✓ |
| ADM-GT-02 | Locations (primary + acceptable, anchor hash) | DONE | admin.py:779-792 | Primary flag ✓; anchor hash not captured (no watermarking) |
| ADM-GT-03 | Aliases/keywords with weights | DONE | admin.py:793-799; matching.py:112-118 | Used as matching evidence ✓ |
| ADM-GT-04 | Partial-credit rules per root-cause group | MISSING | matching.py:186-199 | Fixed 0.5/1.0 quality; no per-group rules |
| ADM-GT-05 | Revisions after freeze w/ rescoring impact preview | MISSING | admin.py:757-758 (GROUND_TRUTH_LOCKED only) | No revision/rescoring path |
| ADM-GT-06 | Step-up + audited + "GT visible" marker + no export | PARTIAL | admin.py:748-758; deps.py:141-162 | Step-up (password re-entry) + gt_session + audit ✓; no persistent marker; export absent ✓ |
| ADM-GT-07 | Test harness (paste report → matcher preview, no ledger writes) | MISSING | — | No endpoint |
| ADM-LV-01 | Control room (online, submissions/min, queue depth/age, backlog, error rate, countdown) | PARTIAL | admin.py:945-996; Dashboard.tsx:304-351 | Real counts, queue age, backlog, DB health ✓; no submissions/min, error rate, or deadline countdown |
| ADM-LV-02 | Round controls w/ reason + confirmation phrase, SSE broadcast, logged | PARTIAL | admin.py:291-394; Dashboard.tsx:374-413 | arm/start/pause/resume/extend/end + reason + audit + transitions ✓; no SSE broadcast; two-step confirm button, no typed phrase |
| ADM-LV-03 | Announcement composer (severity, audience, preview, schedule) | PARTIAL | admin.py:886-912; Dashboard.tsx:431-452 | Severity + body ✓; no audience targeting, preview, or scheduling |
| ADM-LV-04 | Participant list w/ live status + quick actions | PARTIAL | admin_levels.py:187-228 (progress matrix); admin.py:514-530 | Progress matrix (levels flow) ✓; no live online/outbox status |
| ADM-LV-05 | Kill-switch panel (SSE, leaderboard, telemetry, read-only, admission) w/ audit trail | PARTIAL | admin.py:991-995; Dashboard.tsx:343-350 | Deployment-settings flags displayed read-only; no runtime toggles/audit trail/read-only/admission switches |
| ADM-LV-06 | Time adjustments (delta, reason codes, bounds, 2-person above threshold) | PARTIAL | admin.py:915-942 | Reason codes ✓ per-user/global ✓; no policy bounds, no two-person approval |
| ADM-LV-07 | Incident log w/ export | MISSING | — | stage_transitions recorded but no incident log view/export |
| ADM-RV-01 | Queue listing (anonymized, confidence, SLA, filters, saved views) | PARTIAL | review.py:28-62; Queue.tsx:17-29 | Queue + client-side filters ✓; no confidence/SLA/saved views; no participant alias shown |
| ADM-RV-02 | Review view (report text, code w/ highlight, candidates, GT excerpt, history) | PARTIAL | review.py:103-159; ItemDetail.tsx:162-233 | Plain-text payload + highlighted file ✓; no candidate bugs/matcher features, no GT excerpt, only team report count |
| ADM-RV-03 | Decisions w/ reason code + rationale required | PARTIAL | review.py:170-247; ItemDetail.tsx:247-288 | All six decisions ✓; notes optional, no reason code |
| ADM-RV-04 | Double review for Critical/High + disagreement resolution | MISSING | review.py (needs_second_review exists as decision only) | No automatic double review or lead resolution |
| ADM-RV-05 | Workload dashboard + calibration mode | MISSING | — | — |
| ADM-RV-06 | Keyboard-driven flow + bulk accept | MISSING | ItemDetail.tsx (mouse forms only) | — |
| ADM-RV-07 | Participant content plain text, no auto-link | DONE | review.py:140-159; ItemDetail.tsx:178-193 | Rendered in `<pre>` via React text nodes |
| ADM-RV-08 | Optional LLM suggestion panel (advisory) | MISSING | matching.py:15 (ai_assessment disabled by default) | Flag exists; no panel |
| ADM-DS-01 | Dispute inbox w/ states (open, in_review, upheld, rejected) | PARTIAL | admin.py:1178-1191; Dashboard.tsx:644-728 | List + upheld/rejected ✓; no in_review state handling |
| ADM-DS-02 | Dispute detail w/ evaluation chain + receipts + statement | PARTIAL | admin.py:1184-1191 | Statement/receipt/title shown; chain only via separate audit log |
| ADM-DS-03 | Resolution by non-original reviewer + ledger adjustment | PARTIAL | admin.py:1194-1258 | Ledger adjustment via append-only entry ✓; independence from original decision-maker not enforced |
| ADM-DS-04 | Notify participant of outcome | MISSING | — | No notification mechanism |
| ADM-RS-01 | Rescoring runs (GT revisions, review corrections, manual) w/ impact preview | MISSING | — | Only manual dispute/adjustment entries (admin.py:1194-1301) |
| ADM-RS-02 | Execute rescoring run w/ progress; locks round; supersessions | MISSING | — | — |
| ADM-RS-03 | Finalization checklist (pending reviews, disputes, chain verified, snapshot) | MISSING | admin.py:96-144 (closed→finalized unchecked) | No checks on finalization |
| ADM-RS-04 | Release controls (verdicts, leaderboard, publish) w/ audit | PARTIAL | admin.py:397-429; evaluator.py:455-565; Dashboard.tsx:415-424 | evaluate/release with audit + feedback/leaderboard jobs ✓; no public results publish |
| ADM-RS-05 | Signed results export (JSON/CSV, hash, signature, verification) | PARTIAL | admin.py:1078-1172 | CSV w/ sha256 stored ✓; no signature, no JSON, no verification instructions |
| ADM-IN-01 | Integrity flag list by type/severity/status | MISSING | grep "integrity" backend/app: role folded (models_app.py:65) | — |
| ADM-IN-02 | Case view w/ evidence timelines, similarity side-by-side | MISSING | — | — |
| ADM-IN-03 | Case actions incl. 2-officer disqualification | MISSING | — | — |
| ADM-IN-04 | Participant response capture + appeal linkage | MISSING | — | — |
| ADM-IN-05 | Leak attribution (watermark slots) | MISSING | — | No watermarks exist |
| ADM-IN-06 | integrity_officer-only access, audited views | MISSING | models_app.py:65 | Role folded into reviewer |
| ADM-AN | Analytics dashboards + CSV export | MISSING | — | Only live-ops counts |
| ADM-AU | Audit viewer (filters by actor/action/entity/time/rid, chain status, export) | PARTIAL | admin.py:1043-1075; Dashboard.tsx:550-640 | Action filter + chain verify + newest-first list ✓; no actor/entity/time/request filters, no export; insert-only ✓ |
| ADM-EX | Exports via background jobs to R2, access-controlled, expiring | PARTIAL | admin.py:1078-1172 | Synchronous CSV returned inline; stored w/ hash in exports table; no jobs/R2/expiry; kinds limited |
| ADM-SY | System health (replication lag, backups, certs, capacity, flags) | PARTIAL | admin.py:1304-1322; Dashboard.tsx:732-762 | DB probes, job counts, env/flags ✓; no replication/backup/cert/capacity data |

### §10 Backend modules

| Spec ref | Requirement (short) | Status | Evidence | Notes |
|---|---|---|---|---|
| 10.1 AUTH | Login/refresh/logout/activate/reset/me/sessions/acceptances; Argon2id; lockout via limits | DONE | auth.py:54-692; deps.py:33-39 | All endpoints present; step-up via password re-entry (documented v1 substitution); rate limiting in-process |
| 10.2 EVENTS | /public/event, /config, /state, /time, /stream (SSE), /rounds/{id}/key | PARTIAL | state.py:21-139; public.py:13-45 | /stream and /rounds/{id}/key missing; effective end w/ adjustments ✓ |
| 10.3 CHALLENGES | bundle, tree, files (watermarked), search, symbols; quotas; no GT leak | PARTIAL | challenges.py:68-172 | assignments+content+search ✓ rate-limited ✓ traversal-safe ✓; no bundle/tree/symbols endpoints; no watermarking |
| 10.4 SUBMISSIONS | Ordered transaction, idempotency, caps/cooldown, receipt, dispute, drafts | DONE | submissions.py:92-325,341-520; security.py:118-124 | Ordered checks, HMAC receipt, replay w/ original receipt, grace, caps/cooldown, versioned drafts (body version, not If-Match) |
| 10.5 EVALUATION | evaluate jobs, evaluations row, review endpoints, promotion | PARTIAL | evaluator.py:107-208; review.py:28-247 | Job + review endpoints + 10-min claim timeout ✓; no `evaluations` row (§11.4), no second-review/resolve-disagreement, promotion partial |
| 10.6 REALTIME | SSE /v1/stream w/ 7 event types, heartbeats, replay | MISSING | grep SSE/stream backend/app: no match | No realtime module at all; outbox_events rows written but dispatch only marks them delivered (evaluator.py:631-643) |
| 10.7 SCORING | Ledger, snapshot job every 10 s, leaderboard/results endpoints, cacheable 10 s | PARTIAL | scoring.py:30-183; evaluator.py:579-628; leaderboard.py:21-125 | Ledger + visibility modes + delay ✓; snapshots only event-driven (no interval job); responses no-store not cacheable |
| 10.8 INTEGRITY | /v1/integrity/events telemetry batch endpoint | MISSING | config.py:53 (flag only) | — |
| 10.9 ADMIN | Separate host/audience, role checks, step-up claim, reason, idempotency keys | PARTIAL | admin.py (all); deps.py:141-162 | Same app/host; roles + step-up (password) + reasons ✓; no Idempotency-Key on admin mutations |
| 10.10 AUDIT | Insert-only chain, nightly verification job, export w/ proof | PARTIAL | audit.py:20-95; admin.py:1043-1047 | Chain write + verify endpoint ✓; no nightly job, no export; verify covers only `global` scope of app DB |
| 10.11 JOBS | Job kinds (evaluate, snapshot, rescore, seal_bundles, export, send_email, …) | PARTIAL | jobs.py:24-158; worker.py:29-52 | Durable queue, leases, backoff, dead-letters ✓; kind set differs (no rescore/seal/export/email/retention/chain_verify) |
| 10.12 NOTIFICATIONS | Email templates (invite, reset, reminders, results, dispute) | MISSING | admin.py:476-511 (token returned in console) | — |
| SBX-01 | Sandbox gateway + limits + evidence logging | MISSING | Dashboard.tsx:756-759 ("Code execution is disabled") | Runner disabled by deployment decision |

### §11–§17 Data contracts, state machines, scoring, integrity, errors, NFRs, acceptance

| Spec ref | Requirement (short) | Status | Evidence | Notes |
|---|---|---|---|---|
| 11.1 | Submission request shape | PARTIAL | submissions.py:54-68 | `kind` + optional challenge_id (resolved server-side — good); matches otherwise |
| 11.2 | Submission acknowledgement | DONE | submissions.py:328-338 | Plus `replay` + `team_id` extras |
| 11.3 | Round state shape | DONE | state.py:77-94 | Includes kind/name/event_status extras |
| 11.4 | Evaluation record (engine_version, rule_set_hash, confidence, features) | MISSING | evaluator.py (no evaluations table write) | Features recorded only in ledger note strings |
| 11.5 | Ledger entry | PARTIAL | scoring.py:30-65; models_app.py | Append-only ✓; `reverses_entry_id` instead of `superseded_at`; no engine/evaluation linkage |
| 11.6 | Round configuration excerpt | DONE | admin.py:227-238; state.py:118-139 | Defaults match spec except telemetry/sandbox flags absent |
| 12.1 | Event state machine | DONE | admin.py:96-103,106-144 | Transitions + readiness gate for LIVE ✓ |
| 12.2 | Round state machine | PARTIAL | admin.py:279-288,291-394,397-429 | DRAFT→…→RELEASED ✓; no RELEASED→FINAL transition endpoint; auto ENDED at deadline not modeled (deadline enforced in submissions) |
| 12.3 | Submission state machine | PARTIAL | submissions.py/review.py/evaluator.py statuses | RECEIVED→MATCHED_AUTO/NEEDS_REVIEW/REJECTED_AUTO ✓; DISPUTED ✓; RESOLVED state absent (stays disputed) |
| 12.4 | Challenge version lifecycle | PARTIAL | admin.py:589-590,659-660,704-705 | DRAFT→SEALED→PUBLISHED; REVIEWED/ARCHIVED missing; backward edits blocked after seal ✓ |
| 12.5 | Refresh token family | DONE | auth.py:250-358 (rotation + reuse revocation) | AT-01/AT-02 covered by tests/test_auth.py |
| 13.1 | Matching inputs | DONE | matching.py:121-135 | Pure inputs incl. related text/evidence |
| 13.2 | Matching algorithm thresholds | PARTIAL | matching.py:139-199,202-270 | Candidate/loc/category/alias scoring ✓; auto_full requires A≥0.2 always (no "∨ round1"); partial-group-coverage E band unimplemented |
| 13.3 | Oracle defenses | PARTIAL | submissions.py:205-239; admin.py:227-238; evaluator.py:455-565 | caps/cooldown/span/hidden/penalty-at-release ✓; live-leaderboard constraints unenforced; probing analytics missing |
| 13.4 | Points & penalties | DEVIATION | scoring.py:104-115; evaluator.py:147-168,530-559 | Component-weight model (functional/code/evidence) instead of `bug.points × quality`; penalty = low-severity × fp_factor capped ✓; evidence bonus +0.2 missing |
| 13.5 | Ranking tie-breaks | DONE | scoring.py:126-164; evaluator.py:602-619 | Score desc → fewer invalid → earlier last accepted; manual panel review N/A |
| 13.6 | Rescoring determinism | PARTIAL | matching.py (pure function); tests/test_matching.py | Deterministic ✓ replay tests ✓; no engine_version/rule_set evolution tracking |
| §14 | Integrity signals (focus, paste, concurrency, similarity, timing, cadence) | MISSING | grep backend/app: no analyzers | Only caps/cooldown mitigate probing |
| §15 | Error catalog codes/messages | DONE | errors.py:16-80 | Matches spec table; minor: no Retry-After header on 429s |
| §16 | NFRs (perf, reliability, observability, a11y CI, OpenAPI contract tests) | PARTIAL | main.py:64-92 (request-id/limits); scripts/load_test.py; frontend/tests/submission_payload.test.mjs | request tracing ✓; no OpenAPI contract tests, no axe CI, no periodic snapshots |
| §17 | Acceptance matrix | PARTIAL | backend/tests/* (idempotency, gates, auth, gt isolation, auto-submit, matching, scoring) | AT-01..05,07,08,10,11,17,19,24 covered by tests; AT-12..14,18,20,21,23 (infra/SSE/spike/freeze) unverifiable or N/A |

## Findings

### F-S03B-01 — REALTIME module (SSE `/v1/stream`) not implemented; all updates are polling
- **Severity:** HIGH
- **Spec ref:** §10.6; LB-05; WS-07; WS-08; ADM-LV-02 (broadcast); §10.2
- **Evidence:** `backend/app/main.py:97-110` (no stream router); grep `stream|SSE|EventSource` over backend/ and frontend/src returns no implementation; `backend/app/evaluator.py:631-643` `dispatch_outbox` merely marks rows delivered with no consumer; frontend polls (`Workspace.tsx:114-118`, `Lobby.tsx:33-47`, `Queue.tsx:17-21`).
- **Impact:** No `key_release`, live announcements, `submission_update`, `leaderboard_version`, or `session_revoked` push. Spec-critical flows degrade to 5–30 s polling; deadline switches and pause/resume reach participants late (grace + server-side rejection prevents data loss, so not CRITICAL).
- **Fix:** Add `GET /v1/stream` (text/event-stream) with the 7 event types fed by `app.outbox_events` (already written), heartbeat every 15 s, `Last-Event-ID` replay; add `ConnectionIndicator` + outbox wiring in the workspace.

### F-S03B-02 — Participant results endpoint double-counts penalties
- **Severity:** HIGH
- **Spec ref:** RES-01; §10.7
- **Evidence:** `backend/app/routers/leaderboard.py:95-118` — `by_component[r["component"]]` accumulates penalty entries (component `"penalty"`, negative points) and `penalties += pts` for `kind == "penalty"`, then `total = sum(by_component.values()) + penalties` subtracts penalties twice. `frontend/src/pages/participant/Results.tsx:92` renders that `total`.
- **Impact:** Every team with penalties sees an incorrectly low total (off by the penalty amount) on the results page — a core scoring-output correctness bug (leaderboard snapshot sums are computed separately and are correct).
- **Fix:** Compute `total = sum(v for k, v in by_component.items() if k != "penalty") + penalties`, or exclude kind `penalty` from `by_component`; add a regression test with a penalized team.

### F-S03B-03 — Practice environment (§8) entirely missing
- **Severity:** HIGH
- **Spec ref:** PR-01..PR-04
- **Evidence:** grep `practice` over `backend/app` and `frontend/src` → matches only in docs (`docs/`); no `/v1/practice/*` routes, no practice pages.
- **Impact:** Participants cannot rehearse the workspace before the event; spec-required onboarding and its CI isolation guarantee are absent.
- **Fix:** Either implement namespaced practice routes with separate challenge IDs and immediate feedback, or record a formal owner decision de-scoping §8.

### F-S03B-04 — Integrity subsystem (signals, telemetry endpoint, integrity console, integrity_officer role) missing
- **Severity:** HIGH
- **Spec ref:** §14; §10.8; ADM-IN-01..06; §0 roles
- **Evidence:** grep `integrity` in `backend/app` → only `IntegrityError` imports; `backend/app/models_app.py:65` "integrity_officer folded into reviewer for v1"; `config.py:53` `telemetry_enabled` flag unused by any endpoint; no `/admin/integrity` routes in `admin.py`.
- **Impact:** No anti-collusion/anti-probing detection beyond caps/cooldown; two-person disqualification, case workflow, and leak attribution (watermarks don't exist either) are unavailable to organizers.
- **Fix:** Implement `/v1/integrity/events` batch ingestion (always-202), background analyzers producing flags, and the ADM-IN console; or formally de-scope.

### F-S03B-05 — No encrypted bundle pre-fetch or key release; challenge materials served in plaintext
- **Severity:** HIGH
- **Spec ref:** LB-04; LB-06; §10.2 (`/v1/rounds/{id}/key`); §10.3 (`/v1/rounds/{id}/bundle`)
- **Evidence:** `backend/app/routers/challenges.py:32-48` `_require_released_stage` permits file/content/search at `armed` and later; no `key` or `bundle` endpoints exist (grep `/rounds/` → none); frontend has no pre-fetch or decrypt code.
- **Impact:** The "download early, decrypt at T0" fairness mechanism is absent; a participant who reaches the workspace early can read challenge files before start (files are readable at `armed`), and AT-18 (decrypt within 5 s of key release) cannot be met.
- **Fix:** Either gate `/files/content` on `active` (minimum fix: materials only after start) or implement encrypted per-team bundles + `/rounds/{id}/key` released at start.

### F-S03B-06 — Workspace core UX gaps: no Monaco, no multi-tab, no command palette, no offline outbox
- **Severity:** HIGH
- **Spec ref:** WS-03; WS-06 (and §1.4 shortcuts); WS-08; WS-02 markers; WS-09 caps display; WS-11 summary
- **Evidence:** `frontend/src/pages/participant/Workspace.tsx:608-646` (custom `div.codeline` viewer, single file), `:499` (fixed grid), grep `ctrlKey|command palette` over frontend/src → only `Workspace.tsx:296-299`; no `ConnectionIndicator` (grep), no outbox (submits are direct `fetch`, `Workspace.tsx:374-423`).
- **Impact:** Spec's workspace ergonomics (tabs, palette, keyboard shortcuts, offline resilience, reported-line markers, per-file report counters, end-of-round summary) are absent; participant efficiency and the offline guarantee (AT-19) are unmet.
- **Fix:** Prioritize an offline outbox (IndexedDB queue + retry/backoff) and reported-line markers; add tab support and the §1.4 shortcut set; document remaining gaps.

### F-S03B-07 — LB-03 workspace tour missing
- **Severity:** HIGH
- **Spec ref:** LB-03
- **Evidence:** grep `tour` over `frontend/src` → no match; `Lobby.tsx` has no tour panel.
- **Impact:** First-time participants get no guided onboarding; personal-status "workspace tour completed" (LB-01) can never be satisfied.
- **Fix:** Add a replayable 5-step overlay tour on the workspace (localStorage completion flag); or de-scope.

### F-S03B-08 — LB-02 system check covers only 4 items and never blocks entry
- **Severity:** MEDIUM
- **Spec ref:** LB-02
- **Evidence:** `frontend/src/pages/participant/Lobby.tsx:123-160` (API reachable, team, rules, round window); no browser/clock-offset/screen-size/IndexedDB checks; no fail→entry-block logic.
- **Impact:** Unsupported browsers or skewed clocks are not detected; spec's entry gating on browser/API failure is absent.
- **Fix:** Add the seven spec checks (browser feature detection, `/v1/time` offset < 5 s, viewport, fetch probe, IndexedDB probe) and disable the workspace link on hard failures.

### F-S03B-09 — Event/stage resolution ignores the caller's event (latest-wins across all events)
- **Severity:** MEDIUM
- **Spec ref:** §10.2 `/v1/state`, `/v1/config`; §10.3 assignments; LB-01; multi-event correctness
- **Evidence:** `backend/app/routers/state.py:49-61,102-108` and `challenges.py:32-48` select the highest-ordinal stage of ANY event with status ready/live/closed/finalized; `deps.py:127-132` `require_rules_accepted` uses the latest event's rules version regardless of the participant's event; `submissions.py:104-119` correctly uses the caller's team event.
- **Impact:** With two concurrent events, participants of the earlier event see the wrong round clock/state and their submissions may be judged against the wrong stage (`ROUND_NOT_ACTIVE`); rules-acceptance gating can be evaluated against a foreign event's rules version.
- **Fix:** Resolve the caller's event from team membership first, then select that event's stage; scope `/state`, `/config`, assignments, and rules checks to it.

### F-S03B-10 — SUB-01: no filters, no reviewer reason codes, dispute window not time-bounded
- **Severity:** MEDIUM
- **Spec ref:** SUB-01; §10.4 dispute
- **Evidence:** `submissions.py:341-356` (no round/status filter params, `LIMIT 200`); `SubmissionDetail.tsx:53-66` (no reason code shown; dispute form gated only on `feedback_released`); `submissions.py:426-460` (dispute allowed indefinitely after release; no appeal-window end, no rate limit).
- **Impact:** History is unusable for large events; participants can dispute at any time post-release, outside the announced window; evaluation rationale (reason codes) never reaches participants.
- **Fix:** Add `round`/`status` query filters + pagination; store and return reviewer reason codes; enforce an appeal window (stage config) and rate limit disputes.

### F-S03B-11 — LBD-01: no own-row highlight/pin, search, pagination, provisional badge; live-mode constraints unenforced
- **Severity:** MEDIUM
- **Spec ref:** LBD-01; §10.7; §13.3
- **Evidence:** `frontend/src/pages/participant/Leaderboard.tsx:67-107` (plain table); `leaderboard.py:34-56` (no `live requires feedback_mode=hidden and delay>=600` check; `Cache-Control: private, no-store` from `main.py:89` instead of cacheable 10 s); no `leaderboard_version` event consumption (no SSE).
- **Impact:** Spec'd navigation and trust affordances missing; a misconfigured `live` mode would leak near-real-time ordering (anti-oracle control §13.3).
- **Fix:** Highlight/pin own team, add search + top-N pagination + provisional badge; validate live-mode preconditions at stage creation; set `Cache-Control: public/private, max-age=10` on the leaderboard response.

### F-S03B-12 — RES-01/RES-02: rank, per-challenge totals, bugs missed, certificate, public results all missing
- **Severity:** MEDIUM
- **Spec ref:** RES-01; RES-02
- **Evidence:** `leaderboard.py:65-125` (returns only component totals + ledger entries); `frontend/src/pages/participant/Results.tsx` (no rank/missed-bugs/PDF); `App.tsx:23-30` (no public results route); no signed export (`admin.py:1078-1172` is CSV, unsigned).
- **Impact:** Participants cannot see final rank or missed-bug summary; no public results artifact exists for the event record.
- **Fix:** Extend `/v1/results/{stage_id}` with rank + per-challenge + missed counts (after release) and an optional certificate/summary PDF; add admin-controlled public results page.

### F-S03B-13 — WS-04 field-rule deviations and missing affordances
- **Severity:** MEDIUM
- **Spec ref:** WS-04 (table + behavior)
- **Evidence:** `Workspace.tsx:359-361` (description min 20 vs spec 40); `submissions.py:66` evidence optional (Round-2-required not implemented); `submissions.py:48-60` `related_locations` accepted but no per-entry span check and no UI in this workspace (only the parallel levels flow, `levels.py:48`); no "Reports left for this file: N" display (`Workspace.tsx:809-817`); no overlapping-range duplicate note; no paste-length counter (INT-08).
- **Impact:** Weaker reports pass validation than the spec allows; participants lack cap-visibility and duplicate-area guidance; integrity paste signal never recorded.
- **Fix:** Align min-description to 40 (configurable), require evidence for round-2-style stages, validate per-entry span, surface remaining caps and an informational overlap note, count >500-char pastes (advisory telemetry).

### F-S03B-14 — Review queue: no matcher features/confidence, no automatic double review, decision possible without claim
- **Severity:** MEDIUM
- **Spec ref:** ADM-RV-01..04, ADM-RV-06
- **Evidence:** `review.py:28-62` (no confidence/SLA columns), `:66-100` claim, `:178-199` — decision only rejected when `status == "claimed" and claimed_by != p.id`; an `open` item can be decided without claiming; no automatic second review for high-severity/matcher disagreement; no keyboard flow/bulk accept (`ItemDetail.tsx:247-288`).
- **Impact:** Review quality controls (double review, SLA timers, independence) are weaker than specified; race-level duplication of review effort is possible.
- **Fix:** Require claim before decision server-side; add confidence/SLA columns; auto-create second review items for critical/high or matcher-disagreement cases; add keyboard shortcuts and bulk accept with confirmation.

### F-S03B-15 — Dispute resolution independence and participant notification unenforced
- **Severity:** MEDIUM
- **Spec ref:** ADM-DS-03; ADM-DS-04
- **Evidence:** `admin.py:1194-1258` — any organizer (including one who reviewed the submission) may resolve and apply arbitrary `adjust_points`; no check against original decision-makers; no notification path to the participant.
- **Impact:** A reviewer can unilaterally overturn and re-score their own decision; participants learn outcomes only by re-polling.
- **Fix:** Record decision-maker IDs on disputes and reject resolution by them; add an in-app/SSE notification on resolution.

### F-S03B-16 — Rescoring runs and finalization checklist missing
- **Severity:** MEDIUM
- **Spec ref:** ADM-RS-01..03; §12.2 RELEASED→FINAL
- **Evidence:** no `rescore` job kind (`jobs.py` handlers list; `evaluator.py` handlers); `admin.py:96-144` `closed→finalized` has no checklist; no released→final transition endpoint (`admin.py:279-288`).
- **Impact:** Ground-truth corrections cannot be replayed over existing submissions (spec AT-15/16 unmet); finalization can proceed with pending reviews/open disputes.
- **Fix:** Implement a `rescore` job that recomputes affected submissions with supersession ledger entries, an impact preview endpoint, and a finalization gate (pending reviews threshold, open disputes, chain verified, snapshot frozen).

### F-S03B-17 — Audit chain verification limited to `global` scope of the app DB; GT audit rows land in the separate GT database
- **Severity:** MEDIUM
- **Spec ref:** §10.10; ADM-GT-06; ADM-AU
- **Evidence:** `audit.py:69-77` `audit_verify` default `event_scope="global"` and `admin.py:1043-1047` passes no scope; `audit_write` is called with scopes like `event:…`, `review`, `scoring`, `challenge` (`admin.py:561,631,809,849,878,1246…`) that are never verified; ground-truth mutations audit into the GT engine (`admin.py:800-810` `audit_write(gts, …)`) while the viewer reads the app DB (`admin.py:1050-1075`).
- **Impact:** Most audit entries are outside chain verification; GT edits (the most sensitive actions) are invisible in the admin audit viewer; no nightly verification job or export-with-proof.
- **Fix:** Verify per-scope chains (iterate scopes) or use one global chain; replicate GT audit entries into the app DB audit stream (write-only); add a scheduled chain_verify job and export including chain proof.

### F-S03B-18 — Admin API not on separate host/audience; step-up is password re-entry; no idempotency keys on admin mutations
- **Severity:** MEDIUM
- **Spec ref:** §0 conventions; §10.9; ATH-06 (context)
- **Evidence:** `main.py:97-110` mounts admin routes on the same app/origin as participant routes; `deps.py:141-162` implements step-up as a recent password re-entry (`/v1/auth/step-up`, auth.py:470) with the Cloudflare Access + WebAuthn path documented as future work; no `Idempotency-Key` handling on any `/admin/*` POST (`admin.py`).
- **Impact:** A compromised participant-origin XSS or token can reach admin endpoints (role checks still apply); replayed admin state transitions are not deduplicated.
- **Fix:** Deploy the admin API under a separate origin/audience (or at minimum a separate router with origin allow-list), keep the documented MFA roadmap, and accept Idempotency-Key on stage/event transitions.

### F-S03B-19 — Notifications module absent (no email delivery of invites/reminders/results/disputes)
- **Severity:** MEDIUM
- **Spec ref:** §10.12; ADM-PT-02
- **Evidence:** `admin.py:476-511` returns the raw invite token in the console response ("email delivery is a deployment follow-up"); no `send_email` job kind; no reset/reminder/results/dispute email templates anywhere.
- **Impact:** Participants have no out-of-band channel for invites, password resets, schedule reminders, or dispute outcomes; operational risk if the console-exposed invite link is mishandled.
- **Fix:** Add a `send_email` job + templates, or formally document the console-distribution workaround for this deployment.

### F-S03B-20 — Matching/scoring model deviates from §13.2/§13.4
- **Severity:** MEDIUM
- **Spec ref:** §13.2 (rules 6-7); §13.4
- **Evidence:** `matching.py:188` `auto_full = L>=0.9 and C>=0.6 and alias_evidence>=0.2` — no "∨ round1" relaxation, so a bug without aliases can never auto-accept; group-coverage band E∈[0.34,0.66] unimplemented (`:189` partial = `L>=0.9 and C==0` only); points are component-weighted (`scoring.py:104-115`, `evaluator.py:147-168`) rather than `bug.points × quality` with 0.25 steps; Round-2 evidence bonus (+0.2) absent.
- **Impact:** Scoring outcomes differ from the published spec; auto-accept rate depends on alias authoring; participants cannot verify points against the documented formula.
- **Fix:** Either align the implementation with §13.2/13.4 or update the spec/scoring-model docs as the source of truth; at minimum allow round1-style auto-accept when aliases are defined as empty.

### F-S03B-21 — Leaderboard snapshots are event-driven only; no interval snapshot job; responses not cacheable
- **Severity:** MEDIUM
- **Spec ref:** §10.7
- **Evidence:** `refresh_leaderboard` runs only when enqueued from a submission or release (`submissions.py:296`, `admin.py:414-418`); no scheduler loop in `worker.py:29-52` for `snapshot_interval_s`; `leaderboard.py:21-62` sets no cache headers and middleware applies `private, no-store` (`main.py:89`).
- **Impact:** Frozen/live boards can lag or stall between events (no updates during quiet review periods); CDN/browser caching opportunities lost; `leaderboard_version` monotonicity exists but is not time-anchored.
- **Fix:** Add a periodic snapshot job in the worker honoring `snapshot_interval_s`; set `Cache-Control: max-age=10` on the leaderboard endpoint.

### F-S03B-22 — Admin console feature gaps (participants, challenges, GT tooling, analytics)
- **Severity:** MEDIUM
- **Spec ref:** ADM-PT-01/04/05; ADM-CH-03/06/07/08/09/10; ADM-GT-04/05/07; ADM-LV-07; ADM-AN; ADM-EX (background jobs/R2/expiry)
- **Evidence:** `admin.py` contains none of: CSV import, disqualify/reinstate/merge, seat assignment, admin file viewer, variant checks, watermark editor, preview mode, bundle sealing, GT revision/impact preview, GT test harness, incident log, analytics; `Challenges.tsx:38-376` is the only challenge UI (create/upload/freeze/publish/record tests); exports are synchronous inline CSV (`admin.py:1078-1172`).
- **Impact:** Organizers must run the event with a much thinner toolkit than specified; several safeguard workflows (two-person disqualification, variant equivalence, leak attribution) are impossible.
- **Fix:** Prioritize DQ-with-two-person-approval, GT test harness (dry-run matcher), and incident log; track the rest as de-scoped with owner sign-off.

### F-S03B-23 — Pause UX: no full-width banner, inputs remain editable
- **Severity:** MEDIUM
- **Spec ref:** WS-01 (pause clause); §12.2 PAUSED clock effects
- **Evidence:** `Workspace.tsx:471-472` (chip "Timer stopped" only), `:690-696` (notice text), `:810` (submit disabled when not active — the only input disabled; text fields stay editable); server correctly rejects with `ROUND_PAUSED` (`submissions.py:172-173`).
- **Impact:** Participants may keep typing into a form that will be rejected; the pause is less visible than specified (mitigated server-side).
- **Fix:** Render a full-width "Round paused" banner overlay and set the form `disabled` while `round.paused`.

### F-S03B-24 — Announcements are not scoped by event or audience
- **Severity:** LOW
- **Spec ref:** LB-05; ADM-LV-03; §10.6 `announcement` audience
- **Evidence:** `announcements.py:14-41` lists every announcement of every event to any authenticated principal; `admin.py:886-912` composer writes no audience; `announcements` table has `audience` column but nothing filters on it.
- **Impact:** Cross-event leakage of notices; participant-targeted announcements are broadcast to all.
- **Fix:** Filter by the caller's event and audience (all/round/participant) both on write and read.

### F-S03B-25 — 429s carry no Retry-After header; rate limiter is in-process
- **Severity:** LOW
- **Spec ref:** §15 (`AUTH_RATE_LIMITED` "Try again in {n} seconds"); §10.4 rule 4 (`Retry-After`); ATH-01
- **Evidence:** `deps.py:30-39` in-memory bucket per process (no shared store), raises `AUTH_RATE_LIMITED` with `details={"n": window_s}`; `errors.py:67-73` sets only `X-Request-Id`; `submissions.py:239` cooldown 429 includes `details.n` but no header.
- **Impact:** Multi-worker deployments multiply effective limits; clients must parse the body for retry timing.
- **Fix:** Add `Retry-After` (seconds) to 429 responses; move the bucket to Postgres/Redis (documented degradation acceptable).

### F-S03B-26 — Challenge version lifecycle collapsed (no REVIEWED/ARCHIVED states)
- **Severity:** LOW
- **Spec ref:** §12.4; ADM-CH-04
- **Evidence:** `admin.py:589-590` uploads allowed for `draft|reviewed` (REVIEWED never settable), `:668-673` freeze → `sealed`, `:704-705` publish requires `sealed`; no ARCHIVED transition.
- **Impact:** Process states the spec uses for review sign-off and archival cannot be represented.
- **Fix:** Add review/archived transitions or document the simplified lifecycle.

### F-S03B-27 — Round/event scheduling and timezone handling thinner than specified
- **Severity:** LOW
- **Spec ref:** ADM-EV-06; ADM-EV-01 (timezone); §1.6/§0 (event-timezone rendering)
- **Evidence:** `Dashboard.tsx` has no calendar/timeline; `admin.py:38-46` fixed `timezone: "Asia/Kolkata"` default with no editing; `frontend/src/lib/format.ts:3-48` hardcodes IST.
- **Impact:** T-minus milestones not visible to organizers; a non-IST event would render wrong times.
- **Fix:** Drive formatting from the event's timezone (pass through `/v1/config`); add a simple milestone timeline to live ops.

### F-S03B-28 — Missing terminal state transitions: stage RELEASED→FINAL and submission DISPUTED→RESOLVED
- **Severity:** LOW
- **Spec ref:** §12.2; §12.3
- **Evidence:** `admin.py:279-288` STAGE_TRANSITIONS has no `final` target; `submissions.py:448-449` sets `status='disputed'` and `admin.py:1218-1223` resolves the dispute row without updating the submission status.
- **Impact:** Lifecycle dead-ends; participant-visible status stays `disputed` forever after resolution.
- **Fix:** Add a `finalize` stage action (post-appeal-window) and set the submission to a resolved/decided state on dispute resolution.

### F-S03B-29 — NFR instrumentation gaps: no OpenAPI contract tests, no axe a11y CI, no metrics story
- **Severity:** LOW
- **Spec ref:** §16
- **Evidence:** backend tests are pytest flow tests only (`backend/tests/`); frontend has one payload test (`frontend/tests/submission_payload.test.mjs`); no axe/CI config in `frontend/package.json` scripts; observability limited to `X-Request-Id` (`main.py:86`).
- **Impact:** Maintainability and accessibility guarantees rely on manual effort.
- **Fix:** Add contract tests against the OpenAPI schema and an axe CI job; document the metrics/alerting story or link the deployment plan.

### F-S03B-30 — EXTRA: four-level participant flow replaces the Round 1/Round 2 model
- **Severity:** LOW (extra, notable)
- **Spec ref:** §5 (WS-09/WS-10); §12.2 round kinds
- **Evidence:** `backend/app/routers/levels.py` (1,188 lines: level stages, repo lock, gates, auto-submit at deadline), `backend/app/flow.py`, `backend/app/auto_submit.py`, `backend/app/routers/admin_levels.py`, migration `0003_four_level_flow.sql` — none of which exist in the spec, which specifies exactly two rounds.
- **Impact:** The delivered product pivots from rounds to levels with repo selection (challenge-app / challenge-app-option-B); the spec's round model is only partially honored (kind `main`/`level` vs `round1`/`round2`).
- **Fix:** Update the specification to describe the four-level flow (or note the divergence in REQUIREMENTS_RECONCILIATION) so audits and tests target the real product.

## Positive observations (no finding)

- Submission transaction (§10.4) is faithfully implemented: ordered checks, single DB clock (`submissions.py:157`), `FOR UPDATE` stage lock, idempotent replay with original receipt, `IDEMPOTENCY_CONFLICT` on payload mismatch, HMAC receipt (`security.py:118-124`), audit + outbox + evaluate job in one commit.
- Ground-truth isolation is real: separate engine/role (`db.py:40-44`), GT writes only via `gt_session`, CI test `test_gt_isolation.py`.
- Error envelope and catalog match §15 (`errors.py:16-80`), with `X-Request-Id` on every response (`main.py:64-92`).
- Append-only ledger with award-claim arbitration prevents double awards (AT-07) (`scoring.py:68-101`, migration `0002_score_ledger_immutable.sql`).
- Step-up enforcement for challenge/GT/repo-option mutations (`admin.py:543,568,651,749,822,855`; `admin_levels.py:47,144`) satisfies AT-24.

---

### 4.7 System Architecture, sections 0-6 - principles, topology, edge, frontend architecture, authn/authz (`archA`)

# Architecture compliance audit: Sections 0-6

- **Agent:** archA (Task ID 3-g)
- **Baseline document:** `/home/z/my-project/upload/Bug Hunt CTF — System Architecture.md` (revision v2.1, 2026-11-22)
- **Repo:** `/home/z/my-project/bug-hunt-hackathon` @ git HEAD `f1412b7eec6c92c4c168fd2b8a58182b34480387` (2026-11-26)
- **Scope:** §0 Conventions, §1 Design principles, §2 Targets (2.1 D1 / 2.2 D2), §3 Topology (3.1/3.2/3.3), §4 Edge/hostnames/routing, §5 Frontend (5.1-5.6), §6 AuthN/AuthZ (6.1-6.5)
- **Tier judgement:** The repo self-identifies as a D0/D1 v1 one-shot build ("runs locally today, is load-ready for a 50-participant rehearsal", README.md:9-11; `profile: d0-local | d1-free-vm; d2 is out of scope for v1`, backend/app/config.py:19). D2-only requirements are judged PLANNED/N-A unless claimed; the repo claims none.

## Per-section status table

| Spec ref | Requirement (short) | Status | Evidence (file:line) | Notes |
| --- | --- | --- | --- | --- |
| §0 | Profiles separated; D1 MUST NOT advertise D2 guarantees | DONE | backend/app/config.py:19-20; README.md:95-108; docs/DEPLOYMENT_RUNBOOK.md:128 | Honest profile marking; no D2/SLA claims anywhere |
| §1.1 | Correctness before availability; scores reproducible from immutable records | DONE | backend/migrations/0002_score_ledger_immutable.sql; backend/app/scoring.py; docs/DEPLOYMENT_RUNBOOK.md:121-126 | Corrections append reversal entries |
| §1.2 | Server owns time/state/truth; browser never decides | DONE | backend/app/routers/submissions.py:141-180; backend/app/routers/levels.py:926-941; frontend/src/pages/participant/Workspace.tsx:474-479 | `clock_timestamp()` after stage-row FOR UPDATE; client countdown is display-only |
| §1.3 | Ground truth separate trust domain; participant process has no GT credential | PARTIAL | backend/app/db.py:40-44; backend/app/routers/admin.py:759,825; scripts/dev_db.sh:118-121 | DB-role separation real and tested, but the one participant-facing API process also holds the gt_admin credential (F-ARA-01) |
| §1.4 | PostgreSQL only durable source of truth | DONE | backend/app/db.py:40-44; docs/SYSTEM_ARCHITECTURE.md:7 | No Redis/broker; jobs in `app.jobs` |
| §1.5 | At-least-once + idempotent effects | DONE | backend/app/jobs.py:41-64,128-149; backend/tests/test_idempotency.py | SKIP LOCKED + lease; handlers idempotent via unique constraints |
| §1.6 | Modular monolith before microservices | DONE | backend/app/main.py:97-110; backend/worker.py | One process + one worker; module split via routers/services |
| §1.7 | Kill switches for non-essential features | DONE | backend/app/config.py:50-53 (runner/ai/telemetry default False); docs/DEPLOYMENT_RUNBOOK.md:114-120 | Documented failure behavior |
| §1.8 | Capacity claims measured | DONE | docs/LOAD_TEST_REPORT.md:1-13,53-69 (all cells UNRUN, gate respected); backend seed readiness item `load_test_50` | 50-user claim honestly provisional |
| §1.9 | Secure defaults; no participant code execution in API env | DONE | backend/app/config.py:51-53; docs/DEPLOYMENT_RUNBOOK.md:33 (bind 127.0.0.1); backend/app/storage.py:1-8 | Runner disabled (ADR-010) |
| §1.10 | Tenant attribution from the start | PARTIAL | backend/migrations/0001_init.sql:53,64,367,490,505 | `tenants` + `tenant_id` on users/events/submissions/ledger; no RLS, not on every row (F-ARA-25) |
| §1.11 | Outbox for reliable side effects | DONE | backend/migrations/0001_init.sql:43; backend/app/routers/submissions.py:299-303; backend/app/evaluator.py:631-640 | Intent inserted in submission transaction; dispatch job at-least-once |
| §1.12 | Explicit versioned extension points; no third-party code in trusted process | DONE | backend/app/storage.py:3-7 (replaceable adapter); backend/app/config.py:51 | Policy interfaces documented |
| §2.1 | D1 targets: 50 cap after load test; p95 <=500/300ms; 5s propagation | PARTIAL | docs/LOAD_TEST_REPORT.md:3,53-63; scripts/load_test.py | Targets defined, tool ready, measurements UNRUN (honestly marked); tool measures API only, no e2e latency split (F-ARA-02) |
| §2.2 | D2 targets | N-A | backend/app/config.py:19 ("d2 is out of scope for v1") | Repo does not claim D2; no D2 guarantee advertising found |
| §3.1 | D1 topology: Pages, Tunnel, proxy, separate participant/admin API processes + DB roles | PARTIAL | docs/DEPLOYMENT_RUNBOOK.md:8,56,63-64; backend/app/main.py:97-110 | No deployment artifacts at all; single combined API process (F-ARA-01, F-ARA-03) |
| §3.2 | D2 topology / synchronous standby | N-A | backend/app/config.py:19 | Not claimed |
| §3.3 | Component inventory (frontend stack, proxy, API, admin API, DB, queue, evaluator, storage, realtime, sandbox) | PARTIAL | frontend/package.json:13-32; backend/app/jobs.py; backend/worker.py:1; backend/app/storage.py:23-27; docs/DEPLOYMENT_RUNBOOK.md:63 | Stack matches for code components; proxy/edge/storage are plans; roles deviate (F-ARA-04, F-ARA-05) |
| §4.1 | Hostnames; host-only refresh cookie; HTTPS | PARTIAL | backend/app/routers/auth.py:32-46 (path-scoped, domain=None); docs/DEPLOYMENT_RUNBOOK.md:73-79 | Cookie policy DONE; separate hostnames/Access not built (single-hostname plan documented) |
| §4.2 | Request path SPA -> edge -> proxy -> FastAPI | PARTIAL | backend/app/main.py:64-92 | App-level pipeline DONE; edge/proxy layers absent (F-ARA-03) |
| §4.3 | Tunnel/origin policy; no inbound ports; private SSH | PARTIAL | docs/DEPLOYMENT_RUNBOOK.md:60,63-64 | Procedure documented; no cloudflared/Caddy artifacts committed |
| §4.4 | WAF tuning; identity limits after auth; caps in PG; uploads admin-only; no-store default; CSP/HSTS/XCTO/Referrer/Permissions-Policy | PARTIAL | backend/app/routers/submissions.py:101,205-239 (caps transactional); backend/app/routers/admin.py:568 (admin upload, step-up); backend/app/main.py:86-91 | Caps/uploads/cache headers DONE; WAF config absent; CSP/HSTS/Permissions-Policy missing (F-ARA-06); body-limit gap (F-ARA-07); per-process limiter (F-ARA-08) |
| §5.1 | Separate participant/admin builds; participant output free of admin screens | PARTIAL | frontend/src/App.tsx:16-19,70-82 | One SPA bundle statically imports admin pages (F-ARA-09); no GT/secrets in bundle (verified none) |
| §5.2 | State ownership; IndexedDB draft buffer; 4-state UI contract | PARTIAL | frontend/package.json:18 (TanStack Query); frontend/src/pages/participant/Workspace.tsx:187-239 (server draft autosave) | No IndexedDB anywhere in frontend/src (F-ARA-10) |
| §5.3 | OpenAPI-generated client in CI; runtime schemas; X-Request-Id/X-Min-Client-Version; retry policy | PARTIAL | backend/app/main.py:83,86 (X-Request-Id); frontend/src/lib/api.ts:116-147 (retry only on 401 with same idem key); .github/workflows/ci.yml (no generation step) | Hand-written client/types; no runtime validation; no X-Min-Client-Version (F-ARA-11, F-ARA-16) |
| §5.4 | GET /v1/time; server-side acceptance; clock_timestamp once; uniform half-open interval | DONE | backend/app/routers/state.py:21-25; backend/app/routers/submissions.py:157,179; backend/app/routers/levels.py:928,940; frontend/src/pages/Landing.tsx:11-26 | Same comparison applied on both paths; client offset single-sample (F-ARA-12, display-only) |
| §5.5 | D1 polling ~5s in round, 30s outside; SSE only later | DONE | frontend/src/pages/participant/Lobby.tsx:21,36,46; Workspace.tsx:114-118; README.md:104-105 | Fixed 5s regardless of round status (F-ARA-13) |
| §5.6 | Monaco read-only self-hosted; dispose models; precomputed indexes; server-side bounded rate-limited search | PARTIAL | frontend/src/pages/participant/Workspace.tsx:608-646 (bespoke read-only viewer); backend/migrations/0001_init.sql (challenge_file_lines index); backend/app/routers/challenges.py:146-166 | No Monaco dependency at all (F-ARA-14); search bounded + rate-limited but not paginated (F-ARA-15) |
| §6.1 | Access token JWT (EdDSA, kid), in-memory only; opaque refresh cookie HttpOnly/Secure/Strict/host-only/path-scoped; hash + family metadata in PG; CSRF defenses; Argon2id | PARTIAL | backend/app/security.py:27,74-112; backend/app/routers/auth.py:29-46; frontend/src/lib/api.ts:44-52; backend/app/deps.py:170-177 | All cookie/CSRF/storage requirements met; HS256 not EdDSA (F-ARA-18), no kid (F-ARA-19), no explicit hashing semaphore (F-ARA-20); passwordless-login takeover (F-ARA-17) |
| §6.2 | Web Locks refresh serialization; rotation idempotency; reuse outside window revokes family | PARTIAL | backend/app/routers/auth.py:250-345 (encrypted successor + 10s grace + family revocation); frontend/src/lib/api.ts:60-89 (per-tab single-flight only) | Server side solid; no Web Locks/BroadcastChannel (F-ARA-21); successor key derived from JWT secret (F-ARA-22) |
| §6.3 | PG authoritative revocation; fail closed without Redis | DONE | backend/app/deps.py:65-88 (per-request session + token_version check); no Redis in stack | Revocation is immediate (better than TTL window) |
| §6.4 | Cloudflare Access + MFA + TOTP/WebAuthn; distinct admin audience; 5-min step-up; no service tokens in browser; participant API cannot reach admin API | PARTIAL | backend/app/security.py:81 (distinct aud); backend/app/deps.py:141-162 (password step-up, 5 min); backend/app/routers/admin.py:543,651,749,822,855 (GT ops step-up); frontend: no VITE_ vars (grep empty) | No Access/MFA (F-ARA-23); non-GT sensitive ops skip step-up (F-ARA-24); single process = no network separation (F-ARA-01) |
| §6.5 | RBAC + object/tenant ownership from server context; RLS defense in depth | PARTIAL | backend/app/deps.py:55-118; backend/app/routers/submissions.py:105-119 (identity from token); backend/tests/test_authorization.py | Identity never from body; no RLS policies anywhere (F-ARA-25) |

## Findings

### F-ARA-01 — HIGH — Single participant-facing API process holds the ground-truth DB credential
- **Severity:** HIGH
- **Evidence:** backend/app/main.py:20-32,97-110 (one FastAPI app mounts participant AND admin routers); backend/app/db.py:40-44 (`app_engine` + `gt_engine` in the same process); backend/app/routers/admin.py:759,825 (`gt_session()` used inside API-process routes); backend/app/config.py:24-26; docs/DEPLOYMENT_RUNBOOK.md:64 admits "split process pair is the hardening follow-up".
- **Impact:** Violates design principle 3 ("Participant-facing processes have no database credential ... that can read the competition answer key") and the §3.1/§6.4 process split. Any RCE or severe injection on a *participant* endpoint hands over a live `gt_admin` connection string (answer key + flags) and the write path into `gt`. The app_api role itself stays GT-blind (good), but the process does not.
- **Fix:** Split the admin/GT routers into a second FastAPI process (own container, own DB role `admin_api`, own hostname behind Cloudflare Access); give the participant process only `app_api` and give the worker a read-only `evaluator` GT role.

### F-ARA-02 — LOW — Load-test tool measures API only; no server-side vs end-to-end latency split
- **Severity:** LOW
- **Evidence:** docs/LOAD_TEST_REPORT.md:22 ("It measures the API only; it does not measure worker lag directly"), no browser-path measurement in scripts/load_test.py objectives (docs/LOAD_TEST_REPORT.md:5-13).
- **Impact:** §2.1 requires reporting server-side and end-to-end latency separately; the D1 gate will be evaluated without the required split.
- **Fix:** Add a browser-driven (or edge-included) probe phase for e2e numbers alongside the API probe before the rehearsal.

### F-ARA-03 — MEDIUM — D1 deployment artifacts do not exist (no compose, Caddy, cloudflared, Pages, systemd)
- **Severity:** MEDIUM
- **Evidence:** docs/DEPLOYMENT_RUNBOOK.md:8 ("D1 ... has NO deployment artifacts in this repo yet (no Dockerfile, compose file, cloudflared config or systemd units)"), :56 ("NOT built yet"), :63 (compose layout "to be authored"); repo tree contains none of these files.
- **Impact:** §3.1/§4.1-4.4 topology (Pages, Tunnel, reverse proxy, TLS, WAF, hostnames) is prose only while the repo claims D1 load-readiness; the rehearsal and event depend on unbuilt infrastructure.
- **Fix:** Author and end-to-end test the compose stack (postgres, api, worker, caddy, cloudflared), Caddy security headers/limits, and the Pages/Tunnel routing before the rehearsal date; commit them to the repo.

### F-ARA-04 — MEDIUM — DB role model deviates from the process-role table (no admin_api / read-only evaluator; gt_admin over-privileged)
- **Severity:** MEDIUM
- **Evidence:** scripts/dev_db.sh:98-131 (only `app_api`, `gt_admin`, `scheduler`; `GRANT ALL ... IN SCHEMA app TO ... gt_admin` at :116; `INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA gt TO gt_admin` at :121); backend/worker.py:34,46 (worker runs on `app_session` = app_api, plus gt_admin engine via evaluator).
- **Impact:** §3.1 assigns distinct `app_api`/`admin_api`/`evaluator` roles; here the worker/evaluator connection can also mutate ground truth and has full app-schema rights, so an evaluator bug can rewrite the answer key. The `scheduler` role is created but unused.
- **Fix:** Add an `evaluator` role with SELECT-only on `gt` and the specific app tables it writes; a dedicated `admin_api` role for the admin process (see F-ARA-01); drop gt_admin's blanket app-schema ALL.

### F-ARA-05 — LOW — Object storage is a local directory, not a private bucket (D1 inventory)
- **Severity:** LOW
- **Evidence:** backend/app/storage.py:23-27 (default `<repo>/data/artifacts`); backend/app/config.py:48; docs/SYSTEM_ARCHITECTURE.md:7 ("no ... object storage ... in v1").
- **Impact:** §3.3 lists R2-or-equivalent private bucket for challenge blobs/exports/backups; D1 artifacts live on the single VM disk and share its failure domain.
- **Fix:** Implement the promised storage adapter backend for R2/S3-compatible storage as part of the D1 artifacts (F-ARA-03) before the event.

### F-ARA-06 — MEDIUM — CSP, HSTS and Permissions-Policy are not deployed anywhere
- **Severity:** MEDIUM
- **Evidence:** backend/app/main.py:86-91 (only `X-Content-Type-Options`, `Referrer-Policy`, `Cache-Control`); frontend/index.html:1-18 (no CSP meta tag); no proxy config exists to add them (F-ARA-03).
- **Impact:** §4.4 explicitly requires CSP, HSTS, X-Content-Type-Options, Referrer-Policy and Permissions-Policy "deployed and tested". The SPA renders participant-submitted text; without CSP an XSS has no secondary containment.
- **Fix:** Ship a strict CSP (default-src 'self') plus HSTS and Permissions-Policy from Caddy (and a `<meta http-equiv>` fallback), and add a CI check asserting the headers on a built stack.

### F-ARA-07 — LOW — Body-size limit trusts Content-Length only; malformed value crashes with 500
- **Severity:** LOW
- **Evidence:** backend/app/main.py:71-84 (`cl = request.headers.get("content-length")`; `int(cl) > limit` without try/except; chunked requests without the header skip the check).
- **Impact:** §4.4/§7.3 request limits are enforced on a client-controlled header; a non-numeric Content-Length produces an unhandled 500 (stable envelope still returned) and chunked uploads bypass the pre-check.
- **Fix:** Parse defensively (reject malformed values with 400) and enforce the cap while streaming the body.

### F-ARA-08 — LOW — In-process rate limiter resets on restart and multiplies per worker
- **Severity:** LOW
- **Evidence:** backend/app/deps.py:27-39 (`defaultdict(list)` in-process bucket).
- **Impact:** §3.3 allows "conservative in-process controls" for D1, but the login/refresh/search limits silently scale by worker count if uvicorn is run with >1 worker, and are lost on restart/redeploy.
- **Fix:** Document the single-worker D1 constraint or move identity limits into PostgreSQL (already the authority for submission caps).

### F-ARA-09 — MEDIUM — Participant SPA bundle statically includes admin and reviewer screens
- **Severity:** MEDIUM
- **Evidence:** frontend/src/App.tsx:16-19 (static `import AdminDashboard ... AdminChallenges`), :70-82; no lazy/dynamic imports or separate entry points anywhere in frontend/src.
- **Impact:** §5.1: "The participant output MUST NOT contain admin screens ... or evaluator implementation details." Every participant downloads admin UI code and route shapes (data stays server-side, but the MUST is violated and future leaks become easy).
- **Fix:** `React.lazy()` the reviewer/admin route groups (code splitting) or split participant/admin apps into separate builds with a shared package, per §5.1's layout.

### F-ARA-10 — MEDIUM — No IndexedDB draft buffer / unsent queue; 4-state UI contract unmet
- **Severity:** MEDIUM
- **Evidence:** grep across frontend/src finds no IndexedDB/localStorage usage; frontend/src/pages/participant/Workspace.tsx:187-239 (3-second server autosave is the only buffer).
- **Impact:** §5.2 mandates the UI distinguish "draft saved locally / draft saved remotely / submission queued locally / submission acknowledged by server". Only the remote-draft and acknowledged states exist; edits inside the 3 s autosave window are lost on crash/refresh, and offline work is impossible.
- **Fix:** Mirror the form to IndexedDB between autosaves (best-effort, per spec), and render all four states in the workspace UI.

### F-ARA-11 — MEDIUM — API client is hand-written; no OpenAPI generation, no runtime schema validation, no X-Min-Client-Version
- **Severity:** MEDIUM
- **Evidence:** frontend/src/lib/api.ts:116-181 (manual fetch wrapper); frontend/src/lib/types.ts (hand-written types); .github/workflows/ci.yml:216-241 (frontend job has no generation/staleness check); backend/app/main.py:83,86 (X-Request-Id only).
- **Impact:** §5.3 requires generating the TypeScript client from FastAPI OpenAPI in CI and failing on stale output, runtime validation at critical boundaries, and X-Min-Client-Version plus timing metadata. Contract drift between backend and frontend will be invisible until event day.
- **Fix:** Add an `openapi-typescript` generation step with a diff check to CI; validate critical boundaries (state, receipt, results) with a runtime schema; emit X-Min-Client-Version from the API.

### F-ARA-12 — LOW — Clock offset from a single sample, not lowest-RTT multi-sample
- **Severity:** LOW
- **Evidence:** frontend/src/lib/format.ts:72-74 (`new Date(serverIso).getTime() - Date.now()`); frontend/src/pages/Landing.tsx:11-19.
- **Impact:** §5.4 specifies multi-sample lowest-RTT offset estimation; a single sample can be skewed by a slow poll (display-only impact; acceptance is server-side).
- **Fix:** Take 3-5 `/v1/time` samples and keep the lowest-RTT offset.

### F-ARA-13 — LOW — /state polls at a fixed 5 s even outside an active round
- **Severity:** LOW
- **Evidence:** frontend/src/pages/participant/Lobby.tsx:21,36; frontend/src/pages/participant/Workspace.tsx:114-118 (constant `refetchInterval: 5_000`).
- **Impact:** §5.5 prescribes ~5 s during an active round and 30 s outside; 50 idle participants generate unnecessary steady load.
- **Fix:** Derive the interval from `round.status` (30 s when not active/paused).

### F-ARA-14 — LOW — Code viewer is bespoke, not the specified Monaco editor
- **Severity:** LOW
- **Evidence:** frontend/package.json:13-32 (no monaco dependency); frontend/src/pages/participant/Workspace.tsx:608-646 (custom read-only line viewer).
- **Impact:** §5.6 names Monaco (read-only, self-hosted, lazy-loaded, language workers). The bespoke viewer is read-only and lightweight, so the security intent holds, but the named component and its requirements (model disposal, worker policy) are unimplemented.
- **Fix:** Accept as a documented substitution or integrate self-hosted Monaco with the explicit worker CSP policy.

### F-ARA-15 — LOW — Repository search is bounded but not paginated
- **Severity:** LOW
- **Evidence:** backend/app/routers/challenges.py:146-166 (`LIMIT 50`, no offset/cursor; rate-limited 30/min).
- **Impact:** §5.6 requires server-side, paginated, bounded, rate-limited search; results past 50 are silently hidden.
- **Fix:** Add cursor pagination with an explicit has-more indicator.

### F-ARA-16 — MEDIUM — Client discards the idempotency key on submit failure, defeating lost-response recovery
- **Severity:** MEDIUM
- **Evidence:** frontend/src/pages/participant/Workspace.tsx:404-419 (submitReport catch clears `idemKey.current` for every ApiRequestError, including `code === 'NETWORK'`), :445-454 (same for flags).
- **Impact:** §5.3 ("Retry mutations only when they carry a stable idempotency key") and §8.1's response-loss recovery assume the same key survives retries. After a response lost post-commit, the retry carries a NEW key and creates a duplicate submission (double quota consumption, duplicate review items).
- **Fix:** Keep the generated key on network/timeout/5xx errors and reuse it until a receipt or a definitive 4xx arrives; clear it only on success/validation rejection.

### F-ARA-17 — HIGH — Login allows takeover of any account with a NULL password hash
- **Severity:** HIGH
- **Evidence:** backend/app/routers/auth.py:70-86 (registered-but-passwordless account: "the password typed now becomes the password"; comment "this is a risk we are willing to take for this event").
- **Impact:** Any account provisioned without a password (any future import path; the flow exists today) can be claimed by anyone who knows its email, bypassing the invite/activation flow that §6.1 assumes. Pre-event, this is a silent account-takeover primitive against participants/staff alike.
- **Fix:** Reject passwordless accounts at login with the generic credentials error and require activation via the invite token (`/auth/activate` already sets a password).

### F-ARA-18 — MEDIUM — Access tokens use HS256 instead of the specified EdDSA/Ed25519
- **Severity:** MEDIUM
- **Evidence:** backend/app/config.py:33 (`jwt_algorithm: "HS256" ... EdDSA/Ed25519 is a P1 follow-up`); backend/app/security.py:93-112.
- **Impact:** §6.1 specifies EdDSA/Ed25519 with algorithm pinning. HS256 is pinned and verified (no alg confusion), but the shared symmetric secret signs every token, hashes flags, receipts, IPs and derives the successor-encryption key, concentrating key material.
- **Fix:** Add a key-file setting and Ed25519 signing with `kid` before the public event; keep the algorithm allow-list pinned.

### F-ARA-19 — LOW — No `kid` claim in access tokens
- **Severity:** LOW
- **Evidence:** backend/app/security.py:79-92 (claims include iss/aud/sub/sid/role/tv/iat/nbf/exp/jti but no kid).
- **Impact:** §6.1 lists `kid`; no key-rotation story exists for the pinned-algorithm scheme.
- **Fix:** Include kid when Ed25519 key management lands (F-ARA-18).

### F-ARA-20 — LOW — Argon2id hashing not explicitly bounded by a semaphore/thread pool
- **Severity:** LOW
- **Evidence:** backend/app/security.py:27; calls at backend/app/routers/auth.py:81,213,413,478,549 (direct calls in sync handlers; only FastAPI's default 40-thread pool bounds them).
- **Impact:** §6.1: "Hashing is bounded by a semaphore/thread pool." A login flood can occupy the entire shared threadpool and stall every sync endpoint.
- **Fix:** Wrap hash/verify in a bounded executor (e.g. anyio CapacityLimiter) and fail with AUTH_RATE_LIMITED when saturated.

### F-ARA-21 — MEDIUM — No Web Locks / BroadcastChannel serialization of refresh across tabs
- **Severity:** MEDIUM
- **Evidence:** frontend/src/lib/api.ts:60-89 (single-flight promise per tab only); grep finds no `navigator.locks` or `BroadcastChannel` in frontend/src.
- **Impact:** §6.2 requires Web Locks (BroadcastChannel fallback) so parallel tabs do not race the rotation. Two tabs refreshing outside the 10 s grace window force family revocation and log every tab out (availability impact; the server-side grace/revocation logic itself is correct).
- **Fix:** Wrap `performRefresh` in `navigator.locks.request('bhctf-refresh', ...)` with a BroadcastChannel fallback, and have follower tabs reuse the winner's token.

### F-ARA-22 — LOW — Refresh-successor encryption key is derived from the JWT secret
- **Severity:** LOW
- **Evidence:** backend/app/security.py:29 (`Fernet(sha256(settings.jwt_secret))`).
- **Impact:** §6.2 requires protecting the envelope-encryption key; deriving it from the signing secret means one leaked value compromises both token forgery and rotation-idempotency confidentiality.
- **Fix:** Separate `REFRESH_ENCRYPTION_KEY` setting (rotatable independently of JWT_SECRET).

### F-ARA-23 — HIGH — Admin plane has no MFA and no Cloudflare Access; step-up is password re-entry only
- **Severity:** HIGH
- **Evidence:** backend/app/deps.py:141-162 ("In v1 without MFA infrastructure, step-up is implemented as a re-entered password"); README.md:105-106; docs/DEPLOYMENT_RUNBOOK.md (no Access setup step beyond the unwritten D1 section); frontend/src/components/StepUp.tsx:25-42.
- **Impact:** §6.4 mandates interactive Cloudflare Access identity + MFA plus application TOTP/WebAuthn for the admin plane. Today a single phished organizer/admin password yields full event control (publish GT, adjust scores, revoke participants). WebAuthn is documented as the future path but is absent.
- **Fix:** Put the admin SPA/routes behind Cloudflare Access with MFA for the event, and require TOTP at step-up as the minimum application-side factor.

### F-ARA-24 — MEDIUM — Sensitive organizer operations skip step-up entirely
- **Severity:** MEDIUM
- **Evidence:** backend/app/routers/admin.py:292 (`control_stage`), :398 (`release_results`), :916 (`time_adjustment`), :1262 (`manual_adjustment` ledger correction) all use `require_organizer`/`require_admin` without `step_up_verified`, while GT ops (:543,651,749,822,855) do require it.
- **Impact:** §6.4: "Sensitive operations require step-up authentication within the previous five minutes." A stolen organizer token (10-min TTL) can end rounds, publish verdicts and append ledger corrections with no fresh confirmation.
- **Fix:** Apply `step_up_verified` to stage control, release, time adjustments and manual ledger adjustments.

### F-ARA-25 — LOW — No PostgreSQL RLS as defense in depth
- **Severity:** LOW
- **Evidence:** backend/migrations/*.sql contain no `ROW LEVEL SECURITY`/`CREATE POLICY` (grep empty); scripts/dev_db.sh:93-132 grants only.
- **Impact:** §6.5 lists RLS as defense in depth under the app-layer checks (which exist and are tested in backend/tests/test_authorization.py). A SQL-injection-style mistake in a query loses the object-ownership backstop.
- **Fix:** Add RLS policies keyed to an application-set session variable for participant-facing tables in the D1 hardening pass, keeping the app-layer checks.

## Positive verification highlights (no finding)

- Refresh cookie: HttpOnly, Secure in production, SameSite=Strict, host-only, path-scoped to `/v1/auth/refresh` (backend/app/routers/auth.py:32-46; config.py:37).
- CSRF on refresh: exact Origin allow-list + required custom header (backend/app/deps.py:170-177); CORS exact origins, no wildcards (backend/app/main.py:54-62).
- Access token in JS memory only, never storage (frontend/src/lib/api.ts:44-52).
- Session/token_version revocation checked against PostgreSQL on every request (backend/app/deps.py:65-88).
- Submission acceptance: stage-row lock, single `clock_timestamp()` read, uniform boundary check on both submission paths (backend/app/routers/submissions.py:141-180; levels.py:926-941).
- Caps/cooldowns enforced transactionally in PostgreSQL (submissions.py:205-239); identity never from the body (deps.py:3-5, submissions.py:105-119).
- GT isolation actually tested with the real app_api role (backend/tests/test_gt_isolation.py; dev_db.sh:9-10).
- Kill switches and honest UNRUN load-test gating (config.py:50-53; docs/LOAD_TEST_REPORT.md:3).
- CI includes secret scan, pip-audit/npm audit, role-accurate integration tests, e2e journey (.github/workflows/ci.yml).

## Totals

- Findings: 25 (HIGH 3, MEDIUM 10, LOW 12, CRITICAL 0)
- Status counts across audited requirements: DONE 16, PARTIAL 16, DEVIATION 0 (deviations are captured as PARTIAL rows + findings), MISSING 0 (standalone-missing rows; IndexedDB/Web-Locks/MFA absences are folded into PARTIAL rows), N-A (D2) 2.

---

### 4.8 System Architecture, sections 7-end - backend, data, realtime, challenge apps, ops (`archB`)

# Audit Report — archB (Task ID 3-h)

- **Agent**: archB (architecture audit, backend/data/jobs/scoring/deployment)
- **Baseline doc**: `/home/z/my-project/upload/Bug Hunt CTF — System Architecture.md`
- **Sections covered**: §7 (backend architecture) → §21 (end of document)
- **Repo HEAD**: `f1412b7eec6c92c4c168fd2b8a58182b34480387` (2026-11-26)
- **Repo self-identification**: D0/D1 (README.md: "v1 one-shot build … runs locally today"); D2-only items rated N-A.
- **Method**: every Status/Evidence below was verified by reading actual code/config (not file names) at the cited `file:line`.

## Status table

| Spec ref | Requirement (short) | Status | Evidence (file:line) | Notes |
| --- | --- | --- | --- | --- |
| §7.1 | Modular monolith module tree | DEVIATION | backend/app/ (flat: evaluator.py, scoring.py, jobs.py, db.py, …) | All domains exist as flat modules; no `core/`, `tenancy/`, `realtime/` etc. |
| §7.1 | Enforce module import boundaries in CI | MISSING | .github/workflows/ci.yml (no boundary check) | |
| §7.2 | Separate process roles/DB credentials | DEVIATION | backend/app/db.py:40-44; backend/app/main.py:97-110; backend/app/routers/admin.py:759,825 | One API process serves participant+admin; gt_admin creds live in the API process |
| §7.2 | worker-evaluator = read-only ground truth | DEVIATION | scripts/dev_db.sh:120-121 | gt_admin granted INSERT/UPDATE/DELETE on gt (code only SELECTs) |
| §7.3 | Request pipeline (ID, limits, authn, authz, quota, validate, tx, audit, envelope) | DONE | backend/app/main.py:64-95; backend/app/deps.py:33-39,55-88; backend/app/routers/submissions.py:104-325; backend/app/errors.py | Request timeout not enforced (F-ARB-20) |
| §8.1 | Identity from token, never body | DONE | backend/app/routers/submissions.py:104-119, 254-257 | challenge_id re-resolved from assignment |
| §8.1 | Idempotency key + payload hash + replay receipt / 409 | PARTIAL | backend/app/routers/submissions.py:124-139, 263-294; backend/migrations/0001_init.sql:391 | SELECT-then-INSERT race → 500 (F-ARB-05) |
| §8.1 | Lock round-state row, then one clock_timestamp() | DONE | backend/app/routers/submissions.py:141-157 | ADR-012 honored |
| §8.1 | Validate state, eligibility, assignment, deadline/grace, file, schema | DONE | backend/app/routers/submissions.py:159-204 | |
| §8.1 | Per-participant caps/cooldown race-safe | DONE | backend/app/routers/submissions.py:206-239 | Serialized via stage FOR UPDATE; flag kind bypasses caps (F-ARB-18) |
| §8.1 | Atomic submission+job+audit+outbox; 202 + receipt | DONE | backend/app/routers/submissions.py:259-325 | |
| §8.2 | FOR UPDATE SKIP LOCKED claim + lease + attempts + backoff + dead | DONE | backend/app/jobs.py:41-111 | RETRY_BACKOFF_S=[10,60,300,900] |
| §8.2 | Commit claim before work; no locks during work | DONE | backend/app/jobs.py:128-149 | |
| §8.2 | Lease renewal for long jobs; dead-letter alerting | PARTIAL | backend/app/jobs.py:41-59; backend/app/routers/admin.py:962-988 | Fixed 120s lease; dead letters only in admin health view |
| §8.2 | Job inserted in submission transaction | DONE | backend/app/routers/submissions.py:295-296 | |
| §8.3 | Ledger immutable; corrections = reversal entries | DONE | backend/migrations/0002_score_ledger_immutable.sql:3-16; backend/app/scoring.py:30-65 | Trigger blocks UPDATE/DELETE |
| §8.3 | Unique evaluation identity (submission, evaluator_version, rule_set_hash) | MISSING | rg evaluator_version → no matches in backend/ | No evaluations table; version never recorded (F-ARB-09) |
| §9.1 | tenant_id on rows; cross-tenant denial tested | DONE | backend/migrations/0001_init.sql (tenant FKs); backend/tests/test_authorization.py | |
| §9.2 | Logical schemas app/gt/audit with distinct roles | PARTIAL | scripts/dev_db.sh:100-131; backend/tests/test_gt_isolation.py | practice schema absent (F-ARB-21) |
| §9.2 | Participant API holds no gt credentials/route | DEVIATION | backend/app/db.py:40-44; backend/app/main.py:107; backend/app/routers/admin.py:759 | F-ARB-03 |
| §9.3 | Core tables; UUIDv7; cursor pagination | PARTIAL | backend/migrations/0001_init.sql; backend/app/db.py:81-88; backend/app/routers/submissions.py:350 | No evaluations/event_stream/webhook tables; LIMIT-based lists |
| §9.4 | DB invariants (idem, award, frozen config, append-only) | PARTIAL | 0001_init.sql:391,436; backend/app/routers/admin.py:160-199; submissions.py:192 | "Published cannot be edited" not DB-enforced |
| §9.5 | Audit hash chain appended in same transaction | PARTIAL | backend/app/audit.py:20-66 | Chain head read unlocked → fork risk (F-ARB-06) |
| §9.5 | Signed external audit checkpoints at interval | MISSING | backend/app/audit.py:1-7 (docstring only; no code) | F-ARB-07 |
| §9.6 | D1: no PgBouncer; bounded pools | DONE | backend/app/db.py:29-37; backend/app/config.py | |
| §10.1 | Challenge lifecycle DRAFT→…→PUBLISHED→ARCHIVED | PARTIAL | 0001_init.sql:67 (free VARCHAR); admin.py:670 (sealed); submissions.py:192 (published) | No REVIEWED/FROZEN/ARCHIVED transitions or CHECKs (F-ARB-10) |
| §10.2 | ObjectStore adapter, content-addressed, private | PARTIAL | backend/app/storage.py:23-54 | Local-FS adapter (D0); swappable interface; no object storage/sign URLs |
| §10.3 | Encrypted Round-1 bundle + post-T0 key release | MISSING | no AES-GCM/bundle code in backend/ | Superseded by 4-level flow (F-ARB-13) |
| §10.4 | Round-2 repo delivery + watermark + source map | MISSING | backend/migrations/0003_four_level_flow.sql:17-41 | Repo-choice model, no watermarking |
| §10.5 | Upload safety (traversal/symlink/bomb/limits, inert storage) | DONE | backend/app/storage.py:57-91; backend/tests/test_flow_uploads.py:44-109 | Never extracted in API process |
| §11.1 | Pipeline states; only objective structural auto-reject | DONE | backend/app/matching.py:139-142, 171-199; backend/app/evaluator.py:196-208 | |
| §11.2 | Deterministic, explainable, replayable matcher | DONE | backend/app/matching.py:121-199; evaluator.py note fields | |
| §11.2 | Auto-accept disabled by default (99% gate) | DEVIATION | backend/app/matching.py:188-196; backend/app/evaluator.py:136-180 | F-ARB-08 |
| §11.3 | One award per canonical unit; dedupe; partial credit | DONE | backend/app/scoring.py:68-101; backend/app/evaluator.py:136-208, 259-316 | Scope is team, not participant (F-ARB-14) |
| §11.4 | Penalties capped, applied at release; rules gate | DONE | backend/app/evaluator.py:530-559; backend/app/deps.py:121-138 | Claimed severity informational |
| §11.5 | Organizer console: queue age, backlog, capacity | PARTIAL | backend/app/routers/admin.py:962-988 | No reviewer-hours calc/SLA forecast |
| §12.1 | D1: polling, PG jobs, no Redis | DONE | backend/app/routers/state.py:1-60; frontend/src/pages/* (setInterval); backend/app/jobs.py | |
| §12.3 | Outbox write in tx + separate dispatcher delivers | PARTIAL | backend/app/routers/submissions.py:299-303; backend/app/evaluator.py:631-644 | Dispatcher handler exists but is never invoked and delivers nothing (F-ARB-01) |
| §13.2 | D1 host layout (compose, caddy, cloudflared) | MISSING | no docker-compose/Dockerfile in repo; scripts/run_dev.sh only | F-ARB-11 |
| §13.3 | ARM64 images built/tested in CI | MISSING | .github/workflows/ci.yml (ubuntu-latest x86 only) | |
| §17.1-17.2 | Backups + WAL archiving + restore drills | MISSING | docs/BACKUP_AND_RECOVERY.md:37 ("NO automated backup job, no WAL archiving") | Manual pg_dump only (F-ARB-02) |
| §18.1 | Required signals (latency, queue age, DB, host) | PARTIAL | backend/app/main.py:112-118; backend/app/routers/admin.py:962-988 | No metrics/percentiles/external uptime |
| §18.2 | Load test through real edge path; D1 gates | PARTIAL | scripts/load_test.py; scripts/e2e_journey.py; ci.yml:129-213 | Local path only; not through Cloudflare/Tunnel |
| §19.2 | Argon2id, JWT, rotation, RBAC/IDOR tests, cookie/CORS limits | DONE | backend/app/security.py:27-112; backend/app/deps.py; tests/test_authorization.py; main.py:54-92 | CSP header missing (F-ARB-19) |
| §19.3 | Sandbox disabled in D1; uploads never executed | N-A | backend/app/storage.py:60-63 | Artifacts stored inertly |
| §20 | CI: lint/type/tests/authz/migration/scan/e2e | PARTIAL | .github/workflows/ci.yml (ruff, bandit, pip-audit, gitleaks, pytest+PG, e2e, frontend build) | No backend type-check, no image build/provenance |
| §21.1 | ADR-003/012/013/014 defaults | PARTIAL | jobs.py:41-64; submissions.py:141-157; evaluator.py:631-644 | ADR-013 outbox delivery half-implemented |
| §21.2 | D1 launch gate (atomicity, gt role test, idem/deadline tests, isolation, restore) | PARTIAL | backend/tests/test_idempotency.py, test_gt_isolation.py, test_flow_submissions.py; docs/BACKUP_AND_RECOVERY.md:37 | Backup/restore, ARM64, external monitoring unmet |

## Findings

### F-ARB-01 — HIGH — Transactional outbox has no dispatcher; intents are written but never delivered
- **Evidence**: backend/app/routers/submissions.py:299-303 and backend/app/routers/levels.py:1063 insert `app.outbox_events`; the only dispatcher is `dispatch_outbox` at backend/app/evaluator.py:631-644, which (a) is never enqueued or scheduled anywhere (rg `dispatch_outbox` → only its definition) and (b) merely marks rows `delivered_at = now()` without delivering anything.
- **Impact**: ADR-013 / §12.3 "a separate dispatcher claims and delivers outbox rows at least once" is not implemented. Notification/realtime intents silently accumulate; "realtime delivery is a projection of the durable event" has no projection.
- **Fix**: enqueue/schedule `dispatch_outbox` from the worker loop (e.g., every N seconds), implement actual delivery (SSE fan-out, notifications) keyed by stable event ID with attempt/outcome recording; add a test that an outbox row reaches a delivered state.

### F-ARB-02 — HIGH — No automated backup, WAL archiving, or tested restore
- **Evidence**: docs/BACKUP_AND_RECOVERY.md:37 "the repository contains NO automated backup job, no WAL archiving configuration and no restore script"; manual pg_dump procedure at :43-48; :93 "a lost host loses everything since the last dump".
- **Impact**: §17.1-17.2 and the §21.2 D1 gate ("backup restore is completed and measured") are unmet. Single failure domain with no recovery path — data loss of submissions/scores in a real event.
- **Fix**: add scheduled base backups + continuous WAL archiving to a separate storage account, an automated restore-and-verify script (FK checks, ledger totals, audit checkpoints), and record measured RPO/RTO per event.

### F-ARB-03 — HIGH — Process-role collapse: participant-facing API process holds gt_admin credentials and serves gt endpoints
- **Evidence**: backend/app/main.py:97-110 mounts admin routers in the single app; backend/app/db.py:40-44 creates `gt_engine` (gt_admin role) at import in that same process; backend/app/routers/admin.py:759,825 use `gt_session()`; worker.py imports both engines.
- **Impact**: §7.2 and §9.2 require the participant API to have "neither credentials nor a network route" to ground truth. DB-level role isolation for `app_api` holds (test_gt_isolation.py), but any RCE/LPE in the participant API process exposes ground truth (flags, answer keys) and full app-schema write.
- **Fix**: split the admin API and worker into separate processes/containers with their own credentials; keep `DATABASE_URL_GT` out of the participant API entirely.

### F-ARB-04 — HIGH — Reviewer rejection of an auto-accepted report does not reverse awarded points or release the award claim
- **Evidence**: auto-accept awards the `evidence_report` component and claims the unit immediately (backend/app/evaluator.py:146-168); `apply_review_outcome` for `reject_invalid` only sets status (evaluator.py:389-393); review.py:201-230 maps `reject_invalid`→`rejected_auto` but never writes a reversal entry; `reverses_entry_id` is never set by any code path (rg → only schema/model/admin comment at admin.py:1225).
- **Impact**: §8.3/§11.1 corrections are supposed to append reversal entries; instead teams keep evidence points and the award claim for reports a reviewer judged invalid, and the claim blocks re-earning. Final scores are wrong at release without manual organizer adjustment.
- **Fix**: in `apply_review_outcome`, when a claimed unit's report is rejected, atomically append a reversal ledger entry (`reverses_entry_id`) for all its award components and delete/release the `award_claims` row so a corrected resubmission can win it.

### F-ARB-05 — MEDIUM — Concurrent same-key idempotency requests race to an unhandled 500
- **Evidence**: backend/app/routers/submissions.py:124-139 pre-checks with a plain SELECT before the stage lock; insert at :263-294 relies on `UNIQUE (author_id, idempotency_key)` (backend/migrations/0001_init.sql:391) with no IntegrityError handling.
- **Impact**: §8.1 step 3 requires the unique-index conflict to resolve and the loser to read the committed record; instead the loser gets an unhandled IntegrityError → 500. Concurrent same-key convergence (§21.2) only happens via client retry.
- **Fix**: wrap the insert in `ON CONFLICT (author_id, idempotency_key) DO NOTHING` + re-read, or catch IntegrityError and re-select the committed row to return the original receipt.

### F-ARB-06 — MEDIUM — Audit hash-chain head not serialized per event scope
- **Evidence**: backend/app/audit.py:35-39 reads the previous hash with a plain SELECT (no FOR UPDATE / advisory lock); sequence is a single global `audit.entries_seq` (backend/migrations/0001_init.sql:6,10).
- **Impact**: §9.5 requires serialized sequence/hash-head updates per event; two concurrent writes in one scope can both read the same `prev_hash` and fork the chain, making `audit_verify` report a false break and weakening tamper evidence.
- **Fix**: serialize per-scope head updates (e.g., `SELECT ... FOR UPDATE` on the latest row or a per-scope transaction advisory lock), or use per-scope sequences.

### F-ARB-07 — MEDIUM — No external signed audit checkpoints
- **Evidence**: backend/app/audit.py:1-7 docstring claims "D1 exports signed checkpoints externally at intervals", but no checkpoint/export code exists (rg `checkpoint` in backend/ → none).
- **Impact**: §9.5 requires signed checkpoints exported to a separate account at a documented interval (≤1 min / 1,000 entries). A hash chain stored only in the same mutable DB is explicitly "not sufficient evidence".
- **Fix**: add a checkpoint job that signs the current chain head (key held outside the DB) and exports it (with a backup manifest) to separate storage; alert when the unanchored interval exceeds policy.

### F-ARB-08 — MEDIUM — Auto-accept enabled by default without the blind-validation gate
- **Evidence**: backend/app/matching.py:188-196 (`auto_full`/`auto_partial` thresholds applied unconditionally); backend/app/evaluator.py:136-180 awards the evidence component immediately on `accept_full`.
- **Impact**: §11.2 requires auto-accept to be disabled by default until a blind validation set demonstrates ≥99% precision on the auto-accept subset. No validation set or gate exists; combined with F-ARB-04, unvalidated matches can put points on the ledger.
- **Fix**: add a frozen event-config flag (`auto_accept_enabled`, default false) that routes everything to review; document the precision study required to turn it on.

### F-ARB-09 — MEDIUM — Evaluator version never recorded; no `evaluations` entity
- **Evidence**: rg `evaluator_version` across backend/ → no matches; migrations create no `evaluations` table (backend/migrations/0001_init.sql, 0003_four_level_flow.sql); decisions are denormalized onto `submissions.status/matched_bug_code`.
- **Impact**: §8.3's unique evaluation identity `(submission_id, evaluator_version, rule_set_hash)` and §15.5's version pinning cannot be satisfied; recomputation/finalization determinism for a pinned evaluator version is unprovable, weakening replayability (§11.2).
- **Fix**: record `evaluator_version` and the rule-set hash with every decision (evaluation row or submission columns) and expose a deterministic recompute keyed on them.

### F-ARB-10 — MEDIUM — Challenge lifecycle state machine partial; publication immutability not DB-enforced
- **Evidence**: `challenge_versions.status` is a free VARCHAR default 'draft' (backend/migrations/0001_init.sql:67,129,227); only `sealed` (backend/app/routers/admin.py:670) and `published` (submissions.py:192) are used; no REVIEWED/FROZEN/ARCHIVED states, no CHECK constraints, no trigger preventing edits to published versions.
- **Impact**: §10.1's lifecycle (with frozen hashes at FROZEN and read-only ARCHIVED) is only partially realized; the §9.4 invariant "a published challenge version cannot be edited" relies solely on code paths.
- **Fix**: add a status CHECK + transition validation, freeze content/file hashes at seal, and add a DB trigger (like the score ledger one) rejecting edits to published/archived versions.

### F-ARB-11 — MEDIUM — No D1 deployment artifacts (Compose/Caddy/cloudflared) or ARM64 build validation
- **Evidence**: repo contains no docker-compose file, Dockerfile, or reverse-proxy config (only scripts/run_dev.sh dev bootstrap); .github/workflows/ci.yml runs ubuntu-latest (x86) only.
- **Impact**: §13.2 D1 host layout and §13.3 "CI builds and tests the ARM64 image" are unmet; the platform cannot currently be deployed to the target OCI A1 host as specified; §21.2 capacity gate cannot be measured on the actual host shape.
- **Fix**: add a Compose file with the §13.2 service list, per-process resource limits, and an ARM64 image build/test job in CI.

### F-ARB-12 — MEDIUM — Observability signals below the required minimum
- **Evidence**: signals available are /health (backend/app/main.py:112-118) and the admin health view with queue age, dead letters, review backlog (backend/app/routers/admin.py:962-988); no request-rate/percentile metrics, no external uptime/synthetic journey, no host/DB instrumentation.
- **Impact**: §18.1 required signals (p50/p95/p99, acknowledgement latency, oldest job age alerting, WAL/replication lag, external uptime) are absent; an incident during a live event would be blind.
- **Fix**: expose request metrics per route (or an access log with request IDs), oldest-job-age/dead-letter alerting, and an external uptime check/synthetic journey.

### F-ARB-13 — MEDIUM — Round-based delivery model of the spec replaced by a 4-level flow; no encrypted bundle or watermarking
- **Evidence**: backend/migrations/0003_four_level_flow.sql:17-41 (levels 1-4, repo options, per-level progress); no AES-256-GCM bundle/key-release code and no watermark/source-map logic anywhere in backend/.
- **Impact**: §10.3 (encrypted pre-delivered Round-1 bundle, post-T0 key release) and §10.4 (Round-2 watermarked delivery) are not implemented; the repo's documented 4-level flow is a deliberate model deviation that should be reconciled with the architecture doc or the doc updated.
- **Fix**: either implement the bundle/key-release endpoints for the "hunt" stages or amend the architecture spec to bless the level-flow model with an explicit fairness note.

### F-ARB-14 — LOW — Award uniqueness scoped to (stage, team, unit) instead of (tenant, participant, round, unit)
- **Evidence**: backend/migrations/0001_init.sql:436 `UNIQUE (stage_id, team_id, award_unit_id)`; claims in backend/app/scoring.py:68-101.
- **Impact**: §8.3/§9.4 express the invariant per participant; the team-level scope is coherent with the team-based product but is a documented deviation (tenant is implied via stage→event).
- **Fix**: note the deviation in the spec, or add participant-level claims if solo scoring is ever required.

### F-ARB-15 — LOW — Rate limiting is a per-process in-memory bucket
- **Evidence**: backend/app/deps.py:30-39 (`_bucket` dict, trimmed to 60 hits).
- **Impact**: §7.3 step 5 quotas and §12.1 D1 are acceptable for one API process, but limits are not shared across replicas and reset on restart; scaling out would silently multiply the effective limit.
- **Fix**: keep for D1 but document it; move to a shared store (Postgres/Redis) before any second API replica (§15.2).

### F-ARB-16 — LOW — gt_admin granted write on gt and ALL on app schema
- **Evidence**: scripts/dev_db.sh:116,120-121 (`GRANT ALL ... ON ALL TABLES IN SCHEMA app TO app_api, gt_admin, scheduler`; `INSERT, UPDATE, DELETE` on gt to gt_admin).
- **Impact**: §7.2/§9.2 want the evaluator role to read ground truth and write only through restricted operations. Current code only SELECTs gt, but the grant exceeds need (defense-in-depth gap).
- **Fix**: create a dedicated `evaluator` role with SELECT on gt and INSERT-only on its app target tables; keep gt_admin for authoring only.

### F-ARB-17 — LOW — No lease renewal for long jobs; dead letters only visible via admin endpoint
- **Evidence**: backend/app/jobs.py:41-59 (fixed `lease_s=120`); admin.py:967,987 (dead-letter count in admin health); no automated alert.
- **Impact**: §8.2 requires lease renewal for genuinely long jobs and alerting on dead letters/oldest-job age; a slow evaluation could be retried concurrently after lease expiry.
- **Fix**: add lease heartbeats for handlers exceeding a fraction of the lease, and an alert when dead letters or oldest-job age cross thresholds.

### F-ARB-18 — LOW — CTF flag submissions bypass caps/cooldowns
- **Evidence**: backend/app/routers/submissions.py:184-239 applies per-file/per-round caps and cooldown only under `kind == "bug_report"`; the flag branch (240-252) only checks assignment.
- **Impact**: §8.1 step 6 wants quota rows covering concurrent caps; flags are limited only by the 30/min rate limit, enabling cheap flag brute force.
- **Fix**: apply a per-round flag attempt cap (e.g., stage config `max_flag_attempts`) inside the same stage-lock transaction.

### F-ARB-19 — LOW — No Content-Security-Policy header
- **Evidence**: backend/app/main.py:86-91 sets only X-Content-Type-Options, Referrer-Policy, Cache-Control.
- **Impact**: §19.2 lists CSP among required controls; the SPA should ship a CSP.
- **Fix**: add a CSP header (or meta tag in frontend/index.html) with a nonce/hash-based policy for the SPA assets.

### F-ARB-20 — LOW — Request timeout not enforced in the API pipeline
- **Evidence**: backend/app/main.py:64-92 (middleware handles request ID and body size only).
- **Impact**: §7.3 step 2 requires a request timeout; a slow DB call can pin a worker indefinitely under load.
- **Fix**: set an ASGI-level timeout (e.g., uvicorn timeout-keep-alive/`TimeoutMiddleware` or per-route timeouts) consistent with §13.4 resource budget.

### F-ARB-21 — LOW — `practice` schema from §9.2 not present
- **Evidence**: migrations create only `app`, `gt`, `audit` schemas (backend/migrations/0001_init.sql:5,26,573-575).
- **Impact**: the spec's isolated practice-copy schema (no competition identifiers) has no implementation; acceptable to defer but should be tracked.
- **Fix**: either implement the practice schema with independent IDs/keys before any practice mode ships, or mark it N-A in the architecture doc.

### F-ARB-22 — LOW — CI lacks backend type-check and image/digest release path
- **Evidence**: .github/workflows/ci.yml has ruff/bandit/pip-audit/pytest/frontend tsc+vite build, but no mypy job, no Docker image build, no artifact provenance; deployment is dev scripts (scripts/run_dev.sh).
- **Impact**: §20 requires type checks, image builds with immutable digests ("never deploy latest"), and migration checks as part of release management.
- **Fix**: add a mypy job, a migration-drift check (gen_initial_migration.py comparison), and an image-build/provenance job before the D1 event.

## Summary counts
- Status (table rows): DONE 19, PARTIAL 14, DEVIATION 6, MISSING 9, N-A 1 (45 rows).
- Findings: CRITICAL 0, HIGH 4, MEDIUM 9, LOW 9 (22 findings).

---

### 4.9 07 Agentic Build Framework and Skills - process and product conformance (`agentic07`)

# Audit report: 07 Agentic Build Framework and Skills (patched v0.2)

- **Agent:** agentic07 (sub-agent, general-purpose)
- **Task ID:** 4-a
- **Baseline document:** `/home/z/my-project/upload/07_Agentic_Framework_and_Skills_patched.md` (read in full)
- **Repo audited:** `/home/z/my-project/bug-hunt-hackathon`
- **Baseline git HEAD:** `f1412b7eec6c92c4c168fd2b8a58182b34480387` (2026-11-26)
- **Mode:** READ-ONLY audit (Read/Grep/Glob/read-only Bash only; no files modified, no packages installed, no servers/tests run)

## 1. Overall assessment

The repo was **not built under the 07 A0–A11 sub-agent framework**. It was built under a different, documented framework: a "one-shot master prompt" lead-autonomous-engineer build (`docs/design/BUG_HUNT_HACKATHON_ONE_SHOT_MASTER_PROMPT.md:9-37`) plus a separate "lead cloud coding-agent orchestrator" for the four-level flow (`docs/design/BUG_HUNT_EVENT_FLOW_IMPLEMENTATION_ORCHESTRATOR_PROMPT.md:3,108-171`). None of the 07 framework's named artifacts exist: no `skills/`, `openapi/`, `errors.yaml`, `copy/catalog.yaml`, `schemas/`, `apps/`, `packages/`, `runner/`, `tests/{contract,e2e,load,fault,security}/`, `tools/audit-verify`, `ops/runbooks/`, `content/`, `compose.lock`, or `DEFINITION_OF_DONE.md` (verified by directory listing at HEAD).

However, the **spirit** of the framework (written handoffs, reviewable artifacts, decision records, acceptance gates) is substantially honored through repo-specific analogs: `docs/AUTONOMOUS_DECISION_LOG.md` (ADR-001..020), `docs/REQUIREMENTS_RECONCILIATION.md` (R1–R9), `docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md`, `docs/SOURCE_OF_TRUTH_AND_TRACEABILITY.md`, `docs/IMPLEMENTATION_PLAN.md`, `AGENTS.md` gates, and a 74-test pytest suite plus `scripts/e2e_journey.py` (48 checks).

Product-wise, the strongest conformance is in the A3/A4 backend invariants (identity, idempotency, single-clock submit transaction, DB-role ground-truth isolation, audit chain, step-up). The largest gaps are the participant frontend (does not implement the approved four-level flow at all), the absent machine-checkable API contract, and the unrun load/capacity gates (provisional 50 vs the 200+ profile).

## 2. Per-skill / per-section status table

| Skill/Section | Requirement (short) | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| §2 Topology / A0 | Roster artifacts produced (openapi.yaml, apps/*, packages/*, runner/, skills/) | NOT-FOLLOWED | repo tree: no `openapi/`, `apps/`, `packages/`, `runner/`, `skills/` dirs (verified via LS) | Different topology: single FastAPI app `backend/app/` + `frontend/` |
| §3 Roster (A0) | Plan / routing table / phase gates; tests green | PARTIAL | `docs/IMPLEMENTATION_PLAN.md:1-58`; `AGENTS.md:56-61` | Slice plan + verification gates exist; no phase-gate/human-review record per 07 §4 |
| §4 Orchestration | Communicate only through files; paper trail | FOLLOWED | `docs/AUTONOMOUS_DECISION_LOG.md:5-157`; `docs/REQUIREMENTS_RECONCILIATION.md:5-11`; `docs/SOURCE_OF_TRUTH_AND_TRACEABILITY.md:31-66` | ADR + reconciliation + traceability replace handoff files |
| §4 Rules (6,7) | `DEFINITION_OF_DONE.md` referenced by every gate; human review points | NOT-FOLLOWED | no `DEFINITION_OF_DONE.md` anywhere (verified); gates are `AGENTS.md:56-61` | Owner review points exist informally (KNOWN_GAPS owner decisions) |
| §4 Rule (5) | Cold start: regenerate clients from OpenAPI, rerun tests | N-A | no generated clients (frontend/src/lib/api.ts hand-written) | No client generation to regenerate |
| A1 | `openapi/openapi.yaml` single source, redocly lint 0 warnings | NOT-FOLLOWED | no `openapi/` dir; dev-only JSON at `backend/app/main.py:51`; hand table `docs/API_REFERENCE.md:1-30` | OpenAPI served only in development; not a committed contract |
| A1 | `errors.yaml` stable codes; every error used exists; unique | PARTIAL | `backend/app/errors.py:16-54` (catalog); `docs/API_REFERENCE.md:9-17` | Catalog exists and is used; unknown code silently degrades to 400 (`errors.py:59`) |
| A1 | `copy/catalog.yaml` versioned keys; no prose in API | NOT-FOLLOWED | UI copy inline, e.g. `frontend/src/pages/participant/Workspace.tsx:815`; no catalog file | No versioned copy; `{n}` placeholders not interpolated (API_REFERENCE.md:11) |
| A1 | Every non-idempotent POST requires `Idempotency-Key` | PARTIAL | `backend/app/routers/submissions.py:96`; `levels.py:871,477`; admin mutations without key: `admin.py:291,397,1018,1195,1261` | Participant retryable mutations covered; admin mutations are not keyed |
| A2 | Migrations expand/contract, never edit applied | FOLLOWED | `backend/migrations/0003_four_level_flow.sql:1-7` ("Additive expand migration"); `scripts/migrate.sh`; ADR-018 | Ordered SQL, forward-only |
| A2 | `app_api` denied on `gt`; CI role test | FOLLOWED | `backend/app/config.py:24-26`; `db.py:5-11`; `backend/tests/test_gt_isolation.py:18-38` (real psycopg roles) | Strongest conformance in repo |
| A2 | Every table has `tenant_id` | PARTIAL | `backend/migrations/0001_init.sql:64,85,367,490` (yes) vs `0003_four_level_flow.sql:16-60` (repo_options, pointers, progress: event_id only) | Flow tables lack tenant_id |
| A2 | `seeds/synthetic_200.py`; EXPLAIN plans; 60 s load | NOT-FOLLOWED | only `backend/seed.py`; `docs/PERFORMANCE_AND_CAPACITY.md:5` ("PROVISIONAL... 50"); no `docs/plans/` | 200-user profile descoped to 50 (ADR-011); load UNRUN |
| A2 | Clean migrate -> migrate -> pg_dump diff empty | N-A | no evidence found in docs/ or scripts/ | Unproven, not claimed |
| A3 | Identity from JWT only; never body; IDOR-safe | FOLLOWED | `backend/app/deps.py:55-88`; `routers/submissions.py:106-119,395-404` (404 not 403) | Tested in `test_authorization.py` |
| A3 | Idempotency-Key; replay returns original receipt, even after deadline | FOLLOWED | `routers/submissions.py:124-139`; `test_idempotency.py:101` | Same contract in levels submit `levels.py:895-917` |
| A3 | Submit pipeline: lock order, one `clock_timestamp()`, quota lock, single txn | FOLLOWED | `routers/submissions.py:141-314` (stage `FOR UPDATE` :148, clock :157, ordered checks :171-239, one txn); ADR-012 | Matches 02 §5 per AGENTS.md invariant 5 |
| A3 | Rate limits via quota rows, not only memory; 429 with Retry-After | PARTIAL | `backend/app/deps.py:30-39` (in-process dict); `errors.py:67-73` (no Retry-After header) | DB quotas only for caps/cooldowns; documented F-06 |
| A3 | No endpoint reads `gt.*` | FOLLOWED | role enforcement `config.py:24` + `test_gt_isolation.py:18-38`; app routers use `app.*` only | Defense at DB role level |
| A3 | Every response carries `server_time` | PARTIAL | `routers/state.py:22-25,63,78`; `routers/auth.py:184,298,357` only; absent in `submissions.py:328-338`, `levels.py:1088-1095` | Only /state, /time, auth carry it |
| A3 | DB errors map to 503, never 500, for expected conditions | NOT-FOLLOWED | `backend/app/main.py:94-95` handlers; `errors.py:76-80` (generic Exception -> 500 INTERNAL_ERROR) | `SERVICE_DEGRADED` (503) exists but only used by `storage.py:46-48` |
| A3 | Uploads never unpacked on API host | FOLLOWED | `backend/app/storage.py:57-91` (central-directory metadata only); `test_flow_uploads.py:65-100` | Zip-bomb/traversal/symlink checks |
| A3 | Auto-submit: same service, no-prior and partial-draft cases | FOLLOWED | `backend/app/auto_submit.py:72-161,164-263`; `test_flow_auto_submit.py` (6 tests) | Idempotent under races via pointer lock |
| A3 | Upload delete only before submit | PARTIAL | `levels.py` route list (lines 197-1181): POST /uploads only, no DELETE | Staged artifacts cannot be removed |
| A4 | Every admin mutation audited in same transaction | FOLLOWED | `audit.py:20-66`; audit_write calls in `admin.py:384-393,419-428,458,1018-1040,1248-1257,1290-1300` | Append-only hash chain, verify endpoint `admin.py:1043-1047` |
| A4 | Step-up (5 min) for GT views/edits | FOLLOWED | `deps.py:141-162`; `admin.py:543,568,651,749,822,855` (step_up_verified) | Password re-entry per ADR-008 |
| A4 | Live ops reason >= 10 chars | NOT-FOLLOWED | `admin.py:295-297` (only non-empty); `EventIn`-adjacent reason `min_length=5` at `admin.py:149` | "x" passes today |
| A4 | Rescoring appends entries with `reverses_entry_id` | PARTIAL | param exists `scoring.py:44,61`; only caller is a test (`test_scoring.py:60`); dispute path appends kind="adjustment" without it (`admin.py:1234-1247`), manual adjustment `admin.py:1277-1289` | Ledger never updated (good), but reversals don't link originals |
| A4 | Kill switch = feature_flags row + audit + cache invalidation via version tuple | NOT-FOLLOWED | `backend/app/config.py:51-53` (env Settings); `docs/AI_TOOLING_RESEARCH_AND_DECISION.md:131` (restart-only); `/state` has `announcements_version`/`leaderboard_version` (`state.py:91-93`) but no flag invalidation | Startup config, not an audited in-event switch |
| A4 | No impersonation; admin views redacted + audited | FOLLOWED | no impersonation route anywhere (grep "impersonat|view as participant": only `docs/COMPETITION_RULES.md:185` prohibition); admin GT views via step-up endpoints | Conformant |
| A4 | Force-advance playbook (auto-submit latest draft, set adjusted_by/adjusted_reason) | NOT-FOLLOWED | no `adjusted_by`/`adjusted_reason` columns (migrations 0001-0003); `admin_levels.py` offers repo-lock override (:39) + auto-submit trigger (:231) only | Organizer cannot force-advance a stuck pointer |
| A4 | MFA on admin sessions | NOT-FOLLOWED (waived) | ADR-008 `docs/AUTONOMOUS_DECISION_LOG.md:58-63`; `deps.py:144-147` | Documented accepted risk, WebAuthn planned |
| A5 | Four-level journey implemented in shipped participant FE | NOT-FOLLOWED | grep `/v1/levels|/v1/team|/v1/repo|/v1/uploads|/v1/progress|/v1/runs` in `frontend/src`: **no matches**; `docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md:46-49,70-71` | Merged FE is the v1 rebuild-base; four-level UX exists only in unmerged concept PRs |
| A5 | Sync-state chips (Saved locally/server, Offline, Queued, Accepted) | NOT-FOLLOWED | `frontend/src/pages/participant/Workspace.tsx:94-95,681-684,815` (draft notice only); no chip taxonomy | Only a draft-autosave notice exists |
| A5 | Offline outbox in IndexedDB with stable keys | NOT-FOLLOWED | grep `IndexedDB|BroadcastChannel|navigator.locks` in `frontend/src`: no matches | No offline queue; OfflineBanner only (`chrome.tsx:190-208`) |
| A5 | Two tabs via Web Locks / BroadcastChannel | NOT-FOLLOWED | no matches (grep); server-side 412 `DRAFT_VERSION_CONFLICT` instead (`submissions.py:511-512`) | Different mitigation, weaker UX |
| A5 | Countdown never decides lateness; refetch /state on zero | FOLLOWED | `Workspace.tsx:117` (state refetch every 5 s), `:463,476` (server offset); lateness decided server-side `submissions.py:179-180` | Display-only countdown |
| A5 | Every page sets document.title and one h1 | PARTIAL | one `<h1>` per page (14 pages checked); `document.title` never set (grep: no matches) | Static title from index.html |
| A5 | Modals trap focus, Esc close | N-A | no modals exist; `ConfirmButton` double-confirm pattern (`Dashboard.tsx:718`) | Nothing to violate; also nothing conforming |
| A5 | Reduced motion removes non-essential animation | FOLLOWED | `frontend/src/styles/app.css:41` (`prefers-reduced-motion: reduce`) | |
| A6 | Prod red non-dismissible banner; current event + environment shown | PARTIAL | environment shown `Dashboard.tsx:752`; no banner (grep "production" banner: none) | Environment is config-driven, not displayed as banner |
| A6 | Sensitive views: persistent border + view logging | NOT-FOLLOWED | grep "Sensitive" in frontend/src: no matches; GT admin pages `Challenges.tsx` without access-logged border | Backend audits writes, not view access |
| A6 | Live console refresh <= 2 s, stale > 5 s marked | NOT-FOLLOWED | `Dashboard.tsx:736` (`refetchInterval: 10_000`); no last-refresh/stale marker | 10 s polling only |
| A6 | Cursor pagination; never full dataset | NOT-FOLLOWED | admin tables unpaginated (`admin.py:1050-1075` limit-capped at 500; FE renders all rows) | Bounded but not paginated |
| A7 | Sandboxed runner; escape tests green | NOT-FOLLOWED (waived) | `levels.py:1168-1186` (503 RUNNER_UNAVAILABLE); ADR-010 `docs/AUTONOMOUS_DECISION_LOG.md:72-78`; `docs/REQUIREMENTS_RECONCILIATION.md:87-99` (R6); `KNOWN_GAPS...:39-42` | Deliberate, documented, gated on owner approval |
| A8 | AI assessor, cap enforcement, eval set, kill switch <= 1 poll | NOT-FOLLOWED (waived) | `config.py:52` (ai_assessment_enabled=False); ADR-013 `AUTONOMOUS_DECISION_LOG.md:96-102`; gate `docs/AI_TOOLING_RESEARCH_AND_DECISION.md:117-131` | Disabled by default with a 7-item provider gate |
| A9 | Contract suite (schemathesis, golden payloads) | NOT-FOLLOWED | no `tests/contract/` anywhere; no schemathesis config | Only pytest + FastAPI TestClient |
| A9 | E2E on real stack incl. refresh, offline, auto-submit | PARTIAL | `scripts/e2e_journey.py:1-48,281-283` (API-level, 48 checks); no Playwright; offline/auto-submit only in-process tests | Journey covers lifecycle + audit verify |
| A9 | Load profile passes at stated N; zero dup submissions | NOT-FOLLOWED (UNRUN) | `docs/LOAD_TEST_REPORT.md:3` ("SCRIPT READY, MEASUREMENT PENDING"), `:53-60` (all cells UNRUN); ADR-011 `AUTONOMOUS_DECISION_LOG.md:80-86` | Cap stays provisional 50 vs 07 profile 200+ |
| A9 | Fault tests (kill after commit, worker kill, DB restart) | NOT-FOLLOWED | no fault harness in repo (grep "fault"/kill-after-commit in scripts/tests: none) | Job replay idempotency covered in unit tests only |
| A10 | IDOR / RBAC / GT isolation / upload fuzzing vs real roles | FOLLOWED | `backend/tests/test_gt_isolation.py:18-43` (real psycopg roles); `test_authorization.py` (7 tests); `test_flow_uploads.py:44-118` (12 hostile-upload tests) | Real-role requirement met |
| A10 | `tools/audit-verify` chain + checkpoint verification | PARTIAL | verify endpoint `admin.py:1043-1047` + `audit.py:69-95`; e2e check `scripts/e2e_journey.py:282-283`; not run in CI (`.github/workflows/ci.yml`: pytest/lint/scan only) | Tool is an endpoint, not CI-enforced |
| A10 | Every finding has severity, repro, fix owner | PARTIAL | `docs/SECURITY_REVIEW.md:18-29` (severity + status + repro commands, no per-finding owner) | Self-review, honestly scoped (`:53-61`) |
| A10 | Runner escape tests contained | N-A | runner disabled (`config.py:51`) | No runner to escape |
| A11 | Runbooks with trigger/owner/steps/verification/rollback | PARTIAL | `docs/EVENT_OPERATIONS_PLAYBOOK.md:39,44,198,231`; `docs/DEPLOYMENT_RUNBOOK.md`; `docs/BACKUP_AND_RECOVERY.md` | Structure present |
| A11 | Each runbook rehearsed once, date recorded | NOT-FOLLOWED (UNRUN) | `docs/TESTING_STRATEGY.md:140` ("currently UNRUN"), `:145`; `RELEASE_PLAN_D1.md:10-11` pending | Rehearsals are scheduled, not done |
| A11 | Content keyed by (stage_key, repo option); equal depth | PARTIAL | two apps exist (`challenge-app/`, `challenge-app-option-b/`); Option B is a dev fixture: `docs/KNOWN_GAPS...:20-24`, `REQUIREMENTS_RECONCILIATION.md:74-84` (R5) | Equal-depth production content is an owner deliverable |
| A11 | `compose.lock` (image digests) | N-A | no docker-compose/compose.lock in repo (verified) | Single-VM non-container deployment (ADR-001) |

### Status counts (table rows above, 54 requirement rows)

- **FOLLOWED:** 15 (paper trail; expand/contract; gt-role isolation; JWT identity+IDOR; idempotent replay; submit pipeline; no-gt reads; uploads-never-unpacked; auto-submit; admin audit-in-txn; step-up; no-impersonation; countdown-never-decides; reduced-motion; A10 real-role security tests)
- **PARTIAL:** 17
- **NOT-FOLLOWED:** 17 (2 of these, A7/A8, are documented waivers: ADR-010 / ADR-013)
- **N-A:** 5

## 3. Findings

---

### F-AG07-01 — HIGH — The 07 sub-agent framework (A0–A11) was not adopted; a different build framework was used

- **Evidence:** no `skills/`, `openapi/`, `copy/`, `schemas/`, `apps/`, `packages/`, `runner/`, `tests/{contract,e2e,load,fault,security}/`, `tools/`, `ops/`, `content/`, `DEFINITION_OF_DONE.md` in the repo (directory listing at HEAD); `docs/design/BUG_HUNT_HACKATHON_ONE_SHOT_MASTER_PROMPT.md:9-37` (lead autonomous engineer, subagents allowed ad hoc); `docs/design/BUG_HUNT_EVENT_FLOW_IMPLEMENTATION_ORCHESTRATOR_PROMPT.md:108-171` (a second, different orchestrator).
- **Impact:** none of the 07 acceptance gates (redocly lint, error-code uniqueness gate, cold-start regeneration, phase gates) are enforceable; reviewers cannot map skill outputs to expectations; framework-vs-repo drift is now structural.
- **Fix:** either adopt 07 formally (create `skills/*.md`, route work through A0 gates) or record an explicit ADR waiving 07 in favor of the one-shot/lead-orchestrator framework, and port the two gates worth keeping (contract lint, error-catalog uniqueness) into CI.

### F-AG07-02 — HIGH — Shipped participant frontend does not implement the approved four-level flow

- **Evidence:** grep of `frontend/src` for `/v1/levels|/v1/team|/v1/repo|/v1/uploads|/v1/progress|/v1/runs` returns **no matches**; FE only consumes v1 endpoints (`frontend/src/pages/participant/Workspace.tsx:200,909`; `App.tsx:34-52`); `docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md:46-49` (#9: concept PRs unmerged), `:70-71` ("No new frontend implementation"); `docs/REQUIREMENTS_RECONCILIATION.md:113-126` (R8).
- **Impact:** the backend's core four-level product (levels, gates, repo lock, uploads, progress, pointer state machine, auto-submit UX) is unreachable from the shipped UI; the approved baseline journey cannot be run end-to-end by participants. This is the single largest product gap.
- **Fix:** owner selects and merges one concept PR and funds its adaptation to `/v1/levels/*`, `/v1/team/*`, `/v1/repo/*`, `/v1/uploads`, `/v1/progress` (per KNOWN_GAPS #9); until then mark the four-level flow "backend-only, no FE" in readiness.

### F-AG07-03 — MEDIUM — No machine-checkable API contract (no openapi.yaml, errors.yaml, schemas, copy catalog)

- **Evidence:** no `openapi/`, `schemas/`, `copy/` dirs (verified); OpenAPI JSON dev-only: `backend/app/main.py:50-51`; hand-maintained `docs/API_REFERENCE.md:1-30`; error catalog in code `backend/app/errors.py:16-54`; UI copy inline in components (e.g. `frontend/src/pages/participant/Workspace.tsx:815`).
- **Impact:** "redocly lint 0 warnings", "every response body has a schema", and copy-key versioning are unenforceable; FE/BE drift is caught only by manual e2e; catalog `{n}` placeholders are not interpolated in messages (documented quirk, `docs/API_REFERENCE.md:11`).
- **Fix:** commit the generated `openapi.json` (or a hand-written openapi.yaml) as the contract, add a CI contract test (schemathesis) and an error-code uniqueness/liveness check, and move user-facing strings to a versioned catalog.

### F-AG07-04 — LOW — Unknown error code silently degrades to HTTP 400 instead of failing loudly

- **Evidence:** `backend/app/errors.py:59` — `status, default = CATALOG.get(code, (400, "Request failed."))`.
- **Impact:** a typo in a new `ApiError` code produces a misleading 400 and weakens A1's "no endpoint returns an unlisted error code" rule.
- **Fix:** in tests/CI, assert every raised code is in CATALOG (or make unknown codes raise internally in non-dev environments).

### F-AG07-05 — MEDIUM — A2 capacity work missing: no 200-user synthetic seed, no EXPLAIN plans, load test UNRUN

- **Evidence:** only `backend/seed.py` exists (no `seeds/synthetic_200.py`, no `docs/plans/`); `docs/LOAD_TEST_REPORT.md:3` ("SCRIPT READY, MEASUREMENT PENDING (UNRUN at the approved cap)") and `:53-60` (every cell UNRUN); provisional 50 cap: `docs/AUTONOMOUS_DECISION_LOG.md:80-86` (ADR-011), `docs/PERFORMANCE_AND_CAPACITY.md:5`.
- **Impact:** the 07 profile (200+ concurrent participants) is unverified; even the reduced 50-participant cap is unmeasured; hot-query EXPLAIN evidence absent; readiness item `load_test_50` blocks READY.
- **Fix:** run `scripts/load_test.py` at the approved cap on D1-comparable hardware, record results in LOAD_TEST_REPORT.md, and produce EXPLAIN plans for the hot stage-row/submission queries; raise the cap only after a passing run.

### F-AG07-06 — MEDIUM — `server_time` is not carried on every response (A3 hard rule)

- **Evidence:** present only in `backend/app/routers/state.py:22-25,63,78` and `routers/auth.py:184,298,357`; absent from submission receipts (`routers/submissions.py:328-338`), level submissions (`levels.py:1088-1095`), team/progress endpoints (`levels.py:586-680`).
- **Impact:** clients cannot correct clock skew on every interaction; the "server owns time" invariant is only partially exposed.
- **Fix:** add `server_time` in the response middleware (`main.py:64-92`) so every JSON response carries it.

### F-AG07-07 — MEDIUM — Rate limiting is in-process/in-memory and 429s lack a Retry-After header

- **Evidence:** `backend/app/deps.py:27-39` (module-level `_bucket` dict, per-replica); `backend/app/errors.py:67-73` (JSONResponse with only `X-Request-Id`); no Retry-After anywhere (grep: none in backend); only 429 assertion is `backend/tests/test_idempotency.py:101` (status only).
- **Impact:** limits reset on process restart and don't coordinate across workers (documented as accepted risk F-06, `docs/SECURITY_REVIEW.md:25`); clients get no machine-readable backoff (A3 success criterion "429 with Retry-After" unmet).
- **Fix:** persist mutating-endpoint quotas in DB rows (or a shared store) and emit a `Retry-After` header from `api_error_handler` for 429 codes.

### F-AG07-08 — MEDIUM — Expected database failures surface as 500 INTERNAL_ERROR instead of 503

- **Evidence:** `backend/app/main.py:94-95` registers only `ApiError` and generic `Exception` handlers; generic handler returns 500 (`errors.py:76-80`); no SQLAlchemyError mapping; `SERVICE_DEGRADED` (503) exists (`errors.py:38`) but is raised only by `backend/app/storage.py:46-48`.
- **Impact:** A3 hard rule "database errors map to 503... never 500, for expected conditions" is violated; transient DB issues during an event will look like server bugs to participants and pollute 5xx alerting.
- **Fix:** add an exception handler for `SQLAlchemyError`/`OperationalError` mapping to `503 SERVICE_DEGRADED` and keep 500 for genuinely unexpected faults.

### F-AG07-09 — LOW — Staged uploads cannot be deleted before submit

- **Evidence:** `backend/app/routers/levels.py` route list (lines 197-1181) exposes only `POST /uploads`; no DELETE route; A3 playbook 4 requires "DELETE only before submit".
- **Impact:** participants who stage a wrong artifact cannot remove it; storage accumulates staged files.
- **Fix:** add `DELETE /uploads/{artifact_id}` allowed only while the level pointer is on that level and status is `staged`, with an audit entry.

### F-AG07-10 — MEDIUM — Live-operation reasons are not enforced at >= 10 characters

- **Evidence:** `backend/app/routers/admin.py:295-297` — `reason = body.get("reason", "")`; only `if not reason` check; the config-revision reason is `min_length=5` (`admin.py:149`).
- **Impact:** A4 hard rule "Live operations (pause, resume, extend) require a reason of at least 10 characters" unmet; audit trail can carry meaningless one-character reasons.
- **Fix:** enforce `len(reason.strip()) >= 10` (or `Field(min_length=10)`) for pause/resume/extend/end actions.

### F-AG07-11 — MEDIUM — Kill switch is environment config, not an audited `feature_flags` row with cache invalidation

- **Evidence:** `backend/app/config.py:50-53` (Settings flags, `lru_cache` at :60-62); `docs/AI_TOOLING_RESEARCH_AND_DECISION.md:131` ("read at backend startup... deliberate config change plus process restart"); live-ops view reads settings directly (`admin.py:991-995`); no `feature_flags` table in migrations 0001-0003.
- **Impact:** A4's kill-switch rule (flip a DB row, write an audit entry, invalidate `/state` caches via the version tuple, act within 1 s) is not implementable without a restart; flipping leaves no audit entry.
- **Fix:** either implement DB-backed feature flags with an audited admin toggle and `/state` version bump, or record an explicit waiver ADR accepting restart-based switches for this event scale.

### F-AG07-12 — MEDIUM — `reverses_entry_id` is never used by any production code path

- **Evidence:** parameter defined `backend/app/scoring.py:44,61`; the only caller in the repo is a test (`backend/tests/test_scoring.py:60`); dispute resolution appends `kind="adjustment"` without linking the original entry (`admin.py:1224-1247`); manual adjustment likewise (`admin.py:1277-1289`).
- **Impact:** the ledger is append-only (invariant 3 holds) but corrections don't reference the entry they reverse, weakening A4's "rescoring appends entries with reverses_entry_id" and audit-chain traceability.
- **Fix:** pass `reverses_entry_id=<original entry id>` whenever a correction reverses a prior entry (dispute-upheld reversals), and add a test asserting the link.

### F-AG07-13 — LOW — Force-advance playbook not implemented (no `adjusted_by`/`adjusted_reason`)

- **Evidence:** no such columns in `backend/migrations/0001_init.sql`-`0003_four_level_flow.sql`; `backend/app/routers/admin_levels.py` provides repo-lock override (:39-135) and an auto-submit job trigger (:231) only.
- **Impact:** organizers cannot force-advance a participant stuck at a node with an audited "Adjusted by organizer" marker (A4 playbook 3).
- **Fix:** add an admin force-advance endpoint that runs the auto-submit path for that participant, moves the pointer, and records `adjusted_by`/`adjusted_reason` plus an audit entry.

### F-AG07-14 — LOW — MFA absent; step-up is password re-entry only (documented waiver)

- **Evidence:** ADR-008 `docs/AUTONOMOUS_DECISION_LOG.md:58-63`; `backend/app/deps.py:141-162` (step-up = password re-check, 5-minute window); `docs/SECURITY_REVIEW.md:24` (F-05, accepted risk).
- **Impact:** A4's "admin session with MFA" is unmet; single-factor protection guards ground-truth mutations.
- **Fix:** keep the documented follow-up (WebAuthn or Cloudflare Access) on the pre-event list; do not enable remote admin access without it.

### F-AG07-15 — MEDIUM — Offline resilience and sync-state UX requirements not implemented

- **Evidence:** no IndexedDB/BroadcastChannel/Web Locks usage in `frontend/src` (grep: no matches); no sync-state chip taxonomy (A5 hard rule); draft autosave is a plain 3 s interval (`Workspace.tsx:190-230`, label at :815); offline handling is only `chrome.tsx:190-208` (banner) plus query retries.
- **Impact:** queued submits and local drafts are lost on refresh/navigation; the offline event scenario (venue network drop) degrades harder than the spec promises; "never show accepted unless 2xx" is only partially observable to users.
- **Fix:** implement the outbox (IndexedDB + stable idempotency keys), the five sync-state chips, and tab coordination (Web Locks) in whichever concept PR is merged.

### F-AG07-16 — LOW — `document.title` never set per page (h1 rule is met)

- **Evidence:** grep `document.title` in `frontend/src`: no matches; every page has exactly one `<h1>` (14 pages verified).
- **Impact:** minor a11y/navigation deviation from A5's hard rule.
- **Fix:** set the document title per route (document.title or a tiny usePageTitle hook).

### F-AG07-17 — LOW — No focus-trapped modals exist; the modal rules are untestable

- **Evidence:** grep `role="dialog"|aria-modal|modal` in `frontend/src`: no real modals; the confirm pattern is a double-click `ConfirmButton` (`frontend/src/pages/admin/Dashboard.tsx:718`).
- **Impact:** A5's focus-trap/Esc rules are neither met nor violated; blocking-modal auto-submit UX (5/3/1-minute toasts) is absent because the four-level FE is absent (see F-AG07-02).
- **Fix:** adopt a focus-trapping dialog component as part of the four-level FE adaptation.

### F-AG07-18 — MEDIUM — Admin FE hard rules largely unmet (banner, sensitive border, refresh cadence, pagination)

- **Evidence:** no red production banner or "Sensitive, access logged" border (grep in `frontend/src`: no matches); environment shown as a data row only (`Dashboard.tsx:752`); live health polls at 10 s, not <= 2 s, with no last-refresh/stale marker (`Dashboard.tsx:733-737`); no cursor pagination (backend caps audit lists at 500, `admin.py:1051-1075`); admin surface is only 2 pages (`frontend/src/pages/admin/`: Dashboard, Challenges).
- **Impact:** operator awareness and disclosure-safeguard requirements from A6 are unmet; stale live data can mislead during an incident.
- **Fix:** add the non-dismissible production banner, the sensitive-view border with view-logging, a 2 s live console with last-refresh timestamp, and cursor pagination on the audit/submission tables.

### F-AG07-19 — MEDIUM — Runner (A7) not implemented; runs disabled by design (documented waiver)

- **Evidence:** `backend/app/routers/levels.py:1168-1186` (POST /runs, GET /runs/{id} -> 503 RUNNER_UNAVAILABLE); ADR-010 `docs/AUTONOMOUS_DECISION_LOG.md:72-78`; `docs/REQUIREMENTS_RECONCILIATION.md:87-99` (R6); `docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md:39-42` (#8 blocks READY only if Run is expected).
- **Impact:** Levels 3-4 build/run integration and all `06` §5 escape guarantees are absent; participants must test offline. The deviation is safety-motivated and gated, but the endpoint contract remains a stub (both branches of `create_run` raise).
- **Fix:** keep the owner decision gate; if Run is wanted, deliver an isolated runner (VM, no egress) and the escape suite before enabling; otherwise record the final "Run stays off" decision in the readiness checklist.

### F-AG07-20 — MEDIUM — AI assessor (A8) not implemented; disabled by default (documented waiver)

- **Evidence:** `backend/app/config.py:52` (`ai_assessment_enabled: bool = False`); no `packages/ai/`, prompts or eval set anywhere; ADR-013 `docs/AUTONOMOUS_DECISION_LOG.md:96-102`; the 7-item provider gate `docs/AI_TOOLING_RESEARCH_AND_DECISION.md:117-131`.
- **Impact:** all A8 product rules (criteria_met output, cap enforcement, injection tests, calibration) are unbuilt; safe default is in place, and the gate is well documented.
- **Fix:** no action needed pre-event while off; if ever enabled, satisfy the full gate (privacy terms, cost cap, logging, kill-switch rehearsal, sign-off) and then implement the assessor per A8.

### F-AG07-21 — MEDIUM — Integration evidence incomplete: no contract suite, no Playwright e2e, no fault tests, load UNRUN

- **Evidence:** no `tests/contract|e2e|load|fault` trees; e2e is an API-level Python journey (`scripts/e2e_journey.py:1-48`, 48 checks; audit-chain check at :282-283); load report all-UNRUN (`docs/LOAD_TEST_REPORT.md:53-60`); no fault-injection harness (grep: none).
- **Impact:** A9's success criteria ("load profile passes at a stated N with zero duplicate submissions and zero lost jobs", four-level journey incl. refresh/offline/auto-submit in a real browser) are unproven; announced capacity is provisional.
- **Fix:** add schemathesis against a committed OpenAPI contract, a Playwright four-level journey, fault tests (kill worker after commit; DB restart), and run the load rehearsal at the cap.

### F-AG07-22 — LOW — Audit-chain verification is an admin endpoint, not a CI-enforced tool

- **Evidence:** `backend/app/routers/admin.py:1043-1047` (GET /admin/audit/verify); `backend/app/audit.py:69-95`; exercised by `scripts/e2e_journey.py:282-283`; `.github/workflows/ci.yml` runs pytest/ruff/bandit/pip-audit/gitleaks but no chain verification.
- **Impact:** A10's "tools/audit-verify" and "chain verifies after a full event replay" have no automated, periodic enforcement; a silent chain break is found only when an organizer remembers to look.
- **Fix:** add a CI step (or e2e job) that replays a seeded event and asserts `/admin/audit/verify` returns `intact: true`.

### F-AG07-23 — MEDIUM — Ops/content readiness incomplete: runbooks unrehearsed, content not keyed by (stage, repo option), no compose.lock

- **Evidence:** rehearsals UNRUN: `docs/TESTING_STRATEGY.md:140` ("backup_restore... currently UNRUN"), `:145`; `docs/RELEASE_PLAN_D1.md:10-11` (pending); Option B is a dev fixture, not equivalent production content: `docs/REQUIREMENTS_RECONCILIATION.md:74-84` (R5), `docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md:20-24` (#3 blocks READY); no `compose.lock` (no containers; ADR-001 `docs/AUTONOMOUS_DECISION_LOG.md:5-10`).
- **Impact:** A11's success criteria (readiness signed with evidence, runbooks rehearsed with dates, two equally deep content options) are not met; items correctly block READY, but the launch record is incomplete.
- **Fix:** rehearse and date the runbooks (backup/restore, pause/resume, kill switch), have two independent reviewers certify the final A/B challenge packages, and (if containers are ever used) commit a digest lockfile.

## 4. Positives worth recording

- Ground-truth isolation is the best-implemented 07-relevant requirement: real DB roles, real psycopg connections in tests (`backend/tests/test_gt_isolation.py:18-43`), answer-key exclusion test (`:46-52`), and the restricted `challenge-app/ORGANIZER_ANSWER_KEY.md` handling (`AGENTS.md:21-23`).
- The submission transaction matches the A3 hard rules precisely: idempotency reservation with payload hash, stage-row lock, single `clock_timestamp()` read, ordered validation, single-transaction writes with audit + outbox (`backend/app/routers/submissions.py:92-325`).
- Honest reporting culture: UNRUN/provisional claims are labeled everywhere (`docs/LOAD_TEST_REPORT.md:3`, `docs/PERFORMANCE_AND_CAPACITY.md:5`, `docs/SECURITY_REVIEW.md:53-61`), which is itself a 07 §4 "acceptance gate" principle applied well.
- The handoff/paper-trail principle (07 §1) is honored via `AUTONOMOUS_DECISION_LOG.md`, `REQUIREMENTS_RECONCILIATION.md`, `KNOWN_GAPS_AND_OWNER_DECISIONS.md`, and `SOURCE_OF_TRUTH_AND_TRACEABILITY.md:31-51` (traceability table with real paths).

## 5. Severity counts (23 findings)

- CRITICAL: 0
- HIGH: 2 (F-AG07-01, F-AG07-02)
- MEDIUM: 14 (F-AG07-03, 05, 06, 07, 08, 10, 11, 12, 15, 18, 19, 20, 21, 23)
- LOW: 7 (F-AG07-04, 09, 13, 14, 16, 17, 22)

---

### 4.10 08 Admin Deep Specification, Part 1 - admin frontend (`admin08a`)

# Audit report — Spec 08 Part 1 (Admin frontend)

- **Agent:** admin08a (Task ID 4-b)
- **Baseline document:** /home/z/my-project/upload/08_Admin_Deep_Spec_patched.md (Part 1 only: §1.1 route map, §1.2 shell, §1.3 components, §1.4 admin UI rules, §1.5 no impersonation / patch E.4, §1.6 tenant scope / patch E.4)
- **Repo:** /home/z/my-project/bug-hunt-hackathon
- **HEAD:** f1412b7eec6c92c4c168fd2b8a58182b34480387 (2026-11-26)
- **Mode:** READ-ONLY audit; all evidence verified by reading actual code.

Scope covered: frontend admin pages/components (`frontend/src/pages/admin/*`, `frontend/src/components/chrome.tsx`, `StepUp.tsx`, `ui/components.tsx`, `lib/*`, review pages as called surfaces) and the backend admin routers they call (`backend/app/routers/admin.py`, `admin_levels.py`, `review.py`, `auth.py`, `deps.py`).

**Headline:** the implemented admin console is a two-page organizer dashboard (`/admin` = Dashboard.tsx, `/admin/challenges` = Challenges.tsx) plus a reviewer console (`/review`). The spec's 08 §1.1 route map (~50 routes), §1.2 shell, all §1.3 components (C-80..C-99), most of §1.4's rules, the §1.5 state/preview endpoints, and all of §1.6 tenant scoping are absent. What exists is internally coherent and audited on mutations, but security-relevant spec patches (E.4/R-36 tenant rejection, step-up on finalize, MFA) are not met.

## Status table

| Spec ref | Requirement (short) | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| 1.1 | `/login` sign-in (MFA) | PARTIAL | frontend/src/pages/Login.tsx:24-37; backend/app/routers/auth.py:54-89 | Route exists; email+password only, no MFA; first-login sets password (F-AD8A-03) |
| 1.1 | `/step-up` route/modal | PARTIAL | frontend/src/components/StepUp.tsx:10-88; backend/app/routers/auth.py:470-493; backend/app/deps.py:141-162 | Embedded panel + endpoint, 5-min server-side marker; no route or modal variant |
| 1.1 | `/` home personalised by role | PARTIAL | frontend/src/lib/auth.tsx:6-10; frontend/src/App.tsx:69-82 | Role-routed home exists; no per-role personalisation of content |
| 1.1 | `/search` command palette (C-80) | MISSING | frontend/src/App.tsx:22-87; grep `⌘\|metaKey` in src: no matches | No global search anywhere |
| 1.1 | `/events`, `/events/:id` (+stages/schedule/repo-options) | PARTIAL | frontend/src/pages/admin/Dashboard.tsx:64-208, 212-455; backend/app/routers/admin.py:48-214, 241-276 | Events list/lifecycle + stage control embedded in Dashboard; no detail/schedule/repo-options pages; config revisions + stage creation are backend-only (admin.py:153-199, 241-276) with no UI |
| 1.1 | `/content*` (7 routes incl. revisions, libraries) | MISSING | frontend/src/App.tsx:22-87; grep `content` routes: none | No content management UI at all |
| 1.1 | Participants/teams routes (5) | MISSING | frontend/src/App.tsx:69-82; backend admin.py:439-530 (teams/invites/participants endpoints) | Backend endpoints exist; zero frontend pages call them |
| 1.1 | `/users`, `/admin-users` (super admin) | MISSING | grep `/admin/users` in backend/app: no matches; frontend none | No accounts-management route or API |
| 1.1 | `/challenges*` (9 routes incl. ground-truth, tests, rubric, harness, answer-authority, candidate-bugs) | PARTIAL | frontend/src/pages/admin/Challenges.tsx:91-168; backend admin.py:542-880 | Only create/upload/freeze/publish + GT test-results recorder; no list/detail/GT authoring UI/answer packs/candidate bugs |
| 1.1 | Live ops routes (9: live, drill-downs, runs, ai, errors, switches, announcements, emergency) | PARTIAL | Dashboard.tsx:212-455 (live panel, stage control, announcement composer); Dashboard.tsx:344-350 (kill switches read-only chips) | One embedded panel; no drill-downs/runs/AI/errors pages; kill switches not togglable (no API); no emergency room |
| 1.1 | `/review`, `/review/:id` | DONE | frontend/src/App.tsx:54-67; frontend/src/pages/review/Queue.tsx:10-170, ItemDetail.tsx:29-295; backend review.py:28-247 | Paths are `/review/items/:itemId` (naming deviation only) |
| 1.1 | `/review/:id/compare` | MISSING | frontend/src/pages/review/ItemDetail.tsx:133-292 | No answer-pack comparison (answer packs absent, Part 2) |
| 1.1 | `/disputes`, `/disputes/:id` (reviewer or organizer) | PARTIAL | Dashboard.tsx:644-728 (embedded section, organizer-only area); App.tsx:55-67 | Embedded disputes resolve; no detail route; reviewers cannot view disputes at all |
| 1.1 | `/events/:id/rescore`, `/leaderboard`, `/finalize`, `/result-preview` | MISSING | grep in frontend/src: no rescore/leaderboard-admin/finalize/result-preview; admin.py:106-144 | Only a `closed→finalized` status button without step-up (F-AD8A-02); no rescore dry-run, no result preview |
| 1.1 | System routes (runner, ai, integrity, audit, exports, health, readiness, settings) | PARTIAL | Dashboard.tsx:459-514 (readiness), 518-548 (exports), 550-640 (audit), 732-762 (health) | Audit/exports/health/readiness embedded as sections; runner/ai/integrity/settings console routes missing |
| 1.1 | `/preview/*`, `/debug/state/:pid` | MISSING | grep `/admin/participants` in backend: no matches; frontend none | No redacted state dump endpoint or preview pages |
| 1.2 | Shell: top bar (event ▾, env chip, ⌘K search, presence, me), 240px left nav, page header w/ breadcrumb+T+elapsed, alert strip, degraded status strip | DEVIATION | frontend/src/components/chrome.tsx:102-135 (top nav only), 190-208 (OfflineBanner defined, never used — grep usage: none) | No left nav, env chip, search, presence, nav badges or global status strip; event picker lives inside page content (Dashboard.tsx:789-800) |
| 1.3 | Components C-80..C-99 (20 components) | MISSING | frontend/src/ui/components.tsx:20-450 (inventory: Chip, StatusChip, Panel, Button, ConfirmButton, Field, EmptyState, LoadingShell, ErrorBanner, KVRow, etc.); grep for C-80..C-99 names in src: no matches | 0 of 20 implemented; nearest analogue is ConfirmButton (no preview/dry-run semantics) |
| 1.4 r1 | Destructive = EffectPreview → reason → confirm | PARTIAL | Dashboard.tsx:363-393 (reason required for stage actions, end has ConfirmButton); backend admin.py:291-297 enforces reason; Dashboard.tsx:160-168 (event transitions: confirm but NO reason) | Reason+confirm present for stage control; no EffectPreview; event transitions have no reason |
| 1.4 r2 | Every list: total + cursor pagination, no "Load all" | DEVIATION | Dashboard.tsx:632-635 ("Load more" raises limit, cap 500); backend admin.py:1050-1075 (limit param, no cursor); review.py:38 (fixed LIMIT 200); Queue.tsx:50-58 (client-side counts) | Limit-offset refetching, not cursors; no server-side totals; queue silently truncates at 200 |
| 1.4 r3 | Table export of current filter, server-side, expiring link | DEVIATION | Dashboard.tsx:518-548; backend admin.py:1078-1172; StepUp.tsx:109-119 (client-side blob download) | 3 fixed kinds only; content returned inline, not an expiring link; no audit entry on export |
| 1.4 r4 | Sensitive views audited + red "Sensitive, access logged" border | MISSING | Challenges.tsx:291-310 (GT recorder, no border); no GT read endpoints in admin.py; Dashboard.tsx:600-637 (audit viewer unmarked) | GT writes are audited (admin.py:800-810); no sensitive views exist to border; audit viewer itself unmarked |
| 1.4 r5 | Timestamps in event TZ with UTC tooltip | PARTIAL | frontend/src/lib/format.ts:1-49 (hardcoded IST suffix, no tooltip); admin.py:208 returns event timezone (unused by UI) | IST matches default event TZ; no UTC tooltip; TZ hardcoded, not event-driven |
| 1.4 r6 | Request ID clickable (copy + audit search) | MISSING | Dashboard.tsx:626 (plain text cell) | No copy/search affordance |
| 1.4 r7 | Stable deep link per entity | PARTIAL | App.tsx:44, 62 (submission, review item deep links); Dashboard.tsx is a single page (no participant/team/ledger/job links) | Review/submission links exist; admin-side entities not linkable |
| 1.4 r8 | Bulk actions: typed count confirmation (R-34) | MISSING | grep bulk actions in frontend/src: none; ui/components.tsx (no BulkActionBar) | No bulk actions exist at all |
| 1.4 r9 | Dry run writes `dry_run = true` audit event, no other change | MISSING | grep `dry` in frontend/src and backend/app/routers/admin.py: no matches | No dry-run support anywhere |
| 1.4 r10 | Reversibility indicator (undo window / no undo / requires X) | MISSING | grep `undo` in frontend/src: no matches | Never shown |
| 1.5 | No impersonation: admins never sign in as participants | DONE | backend/app/routers/auth.py:54-192 (login only as self); no act-as/impersonation endpoints (grep: no matches) | No impersonation surface exists |
| 1.5 | `GET /admin/participants/{pid}/state` redacted (tokens/drafts removed), admin-owned read-only pages, audited | MISSING | grep `participants/\{?pid\|/state` in backend: only public `/state` clock (state.py:45); no endpoint, no preview/debug pages | Endpoint and both pages absent |
| 1.5 | Participant SPA never runs on admin origin | DEVIATION | frontend/src/App.tsx:22-87 (one SPA serves `/app` participant console and `/admin` on same origin) | Single-origin SPA; cookies/storage shared across participant and admin surfaces |
| 1.6 | `/users` and every list scoped to signed-in admin's tenant; cross-tenant queries rejected in API (R-36) | MISSING | backend/app/deps.py:42-53 (Principal has no tenant_id); admin.py:202-214 (list_events unscoped), 514-530 (participants), 1050-1075 (audit), 1178-1191 (disputes all tenants); admin.py:51 and auth.py:215 (pick "first tenant") | Zero tenant filtering or rejection; F-AD8A-01 |

## Findings

### F-AD8A-01 — HIGH — No tenant scoping in admin API; cross-tenant queries are not rejected (spec 1.6 / patch E.4, R-36)
- **Evidence:** backend/app/deps.py:42-53 (Principal carries id/email/name/role/status/session only); backend/app/routers/admin.py:202-214 (`GET /admin/events` — no tenant filter), admin.py:514-530 (`/admin/events/{id}/participants` — event_id accepted without tenant check), admin.py:1050-1075 (`/admin/audit` — global), admin.py:1178-1191 (`/admin/disputes` — global join), admin.py:51 and auth.py:214-217 (`SELECT id FROM app.tenants ORDER BY created_at LIMIT 1` — caller's tenant ignored when creating events/users).
- **Impact:** Spec R-36 explicitly requires API-level rejection. Any organizer/admin token operates across all tenants; event/team/stage IDs are never verified to belong to the caller's tenant. Today's single seeded tenant masks the flaw, but adding a second tenant immediately yields cross-tenant data disclosure and mutation.
- **Fix:** Load `tenant_id` into Principal from `app.users`; require every admin query to filter by it; reject event/stage/team/challenge IDs whose tenant differs (403-style `ApiError`), including in `create_event`, `register`, dispute resolution and exports.

### F-AD8A-02 — HIGH — Irreversible finalization (and other lifecycle transitions) lack step-up and reason
- **Evidence:** backend/app/routers/admin.py:106-144 (`POST /admin/events/{id}/status` — `require_organizer` only; body is `{status}` with no reason; `closed→finalized` allowed); frontend/src/pages/admin/Dashboard.tsx:160-168 (ConfirmButton, no reason input, no step-up prompt). Contrast: challenge/GT content ops do require step-up (admin.py:543, 568, 651, 749, 822, 855 via `step_up_verified`).
- **Impact:** Spec 1.1 requires `organizer + step-up` for `/events/:id/finalize` (irreversible) and `/events/:id/rescore`; 1.4 r1 requires a reason for every destructive action. A stolen/lapsed organizer session can finalize (or set live/closed) an event with one click and no fresh password or recorded justification.
- **Fix:** Route `finalized` (and destructive transitions) through `step_up_verified` plus a mandatory reason field; audit the reason (`details={"reason": ...}`).

### F-AD8A-03 — HIGH — Admin sign-in has no MFA; first-login password-set enables takeover of invited staff accounts
- **Evidence:** backend/app/routers/auth.py:70-89 (registered account with empty `password_hash`: the typed password becomes the password and the account is activated; comment "this is a risk we are willing to take"), auth.py:203-247 (admin-only `/auth/register`); frontend/src/pages/Login.tsx:45-51 (documents the flow); backend/app/deps.py:144-147 ("In v1 without MFA infrastructure...").
- **Impact:** Spec 1.1 specifies `/login` as sign-in (MFA). Any party who learns a registered-but-unused organizer/admin email can claim the account by signing in first with any password, gaining full admin console access; no second factor protects staff accounts.
- **Fix:** Require the activation invite token to set a password (endpoint `/auth/activate` already exists at auth.py:390); never accept password-on-first-login for staff roles; add TOTP/WebAuthn step-up for staff sign-in (ADR-008 path).

### F-AD8A-04 — HIGH — Route map largely unimplemented: ~40 of ~50 admin routes have no page
- **Evidence:** frontend/src/App.tsx:69-82 (only `/admin` index + `/admin/challenges`); frontend/src/components/chrome.tsx:96-100 (nav has 2 admin entries); grep for content/participants/teams/users/admin-users/ground-truth/rubric/harness/answer-authority/candidate-bugs/emergency/rescore/leaderboard/finalize/result-preview/runner/ai/integrity/settings/preview/debug pages: none. Backend endpoints without any UI caller: config revisions (admin.py:153-199), stage creation (admin.py:241-276), teams/invites/participants listing (admin.py:439-530), time adjustment (admin.py:915-942), manual adjustment (admin.py:1261-1301) — grep in frontend/src confirms no calls.
- **Impact:** Core organizer workflows (participant import/management, content, ground-truth authoring, live drill-downs, emergency actions, rescoring, finalization, integrity, settings) are only reachable via raw API calls; the spec's admin frontend is effectively absent beyond a dashboard.
- **Fix:** Prioritize pages for participants/teams, ground truth, live drill-downs and finalize/rescore (with their required step-up/two-approver semantics), or record an explicit scope cut in the spec.

### F-AD8A-05 — MEDIUM — Fine-grained admin roles (author, ground-truth, operator, content editor, super admin, integrity officer, auditor) not implemented
- **Evidence:** backend/app/deps.py:100-118 (only `reviewer`, `organizer`, `admin` roles exist); all admin routers use `require_organizer`/`require_admin`/`step_up_verified` (e.g. admin.py:49, 107, 242, 292, 1262).
- **Impact:** Spec 1.1 assigns per-page permissions (e.g. `/challenges` = author; `/runner`,`/ai` = operator; `/integrity` = integrity officer; `/settings` = super admin). Every organizer can perform every privileged operation (except admin-only adjustments), defeating least privilege and two-role separation.
- **Fix:** Introduce the spec's role set (or a permission matrix) and gate each route/endpoint accordingly.

### F-AD8A-06 — MEDIUM — Shell layout deviates from spec 1.2 (no left nav, environment chip, ⌘K search, presence, nav badges, status strip)
- **Evidence:** frontend/src/components/chrome.tsx:102-135 (single top bar: wordmark, nav, role chip, sign out); chrome.tsx:190-208 (`OfflineBanner` — the closest thing to a degraded strip — is defined but never used; grep usage: none); Dashboard.tsx:344-350 (kill switches as chips).
- **Impact:** Operators lose the spec's situational-awareness affordances: no environment coloring (prod indistinguishable), no global command palette, no degraded-mode banner, no nav badges for pending reviews/disputes/errors.
- **Fix:** Implement the 1.2 shell (env chip from `settings.environment`, C-80 palette, presence, degraded strip wired to `/admin/system/health` polling).

### F-AD8A-07 — MEDIUM — All 20 spec components (C-80..C-99) are missing
- **Evidence:** grep for `CommandPalette|EffectPreview|ApprovalFlow|EmergencyPanel|ReachPanel|TimelineScrubber|LedgerInspector|RunTimeline|AnswerPackEditor|RubricBuilder|EvidenceAttach|BulkActionBar|SnapshotDiff|KillSwitchTile|IncidentBanner|SessionKiller|GuidedRecovery|AnswerAuthorityConsole|AIPipelineViewer|ReviewerDecisionDiff` in frontend/src: no matches; frontend/src/ui/components.tsx:20-450 (generic primitives only).
- **Impact:** The safety UX of Part 1/2 (two-approver flows, effect previews, kill-switch tiles, answer-pack editor, reviewer-vs-AI diff) has no building blocks; confirmations fall back to a plain ConfirmButton without preview semantics.
- **Fix:** Implement C-80..C-99 (at minimum C-81 EffectPreview, C-82 ApprovalFlow, C-91 BulkActionBar, C-93 KillSwitchTile) before the destructive flows they guard.

### F-AD8A-08 — MEDIUM — Destructive-action pattern incomplete: no EffectPreview, no dry run, no undo indicators, no typed-count bulk confirmation
- **Evidence:** grep for `dry`, `undo`, `EffectPreview` in frontend/src and backend/app/routers/admin.py: no matches; Dashboard.tsx:160-168, 386-393 (ConfirmButton as the only guard); ui/components.tsx:169 (ConfirmButton = arm + confirm).
- **Impact:** Spec 1.4 r1/r8/r9/r10 (patch R-34 included) unmet: mutations like `end` round, `extend`, `finalized`, dispute resolution with point adjustments, and GT test-result recording take effect with no preview of participant-facing impact, no dry-run audit trail, and no reversibility signal.
- **Fix:** Add dry-run variants on destructive endpoints (audit `dry_run=true`, no writes), a participant-facing effect preview component, and undo windows/reversal notes on confirmations.

### F-AD8A-09 — MEDIUM — Exports: fixed kinds, inline delivery (no expiring link), and no audit entry
- **Evidence:** backend/app/routers/admin.py:1078-1172 (`export_csv` — kinds results/submissions/ledger only; returns `content` in the JSON body; inserts into `app.exports` but never calls `audit_write`; no filter parameters); StepUp.tsx:109-119 (client-side blob download); Dashboard.tsx:518-548.
- **Impact:** Spec 1.4 r3 requires per-table export of the *current filter*, generated server-side and delivered as an *expiring link*. Full ledger/results CSV can be exfiltrated with zero audit trail (rule 4's "every view of sensitive data is audited" likewise unmet for exports).
- **Fix:** Accept filter/cursor params; persist the artifact; return an expiring signed download URL; write an `export.created` audit entry per request.

### F-AD8A-10 — MEDIUM — `GET /admin/participants/{pid}/state` and the preview/debug pages are missing (patch E.4)
- **Evidence:** grep `participants/{pid}`/`/state`/`preview`/`impersonat` across backend: only public clock `/state` (state.py:45); frontend/src/App.tsx:22-87 has no `/preview/*` or `/debug/*` routes.
- **Impact:** Spec 1.5's incident tooling (redacted state dump, admin-rendered participant snapshot with tokens/drafts removed, every view audited) does not exist; incident response requires direct DB access, and the "result preview" workflow in 1.1 is impossible.
- **Fix:** Implement the redacted state endpoint (strip tokens and draft content), audited per view, plus read-only admin-owned preview components.

### F-AD8A-11 — MEDIUM — One SPA/origin serves both the participant and the admin console
- **Evidence:** frontend/src/App.tsx:22-87 (single router mounts `/app` participant pages and `/admin` organizer pages); chrome.tsx:102-135 (shared ConsoleShell).
- **Impact:** Spec 1.5 requires the participant SPA never to run on the admin origin. Any XSS or dependency compromise in a participant-facing component shares origin, refresh-cookie scope and localStorage with the admin console, widening admin-session attack surface.
- **Fix:** Serve the admin console from a separate origin (or at minimum a separate build/entry with isolated storage) and document the D1 deviation if splitting is deferred.

### F-AD8A-12 — MEDIUM — Lists lack totals and cursor pagination; "Load more" refetches with a bigger limit
- **Evidence:** Dashboard.tsx:632-635 ("Load more" → `limit += 100`, capped 500); backend admin.py:1050-1075 (`limit` param, `LIMIT :n`, no cursor, no total); review.py:28-62 (`LIMIT 200`, no pagination/total); Queue.tsx:50-58 (counts computed client-side from the truncated page).
- **Impact:** Spec 1.4 r2 violated: no server-side totals, no cursors, and the audit/queue views silently truncate (audit >500 entries and queue >200 items become invisible), hiding activity from operators.
- **Fix:** Return `{total, next_cursor}` envelopes and drive pagination from cursors; show totals server-side.

### F-AD8A-13 — MEDIUM — Sensitive-view rule (red "Sensitive, access logged" border) not implemented anywhere
- **Evidence:** Challenges.tsx:291-310 (ground-truth test recorder — the only GT-related view — has no border); backend admin.py has no GT read endpoints; Dashboard.tsx:600-637 (audit viewer, no border/marking).
- **Impact:** Spec 1.4 r4: even where sensitive surfaces exist (GT recorder, audit log), the access-logged affordance is absent and GT data has no audited view path (only writes are audited, admin.py:800-810).
- **Fix:** Add the border component and an `audit_write` on every sensitive GET once GT/answer-pack views exist.

### F-AD8A-14 — MEDIUM — Disputes not visible to reviewers (spec: `/disputes` = reviewer or organizer)
- **Evidence:** frontend/src/App.tsx:55-67 (review console exposes only queue + item pages); disputes section exists solely in the organizer area (Dashboard.tsx:644-728); backend review.py has no dispute endpoints (grep: none).
- **Impact:** Reviewers cannot track outcomes of reports they decided, contradicting the 1.1 permission model (`/disputes` and `/disputes/:id` for reviewer or organizer).
- **Fix:** Add a disputes view to the reviewer console (read-only) or a shared disputes route with role check.

### F-AD8A-15 — LOW — Timestamps hardcoded to IST; no UTC tooltip; event timezone ignored
- **Evidence:** frontend/src/lib/format.ts:1-49 (`const IST = 'Asia/Kolkata'`, no tooltip); admin.py:208 returns the event's `timezone` column but no frontend code reads it.
- **Impact:** Spec 1.4 r5 partially met (event TZ shown for the default event); no UTC tooltip; wrong display if an event sets another timezone.
- **Fix:** Format from the event timezone and add a `title`/tooltip with the UTC equivalent.

### F-AD8A-16 — LOW — Request IDs are plain text, not clickable/copyable, no audit-log search
- **Evidence:** Dashboard.tsx:626 (`<td className="mono small">{e.request_id}</td>`).
- **Impact:** Spec 1.4 r6 unmet; incident correlation from an error banner to the audit log requires manual copy.
- **Fix:** Render request IDs as a copy-to-clipboard control that deep-links into the audit viewer filtered by `request_id`.

## Notable EXTRA (not a spec violation)
- `POST /admin/events/{event_id}/time-adjustment` (admin.py:915-942), `POST /admin/adjustments` (admin.py:1261-1301, admin-only, reason required), `POST /admin/jobs/auto-submit` and `POST /admin/events/{event_id}/levels/bootstrap` (admin_levels.py:231, 248) exist with correct auth + audit but have no admin UI at all — they match spec concepts from other documents (TIM/ADM) but not the 08 route map.
- The seed/admin flow exposes stage, team and invite creation only via API; the frontend comment acknowledges it ("stages are created via the stage API", Challenges.tsx:286; Dashboard.tsx:357).

---

### 4.11 08 Admin Deep Specification, Parts 2-3 - Answer Authority (`admin08b`)

# Audit report: 08 Admin Deep Spec, Parts 2-3 (Answer Authority)

- **Agent:** admin08b
- **Task ID:** 4-c
- **Baseline document:** /home/z/my-project/upload/08_Admin_Deep_Spec_patched.md (patched v0.2, patches E.1-E.4, R-30..R-36)
- **Scope:** Part 2 (Answer Authority: 2.1 kinds of answer, 2.2 GT authoring incl. 2.2.3 unplanned bugs, 2.3 answer packs, 2.4 mid-event correction protocol, 2.5 GT after freeze) and Part 3 (open items O-1..O-4)
- **Repo HEAD:** f1412b7eec6c92c4c168fd2b8a58182b34480387 (2026-11-26)
- **Code areas audited:** backend/app (models_gt.py, matching.py, evaluator.py, evaluator_level.py, scoring.py, routers/admin.py, routers/review.py, routers/admin_levels.py, routers/challenges.py, db.py, deps.py, jobs.py), backend/migrations (0001-0003), scripts/dev_db.sh, backend/tests/test_gt_isolation.py, backend/seed.py, frontend/src (App.tsx, pages/admin/Challenges.tsx, pages/review/ItemDetail.tsx), challenge-app (ORGANIZER_ANSWER_KEY.md), challenge-app-option-b, docs (GROUND_TRUTH_ISOLATION.md, CHALLENGE_DESIGN_AND_GROUND_TRUTH.md, SCORING_MODEL.md, KNOWNS_LIMITATIONS_AND_FOLLOWUPS.md, REVIEWER_HANDBOOK.md, EVENT_OPERATIONS_PLAYBOOK.md, API_REFERENCE.md).

## Executive summary

The pre-freeze ground-truth half of the spec is substantially implemented (gt schema isolation, freeze/lock semantics, deterministic matcher, append-only ledger). The entire answer-pack / mid-event-correction half (gt.answer_packs, gt.answer_pack_entries, gt.candidate_bugs, gt.answer_pack_links, lifecycle, two-approver activation, impact-preview dry run, timing guard, rescore job, correction ID, answer-authority console) is absent from schema, API, worker and frontend. The repo itself documents this as a known gap (KNOWNS_LIMITATIONS_AND_FOLLOWUPS.md L-11, P1) and routes reviewer `unplanned_valid` decisions into a re-queue loop instead of a candidate-bug queue.

## Per-section status table

| Spec ref | Requirement (short) | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| 2.1 GT | Ground truth kind: pre-freeze authoring, immutable after publish | DONE | backend/app/routers/admin.py:659-660, 757-758; backend/app/routers/admin.py:650-685 | Add-bug/upload refuse once version not draft/reviewed (409 GROUND_TRUTH_LOCKED); freeze seals with content hash. Owner role is organizer/admin + step-up, no dedicated "ground-truth role" |
| 2.1 AP | Answer pack kind: versioned, active/archived, two approvers | MISSING | backend/migrations/0001_init.sql:573-652; repo-wide grep | No gt.answer_packs / gt.answer_pack_entries / gt.answer_pack_links tables, no lifecycle code |
| 2.1 MD | Manual decision: append-only ledger entry scoring a report | PARTIAL | backend/app/routers/review.py:178-247; backend/app/evaluator.py:319-404; backend/app/scoring.py:30-65 | Decisions recorded append-only; but reviewer accept of a never-claimed report writes no ledger entry (see F-AD8B-09) |
| 2.2 layout | `/challenges/:id/ground-truth` page: red banner, rail, tabs, code view | MISSING | frontend/src/App.tsx:74-78; frontend/src/pages/admin/Challenges.tsx:1-393 | Admin frontend has only Dashboard + Challenges; GT authoring UI is create/upload/freeze/publish/test-results forms |
| 2.2.1 | `award_unit_id` generated | DEVIATION | backend/app/routers/admin.py:735-748; backend/app/models_gt.py:48 | `code` is caller-supplied (BugIn.code), not generated |
| 2.2.1 | `canonical_file` must exist in frozen repo tree | MISSING | backend/app/routers/admin.py:779-792 | Locations inserted with no check against app.challenge_files paths |
| 2.2.1 | `line_anchors[]` 1-10 anchors, within file length | PARTIAL | backend/app/routers/admin.py:744, 779-792 | Max 8 locations (not 1-10); no line-within-file-length validation |
| 2.2.1 | `aliases[]` each `{file, lines[]}` alternative locations | DEVIATION | backend/app/models_gt.py:74-83; backend/app/models_gt.py:59-71 | Aliases are weighted keywords; alternative locations modeled via gt_locations.is_primary=false |
| 2.2.1 | `category` enum (logic, security, performance, ...) | DEVIATION | backend/app/routers/admin.py:739; backend/app/matching.py:25-38 | Free-text category; CATEGORIES_FAMILIES uses a different taxonomy (injection, data_handling, configuration, ...) |
| 2.2.1 | `severity` low/medium/high, informational | DEVIATION | backend/app/routers/admin.py:738; backend/app/models_gt.py:50 | Adds `critical`; not scored (informational) as specced |
| 2.2.1 | `weight_multiplier` default 1 (R-31) | MISSING | backend/app/models_gt.py:44-56; backend/app/routers/admin.py:735-745 | No weight_multiplier anywhere; direct `points` only |
| 2.2.1 | `canonical_patch_md`/`reference_explanation_md` reviewer-only | PARTIAL | backend/app/models_gt.py:54-55; backend/app/routers/submissions.py:371-375, 416-418 | Analogues `explanation`/`fix_guidance` exist; participants only ever see matched_bug_code/points after release |
| 2.2.2 r1 | Bugs are structured data, not essays | DONE | backend/app/routers/admin.py:735-811; backend/app/models_gt.py:31-56 | Structured fields + locations + aliases |
| 2.2.2 r2 | Matchability check: "Test against sample report" runs matcher inline | MISSING | repo-wide grep of backend/app (no dry/sample/harness endpoint); backend/app/routers/admin.py (no such route) | No endpoint or UI action |
| 2.2.2 r3 | Overlap warning + "Confirm distinct" | MISSING | backend/app/routers/admin.py:748-811 | No overlap detection between gt bugs at authoring time |
| 2.2.2 r4 | Per-bug draft state + "Publish draft" | MISSING | backend/app/routers/admin.py:759-778 | Direct insert, no draft/publish states |
| 2.2.2 r5 | Freeze locks whole challenge; read-only after | DONE | backend/app/routers/admin.py:650-685, 757-758; backend/migrations/0001_init.sql (challenge_versions.status flow) | GROUND_TRUTH_LOCKED after seal; UI freeze button exists (Challenges.tsx:134-139) |
| 2.3.1 | gt.answer_packs + one_active_pack partial unique index | MISSING | backend/migrations/0001_init.sql:573-652 | Table set is gt_bugs/gt_flags/gt_revisions/gt_aliases/gt_locations/gt_test_cases only |
| 2.3.1 | gt.answer_pack_entries (award_unit_id UNIQUE, origin check) | MISSING | backend/migrations/0001_init.sql:573-652 | Absent |
| 2.3.1 | gt.candidate_bugs (submission/flag/rationale/state) | MISSING | backend/migrations/0001_init.sql:573-652; backend/app/routers/review.py:170-208 | Only the `unplanned_valid` decision string exists |
| 2.3.1 | gt.answer_pack_links (link report with reason) | MISSING | backend/migrations/0001_init.sql:573-652 | Absent |
| 2.3.1 | Triggers: no update/delete of active/archived pack rows | MISSING | backend/migrations/0001_init.sql; 0002_score_ledger_immutable.sql | No pack triggers; 0002 covers only score ledger |
| 2.3.1 | Ledger origin triple w/ num_nonnulls=1 (R-33) | MISSING | backend/migrations/0001_init.sql:488-512; backend/app/scoring.py:30-65 | Single `award_unit_id VARCHAR(80)`; no origin columns |
| 2.3.1 | Activation: gt role + step-up + two approvers in approved_by | MISSING | repo-wide grep (no activation code) | No activation path exists |
| 2.3.1 | No grant on gt schema to app_api/worker/participant roles | DONE | scripts/dev_db.sh:110-131; backend/tests/test_gt_isolation.py:18-52 | gt granted to gt_admin only; enforced by real-role tests |
| 2.3.2 | Lifecycle DRAFT→ACTIVE→ARCHIVED, exactly one active | MISSING | repo-wide grep | Absent |
| 2.3.3 | GT+AP one combined index; AP overlapping GT rejected at activation | MISSING | backend/app/matching.py:121-199; backend/app/evaluator.py:44-84 | Matcher considers gt_bugs only; no combined candidate set, no overlap rejection |
| 2.3.4 | Answer-pack console route/UI (C-88 AnswerPackEditor) | MISSING | frontend/src/App.tsx:74-78; no backend endpoints | Absent in API and frontend |
| 2.2.3 s1 | Reviewer "Escalate as unplanned bug" creates candidate row w/ rationale, state pending | PARTIAL | backend/app/routers/review.py:170-208; backend/app/evaluator.py:394-404 | `unplanned_valid` decision exists; no candidate_bugs row, rationale is free-text notes, no pending state; re-queues a fresh review item (loop, F-AD8B-04) |
| 2.2.3 s2 | GT user sees /candidate-bugs; Reject (reason) or Draft AP entry (no GT overlap) | MISSING | repo-wide grep; frontend/src/App.tsx:74-78 | No queue, no endpoint, no UI |
| 2.2.3 s3 | Nothing scored at this stage | DONE | backend/app/evaluator.py:394-404 | unplanned_valid writes no ledger entry |
| 2.2.3 s4 | Activation follows §2.4 | MISSING | see 2.4 rows | No activation exists |
| 2.4 s1 | Escalate (reviewer + rationale) | PARTIAL | backend/app/routers/review.py:178-247 | Decision recorded with notes; no structured candidate/rationale |
| 2.4 s2 | Evaluate: GT user rejects or drafts AP entry; GT overlap rejected | MISSING | backend/app/routers/admin.py (no endpoint) | Absent |
| 2.4 s3 | Impact preview dry run, writes nothing, byte-identical output | MISSING | repo-wide grep (dry_run/preview: no matches in backend/app) | Absent |
| 2.4 s4 | Approve: two approvers, step-up, reason | MISSING | repo-wide grep (no approval flow anywhere) | Absent |
| 2.4 s5 | Announce: draft + preview, must not reveal issue location | MISSING | backend/app/routers/admin.py:891-912 | Announcement endpoint is free-text only; no draft/preview, no location-leak guard |
| 2.4 s6 | Timing guard: block activation in last N minutes (default 10) | MISSING | repo-wide grep | Absent (also O-4 unresolved) |
| 2.4 s7 | Activate: new pack active, previous archived | MISSING | repo-wide grep | Absent |
| 2.4 s8 | Idempotent rescore job (JOB-09) appends reversal+award entries | MISSING | backend/app/evaluator.py:107-644 (full handler registry); backend/app/evaluator_level.py:97 | No rescore job; reversal primitive (reverses_entry_id) exists unused by any correction flow |
| 2.4 s9 | Publish: leaderboard_version increments; receipts updated | PARTIAL | backend/app/scoring.py:167-183; backend/app/routers/leaderboard.py | Snapshot versioning exists, but only via refresh_leaderboard at release, not from a correction flow |
| 2.4 s10 | Every step audited under one correction ID | MISSING | backend/app/audit.py; backend/app/routers/admin.py | Audit chain exists; no correction-ID linkage |
| 2.5 | GT not editable after freeze | DONE | backend/app/routers/admin.py:589-590, 659-660, 757-758 | Enforced (GROUND_TRUTH_LOCKED) |
| 2.5 | Corrections go through §2.4 as answer-pack entries | MISSING | docs/KNOWNS_LIMITATIONS_AND_FOLLOWUPS.md:27 (L-11); backend/seed.py:862-872 | Only gt_revisions (seed-time) exists; in-event promotion requires direct SQL/seed |
| P3 O-1 | Answer-pack console fields beyond §2.3.4 | OPEN/MISSING | baseline doc 08 §3 | Doc open; implementation absent |
| P3 O-2 | AI reasoning pipeline in depth | OPEN | baseline doc 08 §3 (02 §9.4 baseline) | Out of this audit's scope; ai_assessment_enabled=False kill switch exists (backend/app/config.py) |
| P3 O-3 | Emergency-powers catalog with safety rails | OPEN/MISSING | repo-wide grep (no emergency/powers concept) | Two-approver, dry-run rails absent; closest analogs: admin/adjustments (single admin, no dry run) |
| P3 O-4 | Timing-guard default (10 min) confirm | OPEN/MISSING | repo-wide grep | Unimplemented and unconfirmed |

## Findings

### F-AD8B-01 - HIGH - Answer-pack data model entirely missing (gt.answer_packs, gt.answer_pack_entries, gt.answer_pack_links; one_active_pack index; activation approval; pack immutability triggers)
- **Severity:** HIGH
- **Evidence:** backend/migrations/0001_init.sql:573-652 (gt schema contains only gt_bugs, gt_flags, gt_revisions, gt_aliases, gt_locations, gt_test_cases); backend/app/models_gt.py:31-131 (no answer-pack models); repo-wide grep for answer_pack returns only docs.
- **Impact:** The spec's central mid-event mechanism (versioned answer packs, exactly one active per (event, challenge), two-approver activation, immutable active/archived entries) does not exist. Real bugs missed by GT cannot be scored mid-event without rewriting GT, which 2.5 forbids; organizers must resort to direct SQL (documented in KNOWNS_LIMITATIONS_AND_FOLLOWUPS.md L-11 as P1).
- **Fix:** Add a migration creating gt.answer_packs (with UNIQUE (event_id, challenge_id, version) and the one_active_pack partial unique index), gt.answer_pack_entries (award_unit_id UNIQUE, origin CHECK), gt.answer_pack_links, and BEFORE UPDATE/DELETE triggers for active/archived rows; add models, step-up-gated lifecycle endpoints (draft→activate with two approvers recorded in approved_by→archive previous), and include AP entries in the evaluator's candidate query.

### F-AD8B-02 - HIGH - gt.candidate_bugs and the unplanned-bug queue (/challenges/:id/candidate-bugs) missing
- **Severity:** HIGH
- **Evidence:** backend/migrations/0001_init.sql:573-652 (no candidate_bugs table); backend/app/routers/review.py:170-208 (only an `unplanned_valid` decision string); frontend/src/App.tsx:74-78 (no candidate-bugs route).
- **Impact:** Spec 2.2.3's escalation layer is not implemented: a reviewer's agreement that a real unplanned bug exists produces no pending/rejected/accepted record, no written-rationale field, no link to submission/flag, and no ground-truth-role decision surface. The audit trail for the answer decision is lost, and the two-layer protection (reviewer escalates, GT role decides) collapses into a re-queued review item.
- **Fix:** Add gt.candidate_bugs per the spec schema; on `unplanned_valid` decision create the row (submission_id, flag/report id, rationale from reviewer notes, state=pending); add step-up-gated admin endpoints to list/Reject (reason required, returns report to review)/Draft AP entry, all audited.

### F-AD8B-03 - HIGH - Mid-event correction protocol (§2.4, patch E.3) not implemented: no impact preview/dry run, no two-approver approval, no announcement preview, no timing guard, no activation, no rescore job, no correction ID
- **Severity:** HIGH
- **Evidence:** backend/app/evaluator.py:107-644 and backend/app/evaluator_level.py:97 (complete job-handler registry: evaluate_submission, create_review_item, verify_flag, apply_review_outcome, apply_test_results, release_feedback, refresh_leaderboard, dispatch_outbox, evaluate_level_submission - no rescore); repo-wide grep for dry_run/preview returns nothing in backend/app; backend/app/routers/admin.py:1194-1301 (dispute adjust_points and admin MANUAL adjustments are the only in-event score corrections, single-actor, no dry run).
- **Impact:** All ten protocol steps are absent except the escalation decision (partial). In-event score changes happen only via dispute/manual adjustments with no impact preview, no two-person control, no announcement discipline (leak of the issue location is possible since announcements are free text), no timing guard near stage end, and no linked audit chain (no correction ID). This is a major spec violation of the patched E.3 flow.
- **Fix:** Implement a correction flow keyed by one correction ID: impact-preview endpoint computing affected participants/deltas/leaderboard changes/reversals without writes; activation requiring step-up + two approvers; announcement draft+preview enforced to not include locations; a blocking timing guard (configurable N=10 min, emergency override flag with two approvers); an idempotent rescore job appending reversal+award entries (reverses_entry_id) that skips never-submitted drafts; leaderboard republish; audit entries at each step.

### F-AD8B-04 - MEDIUM - `unplanned_valid` decision regenerates review items in a loop with no terminal state
- **Severity:** MEDIUM
- **Evidence:** backend/app/routers/review.py:201-208 (decision maps submission to needs_review and marks the item decided); backend/app/evaluator.py:394-404 (apply_review_outcome for unplanned_valid sets needs_review and enqueues create_review_item reason 'unplanned_valid', priority 2); backend/app/evaluator.py:211-232 (create_review_item inserts a new item because the old one is now 'decided').
- **Impact:** Each unplanned_valid decision produces a fresh open review item for the same submission; repeated decisions cycle indefinitely (each writing another app.reviews row), flooding the queue with priority-2 items and never reaching a pending/accepted/rejected answer state. Reviewer workload grows and the report never leaves review.
- **Fix:** On unplanned_valid, create a candidate_bugs row (state pending) and stop re-enqueueing a review item; only a GT-role reject (with reason) should return the submission to review.

### F-AD8B-05 - MEDIUM - Ledger origin discriminator (patch R-33) missing
- **Severity:** MEDIUM
- **Evidence:** backend/migrations/0001_init.sql:488-512 (score_ledger_entries has a single award_unit_id VARCHAR(80); no gt_award_unit_id/ap_entry_id/manual_decision_id columns or num_nonnulls CHECK); backend/app/scoring.py:30-65 (add_ledger_entry signature).
- **Impact:** Once answer packs exist, ledger entries cannot be traced to their origin kind (GT award unit vs AP entry vs manual decision), which the patch requires for reproducibility and rescoring; today reason_code strings are the only provenance.
- **Fix:** Add the three nullable origin columns with CHECK (num_nonnulls(...) = 1) to app.score_ledger_entries and thread the origin through add_ledger_entry call sites.

### F-AD8B-06 - MEDIUM - GT authoring validation gaps: canonical file existence, line-range bounds, anchor count, generated award-unit id
- **Severity:** MEDIUM
- **Evidence:** backend/app/routers/admin.py:735-811 (BugIn: code caller-supplied; locations list[dict] max_length=8, inserted verbatim with no check that file_path exists in app.challenge_files for the version, no line_start/line_end bounds vs file line_count); docs/GROUND_TRUTH_ISOLATION.md:44 (freeze-time anchor-hash verification is a documented follow-up, not implemented).
- **Impact:** A typo'd path or out-of-range lines silently produces a bug that can never match (location score 0), discovered only at evaluation time; spec requires canonical_file to exist in the frozen tree and anchors to be within file length (1-10 anchors; implementation caps at 8).
- **Fix:** In add_bug (and seed), validate each location's file_path against app.challenge_files for the challenge_version and line ranges against line_count; enforce the 1-10 anchor bound; generate award-unit ids server-side (or validate uniqueness) per spec 2.2.1.

### F-AD8B-07 - MEDIUM - Authoring UX and safety checks absent: no ground-truth page, no matchability check ("test against sample report"), no overlap warning, no per-bug draft/publish, no answer-authority console
- **Severity:** MEDIUM
- **Evidence:** frontend/src/App.tsx:74-78 (admin routes: index + challenges only); frontend/src/pages/admin/Challenges.tsx:208-310 (panels: create/upload/freeze/publish/test-results only); no matcher-inline or harness endpoint in backend/app/routers (grep for sample/harness/dry: no matches); no overlap check in backend/app/routers/admin.py:748-811.
- **Impact:** Spec 2.2 layout, 2.2.2 rules 2-4, and 2.3.4 console (C-88 AnswerPackEditor states draft/preview/active/archived) are unimplemented; organizers author GT only via raw API/seed without the spec's inline validation safety nets (matchability test, overlap "Confirm distinct", per-bug draft state).
- **Fix:** Add the ground-truth authoring page (red sensitive banner, rail, tabs, read-only code view with anchors), a step-up-gated POST .../ground-truth/test-match endpoint that runs matching.decide on a sample report, overlap detection between bugs (shared anchor or ≥50% same category) with a confirm flag, per-bug draft/publish states, and the answer-authority console once packs exist.

### F-AD8B-08 - MEDIUM - weight_multiplier (patch R-31) missing from the bug model
- **Severity:** MEDIUM
- **Evidence:** backend/app/models_gt.py:44-56 (gt_bugs has points Numeric(8,2), no weight_multiplier); backend/app/routers/admin.py:735-745 (BugIn has points only); backend/app/scoring.py:104-115 (compute_award_points uses bug_points directly).
- **Impact:** Stage base points cannot be multiplied per bug; per-bug weighting requires editing base points, losing the spec's separation between stage base points and bug difficulty multiplier.
- **Fix:** Add weight_multiplier numeric NOT NULL DEFAULT 1 to gt_bugs and BugIn, and multiply base points in the evaluator's compute_award_points call sites.

### F-AD8B-09 - MEDIUM - Reviewer acceptance of a never-claimed report scores nothing (MD gap)
- **Severity:** MEDIUM
- **Evidence:** backend/app/evaluator.py:339-357 (apply_review_outcome: looks up an existing award claim; if unit_id is None, no code_review ledger entry is written; submission still set to 'decided'); docs/SCORING_MODEL.md:96-101 (documents this as a v1 limit, P2); docs/KNOWNS_LIMITATIONS_AND_FOLLOWUPS.md:27.
- **Impact:** Spec 2.1 defines MD as "the ledger write that scores a specific report"; here a reviewer's accept_full on a valid-but-unmatched report produces no ledger entry at all, so the report is terminally 'decided' with zero score. Combined with the missing answer-pack path, valid unplanned findings can never be paid mid-event.
- **Fix:** On reviewer accept of an unclaimed report, either claim an award unit (creating one from a candidate/AP path) or write an explicit manual-decision ledger entry with the origin columns from F-AD8B-05.

### F-AD8B-10 - LOW - Category and severity taxonomies deviate from spec enums
- **Severity:** LOW
- **Evidence:** backend/app/routers/admin.py:739 (category free text), :738 (severity pattern includes critical); backend/app/matching.py:25-38 (CATEGORIES_FAMILIES taxonomy: injection, data_handling, configuration, authentication_authorization, ... vs spec's logic/security/performance/concurrency/input_validation/error_handling/other).
- **Impact:** Spec-conformant GT payloads cannot be imported as-is; family mapping partially compensates for matching but the specified `security`/`performance` categories have no equivalent, and `critical` severity is an extension.
- **Fix:** Either adopt the spec enums with a mapping table, or record the deviation as a ratified taxonomy change in the spec.

### F-AD8B-11 - LOW - Aliases are keywords, not alternative locations
- **Severity:** LOW
- **Evidence:** backend/app/models_gt.py:74-83 (GtAlias: keyword + weight, "matching evidence"); spec 2.2.1 defines aliases[] as {file, lines[]} alternative locations; alternative locations are instead gt_locations with is_primary=false (models_gt.py:59-71; docs/CHALLENGE_DESIGN_AND_GROUND_TRUTH.md:75-77 "Secondary location").
- **Impact:** Functional equivalents exist for both concerns (keyword evidence; non-primary anchors), but the field named `aliases` carries different semantics than the spec; a spec-driven authoring tool or importer would populate the wrong data.
- **Fix:** Rename or re-document: keep gt.aliases as keyword evidence and add an explicit `alternative_locations` concept in the spec, or align the model to the spec's alias shape.

### F-AD8B-12 - LOW - Field-name deviations: canonical_file/canonical_patch_md/reference_explanation_md/award_unit_id vs implementation
- **Severity:** LOW
- **Evidence:** backend/app/models_gt.py:44-56 (gt_bugs: code, title, severity, category, points, root_cause_group, explanation, fix_guidance - no canonical_file, canonical_patch_md, reference_explanation_md columns); reviewer-only visibility is enforced (backend/app/routers/submissions.py:371-375, 416-418 - matched_bug_code/points only after feedback_released).
- **Impact:** Semantics are largely covered (explanation≈reference_explanation_md, fix_guidance≈canonical_patch_md, canonical file implied by gt_locations.file_path), but the spec's named fields do not exist one-to-one, complicating traceability and future AP-entry authoring which reuses those names.
- **Fix:** Add the spec-named columns (or a documented mapping) so AP entries and GT share field names per 2.3.1.

## EXTRA observations (notable, not failures)

- gt-schema isolation is genuinely implemented and tested: scripts/dev_db.sh:110-131 grants gt only to gt_admin (no app_api/scheduler grants, including ALTER DEFAULT PRIVILEGES), and backend/tests/test_gt_isolation.py:18-52 verifies with the real app_api role. This satisfies the §2.3.1 isolation premise for the tables that exist.
- The score ledger is append-only at the DB level (backend/migrations/0002_score_ledger_immutable.sql:1-16 trigger rejects UPDATE/DELETE), supporting the MD kind's append-only mutability.
- `unplanned_valid` correctly scores nothing (backend/app/evaluator.py:394-404), satisfying §2.2.3 step 3's "nothing is scored at this stage" for the part that exists.
- Docs are honest about the gap: docs/KNOWNS_LIMITATIONS_AND_FOLLOWUPS.md:27 (L-11, P1: "Unplanned-bug promotion ... requires direct SQL/seed-level action"), docs/SCORING_MODEL.md:96-101, docs/REVIEWER_HANDBOOK.md:123-132, docs/EVENT_OPERATIONS_PLAYBOOK.md:329 (unplanned findings reconciled only post-event).

## Status tally (rows in the table above)

- DONE: 6
- PARTIAL: 7
- MISSING: 23
- DEVIATION: 6
- OPEN/MISSING (Part 3 doc items): 3 (O-1, O-3, O-4); O-2 open (out of scope)

## Severity tally (findings)

- CRITICAL: 0 | HIGH: 3 | MEDIUM: 6 | LOW: 3

---

### 4.12 D1 Polished Website Build Checklist - first half (`checklistA`)

# Checklist Compliance Audit — checklistA (first half)

- **Agent:** checklistA (Task ID 4-d)
- **Baseline doc:** `/home/z/my-project/audit/baseline/build_checklist.txt` (D1 Polished Website Build Checklist, lines 1–~2400; TOC + chapters 1–8, boundary at start of ch.9)
- **Repo HEAD:** `f1412b7eec6c92c4c168fd2b8a58182b34480387` (2026-11-26)
- **Method:** read-only audit; every DONE/PARTIAL/MISSING verdict below cites file:line actually read. Sign-off / owner / reviewer-initials columns are process, not code → **N-A** throughout.
- **Scope note:** Chapter 9 (Vertical Architecture, from line 2390) belongs to the second-half agent; only the chapter intro was skimmed.

Repo reality vs spec: the implementation is a single-origin FastAPI app + React SPA with a "four-level / stage" event flow and CTF flags; several spec surfaces (Monaco workspace, encrypted bundles, integrity console, practice environment) do not exist. Where the repo documents a deliberate deviation (e.g. first-login activation), it is noted.

## Status table

Legend: DONE / PARTIAL / MISSING / N-A. Tier = checklist severity (S1 > S2 > S3).

| Item ref/section | Requirement (short) | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| §1.1 D1 boundary | 50-participant cap honesty, no D2 claims | N-A | docs/RELEASE_PLAN_D1.md exists | Product posture; config defaults d0-local (backend/app/config.py:19) |
| PMX-01 (S2) | Permission matrix server-side, every route declares min role | DONE | backend/app/deps.py:91-118; routers use require_role/require_staff | Shared deps on every route |
| PMX-02 (S1) | Identity from token only; never client-supplied participant/team ids | DONE | backend/app/deps.py:55-88; backend/app/routers/submissions.py:105-119, 254-257 | challenge_id resolved server-side from assignment |
| PMX-03 (S2) | Authz/IDOR suites in CI | DONE | backend/tests/test_authorization.py:15-41; .github/workflows/ci.yml:1 | Plus test_gt_isolation.py, test_flow_* |
| PMX-04 (S3) | Role+ownership checks; RLS as defence in depth only | PARTIAL | backend/app/routers/submissions.py:395 (ownership-scoped) | No PG RLS layer at all |
| VIS-01 (S3) | Dark default + persisted light theme | PARTIAL | frontend/src/styles/app.css:9; tokens.css:3-28 | Dark-only; no theme toggle |
| VIS-02 (S3) | Colour tokens defined once, no hard-coded colours | DONE | frontend/src/styles/tokens.css:3-28; components consume var(--*) | Token names differ from spec but discipline holds |
| VIS-03 (S2) | WCAG AA contrast verified programmatically | PARTIAL | tokens.css:4-16 (dark palette) | No programmatic/token-map contrast audit |
| VIS-04 (S3) | 4px base grid / 8px rhythm | N-A | app.css spacing values | Polish; spot values consistent |
| VIS-05 (S2) | Resizable panes, min 1280x720, blocking <1024px notice | PARTIAL | frontend/src/pages/participant/Workspace.tsx:501 (.workspace grid); app.css media 900/860px | No resize handles; no blocking small-screen notice; smaller pages responsive |
| VIS-06 (S3) | Reduced motion honoured, ≤150ms | DONE | frontend/src/styles/app.css:41-49, 887 | --speed 120ms (tokens.css:24) |
| VIS-07 (S2) | Browser matrix + blocking compat notice | PARTIAL | frontend/src/pages/Landing.tsx:303+ (FAQ mentions) | No detection/blocking notice |
| VIS-08 (S3) | Self-hosted fonts; code font 12-20px default 14 | DONE | frontend/src/main.tsx:6-15 (@fontsource); Workspace.tsx:83, 623-633 | |
| CMP-01..08,10,11,13 (S3 group) | Shared component library (Button/Field/Dialog/Toast/DataTable/etc.) | PARTIAL | frontend/src/ui/components.tsx:132-301 | Button/Field/Empty/Error/Loading/Confirm exist; missing Toast, Dialog, DataTable virtualization, SplitPane, Skeleton |
| CMP-05 (S2) | ConfirmDialog; typed phrase for irreversible actions | PARTIAL | frontend/src/ui/components.tsx:169-207 (two-click arm) | No typed-confirmation phrase anywhere |
| CMP-07 (S2) | Persistent announcement banner (info/warning/critical) | PARTIAL | frontend/src/pages/participant/Lobby.tsx:216-236 | Lobby list only; no workspace banner |
| CMP-09 (S2) | Countdown role=timer, announce 10/5/1 thresholds | PARTIAL | frontend/src/ui/components.tsx:315-358; lib/format.ts:90-97 | Announces 10/2 min via aria-live; no role="timer", no 5/1 |
| CMP-12 (S2) | CodeView wraps Monaco read-only | PARTIAL | frontend/src/pages/participant/Workspace.tsx:599-655 | Custom read-only viewer; no Monaco/syntax highlight/wrap toggle |
| CMP-14 (S2) | ConnectionIndicator wired into HUD | MISSING | grep: no ConnectionIndicator; chrome.tsx:190-208 OfflineBanner unused | |
| KBD-01 (S2) | Full shortcut set + palette | MISSING | frontend/src/pages/participant/Workspace.tsx:286-311 (arrows/Home/End/Enter only) | No Ctrl+K/P/Shift+F, Alt+N, F8 |
| KBD-02 (S3) | Shortcuts safe while typing | N-A | — | No single-key shortcuts exist |
| KBD-03 (S3) | '?' help overlay, UI equivalents | MISSING | grep frontend/src: no help overlay | |
| ACC-01/02 (S2) | WCAG 2.2 AA; keyboard + 2px focus | PARTIAL | app.css:28-31 (:focus-visible 2px); Field role=alert (components.tsx:233) | No tracked conformance |
| ACC-03 (S2) | axe in CI + screen-reader pass | MISSING | .github/workflows/ci.yml (no axe job) | |
| ACC-04 (S3) | Font size / high-contrast / reduced-motion in-product | PARTIAL | Workspace.tsx:623-633 (font size); app.css:41 | No high-contrast theme |
| ACC-05 (S2) | Accommodation field + ACCOMMODATION time adjustments | PARTIAL | backend/app/routers/admin.py:915-924 (reason codes) | No participant-profile accommodation field |
| LOC-01 (S3) | Externalized message catalogs | PARTIAL | strings inline in components | Wording consistent but not catalogued |
| LOC-02 (S2) | Single time formatter, event tz + abbreviation, RFC3339 UTC | DONE | frontend/src/lib/format.ts:3-56; backend ISO everywhere | IST label; tz fixed Asia/Kolkata (config admin.py:45) |
| LOC-03 (S3) | Locale-stable number rendering | DONE | frontend/src/lib/format.ts:78-85 | |
| STP-01 (S3) | Skeletons >200ms, no spinner hides content | PARTIAL | components.tsx:251-265 (LoadingShell) | Not skeleton-based |
| STP-02 (S3) | Empty states explain + next action | DONE | components.tsx:240-249; Workspace/Lobby EmptyState usage | |
| STP-03 (S2) | Error: catalog message + request_id + retry | DONE | components.tsx:267-301 (ErrorBanner) | request_id shown with retry |
| STP-04 (S2) | Degraded/polling persistent banner | PARTIAL | chrome.tsx:190-208 defined but never rendered (grep: no usage) | |
| ERC-01 (S1) | Stable error envelope + X-Request-Id | DONE | backend/app/errors.py:67-80; main.py:64-92 | |
| ERC-02 (S1) | Full catalog, exact codes/statuses | PARTIAL | errors.py:16-54 | Codes present incl. 425/409/412; AUTH_RATE_LIMITED 429 lacks Retry-After header |
| ERC-03 (S2) | Client renders catalog wording verbatim | PARTIAL | frontend/src/lib/api.ts:153-172; Workspace.tsx:407-414 | Client overrides wording for cooldown/cap |
| ERC-04 (S2) | No verbose errors/stack traces | DONE | errors.py:76-80; no debug handlers | |
| PUB-01a (S3) | Landing content, one cached public call | DONE | frontend/src/pages/Landing.tsx:27-31, 94-131; backend public.py:13-45; main.py:90-91 | Two cached calls (event + time) |
| PUB-01b (S3) | Landing countdown from server time | DONE | Landing.tsx:11-19, 70-76 (clockOffset) | |
| PUB-02a (S2) | Versioned rules page | DONE | backend/app/routers/public.py:48-70; frontend/src/pages/Rules.tsx:16-24 (version + frozen chips) | |
| PUB-02b (S2) | Rules PDF generated at publish time | MISSING | grep "pdf" frontend/backend: none | |
| PUB-03a (S2) | DPDP privacy notice + in-app versioned consent | PARTIAL | docs/PRIVACY_NOTICE.md; backend/routers/auth.py:673-692 (acceptances w/ version+ip); migrations/0001_init.sql:99-103 | Consent gate works for submissions; first-login path can activate without acceptance screen |
| PUB-04 (S3) | FAQ | DONE | frontend/src/pages/Landing.tsx:303-340 | |
| PUB-06 (S3) | Public pages cacheable, no private data | DONE | main.py:90-91; public.py public subset only | |
| PUB-05a (S2) | External status page outside failure domain | MISSING | repo/config: no status host anywhere | |
| PUB-05b (S3) | Status page update procedure/process | N-A | — | Process item |
| ATH-01a (S1) | Login: rate-limited, envelope, server_time, refresh cookie, audited, generic error | PARTIAL | backend/app/routers/auth.py:52-229 | All present; audit stores ip_hash+UA (auth.py:157-167), no timezone; first-login password claim (auth.py:67-76) |
| ATH-01b (S3) | Show/hide password, routed account states, Turnstile after 3 fails | PARTIAL | frontend/src/pages/Login.tsx:56-86 | None of the three; deviation disclosed honestly (Login.tsx:46-51) |
| ATH-01c (S2) | Rate-limit lockout w/ Retry-After, no hard locks | PARTIAL | deps.py:33-39; errors.py:20 | No hard locks ✓; no Retry-After header |
| AUTH-02a (S1) | Access token memory-only | DONE | frontend/src/lib/api.ts:44-52; grep: no token in localStorage | |
| AUTH-02b (S1) | Refresh cookie HttpOnly/Secure/Strict, path-scoped, hash stored | DONE | backend/app/routers/auth.py:29-46; security.py:52-57 | Host-only when cookie_domain empty (config.py:37) |
| AUTH-01d (S1) | Short-lived JWT, pinned alg, sid revocation, claims | PARTIAL | security.py:74-112; config.py:33-34 | HS256 not EdDSA (documented follow-up); sid+tv revocation via DB (deps.py:65-87); no kid claim |
| AUTH-03a (S1) | Pin one alg; verify iss/aud/exp/nbf | DONE | security.py:97-112 (options require exp/iat/nbf/sub/sid) | |
| AUTH-04a (S1) | Rotation idempotent in 10s grace; reuse outside revokes family | DONE | backend/app/routers/auth.py:259-305; config.py:36 | |
| AUTH-04b (S2) | Web Locks serialization across tabs | PARTIAL | frontend/src/lib/api.ts:60-89 (single-flight) | No Web Locks; grace-window successor covers cross-tab |
| AUTH-05a (S2) | Proactive refresh at 80%; submit retries once; drafts persist | PARTIAL | api.ts:141-147 (retry); Workspace.tsx:187-239 (server drafts) | No proactive timer; no local IndexedDB draft |
| AUTH-07a (S2) | Argon2id m=19456 t=2 p=1, bounded pool | PARTIAL | security.py:27 | Params exact; no semaphore/pool bound |
| AUTH-07b (S3) | Per-account and per-IP limits | DONE | auth.py:55-56 (20/IP, 10/email per min) | |
| ATH-02a (S2) | Activation flow (fragment token, min-12 pw, strength, consent, Turnstile) | PARTIAL | auth.py:393-436 (activate w/ min-12 + consent) | Token in query not fragment; no strength meter/breach check; login bypass documented |
| ATH-02b (S2) | Single-use 48h invites + rate-limited re-request | PARTIAL | admin.py:476-511 (single-use, 48h); auth.py:398-401 | No re-request action/rate limit |
| ATH-03a (S2) | Password reset: generic, 30-min link, revokes sessions + tv bump | DONE | auth.py:505-561 (tv+1, revoke all) | No email delivery (dev-log, documented auth.py:519-520) |
| ATH-04a (S1) | Blocking rules consent, recorded {version, accepted_at, ip}, gates participation | DONE | deps.py:121-138 (gate); auth.py:673-692; migrations/0001_init.sql:99-103 | Enforced server-side for all submissions |
| ATH-05a (S3) | Active sessions list + sign-out others | PARTIAL | auth.py:624-690; Account.tsx:8-53 | No location, no session_revoked event handling |
| ATH-05b (S2) | Concurrent session limit 2 + audited logins | DONE | config.py:38; auth.py:91-135 (reclaim+evict, serialized by row lock) | |
| CSRF-01a (S2) | Exact-origin CORS; refresh needs Origin + custom header | DONE | config.py:57,68-69; main.py:54-62; deps.py:170-178 | |
| LB-01a (S3) | Lobby: event, status, personal readiness, countdown | DONE | frontend/src/pages/participant/Lobby.tsx:57-190 | |
| LB-02a (S2) | System check (browser, clock, API, IndexedDB, bundle) | PARTIAL | Lobby.tsx:122-160 | Only API/team/rules checks |
| LB-02b (S2) | Hard-block entry on browser/API failures only | PARTIAL | Lobby.tsx:146-159 | No blocking at all |
| LB-03a (S2) | Interactive 5-step workspace tour, replayable | MISSING | grep: no tour | |
| LB-04a (S1) | Pre-fetch encrypted bundle when SEALED/ARMED + integrity check | MISSING | challenges.py:46-48 (files served after 'armed'); no bundle code | |
| LB-04b (S2) | Key endpoint after starts_at, 425 before, no-store | MISSING | errors.py:37 (code only); no endpoint | |
| LB-05a (S2) | Announcements banner + list, unread count, polling fallback | PARTIAL | Lobby.tsx:43-47, 216-236; announcements.py:14-41 | No unread count; no workspace banner |
| LB-06a (S2) | Auto-flip to Enter-workspace at T0 | PARTIAL | Lobby.tsx:33-55 (5s poll); manual link only | |
| WS-01a (S2) | HUD w/ server-deadline countdown, warn 10m/crit 2m | DONE | Workspace.tsx:114-118, 486-492; format.ts:90-97 | |
| WS-01b (S1) | Hidden feedback: no provisional score/verdict in HUD | DONE | submissions.py:371-381 (coarse statuses); Workspace header shows status only | |
| WS-01c (S2) | Pause banner, frozen countdown, disabled inputs | PARTIAL | Workspace.tsx:68, 718-722 | Chip+notice, not full-width banner; submit disabled via !stageActive |
| WS-01d (S3) | HUD: connection indicator, outbox count, user menu | PARTIAL | chrome.tsx:102-135 (role chip + signout) | No indicator/outbox count |
| WS-02a (S3) | Explorer file chips: lang icon, line count, viewed/report counts | PARTIAL | Workspace.tsx:525-560; assignments include line_count (challenges.py:100-103) | No viewed marks/report counts |
| WS-02b (S2) | Virtualized tree, lazy load, filename search, reported indicators | PARTIAL | Workspace.tsx:60-74 (simple tree); challenges.py:146-172 (server search) | Not virtualized/lazy; bounded 5000 lines/file (admin.py:614) |
| WS-02c (S3) | Explorer keyboard nav + limited context menu | PARTIAL | Workspace.tsx:286-311 (code-area keys) | No explorer keys/context menu |
| WS-03a (S2) | Read-only code view: highlight, line numbers, find, go-to-line, wrap, font size | PARTIAL | Workspace.tsx:599-655, 668-676 | Read-only ✓, line numbers ✓, find ✓, font size ✓; no highlighting/go-to-line/wrap toggle |
| WS-03b (S3) | Multi-tab, limit 20, eviction | MISSING | Workspace.tsx (single selection state) | |
| WS-03c (S1) | Gutter selection bounded by max span → report target | DONE | Workspace.tsx:247-311, 350-353 (≤25); submissions.py:83-85 | |
| WS-03d (S2) | Reported-line markers; no verdict hints | PARTIAL | submissions.py coarse statuses ✓ | No reported markers in viewer |
| WS-03e (S2) | Server-side repo search, bounded, symbols, peek | PARTIAL | challenges.py:146-172 (bounded, rate-limited, ≤50) | No symbol nav/peek/shortcut binding |
| WS-03f (S3) | Copy-friction interception, documented as deterrence | MISSING | frontend: no copy interception | |
| WS-04a (S1) | Field validation identical client/server, exact limits | PARTIAL | submissions.py:75-89; Workspace.tsx:345-364 | Deviations: description min 20 (spec 40); evidence optional (spec required ≥40 R2); related locations not span-limited |
| WS-04b (S2) | Drafts: local debounce + server 10s, If-Match reconcile, 412 surfaced | PARTIAL | Workspace.tsx:187-239; submissions.py:487-520 (version conflict) | Server 3s ✓, 412 handled ✓; no local IndexedDB |
| WS-04c (S3) | Submit enabled only when valid; remaining caps shown | PARTIAL | Workspace.tsx:825 (disabled), 356-361 | Caps not shown proactively |
| WS-04d (S1) | Outbox + fresh Idempotency-Key, 202 + receipt toast, drawer Received | DONE | Workspace.tsx:376-380 (key, receipt UI); submissions.py:92-325, 135-139 | |
| WS-04e (S2) | Duplicate/overlap advisory without validity hint | MISSING | grep: no overlap check | |
| WS-04f (S1) | No HTML/MD rendering of user text; paste counter | PARTIAL | React text-only (ItemDetail.tsx:178-193; SubmissionPayload.tsx:17-33) | Paste-length telemetry missing (signals absent) |
| WS-04g (S2) | Four visibly distinct draft/submission states | PARTIAL | Workspace.tsx:833 (draft saved-at), SubmissionsDrawer statuses | No queued/acknowledged split (no outbox) |
| WS-05a (S3) | Submissions drawer read-only, pending "Sending..." retry | PARTIAL | Workspace.tsx:894-963; submissions.py:341-383 | No pending-retry entries |
| WS-06a (S3) | Command palette | MISSING | grep: no palette | |
| WS-07a (S2) | Announcements banner/toast + archived HUD list | PARTIAL | Lobby only (Lobby.tsx:216-236) | Workspace has no announcement surface |
| WS-08a (S1) | Offline: usable, exact outbox count, in-order replay same keys | MISSING | grep: no outbox/indexedDB | |
| WS-08b (S2) | 503/429 backoff + banner; refresh-fail blocking dialog preserving work | PARTIAL | components.tsx:267-301; api.ts:140-147 | No backoff policy; refresh failure silently signs out (auth.tsx:41-66) |
| WS-09a (S3) | Per-file caps/cooldown on chips, T-5 drafts reminder | PARTIAL | Server caps/cooldown enforced (submissions.py:206-239); admin.py:232-234 defaults 12/20s | Not shown on chips; no T-5 reminder |
| WS-10a (S3) | R2 affordances: tree, search, required evidence, sandbox flag-gated | PARTIAL | levels.py (repo/artifact flow); evidence optional; runner flag-gated (levels.py:1168-1188) | |
| WS-11a (S1) | Deadline: read-only, banner, grace mirror, final flush, acknowledged count | PARTIAL | submissions.py:179-180 (server grace ✓); Workspace.tsx:825 (!stageActive disables submit) | No "Time is up" banner/final flush/summary |
| SUB-01a (S3) | My submissions list with filters | PARTIAL | Submissions.tsx:29-60; Workspace drawer | No round/status filters |
| SUB-01b (S2) | Detail: full text, matched bug code, points, no GT text | DONE | submissions.py:386-419; SubmissionDetail.tsx:36-60 | Codes only after release ✓ |
| SUB-01c (S2) | Dispute form 1000 chars, only during appeal window | PARTIAL | submissions.py:426-460; DisputeForm.tsx:12-13, 85 | Gated on release; no window end |
| LBD-01a (S2) | Modes live/frozen/hidden per round w/ delay; live constrained | PARTIAL | leaderboard.py:34-56; admin.py:227-238 (default hidden, 600s) | Live-mode constraints (feedback hidden + delay≥600) not validated |
| LBD-01b (S3) | Leaderboard columns, own row highlight, search, pagination | PARTIAL | Leaderboard.tsx:70-105; scoring.py:126-164 | Tie-break columns ✓; no highlight/search/pagination |
| LBD-01c (S2) | Snapshot endpoint cacheable 10s + polling fallback | PARTIAL | leaderboard.py:21-62; main.py:89 (no-store) | Polling ✓ (Leaderboard.tsx:13-20); not cacheable |
| LBD-01d (S1) | Leaderboard never shows per-bug detail or others' reports | DONE | scoring.py:126-164 (team totals only); leaderboard.py | |
| RES-01a (S2) | Score breakdown, reason codes, rank, missed counts, certificate | PARTIAL | leaderboard.py:65-125; Results.tsx:64-100 | No rank/missed counts/certificate PDF |
| RES-01b (S2) | Penalties w/ reason codes under published cap | DONE | evaluator.py:544-547 (cap_fraction); Results penalties panel | |
| RES-02a (S3) | Optional public results page + signed file | MISSING | no public results route | |
| PR-01a (S2) | Practice on separate data/schema | MISSING | grep: no practice routes | |
| PR-02a/03a (S3) | Practice content/feedback/reset | MISSING | — | |
| PR-04a (S1) | /v1/practice/ namespaced + CI asserts no prod GT reachable | MISSING | no practice namespace | |
| SBX-01a (S1) | Sandbox disabled in D1, no endpoints, no panel | DONE | config.py:51 (runner_enabled=False); levels.py:1168-1188 (always RUNNER_UNAVAILABLE); no panel | Contract endpoints inert |
| SBX-01b (S3) | Design hooks for later enablement | PARTIAL | levels.py:1165-1188 (stable contract) | No resource-limit hooks documented |
| RV-01a (S3) | Queue listing anonymized w/ SLA, age, filters, saved views | PARTIAL | review.py:28-62 (anonymized ✓); Queue.tsx:51-72 (status filters) | No SLA timer/age/severity/confidence |
| RV-02a (S2) | Review view: report, code+range, candidates, GT excerpt, history | PARTIAL | review.py:103-159; ItemDetail.tsx:162-231 | Report+file+range ✓; no matcher candidates/GT excerpt/history |
| RV-03a (S2) | Exact decision set + reason code + rationale | DONE | review.py:170-175 (all six decisions); rubric+notes 211-225 | Rubric is the structured reason; no separate code field |
| RV-03b (S2) | Claims time out 10 min → requeue | PARTIAL | review.py:82-87 (lazy takeover ≥10min) | No visible auto-requeue |
| RV-04a (S2) | Auto double review for Critical/High + disagreement | MISSING | review.py (manual needs_second_review only) | |
| RV-05a (S3) | Workload dashboard + calibration | MISSING | admin.py:945-996 (counts only) | |
| RV-06a (S3) | Keyboard-driven flow + guarded bulk accept | MISSING | ItemDetail.tsx (forms only) | |
| RV-07a (S1) | Participant content plain text, no auto-linking | DONE | ItemDetail.tsx:178-193 (pre, no linkify); review.py:105 | |
| RV-08a (S2) | LLM advisory panel flagged/logged | N-A | config.py:52 (ai_assessment_enabled=False) | Feature absent and disabled |
| DS-01a (S3) | Dispute inbox with states | PARTIAL | admin.py:1178-1191; Dashboard.tsx:642+ | States in DB + inbox UI ✓ |
| DS-02a (S3) | Dispute detail with evaluation chain + receipts | PARTIAL | admin.py:1184-1185 (receipt, title) | No full chain view |
| DS-03a (S2) | Resolver ≠ original decision-maker; rationale; ledger adjustment | PARTIAL | admin.py:1194-1258 (rationale + add_ledger_entry) | No different-reviewer enforcement |
| DS-04a (S3) | Participant notified of outcome | MISSING | no notification path | |
| RVC-01a (S2) | Capacity math gates results date | MISSING | admin.py:945-996 (no forecast) | |
| EV-01a (S3) | Event editor fields incl. retention/participation mode | PARTIAL | admin.py:38-93 (name/slug/tz/caps/duration) | No retention/participation-mode fields |
| EV-02a (S1) | Round config frozen at publication (409 semantics) | DONE | admin.py:220-276 (stage created with frozen defaults + rule_set_hash); no update route exists; GROUND_TRUTH_LOCKED on files/GT (admin.py:589-590, 659-660, 704-705) | Freeze by absence of edit path + config revisions w/ reason (admin.py:153-199) |
| EV-02b (S2) | Diff view before publication + state-machine buttons | PARTIAL | admin.py:96-103 (EVENT_TRANSITIONS), 279-288 (STAGE_TRANSITIONS) | Enforced server-side; no diff view UI |
| EV-04a (S2) | Readiness gate blocks go-live | DONE | admin.py:117-126 (blocks 'live'); Dashboard readiness panel; seed.py:609 | |
| EV-06a (S3) | T-minus calendar view | MISSING | Dashboard.tsx (no timeline) | |
| PT-01a (S3) | CSV import with dry run | MISSING | admin.py:476-530 (single invites) | |
| PT-02a (S3) | Invite send/resend rate-limited + tracking | PARTIAL | admin.py:514-530 (used_at tracking) | No rate limit/resend |
| PT-03a (S3) | Participant detail page | PARTIAL | admin.py:514-530 (list w/ team+activated) | No sessions/flags/notes |
| PT-04a (S2) | Reset pw / revoke sessions / disqualify(2-person) / merge | PARTIAL | auth.py:505-561 (reset); no disqualify/reinstate/merge endpoints (grep) | |
| PT-05a (S3) | Seat/device assignment export | MISSING | — | |
| CH-01a (S3) | Challenge editor metadata + upload | DONE | admin.py:542-563, 566-633 | |
| CH-02a (S1) | Safe upload: limits, traversal/symlink/device/bomb rejection, inert storage | DONE | admin.py:566-633 (path checks, 512KiB, inert text); storage.py:57-91 (zip central-dir inspection: abs/traversal/symlink/device/dupes/count/size bombs) | Never extracted/executed |
| CH-02b (S2) | Extraction in unprivileged isolated process; collision rejection | PARTIAL | storage.py:57-91 (no extraction at all) | N-A for isolation; Unicode normalization collisions unchecked |
| CH-03a (S3) | File viewer + anchor selection feeding GT editor | PARTIAL | ItemDetail.tsx:196-231 (viewer w/ range) | No GT-editor anchoring |
| CH-04a (S1) | Version lifecycle enforced; frozen immutable | PARTIAL | admin.py:279-288 + 589-590/659-660/704-705 (draft→sealed→published; GROUND_TRUTH_LOCKED) | REVIEWED/ARCHIVED states absent; no backward-transition UI |
| CH-05a (S2) | Validation report before freeze (anchor hashes, unique codes, totals) | PARTIAL | admin.py:650-685 (content hash only) | |
| CH-06a (S2) | Unplanned-defect audit workflow (2 reviewers) | MISSING | — | |
| CH-07a (S2) | Variant equivalence validation | MISSING | — | No variant machinery |
| CH-08a (S3) | Watermark slot editor | MISSING | — | |
| CH-09a (S3) | Preview mode w/ test account | MISSING | — | |
| CH-10a (S2) | Per-participant bundle sealing + decryptability sample | MISSING | — | Shared challenge, no bundles |
| LV-01a (S2) | Control-room telemetry | PARTIAL | admin.py:945-996 | No submissions/min, error rate, live presence |
| LV-02a (S1) | Round controls: reason + typed phrase + audit + broadcast | PARTIAL | admin.py:291-394 (reason+audit ✓); Dashboard.tsx:376-390 (two-click confirm) | No typed phrase; no announcement broadcast |
| LV-03a (S3) | Announcement composer (severity/audience/preview) | PARTIAL | admin.py:886-912; Dashboard.tsx:436-449 | No audience targeting/preview/scheduling |
| LV-04a (S3) | Participant live status list | PARTIAL | admin.py:514-530, 983-985 (estimate; flagged) | |
| LV-05a (S2) | Kill-switch panel with runtime toggles + trail | PARTIAL | admin.py:991-995 (read-only display) | No runtime toggles |
| LV-06a (S2) | Time adjustments bounded + two-person above threshold | PARTIAL | admin.py:915-942 | No bound, no second approver |
| LV-07a (S3) | Incident log exported with event | PARTIAL | stage_transitions + audit entries (admin.py:377-393) | No dedicated incident log |
| RS-01a (S2) | Rescoring runs w/ impact preview | MISSING | only manual admin adjustment (admin.py:1261-1301) | |
| RS-02a (S1) | Ledger supersessions only, never in-place | DONE | migrations/0002_score_ledger_immutable.sql:1-16 (trigger); scoring.py:30-65 | |
| RS-03a (S1) | Finalization checklist blocks release (backlog, disputes, chain, snapshot) | MISSING | admin.py:397-429 (status check only) | |
| RS-04a (S2) | Separate release controls, timestamped, audited | PARTIAL | admin.py:397-429 (evaluate vs release; audit ✓) | Verdicts+leaderboard publish together |
| RS-05a (S2) | Signed results export (hash+signature+instructions) | PARTIAL | admin.py:1157-1172 (hash stored, no signature) | |
| AN-01a (S3) | Analytics dashboards, never to participants | MISSING | admin.py:945-996 only | |
| ADM-01a (S1) | Admin SPA/API behind Cloudflare Access on separate hostnames | MISSING | main.py:97-110 (single app/origin) | |
| ADM-01b (S1) | App-side admin MFA + 60-min sessions | PARTIAL | security.py:81 (admin audience); deps.py:144-147 (password step-up, documented v1) | No TOTP/WebAuthn; no idle timeout |
| ADM-01c (S1) | Step-up ≤5 min for GT/destructive ops (403) | DONE | deps.py:141-162; admin.py:543, 568, 651, 749, 822, 855 (step_up_verified); errors.py:39 | |
| ADM-01d (S1) | No Access service tokens in client; validate JWTs | N-A | grep: no Access tokens/JWT consumption | No Cloudflare Access in v1 |
| ADM-01e (S1) | Participant API can't reach admin API; own DB roles | PARTIAL | config.py:24-26 (app_api vs gt_admin); admin.py:759 (gt_session for GT writes) | Single process serves both; no admin_api role |
| GT-01a (S2) | GT editor under step-up, revision-controlled | PARTIAL | admin.py:748-811 (API under step-up) | No UI, no revision model |
| GT-02a (S2) | Locations w/ anchor hash | PARTIAL | admin.py:779-792 (file+range+is_primary) | No content anchor hash |
| GT-03a (S3) | Weighted aliases | DONE | admin.py:793-799; models_gt | |
| GT-04a (S2) | Partial credit per root-cause group | MISSING | review rubric only (review.py:162-167) | |
| GT-05a (S1) | Post-freeze corrections via new revision + impact preview | MISSING | admin.py:757-758 (edits blocked, no path) | |
| GT-06a (S1) | GT access step-up, marker, logged, encrypted export only | PARTIAL | deps step-up + audit (admin.py:800-810); StepUp.tsx:23-44 (banner) | No export regime (no export at all) |
| GT-07a (S3) | Dry-run matcher harness | MISSING | — | |
| GT-08a (S1) | gt schema unreadable by app_api; CI-proven | DONE | tests/test_gt_isolation.py:19-33; migrations/0003 grants; config.py:23-26 | |
| RM-01a (S2) | Role management audited | MISSING | roles only at creation (auth.py:181-247) | |
| AU-01a (S2) | Audit viewer: filters, chain status, export, read-only | PARTIAL | admin.py:1043-1075 (action filter + verify endpoint); read-only ✓ | No actor/entity/time/request-id search |
| EX-01a (S3) | Exports as background jobs, expiring | PARTIAL | admin.py:1078-1172 (synchronous, stored w/ hash) | |
| SY-01a (S3) | System health board (backup, certs, capacity) | PARTIAL | admin.py:1304-1322; main.py:112-118 | Core probes only |
| IN-01a..IN-06a (S1/S2/S3) | Integrity console (flags, cases, two-officer DQ, attribution, audited views) | MISSING | grep backend: no integrity endpoints; models_app.py:65 (integrity_officer folded into reviewer) | S1 items IN-03a/IN-03b unimplemented |
| SIG-01a..SIG-05a (S2) | Integrity signals catalogue + consent-gated telemetry ingestion | MISSING | config.py:53 (telemetry_enabled=False), no ingestion routes | |

Tally (item rows above, counting grouped rows as their full item count): **DONE 43 · PARTIAL 74 · MISSING 51 · N-A 6** (~174 checklist rows in scope; S3 polish grouped where noted).

## Findings

### F-CKLA-01 — HIGH — No encrypted per-participant bundle pre-delivery or timed key release (LB-04a S1, LB-04b S2, CH-10a S2)
- **Evidence:** backend/app/routers/challenges.py:46-48 (materials become fetchable as soon as stage is 'armed'); no key/bundle endpoint anywhere in backend/app/routers/; `KEY_NOT_AVAILABLE` exists only in the catalog (backend/app/errors.py:37).
- **Impact:** The T0 fairness design (TIM-04) is absent: at round start every team races the same downloads on the venue network, and there is no per-participant bundle/sealing to attribute leaks. Checklist treats this as S1.
- **Fix:** Implement sealed-bundle prefetch with integrity check + a rate-limited, audited, no-store key endpoint that returns 425 before `starts_at` (or formally de-scope with written owner sign-off, as the gate model permits).

### F-CKLA-02 — HIGH — Offline outbox with in-order idempotent replay missing (WS-08a S1)
- **Evidence:** grep over frontend/src shows no `indexedDB`/`outbox` usage; submissions POST directly (frontend/src/pages/participant/Workspace.tsx:374-429); `OfflineBanner` is defined but never rendered (frontend/src/components/chrome.tsx:190-208, zero usages).
- **Impact:** A venue-network drop between clicking submit and the 202 strands the report with only a generic error; the participant cannot see a pending count or rely on ordered replay. This is the product's most reputation-defining failure mode per the checklist.
- **Fix:** Queue submissions client-side keyed by the fresh Idempotency-Key, show an exact pending-outbox count in the HUD, flush in order on reconnect with the same keys; wire OfflineBanner.

### F-CKLA-03 — HIGH — Integrity console and signal catalogue entirely missing (IN-01..IN-06, SIG-01..SIG-05)
- **Evidence:** no integrity endpoints in backend/app/routers/ (grep "integrity"); backend/app/models_app.py:65 documents "integrity_officer folded into reviewer for v1"; telemetry ingestion absent (backend/app/config.py:53 flag only).
- **Impact:** IN-03a/IN-03b are S1 controls (two-officer disqualification, human-in-the-loop with recorded rationale). Collusion/leak handling has no evidence-based path; DPDP retention duties for signals (SIG-05a) are unmechanized.
- **Fix:** Implement the case/flag model (dismiss/warn/penalize/escalate/propose-DQ with two-officer rule) plus consent-gated batched 202 telemetry ingestion, or de-scope in writing before G5.

### F-CKLA-04 — HIGH — Admin plane shares the participant origin; no MFA; no 60-minute idle sessions (ADM-01a/ADM-01b S1)
- **Evidence:** one FastAPI app serves all roles (backend/app/main.py:97-110); step-up is password re-entry only, documented as v1 (backend/app/deps.py:144-147); no TOTP/WebAuthn anywhere; sessions have no inactivity timeout (refresh TTL 3 days, backend/app/config.py:35).
- **Impact:** A participant-side phish or XSS has a network path to admin endpoints; one stolen admin session is long-lived. AUTH-09 (answer-key blast radius) is not contained.
- **Fix:** Split admin onto a separate hostname behind interactive Cloudflare Access with MFA, add application TOTP/WebAuthn and a 60-min idle expiry; keep the documented path (SECURITY_ARCHITECTURE.md) but land it before the event.

### F-CKLA-05 — HIGH — First-login account claiming bypasses invite activation (ATH-02a/02b S2, documented deviation)
- **Evidence:** backend/app/routers/auth.py:67-76 — a registered user with no password has "the password you type becomes your password", with an inline note "this is a risk we are willing to take"; Login page discloses it (frontend/src/pages/Login.tsx:46-51); no Turnstile, no breached-password check, no strength meter.
- **Impact:** Anyone who knows a registered-but-passwordless email (e.g. from an invite list leak) takes over that account before the rightful owner; also weakens the ATH-04 consent-evidence chain (account can activate without a consent screen).
- **Fix:** Require the single-use invite token (already implemented at auth.py:393-436) for any passwordless account; add Turnstile after 3 failures on the login form.

### F-CKLA-06 — HIGH — Finalization gate absent: release not blocked by pending reviews, open disputes, or audit-chain verification (RS-03a S1)
- **Evidence:** backend/app/routers/admin.py:397-429 — `/admin/stages/{id}/release` checks only the stage status; no check of open review items (`app.review_items`), disputes, or `audit_verify` despite both being one query away (admin.py:979, 1043-1047).
- **Impact:** Results can be published and then move (AT-25), the fastest credibility killer the checklist names; the existing readiness gate (admin.py:117-126) shows the team knows the pattern.
- **Fix:** Reuse the readiness-gate pattern: block release while `review_items.status='open'` exceeds threshold, disputes are open, or `audit_verify` reports a break; surface the blocking reason.

### F-CKLA-07 — HIGH — No post-freeze ground-truth correction path with impact preview (GT-05a S1, RS-01a S2)
- **Evidence:** GT bug/file writes raise GROUND_TRUTH_LOCKED once past draft/reviewed (backend/app/routers/admin.py:589-590, 659-660, 757-758) and there is no revision route, no rescoring-run creation, no impact preview; only an admin manual ledger adjustment exists (admin.py:1261-1301).
- **Impact:** A wrong key discovered mid-event forces either no fix or untracked DB surgery — both sides of DAT-04: corrections are either impossible or unreproducible.
- **Fix:** Add a GT revision route (new immutable version + reason) that enqueues a rescoring run with an affected-submission/participant preview, applying ledger supersessions only.

### F-CKLA-08 — HIGH — Round controls neither broadcast nor typed-confirmation protected (LV-02a S1)
- **Evidence:** backend/app/routers/admin.py:291-394 — `control_stage` requires a reason and writes `stage_transitions` + audit but never inserts an announcement; the UI uses a two-click ConfirmButton, not a typed phrase (frontend/src/pages/admin/Dashboard.tsx:376-390, frontend/src/ui/components.tsx:169-207).
- **Impact:** Silent pauses/extensions are the classic TIM-05 dispute generator; participants reconstruct interventions unflatteringly. The S1 checklist item explicitly requires broadcast + typed phrase.
- **Fix:** On every control action, insert an announcement (audience=round) in the same transaction; require typing the action word for end/pause/extend.

### F-CKLA-09 — MEDIUM — 429 responses lack the Retry-After header (ERC-02 S1-part, ATH-01c S2)
- **Evidence:** backend/app/errors.py:67-73 attaches only `X-Request-Id`; grep finds no `Retry-After` anywhere; wait seconds exist only in the message/details (errors.py:20, deps.py:37).
- **Impact:** Clients and proxies cannot honour backoff; lockout feedback spec is only half-implemented.
- **Fix:** In `api_error_handler`, when code is AUTH_RATE_LIMITED/RUN_RATE_LIMITED/SUBMISSION_COOLDOWN/SUBMISSION_CAP_REACHED, emit `Retry-After: n` from details.

### F-CKLA-10 — MEDIUM — Report field limits deviate from spec on server and client (WS-04a S1-part)
- **Evidence:** backend/app/routers/submissions.py:86-87 (description min 20, spec 40); :66 (evidence optional/max 2000, spec: required ≥40 in Round 2); related locations capped at 5 entries (:60) but not span-limited; client mirrors the same limits (frontend/src/pages/participant/Workspace.tsx:356-361).
- **Impact:** Anti-shotgun (INT-05) and evidence-quality defences are weaker than the frozen rules claim; oracle defences otherwise intact.
- **Fix:** Align limits to the spec (description 40-2000, evidence required in level-2 stages, span-limit each related location) in one shared validation module used by both sides.

### F-CKLA-11 — MEDIUM — Participant power actions (disqualify/reinstate/merge, two-person approval) missing (PT-04a S2)
- **Evidence:** no admin endpoint sets `app.users.status='disqualified'` or merges accounts (grep over backend/app/routers); enforcement of the status exists (backend/app/deps.py:82-83) but the control does not.
- **Impact:** The one-click-disqualify guardrail the checklist demands cannot exist; organizers would need direct DB access mid-event (unaudited).
- **Fix:** Add reason-coded disqualify/reinstate/merge endpoints requiring step-up + a second approver, writing audit entries.

### F-CKLA-12 — MEDIUM — Keyboard shortcut set and command palette missing (KBD-01 S2, KBD-03 S3)
- **Evidence:** only arrow/Home/End/Enter handling in the code viewer (frontend/src/pages/participant/Workspace.tsx:286-311); no Ctrl+K/P/Shift+F, Alt+N, F8, or '?' overlay (grep).
- **Impact:** Keyboard-first participants cannot run a round without the mouse; advertised-equivalent flows don't exist yet.
- **Fix:** Implement the palette + help overlay wired to existing actions (files, search, submit).

### F-CKLA-13 — MEDIUM — Connection states and degraded-mode banner not wired into the workspace HUD (CMP-14 S2, STP-04 S2, WS-01d)
- **Evidence:** `OfflineBanner` defined but never used (frontend/src/components/chrome.tsx:190-208); no online/reconnecting/degraded indicator component (grep ConnectionIndicator: none).
- **Impact:** When the venue network degrades, participants cannot tell their problem from the platform's (NET-06), driving helpdesk load exactly when it is least affordable.
- **Fix:** Add a ConnectionIndicator to the console shell driven by query state, and render the existing OfflineBanner when >N consecutive polls fail.

### F-CKLA-14 — MEDIUM — Review consistency hardening absent: no auto double review, no SLA/age timers, no capacity forecast (RV-04a/03b/01a/05a, RVC-01a S2)
- **Evidence:** `needs_second_review` is a manual decision only (backend/app/routers/review.py:170-175); claim timeout enforced lazily (review.py:82-87); queue listing has no age/SLA (review.py:28-62); live ops shows only a backlog count (admin.py:979).
- **Impact:** EVA-02 (inconsistent high-stakes decisions) and EVA-01 (results-date miss) are unmitigated; the published review schedule is not backed by measured throughput.
- **Fix:** Auto-escalate Critical/High and reviewer-matcher disagreements to a second claim; surface age/SLA columns; add the capacity-forecast panel before publishing a results date.

### F-CKLA-15 — MEDIUM — No external status page (PUB-05a S2)
- **Evidence:** no status host in frontend or deployment config (grep); the only health surface is the API's own /health (backend/app/main.py:112-118).
- **Impact:** A VM or Cloudflare failure takes the status signal down with the platform (OPS-01/NET-07).
- **Fix:** Host status at an external provider outside the account/failure domain before registration opens.

### F-CKLA-16 — MEDIUM — Rules PDF not generated at publish time (PUB-02b S2)
- **Evidence:** grep "pdf" across frontend/src and backend/app: no hits; rules are DB markdown rendered as plain text (backend/app/routers/public.py:48-70).
- **Impact:** Consent/appeal evidence trail has no frozen downloadable artefact tied to rules_version.
- **Fix:** Render the frozen rules body to PDF on version change and link it from the rules page.

### F-CKLA-17 — MEDIUM — Role management and audit-viewer search incomplete (RM-01a, AU-01a S2)
- **Evidence:** roles are set only at account creation (backend/app/routers/auth.py:181-247); audit viewer filters by action only, no actor/entity/time/request-id, and no export (backend/app/routers/admin.py:1050-1075); chain verification endpoint exists (admin.py:1043-1047).
- **Impact:** Privilege changes are unlogged; incident investigation over the audit chain is manual SQL.
- **Fix:** Add audited role assign/revoke endpoints; extend the viewer with the spec'd filters and export.

### F-CKLA-18 — MEDIUM — Time adjustments unbounded, no two-person approval (LV-06a S2, ACC-05a partial)
- **Evidence:** backend/app/routers/admin.py:915-942 accepts any nonzero delta with a reason code; no policy bound, no second approver, no participant-profile accommodation field.
- **Impact:** Unbounded silent per-participant time grants are the "organizer favored them" story the checklist warns about (TIM-05).
- **Fix:** Bound deltas by policy, require step-up + second approver above threshold, and record accommodation requests on the profile.

### F-CKLA-19 — MEDIUM — Challenge pre-freeze validation report incomplete (CH-05a S2, GT-02a anchor hash)
- **Evidence:** freeze computes only a content hash (backend/app/routers/admin.py:650-685); GT locations store file+range without anchor hash (admin.py:779-792).
- **Impact:** INT-02's machine-checked pre-flight (unique codes, severity distribution, totals, anchor-hash match) is missing, so mis-authored challenges surface as disputes days later (DAT-06 drift is undetectable).
- **Fix:** Extend freeze to the full validation report and store a content-hash anchor per GT location.

### F-CKLA-20 — MEDIUM — Unplanned-defect audit workflow missing (CH-06a S2)
- **Evidence:** no two-reviewer audit of challenge files anywhere (grep; challenge flow admin.py:542-729).
- **Impact:** Genuine unplanned bugs found by honest participants risk false-positive penalties — the exact fairness failure INT-02 describes.
- **Fix:** Add the audit workflow (two independent reviewers per challenge, promote/mark-intentional) gated before freeze.

### F-CKLA-21 — MEDIUM — No automated accessibility checks in CI (ACC-03 S2, ACC-01 tracking)
- **Evidence:** .github/workflows/ci.yml runs gitleaks/ruff/tests but no axe job; no browser-matrix pass.
- **Impact:** WCAG 2.2 AA is a spec-level requirement with no release gate; regressions ship silently.
- **Fix:** Add an axe-core job over the built SPA (lobby → workspace → submit) to CI.

### F-CKLA-22 — MEDIUM — Practice environment entirely missing (PR-01a..PR-04a S2/S1)
- **Evidence:** no /v1/practice routes (grep backend/app/routers/); no practice UI in frontend/src/pages.
- **Impact:** The onboarding surface (HUM-04) is absent; first contact with the workspace happens inside a timed round; PR-04a's CI guarantee against production-ID leakage is unimplementable.
- **Fix:** Build the namespaced practice surface on separate data with its own rate limits, or de-scope before G5 with sign-off.

### F-CKLA-23 — LOW — Exports synchronous, unsigned, non-expiring (RS-05a S2-part, EX-01a S3)
- **Evidence:** CSV export runs in-request and returns content (backend/app/routers/admin.py:1078-1172); content hash stored but no signature, no background job, no expiry.
- **Impact:** Heavy exports burden the single VM; the public tamper-evidence artefact the spec closes with doesn't exist.
- **Fix:** Move exports to the existing job queue, add a detached signature + verification instructions, set expiry.

### F-CKLA-24 — LOW — Leaderboard snapshot served no-store instead of cacheable-for-10s (LBD-01c)
- **Evidence:** middleware default `Cache-Control: private, no-store` (backend/app/main.py:89) applies to /v1/leaderboard; only /v1/public gets max-age.
- **Impact:** Every participant poll hits the API; the cheap read path the spec designs for is unused (D1 single-VM load).
- **Fix:** Emit `public, max-age=10` for authenticated leaderboard snapshot GETs.

### F-CKLA-25 — LOW — Workspace/leaderboard polish gaps (grouped S3)
- **Evidence:** no reported-line markers (Workspace.tsx viewer renders selection only); no remaining-cap chips or T-5 reminder (Workspace.tsx:825); no own-row highlight/search/pagination (Leaderboard.tsx:70-105); no light theme (app.css:9); no <1024px blocking notice (app.css media 900/860px); no multi-tab/eviction (Workspace single selection); no copy-friction interception (grep).
- **Impact:** Degraded polish vs the D1 "polished website" bar; none block the event.
- **Fix:** Land per-file polish in the G4-G5 pass or accept-as-is in writing.

### F-CKLA-26 — LOW — Countdown lacks role="timer" and 5/1-minute announcements (CMP-09 S2-part)
- **Evidence:** frontend/src/ui/components.tsx:315-358 — aria-live announcements exist for 10-minute and 2-minute phases only (frontend/src/lib/format.ts:90-97); span has no role="timer".
- **Impact:** Assistive-tech users get coarser urgency signals than the accessibility-correct spec.
- **Fix:** Add role="timer" and 5/1-minute thresholds.

### F-CKLA-27 — LOW — Client rewrites catalog error wording (ERC-03 S2-part)
- **Evidence:** frontend/src/pages/participant/Workspace.tsx:407-414 replaces `serverMessage` with locally composed text for SUBMISSION_COOLDOWN/SUBMISSION_CAP_REACHED.
- **Impact:** Wording drift from the rules text participants agreed to — the seed of fairness disputes.
- **Fix:** Render the server message verbatim; put specifics (file, limit, seconds) into details slots.

### F-CKLA-28 — LOW — Deadline UX lacks explicit "Time is up" banner and final summary (WS-11a S1-part)
- **Evidence:** server grace is exact (backend/app/routers/submissions.py:179-180) and submit disables on stage state (Workspace.tsx:825), but the client shows only an inline notice (Workspace.tsx:718-722); no final flush or acknowledged-count screen.
- **Impact:** Participants at the deadline see coarse feedback; the client mirrors the server rule but not the specified UX.
- **Fix:** Render a full-width deadline banner from `ends_at_effective` and show the acknowledged-report count.

### F-CKLA-29 — LOW — Login screen lacks show/hide toggle, routed account states, Turnstile (ATH-01b S3)
- **Evidence:** frontend/src/pages/Login.tsx:56-86 (two bare fields); account states handled only via server error codes.
- **Impact:** Dead-end login generates support load at lobby-open.
- **Fix:** Add the toggle, route AUTH_NOT_ACTIVATED/documented states to instructions, add Turnstile after 3 failures.

### F-CKLA-30 — LOW — Session list lacks location; no session_revoked handling (ATH-05a S3)
- **Evidence:** backend/app/routers/auth.py:624-641 returns created/last_seen/user_agent only; no client listener for remote revocation (frontend/src/lib/auth.tsx).
- **Impact:** Participants cannot self-diagnose account sharing (AUTH-10).
- **Fix:** Add approximate geo from ip_hash bucket + a revocation check on the 5s state poll.

### F-CKLA-31 — LOW — No PostgreSQL row-level security as defence in depth (PMX-04 S3)
- **Evidence:** migrations contain no RLS policies (grep POLICY: none); isolation relies on schema grants (migrations/0003_four_level_flow.sql:110-114) + ownership-scoped queries.
- **Impact:** A compromised app role bypasses app-level checks with nothing behind them.
- **Fix:** Add RLS policies keyed on team/participant for hot tables (submissions, drafts) as the second layer.

## What is solid (for balance)

Auth core is genuinely strong: memory-only access tokens, path-scoped HttpOnly refresh with hashed storage, 10s grace-window idempotent rotation with family revocation, session cap with reclaim/eviction (backend/app/routers/auth.py), Argon2id at OWASP params, exact-origin CORS + double CSRF check, and CI-proven gt-schema denial (backend/tests/test_gt_isolation.py:19-33). The submission transaction (idempotency-key reservation, DB clock, caps/cooldown/grace, receipt) and the append-only score ledger with trigger enforcement (migrations/0002_score_ledger_immutable.sql) match the checklist's S1 core. Error envelope + X-Request-Id, readiness-gated go-live, step-up for GT ops, and read-only runner disablement also verify DONE.

---

### 4.13 D1 Polished Website Build Checklist - second half + stage gates (`checklistB`)

# Checklist Compliance Audit - Second Half (checklistB)

- **Agent:** checklistB (audit subagent)
- **Task ID:** 4-e
- **Baseline doc:** /home/z/my-project/audit/baseline/build_checklist.txt (Bug Hunt CTF - D1 Polished Website Build Checklist)
- **Scope:** lines 2400-4584 (chapters 9.1-9.9, 10 Master Prohibitions PR-01..PR-46, 11 Stage Gates G0-G5, 12 Acceptance Matrix AT-01..AT-25, 13 Event-Day Readiness RDY-01..RDY-13)
- **Repo HEAD:** f1412b7eec6c92c4c168fd2b8a58182b34480387 (2026-11-26)
- **Method:** read-only verification (Read/Grep/Glob); every DONE/PARTIAL/MISSING verdict cites evidence actually read. Owner sign-off columns and pure process items (venue drills, drills not evidenced in repo) marked N-A.

## Status table

| Item ref/section | Requirement (short) | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| EDG-01a | Six-hostname plan implemented | MISSING | repo root LS (no edge/DNS/proxy config); frontend/src/App.tsx:21-85 | No deployment artifacts at all; SPA is single-origin; no status host/link |
| EDG-02a | Refresh cookie host-only, refresh-path scoped | DONE | backend/app/routers/auth.py:32-46; config.py:37 | HttpOnly, Secure(prod), SameSite=Strict, path=/v1/auth/refresh, domain=None |
| EDG-03a | Cloudflared outbound, no inbound ports | N-A | (deployment item, no artifacts in repo) | No tunnel/proxy config exists to verify |
| EDG-04a | Forwarded headers trusted only from connector | N-A | backend/app has no forwarded-header logic (grep X-Forwarded-For: none) | App never consumes IP headers; edge half unbuildable in repo |
| EDG-05a | Two cloudflared connectors documented | N-A | (infra) | Not in repo |
| EDG-06a | Origin-direct emergency topology pre-staged | MISSING | Glob **/{Caddyfile,docker-compose*,cloudflared*}: no matches | No cert/firewall/DNS fallback artifacts |
| EDG-07a | Venue-IP allow rule + generous thresholds | N-A | (edge config) | Not in repo; app limits are identity-keyed (deps.py:30-39) |
| EDG-08a | Scoped WAF exceptions + attack-text corpus | MISSING | no corpus artifact in repo; matching/review store text inert | Edge half N-A; repo half (accept attack text as data) works |
| EDG-09a | Archive uploads via Access-protected admin host | N-A | backend/app/storage.py:57-91 (safe metadata-only ZIP check) | Repo half done; edge routing unbuildable |
| EDG-10a | Rocket Loader/Scrape Shield off | N-A | (edge setting) | Not in repo |
| EDG-11a | private,no-store default; only public data cacheable | DONE | backend/app/main.py:89-91 | Default no-store; /v1/public + /health public,max-age=10; leaderboard not CDN-cacheable (conservative) |
| EDG-12a | Hashed assets + X-Min-Client-Version | PARTIAL | frontend/package.json (vite default hashing); grep X-Min-Client-Version: none | No X-Min-Client-Version header anywhere |
| EDG-13a | CSP/HSTS/XCTO/Referrer/Permissions-Policy on every host | MISSING | backend/app/main.py:87-88 (only nosniff + no-referrer) | No CSP, HSTS or Permissions-Policy anywhere in repo |
| EDG-14a | Free-plan limits verified | N-A | (process) | - |
| EDG-15a | Turnstile at activation/reset | MISSING | grep turnstile: none | No captcha anywhere |
| FEA-01a | Monorepo split builds; no admin screens in participant build | MISSING | frontend/src/App.tsx:16-19 (admin/review pages imported into one SPA); .github/workflows/ci.yml (no bundle scan) | Single bundle ships admin+review code to participants; client-side RequireRole only |
| FEA-02a | State-ownership table (server/Query/Zustand/IndexedDB/router) | PARTIAL | frontend/package.json (@tanstack/react-query); Workspace.tsx:148-230 (server drafts) | Query + router + components yes; no Zustand, no IndexedDB |
| FEA-03a | IndexedDB best-effort; 4 draft states visible | MISSING | grep indexedDB in frontend/src: no matches | Drafts are server-only via /v1/drafts (submissions.py:468-521) |
| FEA-04a | OpenAPI-generated client + staleness check in CI | MISSING | frontend/src/lib/api.ts:1-181 (handwritten); ci.yml (no codegen step) | Hand-written client beside schema |
| FEA-05a | GET retries per policy; mutations retry only with idempotency key | PARTIAL | frontend/src/lib/api.ts:121,141-147,178-181 | Idempotency-Key header + one silent-refresh retry; no GET retry policy |
| FEA-06a | /v1/time + state are only clocks; lowest-RTT offset, display-only | PARTIAL | backend/app/routers/state.py:21-25,64; frontend/src/lib/format.ts:72-74; Workspace.tsx:463-477 | Server-authoritative and display-only yes; offset is single-sample, not multi-sample lowest-RTT |
| FEA-07a | D1 realtime is polling (5s active / 30s idle) | DONE | frontend/src/pages/participant/Workspace.tsx:112,117 (refetchInterval 5s/15s); state.py:45-94 | Polling only; SSE absent (accepted L-06) |
| FEA-08a | Monaco self-hosted, lazy, read-only, capped, soak <3s TTI | MISSING | grep monaco in frontend/src + package.json: no matches | Plain pre/code viewer in Workspace; no editor at all |
| FEA-09a | Precomputed pinned indexes; server-side paginated search | PARTIAL | backend/app/routers/challenges.py:146-172 (LIMIT 50, rate-limited); models_app.py:348 (line index) | Server-side bounded search yes; no symbol index, no parser version pin, no pagination cursor |
| PRX-01a | Proxy limits/routing/timeouts | MISSING | Glob Caddyfile/nginx/compose: no matches | No proxy config in repo |
| PRX-02a | Compose set with per-process CPU/mem limits + DB budget | MISSING | Glob compose/docker-compose: no matches; DEPLOYMENT_RUNBOOK.md:56 ("NOT built yet in this repo") | - |
| PRX-03a | Per-process least-privilege DB roles | PARTIAL | ci.yml:93-117 + scripts (app_api, gt_admin, scheduler); backend/app/db.py:40-44 | app_api vs gt split good; evaluator shares gt_admin; roles not created in migrations |
| PRX-04a | Same-VM separation honestly documented | N-A | docs/DEPLOYMENT_RUNBOOK.md (process doc) | - |
| API-01a | 15-module layout, import boundaries in CI | PARTIAL | backend/app/main.py:97-110 (router include list); no boundary CI | Modular monolith via routers; shared app schema, no 15 modules, no boundary check |
| API-02a | Fixed request-pipeline order on every route | DONE | backend/app/main.py:64-92 (request id, size limit, headers); deps.py:55-88 (authn); errors.py:67-80 (envelope) | Size limit only checked when Content-Length present (see F-CKLB-25) |
| API-03a | Nine-step submission transaction order | DONE | backend/app/routers/submissions.py:92-325 (docstring 3-10; FOR UPDATE 148; clock 157; insert block 259-314) | Order matches arch 8.1 |
| API-04a | Idempotency: replay receipt / 409 / no double quota / concurrent convergence | PARTIAL | submissions.py:123-139 (replay+409); migrations/0001_init.sql:391 (unique (author_id,idempotency_key)); tests/test_idempotency.py:26-51 | Concurrent same-key not converged: unique violation yields 500 (F-CKLB-06); tests are sequential only |
| API-05a | clock_timestamp() once after lock; never now() | DONE | submissions.py:141-157; db.py:73-75 | now() never used for acceptance |
| API-06a | Uniform published grace window | DONE | submissions.py:169-180; state.py:87 (grace_seconds surfaced); state.py:132 (/v1/config) | Grace uniform, in stage row, published to clients |
| API-07a | Ack only after commit | DONE | submissions.py:315-325 (return after `with app_session()` commits) | - |
| API-08a | Honest D1 durability claims | DONE | docs/BACKUP_AND_RECOVERY.md ("no automated backup job..."); api copy makes no zero-loss claim | Honest posture everywhere |
| API-09a | Endpoint families per spec | PARTIAL | routers/auth.py, state.py, challenges.py, submissions.py, review.py, leaderboard.py, admin.py (route list) | auth/state/challenges/submissions/review/scoring/admin present; no round-key/stream, no notifications, no integrity endpoints |
| API-10a | No ground-truth in responses/logs; serialization tests | DONE | tests/test_gt_isolation.py:18-52; submissions.py:371-381; challenges.py:1-5 | Real-role tests + response-shape test |
| API-11a | Transactional outbox + at-least-once dispatcher with stable IDs | PARTIAL | submissions.py:297-303 (same-txn insert); evaluator.py:631-643 | Dispatcher handler exists but never enqueued and delivers nothing (F-CKLB-10) |
| API-12a | Identity-keyed quotas transactional; in-process limiter accelerator only | PARTIAL | deps.py:27-39 (in-process bucket); submissions.py:206-239 (transactional caps) | Rate limiter is per-process only; caps are transactional; L-05 documents |
| API-13a | Data contracts match spec section 11 shapes | PARTIAL | submissions.py:48-68 (SubmissionIn fields); submissions.py:328-338 (receipt); state.py:77-94 (round state) | Core shapes match; evaluation record lacks engine_version/rule_set_hash/features (F-CKLB-15) |
| API-14a | GET /v1/config exposes participant-visible config | DONE | backend/app/routers/state.py:97-139 (safe_keys allow-list) | - |
| API-15a | announcements_version + leaderboard_version counters | DONE | state.py:66-92 | - |
| API-16a | NOTIFICATIONS module + email templates via outbox | MISSING | grep send_email/smtp in backend/app: no matches; KNOWNS L-01 | No email at all (P0 before event per docs) |
| EVS-01a | Deterministic matcher; features+version+ruleset hash recorded | PARTIAL | matching.py:121-199 (pure, features); evaluator.py:167 (L/C/A in note) | evaluator_version and rule_set_hash never recorded per evaluation; candidate set not persisted |
| EVS-02a | Auto-accept disabled until 99% precision validated on blind set | PARTIAL | matching.py:188-192 (auto_full live by default); admin.py:160-176 (rule_set_hash freeze) | Thresholds frozen at publication, but no blind validation set or precision measurement exists (F-CKLB-29) |
| EVS-03a | Decision rules exactly per spec (0.9/0.6/0.2, structural reject only) | DONE | matching.py:138-199; submissions.py:83-85 (span) | auto_partial -> review; reject only structural; duplicates via claims |
| EVS-04a | Points/penalties per spec (severity x quality; fp_factor, cap) | PARTIAL | evaluator.py:482-559 (penalty exact); scoring.py:104-115 (component-weight award model) | Penalty side matches spec; award side uses 3-component weight model, not severity x quality (documented deviation) |
| EVS-05a | Published tie-break order computed by engine | PARTIAL | scoring.py:126-164; tests/test_scoring.py:237-256 | First 3 tie-breaks implemented+tested; no manual-panel flag |
| EVS-06a | Rescoring determinism proven in CI via corpus replay | PARTIAL | matching.py:1-6 (pure function); tests/test_matching.py:1 (unit tests only) | No recorded-corpus replay self-test in CI |
| DB-01a | Five logical schemas + role grants as specified | PARTIAL | migrations/0001_init.sql:5,26,573 (app/gt/audit only); ci.yml:94-116 (roles) | practice and integrity schemas absent; role DDL lives in CI/scripts, not migrations (F-CKLB-22) |
| DB-02a | tenant_id everywhere; cross-tenant denial tested | PARTIAL | 0001_init.sql:79,392 (tenant_id FKs); submissions.py:106-121; tests/test_authorization.py:1 | tenant_id on core rows + ownership scoping; adversarial tenant tests not seen |
| DB-03a | Core tables per spec (UUIDv7, FKs, cursors) | PARTIAL | 0001_init.sql:28-517, 0003_four_level_flow.sql; db.py:81-88 (uuid7) | Broad inventory present; audit checkpoints table absent; cursor pagination not implemented |
| DB-04a | Invariants as constraints (idempotency, award, immutability, gt denied) | DONE | 0001:390-398 (unique idem+hash), 435-440 (unique award), 0002 (trigger); test_gt_isolation.py:18-37 | gt denial proven with real role |
| DB-05a | Ledger immutable; corrections append reversals; recompute deterministic | DONE | 0002_score_ledger_immutable.sql:3-16; scoring.py:44 (reverses_entry_id); test_scoring.py:27-83 | Trigger blocks UPDATE/DELETE as app role too |
| DB-06a | Canonical award units; unique claim | DONE | 0001:435-440 UNIQUE(stage_id,team_id,award_unit_id); scoring.py:68-101 (ON CONFLICT DO NOTHING) | Team-keyed rather than participant-keyed (team model) |
| DB-07a | Same-txn audit append; per-scope serialization; external signed checkpoints | PARTIAL | audit.py:20-66 (same-txn, per-scope chain); audit.py:35-39 (no serialization) | Chain can fork under concurrency (F-CKLB-01); no external signed checkpoints at all (F-CKLB-02) |
| DB-08a | Connection budget documented with alert | PARTIAL | config.py:27-28 (pool 8+4); no budget doc/alert | No calculated budget or 70% alert |
| DB-09a | Off-site encrypted WAL/base backups with verification | MISSING | docs/BACKUP_AND_RECOVERY.md sec.3 ("NO automated backup job, no WAL archiving... restore script") | (F-CKLB-04) |
| DB-10a | Host clock sync (chrony) + offset alert; no datetime.now() decisions | PARTIAL | submissions.py:157 (DB clock); leaderboard.py:42 (app clock for cutoff) | chrony/alert is ops (absent); one minor app-clock use in leaderboard cutoff |
| DB-11a | No sequential-ID authz; UUIDs + ownership recheck | DONE | db.py:81-88 (uuid7); submissions.py:386-404; deps.py:1-5 | - |
| WRK-01a | SKIP LOCKED claim, lease, bounded backoff, dead-letter + alerts | DONE | jobs.py:41-64,88-99; worker.py:32-52; admin.py:962-990 (dead letters surfaced) | No jitter; alert is admin-visibility, not paged |
| WRK-02a | No locks/txn across evaluation/email/external work | DONE | jobs.py:128-148 (work outside claim txn); evaluator.py:130-134 (gt read in own session) | - |
| WRK-03a | Submission txn inserts evaluate job atomically; polling recovery | DONE | submissions.py:295; worker.py:46 (drain loop) | - |
| WRK-04a | Per-kind retry policy, max attempts, dead-letter, metric | PARTIAL | jobs.py:21-24 (uniform backoff/max_attempts=5) | No per-kind policies, no jitter, no metrics (F-CKLB-27) |
| WRK-05a | Evaluation unique on (submission, engine version, ruleset); gt via separate role | PARTIAL | evaluator.py:97-104 (_has_component); db.py:40-44 (gt engine) | No evaluator_version / rule_set_hash uniqueness or recording |
| WRK-06a | Single scheduler with leader lock/lease | PARTIAL | worker.py:38-45 (inline auto-submit scan); no leader lock | scheduler role created in CI but unused (L-10); two workers would double-scan (F-CKLB-20) |
| OBJ-01a | Narrow ObjectStore adapter; content-hash keys | PARTIAL | storage.py:30-54 (adapter + sha256 keys) | Local-FS D0 backend; no provider impl |
| OBJ-02a | Private buckets; signed URLs only post-authorization | PARTIAL | storage.py:23-27 (private dir); no public serving path | No signed URLs (none needed in D0) |
| OBJ-03a | Backups to separate provider/account, keys with two custodians | MISSING | BACKUP_AND_RECOVERY.md sec.3 | (F-CKLB-04) |
| OBJ-04a | Defined object-store outage behaviour | PARTIAL | storage.py:45-48 (SERVICE_DEGRADED fail-closed) | Pause thresholds not implemented |
| HST-01a | Confirm Always Free limits in console | N-A | (process) | - |
| HST-02a | Tested alternate-host recovery path | MISSING | RELEASE_PLAN_D1.md (plan only, execution UNRUN) | No recovery path artifact |
| HST-03a | ARM64 images build/test in CI | MISSING | ci.yml:41,66,225 (ubuntu-latest x86; no image build) | No Dockerfile/ARM64 job at all |
| HST-04a | Measured compose resource budget | MISSING | no compose file; LOAD_TEST_REPORT.md UNRUN | - |
| HST-05a | Cap = largest fully tested count | MISSING | LOAD_TEST_REPORT.md:3 (all cells UNRUN) | Honesty preserved (max_participants gated) but unmeasured |
| HST-06a | Cost guardrails | N-A | (process) | - |
| HST-07a | No laptop nodes; no Kubernetes on D1 | DONE | repo LS (no k8s manifests, single worker design); worker.py:1-6 | Nothing violates ADR-001/009 |
| HST-08a | Cert/domain expiry monitoring | MISSING/N-A | no artifacts | Deployment not started |
| HST-09a | Secrets encrypted at rest (SOPS/age), secret scanning, rotation | PARTIAL | ci.yml:18-30 (gitleaks); config.py:32 (dev default flagged) | No SOPS/age pipeline, no rotation procedure artifact |
| HST-10a | Pinned deps, image scans, minimal non-root images | PARTIAL | backend/requirements.txt (== pins); frontend package-lock.json; no image scan/Dockerfile | Lockfiles yes; scans/base images absent |
| HST-11a | Scaling sequence discipline (no Redis/microservices) | DONE | repo (no Redis anywhere); config.py:51-53 (kill switches) | - |
| HST-12a | Disk-full/memory defences + resource alerts | MISSING | no monitoring artifacts; OBS-02a partial | - |
| OBS-01a | External probes, two alert channels, external status page | MISSING | no probe/status artifacts; Landing.tsx has no status link | (F-CKLB-23) |
| OBS-02a | Required signals collected (latency, queue, DB, host) | PARTIAL | main.py:112-118 (/health); db.py:97-112 (probes); admin.py:962-990 (queue age/dead letters) | No HTTP latency histograms/p95, no host metrics |
| OBS-03a | Structured logging allow-list; no secrets logged | PARTIAL | main.py:34 (basicConfig); no sensitive logging found (grep) | Not structured, no allow-list mechanism |
| OBS-04a | Tiered alerts linked to runbooks | MISSING | no alerting code/config | Runbooks exist (docs) but no alert system |
| OBS-05a | D1 full-path load test (baseline, login burst, T0, deadline rush, soak) | MISSING | LOAD_TEST_REPORT.md:3 ("MEASUREMENT PENDING (UNRUN at the approved cap)") | Script exists (scripts/load_test.py) but zero accepted numbers (F-CKLB-03) |
| OBS-06a | Backup restore drill with measured RPO/RTO | MISSING | BACKUP_AND_RECOVERY.md sec.3-4 (manual procedure only, drill PENDING L-16) | (F-CKLB-04) |
| OBS-07a | Full dry-run + game-day failure injections | MISSING | no drill records; EVENT_OPERATIONS_PLAYBOOK.md (plan only) | Process; not evidenced |
| OBS-08a | Change freeze T-24h, emergency path, immutable digests | PARTIAL | docs/DEPLOYMENT_RUNBOOK.md:129-130 (freeze + rehearsal rule) | Documented, not enforced by pipeline (no deployment pipeline at all) |
| OBS-09a | Environments + CI gates (lint, tests, IDOR, migrations, scans) | PARTIAL | ci.yml:33-126 (ruff, bandit, pip-audit, pytest+PG+real roles, e2e), 216-240 (frontend) | No staging env, no image build/provenance, no axe |
| OBS-10a | Named event roles, shared channel, decision log | N-A | EVENT_OPERATIONS_PLAYBOOK.md:39-44 (roles table) | Process document exists |
| OBS-11a | Runbooks for the eleven emergencies | PARTIAL | EVENT_OPERATIONS_PLAYBOOK.md; DEPLOYMENT_RUNBOOK.md:84,123 | Most scenarios covered as docs; key-compromise/answer-key-exposure entries thin |
| OBS-12a | Pre-event pen test with findings closed | MISSING | SECURITY_REVIEW.md:26 (F-07 PENDING), :55 (self-review only) | (F-CKLB-23 group) |
| OBS-13a | Egress default-deny; no user-controlled URL fetch | PARTIAL | grep outbound fetch/http in backend/app: none (no SSRF surface) | Repo clean; egress firewall is deployment |
| OBS-14a | Degradation ladder implemented and drilled | PARTIAL | config.py:51-53 (kill switches); admin.py stage control (pause) | Ladder partially present (pause, leaderboard modes); not drilled |
| PR-01 | No tokens in storage/URLs; memory only | DONE | frontend/src/lib/api.ts:44-52 (module var); grep localStorage: only admin id list (Challenges.tsx:23-32, non-secret) | - |
| PR-02 | No admin screens/secrets in participant build | PARTIAL | App.tsx:16-19; chrome.tsx RequireRole (client-side) | Violation of the build-boundary prohibition (F-CKLB-05) |
| PR-03 | No answer-key in bundles/public responses | DONE | test_gt_isolation.py:46-52; challenges.py (files from app schema only) | - |
| PR-04 | No participant-supplied identity as authority | DONE | submissions.py:106-121,254-257 (server-resolved challenge); deps.py:55-88 | - |
| PR-05 | No unpinned JWT algs; iss/aud/exp/nbf verified | DONE | security.py:97-112 (pinned HS256, requires exp/iat/nbf/sub/sid, issuer+aud) | - |
| PR-06 | No broad cookie domain; no token in URL | DONE | auth.py:32-46; refresh via POST cookie; no token query params | - |
| PR-07 | No archive extraction/execution in API process | DONE | storage.py:57-91 (central-directory metadata only) | - |
| PR-08 | No secrets/answer-key in logs | DONE | main.py:34 (minimal logging); no payload logging found | - |
| PR-09 | No floating tags | N-A | no images in repo | - |
| PR-10 | No HTML/Markdown render of participant text | DONE | grep dangerouslySetInnerHTML/innerHTML: none; review.py:4-5 plain text | - |
| PR-11 | No unvalidated outbound URL fetch | DONE | grep: no outbound fetch features | - |
| PR-12 | No live verdicts while feedback hidden | DONE | submissions.py:371-381 (status coerced to "received") | - |
| PR-13 | No live leaderboard without hidden feedback + 600s delay | DONE | leaderboard.py:34-42 (hidden default; 600s frozen delay) | - |
| PR-14 | No automatic telemetry-driven scoring | DONE | telemetry_enabled=False (config.py:53); no scoring link | - |
| PR-15 | No unvalidated semantic auto-reject | DONE | matching.py:138-142,197-198 (structural only) | - |
| PR-16 | No claimed-severity scoring; no matcher-confidence penalties | DONE | matching.py (claimed_severity unused); borderline -> needs_review (191-199) | - |
| PR-17 | No post-hoc rules/tie-breaks | N-A | process; rules_version gate enforced (deps.py:121-138) | - |
| PR-18 | No in-place edits of frozen rules/GT | DONE | admin.py:155-199 (revisions + freeze); GROUND_TRUTH_LOCKED errors.py:40 | - |
| PR-19 | No security claims for copy-blocking | DONE | Landing.tsx footer (safe-harbour wording only) | - |
| PR-20 | No full GT to third-party model | DONE | ai_assessment_enabled=False (config.py:52); no vendor calls | - |
| PR-21 | No browser clock for acceptance | DONE | submissions.py:157 | - |
| PR-22 | No now()/datetime.now() for deadline decisions | DONE | submissions.py:157 (clock_timestamp only); minor: leaderboard.py:42 app clock for snapshot cutoff (F-CKLB-28) | - |
| PR-23 | No hidden/asymmetric grace | DONE | submissions.py:169-180 + state.py:87,132 (published) | - |
| PR-24 | No paused-shown-as-running timer | DONE | state.py:76,88 (paused flag); Workspace.tsx:476 (paused styling) | - |
| PR-25 | No disposable store as authority | DONE | PostgreSQL-only; no Redis/cache store of scores/jobs | - |
| PR-26 | No double award of one unit | DONE | 0001:436 unique claim + ON CONFLICT (scoring.py:89) | - |
| PR-27 | No ledger/audit mutation | DONE | 0002 trigger + test_scoring.py:69-83 | - |
| PR-28 | No pre-commit acknowledgement | DONE | submissions.py:315 (post-commit return) | - |
| PR-29 | No receipt replay on different payload | DONE | submissions.py:136-137 (409); test_idempotency.py:39-51 | - |
| PR-30 | No locks across evaluation/email | DONE | jobs.py:140-148; evaluator sessions separate | - |
| PR-31 | No locally-queued report labelled accepted | PARTIAL | Workspace receipt flow (server 202 only); no offline queue exists at all | No queue means no mislabelling, but the offline story is absent (F-CKLB-13) |
| PR-32 | No D2 guarantees advertised | DONE | docs honest (LOAD_TEST_REPORT, BACKUP docs, RPO language) | - |
| PR-33 | No capacity beyond tested count | DONE | LOAD_TEST_REPORT.md gates max_participants | - |
| PR-34 | No K8s / fake replica HA | DONE | no orchestration, single worker | - |
| PR-35 | No Redis/PgBouncer without measured need | DONE | none present | - |
| PR-36 | No sandbox execution in D1 | DONE | config.py:51 runner_enabled=False; storage never executes | - |
| PR-37 | No webhooks in D1 | DONE | none present | - |
| PR-38 | No silent durability downgrade | DONE | storage.py:45-48 fail-closed SERVICE_DEGRADED | - |
| PR-39 | Free-tier sole-host risk accepted in writing | N-A | process | - |
| PR-40 | No mid-freeze deploys outside emergency path | N-A | documented in DEPLOYMENT_RUNBOOK.md:129-130 | No pipeline to enforce |
| PR-41 | No registration with open gate items | N-A | admin.py:1003-1041 readiness items exist as gate tooling | - |
| PR-42 | No monitoring inside primary failure domain | MISSING | no monitoring artifacts (same as OBS-01a) | - |
| PR-43 | No skipping restore drill / no cross-migration rollback | PARTIAL | drill not performed; migrations forward-only (migrate.sh design) | - |
| PR-44 | No telemetry without consent/retention schedule | PARTIAL | telemetry_enabled=False default; Privacy.tsx exists; retention doc thin | - |
| PR-45 | No claims that AI/screenshots are technically prevented | DONE | rules wording (safe-harbour only) | - |
| PR-46 | No per-tenant databases for MVP | DONE | single shared DB with tenant_id (0001:53) | - |
| G0-01 | Ten decisions recorded | N-A | docs/AUTONOMOUS_DECISION_LOG.md exists | Decision documentation, not code |
| G0-02 | Fifteen ADRs adopted | PARTIAL | ADR references throughout docs/code (ADR-012 submissions.py:141; ADR-003 jobs.py:1; ADR-010 config.py:51) | Adoption is documentary |
| G0-03 | Monorepo scaffold + CI green | DONE | .github/workflows/ci.yml:47-54,123-126,232-239 | CI exists and covers lint/format/types/tests/e2e |
| G0-04 | OCI host provisioned, connectors registered | MISSING | no infra artifacts | Deployment not started |
| G0-05 | Design tokens, shared components, error catalog | PARTIAL | frontend/src/styles/tokens.css; frontend/src/ui/components.tsx; backend/app/errors.py:16-54 | Catalog exists; 17-component claim not counted |
| G0-06 | Schema bootstrap with roles + first migrations | PARTIAL | migrations/0001-0003; ci.yml:93-117 (roles, not migrations) | Roles outside migrations (F-CKLB-22) |
| G0-07 | Secrets pipeline + secret scanning + env plan | PARTIAL | ci.yml:18-30 (gitleaks); no SOPS/age | - |
| G1-01 | Public pages from static host | PARTIAL | App.tsx:25-30 (landing/rules/privacy/terms); Landing.tsx:303-337 (FAQ) | No status link; not a separate static host |
| G1-02 | Auth on staging (invite, lockout, rotation grace, rules gate) | PARTIAL | auth.py routes (activate, refresh, step-up, resets); deps.py:121-138 (rules gate); test_auth.py (ATH-01..05) | No Turnstile; staging env absent |
| G1-03 | Lobby: overview, tour, system check | PARTIAL | Lobby.tsx:122-123 (readiness checklist panel) | No five-step tour with completion, no automated system check |
| G1-04 | Workspace shell five regions, resizable, shortcuts | PARTIAL | Workspace.tsx (HUD, tree, code, report panel, submissions drawer) | No resizable panes/shortcuts; Monaco absent (FEA-08a) |
| G1-05 | Practice env isolated, /v1/practice/ namespace | PARTIAL | four-level flow implemented instead (levels.py, migrations/0003); test_gt_isolation.py proves isolation | Deliberate redesign; no /v1/practice/ endpoints |
| G1-06 | Cross-browser + axe in CI | MISSING | ci.yml (no browser matrix, no axe) | - |
| G2-01 | Submission transaction tests incl. process termination + 5 concurrent | PARTIAL | test_idempotency.py:26-51 (sequential); submissions.py:259-314 (atomic) | No process-termination test, no concurrent same-key test; see F-CKLB-06 |
| G2-02 | Deadline proofs (grace boundary, clock skew, pause races) | PARTIAL | test_idempotency.py:75-82 (ROUND_ENDED); test_flow_gates.py, test_flow_auto_submit.py (windows) | Exact grace+1s boundary and pause/resume race tests not confirmed |
| G2-03 | GT isolation proven with production role | DONE | test_gt_isolation.py:18-43 | - |
| G2-04 | Scoring correctness (concurrent, append-only, unique claims) | DONE | test_scoring.py:27-151; 0002 trigger; scoring.py:68-101 | - |
| G2-05 | Oracle defences (caps 12/80, cooldown 20s, span 25, probe flag) | PARTIAL | submissions.py:83-239 (caps/cooldown/span under stage lock) | No probing-pattern integrity flag (G3-06 console absent) |
| G2-06 | Per-participant AES-256-GCM bundles, key release (425 pre-start) | MISSING | errors.py:37 (KEY_NOT_AVAILABLE defined, never used); grep AES/GCM: none | Four-level flow replaced sealed bundles; no key-release mechanism |
| G2-07 | Round state over polling, pause semantics | DONE | state.py:45-94; submissions.py:172-173 (ROUND_PAUSED); Workspace.tsx:117 (5s) | - |
| G2-08 | Frozen leaderboard (snapshot job, 600s delay, no detail leak) | DONE | leaderboard.py:21-62; evaluator.py:579-628 (snapshot job); scoring.py:126-164 (totals only) | - |
| G2-09 | Evaluation pipeline completes; 60s auto-path target | PARTIAL | evaluator.py:107-208; admin.py:962-990 (queue visibility) | 60s target never measured (load test UNRUN) |
| G2-10 | Outbox delivers at-least-once with dedupe | PARTIAL | submissions.py:297-303; evaluator.py:631-643 | Dispatcher never scheduled, delivers nothing (F-CKLB-10) |
| G2-11 | Draft semantics (IndexedDB debounce, offline flush, 4 states) | PARTIAL | submissions.py:487-521 (version conflict); Workspace.tsx:200-230,815 (3s autosave) | No IndexedDB, no offline queue (F-CKLB-13) |
| G3-01 | Layered admin access (Access hostnames, MFA, step-up 5 min) | PARTIAL | deps.py:141-162 (5-min step-up); admin.py:543-689 (step-up on GT/challenge ops) | Password re-entry, not MFA; no Access hostnames/network split (L-04, F-CKLB-08) |
| G3-02 | Review queue (SLA timers, double review, calibration) | PARTIAL | review.py:25,65-100 (10-min claim timeout), 103+ (decision) | No SLA timers, no double review for Critical/High, no calibration (F-CKLB-18) |
| G3-03 | Unplanned-finding promotion + rescoring | MISSING | evaluator.py:394-405 (routes back to needs_review); KNOWNS L-11 | No promotion proposal/revision/rescoring (F-CKLB-19) |
| G3-04 | Rescoring/finalization controls (previews, blocking checklist) | PARTIAL | admin.py:398-419 (release), 1262-1290 (manual adjustment with audit) | No impact previews; finalization blocking on pending reviews not verified |
| G3-05 | Live ops console (controls, announcements, kill switches) | PARTIAL | admin.py:281-384 (stage controls w/ reason), 892-932 (announcements, time adjustment), 946+ (live view) | Typed confirmations partial; kill-switch panel is config flags only |
| G3-06 | Integrity console (signals, cases, watermark attribution) | MISSING | grep integrity console/watermark: none in app | No integrity module at all (F-CKLB-21) |
| G3-07 | Challenge authoring (fuzz, validation reports, watermark slots, preview) | PARTIAL | admin.py:568-689 (upload/freeze/publish); storage.py:57-91 (safety); test_flow_uploads.py (12 tests) | No two-reviewer audit, watermark slots, preview mode |
| G3-08 | Audit chain verification + nightly job + external checkpoints | PARTIAL | audit.py:69-95; admin.py:1043-1046 (verify endpoint) | No scheduled/nightly verification job; no external checkpoints (F-CKLB-02) |
| G4-01 | Security control pass (CSP, WAF corpus, limits, IDOR suites) | PARTIAL | test_authorization.py; deps (bind params everywhere); main.py:87-89 | No CSP/HSTS/Permissions-Policy (F-CKLB-11); body limit bypass via chunked (F-CKLB-25) |
| G4-02 | Full-path 50-cap load test passes | MISSING | LOAD_TEST_REPORT.md:3 (all UNRUN) | (F-CKLB-03) |
| G4-03 | Backup restore drill with RTO/RPO | MISSING | BACKUP_AND_RECOVERY.md sec.3-4 | (F-CKLB-04) |
| G4-04 | DB failure drill (kill primary, lease expiry) | MISSING | no drill records; jobs.py:102-111 (requeue code only) | - |
| G4-05 | Pen test closed + safe-harbour channel | MISSING | SECURITY_REVIEW.md:26 (F-07 PENDING); Landing.tsx safe-harbour wording exists | - |
| G4-06 | Game-day injections with recovery times | MISSING | no records | - |
| G4-07 | Resource/connection budgets verified at peak | MISSING | no compose budget; LOAD_TEST_REPORT UNRUN | - |
| G4-08 | S3 polish sweep + AT matrix green | MISSING | ONE_SHOT_ACCEPTANCE_CRITERIA.md:64-69 (UNRUN list) | Matrix rows partially covered by automated tests |
| G5-01 | Readiness gate signed with evidence | N-A | admin.py:1003-1041 (readiness tooling exists); sign-off is process | - |
| G5-02 | Venue dry-run with shared-IP test | MISSING | no dry-run record | Process, not evidenced |
| G5-03 | Two independent uplinks verified | N-A | process | - |
| G5-04 | Change freeze armed; immutable digests | N-A | documented in DEPLOYMENT_RUNBOOK.md:129-130; no deployment pipeline | - |
| G5-05 | Printed runbooks, named roles, tested channel | N-A | EVENT_OPERATIONS_PLAYBOOK.md:39-44 | Process |
| G5-06 | Legal surfaces published; status page live | PARTIAL | Rules/Privacy/Terms pages + deps.py:121-138 acceptance gate; no status page | - |
| AT-01/02 | Two-tab login; rotated replay revokes family | DONE | security.py:1-10 (family rotation/reuse); tests/test_auth.py:1 (ATH-01..05) | - |
| AT-03/04 | Same-key 5x one receipt; different payload 409 | DONE | test_idempotency.py:26-51 | - |
| AT-05 | deadline+grace+1s -> 409 ROUND_ENDED | PARTIAL | test_idempotency.py:75-82 (post-end 409) | Exact grace+1s boundary assertion not confirmed |
| AT-06 | Local clock change: no server effect | DONE | submissions.py:157; Workspace offset display-only (Workspace.tsx:463-477) | - |
| AT-07 | Concurrent evaluations -> one award + duplicate | DONE | test_scoring.py:86-151; scoring.py:68-101 | - |
| AT-08 | app_api denied on gt | DONE | test_gt_isolation.py:18-37 | - |
| AT-09 | Cross-participant access -> 403/404 | DONE | submissions.py:403-404; test_authorization.py:1 (7 tests) | - |
| AT-10 | Attack-text report survives pipeline inert | PARTIAL | React text rendering; review plain text (review.py:4-5) | Edge/WAF half untested (no edge) |
| AT-11 | Pause -> ROUND_PAUSED; grace for in-flight | DONE | submissions.py:172-173; state.py:76,88 | - |
| AT-12 | Kill DB primary mid-round recovery | MISSING | no drill | - |
| AT-13 | Redis drop fallback (polling in D1) | N-A | no Redis; polling is the path (Workspace.tsx:117) | - |
| AT-14 | Laptop-node pull: no impact | DONE | no laptop nodes in architecture (worker.py) | - |
| AT-15 | GT revision after freeze -> rescoring with previews | PARTIAL | admin.py:1262-1290 (manual adjustment, reversal entries, audit) | No rescoring run/previews (F-CKLB-19) |
| AT-16 | Unplanned valid finding credited to all | MISSING | evaluator.py:394-405 | (F-CKLB-19) |
| AT-17 | Probe script hits caps, no verdict, flag raised | PARTIAL | caps/cooldown/span enforced (submissions.py:206-239); hidden status (371-381) | No probing-pattern flag (integrity module absent) |
| AT-18 | T0 key-release spike at cap | MISSING | no key release mechanism; load test UNRUN | - |
| AT-19 | Offline 2 min -> ordered flush, no duplicates | MISSING | no offline queue (grep indexedDB: none) | (F-CKLB-13) |
| AT-20 | Deploy during freeze blocked by pipeline | N-A | no deployment pipeline exists to test | - |
| AT-21 | Restore verifies ledger/audit/leaderboard | MISSING | restore drill not performed | (F-CKLB-04) |
| AT-22 | Screen-reader/keyboard journey | PARTIAL | aria labels throughout chrome.tsx/components.tsx | No automated axe/screen-reader pass evidence |
| AT-23 | Venue shared-IP test from seats | MISSING | not run | - |
| AT-24 | GT access without step-up blocked | DONE | deps.py:141-162; admin.py:749,822 GT ops behind step_up_verified; errors.py:53 | AT-24 code exists (password re-entry form of step-up) |
| AT-25 | Finalization blocked on pending reviews | PARTIAL | admin.py release endpoint (398-419) | Blocking-on-pending-reviews assertion not confirmed |
| RDY-01 | All S1 mitigations verified current | N-A | process | - |
| RDY-02 | Full-path load test passes | MISSING | LOAD_TEST_REPORT.md:3 | (F-CKLB-03) |
| RDY-03 | Venue dry-run complete | MISSING | no record | - |
| RDY-04 | Game-day injections complete | MISSING | no record | - |
| RDY-05 | Restore drill with measured RPO/RTO | MISSING | BACKUP_AND_RECOVERY.md sec.3 | (F-CKLB-04) |
| RDY-06 | Pen test closed | MISSING | SECURITY_REVIEW.md:26 | - |
| RDY-07 | Two-reviewer challenge certification + pre-flight solvers | N-A | process | - |
| RDY-08 | Answer-key isolation re-proven in production | PARTIAL | test_gt_isolation.py (proven in CI/test env) | Production deployment does not exist yet |
| RDY-09 | Rules/privacy/consent published | PARTIAL | Rules.tsx/Privacy.tsx/Terms.tsx + acceptance gate | Appeal window text unverified |
| RDY-10 | Printed runbooks, tested channels | N-A | docs exist; printing is process | - |
| RDY-11 | Venue network + second uplink tested | MISSING | not run | - |
| RDY-12 | Review capacity supports results date | N-A | process | - |
| RDY-13 | Helpdesk channels + pause scripts | N-A | process | - |

## Findings

### F-CKLB-01 - Audit hash chain can fork under concurrent writes
- **Severity:** HIGH
- **Evidence:** backend/app/audit.py:35-39 (prev_hash read with `SELECT ... ORDER BY seq DESC LIMIT 1` without lock/serialization, then insert in caller txn); audit.py:69-95 (verification walks seq order)
- **Impact:** DB-07a (S1) / G3-08. Two concurrent writers in the same event_scope (e.g., the default `global` scope used by auth/login/dispute writes from two API processes) read the same `prev_hash` and both insert; the chain forks and `audit_verify` then reports a false break, destroying the tamper-evidence value of the audit log under normal traffic, not just attack.
- **Fix:** Serialize chain-head updates per scope: keep a `audit.chain_heads(scope, head_hash)` row locked `FOR UPDATE` inside the same transaction (or use `pg_advisory_xact_lock(hash(scope))`), then read head, insert, update head. Add a concurrent-write test.

### F-CKLB-02 - No external signed audit checkpoints
- **Severity:** HIGH
- **Evidence:** backend/app/audit.py:4-6 (docstring claims "D1 exports signed checkpoints externally at intervals" but no such code); no checkpoint job/export anywhere (grep checkpoint: none in app)
- **Impact:** DB-07a (S1) second half, G3-08, RDY. The hash chain lives only inside the same mutable database; anyone who compromises the DB rewrites the evidence too. The docstring overstates what is implemented.
- **Fix:** Implement a periodic checkpoint export job (sign chain head + seq with a key held outside the DB, write to separate storage), an unanchored-interval alert, and a nightly `chain_verify` job (G3-08). Until then, correct the audit.py docstring.

### F-CKLB-03 - D1 load test never executed; capacity unmeasured
- **Severity:** HIGH
- **Evidence:** docs/LOAD_TEST_REPORT.md:3 ("SCRIPT READY, MEASUREMENT PENDING (UNRUN at the approved cap)"; every results cell "UNRUN"); scripts/load_test.py exists but has no accepted numbers; ONE_SHOT_ACCEPTANCE_CRITERIA.md:66 (UNRUN item 1)
- **Impact:** OBS-05a / G4-02 / RDY-02 (all S1) plus HST-05, AT-18, PR-33. The 50-participant cap, the 500 ms ack / 300 ms read targets, the soak and the deadline-rush behaviour are all unmeasured claims; the launch gate cannot pass.
- **Fix:** Execute the documented procedure at the approved cap through the real edge (once it exists), fill the results table, record machine profile/dataset/script commit, and only then confirm `max_participants`.

### F-CKLB-04 - No automated backups, WAL archiving or restore drill
- **Severity:** HIGH
- **Evidence:** docs/BACKUP_AND_RECOVERY.md section 3 ("the repository contains NO automated backup job, no WAL archiving configuration and no restore script"); KNOWNS_LIMITATIONS_AND_FOLLOWUPS.md L-16 (rehearsal not performed)
- **Impact:** OBS-06a / DB-09a / OBJ-03a / G4-03 / RDY-05 (S1). Total VM/storage loss means total data loss; the backup-restore readiness gate can never be checked; the docs' honest RPO posture cannot be quantified.
- **Fix:** Add base backup + WAL archive pipeline to separate storage with separately controlled keys, automatic archive-continuity verification with alerts, and execute + time the restore drill into a scratch database; record measured RPO/RTO.

### F-CKLB-05 - Admin and reviewer screens ship in the participant bundle
- **Severity:** HIGH
- **Evidence:** frontend/src/App.tsx:16-19 (AdminDashboard/AdminChallenges/review pages imported into the single SPA); components/chrome.tsx RequireRole (client-side guard only); .github/workflows/ci.yml has no build-artifact scan
- **Impact:** FEA-01a / PR-02 (both S1). Whatever ships in the participant bundle ships to the adversary: admin console structure, endpoints and any future service-token material are exposed to participants; only a client-side route guard separates roles.
- **Fix:** Split participant/admin/reviewer into separately built apps (or dynamic-import guarded chunks excluded from the participant build) and add a CI bundle-scan step asserting no admin/review routes, GT strings or evaluator internals appear in the participant artifact.

### F-CKLB-06 - Concurrent same-key submissions return 500 instead of the stored receipt
- **Severity:** HIGH
- **Evidence:** backend/app/routers/submissions.py:123-139 (SELECT-then-INSERT with no ON CONFLICT/retry); migrations/0001_init.sql:391 (unique (author_id, idempotency_key)); tests/test_idempotency.py:26-36 (retries are sequential, no concurrency test)
- **Impact:** API-04a / G2-01 (S1: "concurrent same-key requests converge to one receipt"). Two requests racing on one key (double-click with a slow network) hit the unique index; the loser raises an unhandled IntegrityError and gets a 500 INTERNAL_ERROR instead of the stored receipt. No duplicate is created, but the convergence guarantee is broken and G2-01's "five concurrent" test cannot pass.
- **Fix:** Wrap the insert in ON CONFLICT ON CONSTRAINT handling, or catch the unique violation and re-read the stored row (returning the receipt or 409 on hash mismatch, exactly as the pre-check does). Add a concurrent same-key test.

### F-CKLB-07 - No per-participant sealed bundles or T0 key release
- **Severity:** HIGH
- **Evidence:** grep AES/GCM/nonce/seal in backend/app: only status-word "seal" in admin stage transitions (admin.py:299-300, 670); errors.py:37 defines KEY_NOT_AVAILABLE (425) but no route raises it; no key-release endpoint
- **Impact:** G2-06 (S1). There is no encrypted-bundle/key-release mechanism: bundle sealing is only a status change with a content hash, keys are never distributed, and the fairness-window decrypt behaviour (AT-18 / TIM-04) has no implementation. The repo's four-level flow is a documented redesign, but the checklist item's timing-fairness objective (all assigned clients decrypt within the window) has no equivalent.
- **Fix:** Either implement per-participant AES-256-GCM bundles with AAD manifests, a rate-limited, audited, no-store key-release endpoint gated on starts_at (425 before), or record the redesign in the reconciliation doc with an equivalent fairness-window gate on level-content release, and map AT-18 to it.

### F-CKLB-08 - Admin access has no MFA; step-up is password re-entry
- **Severity:** MEDIUM
- **Evidence:** backend/app/deps.py:141-147 ("In v1 without MFA infrastructure, step-up is implemented as a re-entered password check"); docs/KNOWNS_LIMITATIONS_AND_FOLLOWUPS.md L-04; SECURITY_REVIEW.md:61 (F-05 MFA pending)
- **Impact:** G3-01 (S1) partial. Compromise of one organizer/admin password reaches the admin API and the answer key with only a 5-minute re-auth prompt; AT-24 passes (step-up exists) but the "mandatory MFA" layer does not.
- **Fix:** Land the documented production path (Cloudflare Access in front of admin hostnames + WebAuthn, ADR-008) before the event, or at minimum require step-up (password re-entry) on every admin session start plus lockout on repeated failures.

### F-CKLB-09 - Rate limiting is in-process only
- **Severity:** MEDIUM
- **Evidence:** backend/app/deps.py:27-39 (module-level token bucket, per process); config.py:44 (max_concurrent_requests_per_user declared, not enforced, L-08); submission caps are transactional (submissions.py:206-239)
- **Impact:** API-12a (S2) / NET-01. With the planned two API processes, limits silently double; a restart clears the buckets; per-user concurrency cap is dead config. Documented as L-05 "accepted for single-VM D1" but the D1 topology itself specifies two API processes (PRX-02a).
- **Fix:** Move the limiter to PostgreSQL (or a shared store) keyed by identity, or enforce `max_concurrent_requests_per_user` in middleware; remove/annotate the dead setting either way.

### F-CKLB-10 - Outbox dispatcher is dead code and delivers nothing
- **Severity:** MEDIUM
- **Evidence:** backend/app/evaluator.py:631-643 (`dispatch_outbox` handler only marks rows `delivered_at = now()`; no receiver); grep shows the handler is never enqueued by any code path
- **Impact:** API-11a / G2-10 (S2). Outbox rows are written atomically (submissions.py:297-303) but nothing dispatches them; the "delivery" is a status flip with no email/SSE/webhook receiver and no receiver-side dedupe. The pattern is decorative; a future notification feature would silently do nothing.
- **Fix:** Enqueue `dispatch_outbox` on a schedule (worker loop) and give it a real delivery sink, or remove the outbox writes and document polling counters as the D1 realtime mechanism.

### F-CKLB-11 - No CSP, HSTS or Permissions-Policy headers
- **Severity:** MEDIUM
- **Evidence:** backend/app/main.py:87-89 (only X-Content-Type-Options, Referrer-Policy, Cache-Control); grep csp/hsts/content-security-policy across repo: no matches
- **Impact:** EDG-13a (S2) / G4-01 (S1 control pass). The XSS backstop for the memory-only token model does not exist; header posture is two of five required controls.
- **Fix:** Add a strict CSP (default-src 'self'; no need for worker-src until Monaco lands), HSTS, Permissions-Policy on the app/API hosts (proxy or middleware), and a CI header check per hostname.

### F-CKLB-12 - Monaco editor entirely absent
- **Severity:** MEDIUM
- **Evidence:** grep monaco in frontend/src and package.json: no matches; Workspace.tsx renders a plain read-only code panel
- **Impact:** FEA-08a / G1-04 (S2). No lazy-loaded read-only editor, no editor-model disposal, no cap on open tabs, no 3-hour soak or TTI numbers (FE-03/FE-06). The workspace experience is a code viewer, not the specified editor.
- **Fix:** Either integrate self-hosted Monaco (lazy, read-only, required language workers only, model disposal on tab close) with measured TTI, or record an explicit S2 waiver with the code-viewer rationale.

### F-CKLB-13 - No IndexedDB draft buffer or offline queue
- **Severity:** MEDIUM
- **Evidence:** grep indexedDB/localStorage in frontend/src: no IndexedDB anywhere (only admin Challenges.tsx:23-32 id list); drafts are server-only (submissions.py:468-521; Workspace.tsx:200-230,815)
- **Impact:** FEA-03a / G2-11 / AT-19 / PR-31 (S2). A two-minute venue network blip loses in-progress report text (no local buffer), there is no queued-reports flush, and the draft-local/queued/acknowledged UI distinction does not exist. The offline story the rules would promise is absent.
- **Fix:** Add an IndexedDB draft cache (best-effort, clearable) with debounced local saves, a bounded send queue keyed by idempotency key, and the four visibly distinct states in the workspace UI.

### F-CKLB-14 - API client is hand-written; no OpenAPI generation or staleness check
- **Severity:** MEDIUM
- **Evidence:** frontend/src/lib/api.ts:1-181 and lib/types.ts (hand-maintained); .github/workflows/ci.yml (no codegen/staleness step)
- **Impact:** FEA-04a (S2). The client and the server schema drift silently; the DO/DO-NOT pair explicitly forbids hand-writing the client beside the OpenAPI file. Runtime validation at boundaries is also absent (responses are cast, not validated).
- **Fix:** Generate the TS client + types from the OpenAPI schema in CI, fail on stale checked-in output, and validate critical response shapes at the boundary.

### F-CKLB-15 - Evaluation records lack engine version, ruleset hash and candidate set
- **Severity:** MEDIUM
- **Evidence:** grep evaluator_version/engine_version in backend/app: no recording anywhere; evaluator.py:167 records only L/C/A features inside a ledger note; rule_set_hash exists on stages (submissions.py:145) but is not persisted per evaluation
- **Impact:** EVS-01a (S1) / WRK-05a / API-13a. Evaluations are not fully replayable: the engine version and rule set that produced an outcome are not recorded with it, and there is no uniqueness on (submission_id, evaluator_version, rule_set_hash), so a future evaluator upgrade cannot deterministically re-score or prove which rules produced a score.
- **Fix:** Persist an evaluation row per submission with evaluator_version, rule_set_hash, feature values and candidate set (or at minimum version + hash on the ledger/review record) with the unique key, and include both in the rule_set_hash freeze.

### F-CKLB-16 - No recorded-corpus determinism replay test in CI
- **Severity:** MEDIUM
- **Evidence:** tests/test_matching.py:1 ("Unit tests for the deterministic matching engine"); no corpus fixture or replay test; ONE_SHOT acceptance docs list determinism as a property, not a test
- **Impact:** EVS-06a (S1). Determinism is designed (pure function, matching.py:121) but the CI self-test that replays a recorded corpus and asserts identical outcomes does not exist; regressions in scoring would not be caught as reproducibility failures.
- **Fix:** Add a CI test that loads a committed fixture corpus (reports + GT + rule sets + decisions), runs the matcher/evaluator twice and against stored expected outcomes, and fails on any drift.

### F-CKLB-17 - No email/notification capability at all
- **Severity:** MEDIUM
- **Evidence:** grep send_email/smtp/email_template in backend/app: no matches; KNOWNS_LIMITATIONS_AND_FOLLOWUPS.md L-01 (invite/reset tokens printed to console)
- **Impact:** API-16a (S2). Invite, password reset, schedule reminders, results-available and dispute-outcome emails do not exist; activation tokens are console-printed, which fails the moment invites go to real participants.
- **Fix:** Implement the outbox-driven transactional email module (or a documented manual hand-delivery procedure in the ops playbook with an owner and timing, per L-01's follow-up).

### F-CKLB-18 - Review console lacks SLA timers, double review and calibration
- **Severity:** MEDIUM
- **Evidence:** backend/app/routers/review.py:28-100 (queue + 10-min claim timeout only); no SLA timers, no automatic double review for Critical/High, no disagreement-resolution screen, no calibration mode, no workload dashboard beyond the admin queue counts (admin.py:962-990)
- **Impact:** G3-02 (S2). Review throughput is the results bottleneck; operability features the published schedule depends on are missing, so RDY-12 (review capacity) cannot be evidenced.
- **Fix:** Add per-item SLA timers with ageing display, double-review routing for high/critical and disagreements with lead-reviewer resolution, and a calibration mode with sample items.

### F-CKLB-19 - Unplanned-finding promotion and rescoring runs do not exist
- **Severity:** MEDIUM
- **Evidence:** backend/app/evaluator.py:394-405 (unplanned_valid re-routes to needs_review; comment "promotion is a P2 capability"); admin.py:1262-1290 (manual ledger adjustment only, no rescoring run); KNOWNS L-11
- **Impact:** G3-03 / AT-16 / AT-15 (S2). Honest participants who find real unplanned bugs cannot be credited through the product; the fairness flagship path requires direct SQL. Impact previews before rescoring runs are also absent (G3-04).
- **Fix:** Implement a guarded promotion flow (decision -> proposal -> lead approval -> GT revision -> rescoring job crediting every matching participant with reconciliation), plus impact previews before rescoring runs.

### F-CKLB-20 - No scheduler leader lock; auto-submit scan runs on every worker
- **Severity:** MEDIUM
- **Evidence:** backend/worker.py:38-45 (auto_submit.scan_and_submit() runs inline in the single worker loop with no lease/lock); docs L-10 ("scheduler DB role exists ... but no consumer uses it")
- **Impact:** WRK-06a (S2). If a second worker process is ever started (the docs' own D1 inventory contemplates worker processes), the scheduler duty duplicates (double auto-submits) or, if the loop dies silently, the event clock freezes with no lease/health arbitration.
- **Fix:** Take a DB advisory-lock/session lease around the auto-submit scan (or move it to a dedicated scheduler process using the scheduler role with a heartbeat row), so at most one scheduler acts per interval.

### F-CKLB-21 - Integrity module/console entirely absent
- **Severity:** MEDIUM
- **Evidence:** grep integrity console/watermark/case in backend/app + frontend/src: no matches (config.py:53 telemetry_enabled=False is the only integrity-adjacent switch)
- **Impact:** G3-06 (S2) and the flag half of G2-05/AT-17. There is no signals/flags store, no case workflow, no two-officer disqualification path, no watermark attribution tool; a scripted probing attack is defended only by caps/cooldown, never flagged.
- **Fix:** Implement the integrity schema (flags/cases), a probing-pattern detector fed by submission metadata, the human-rationale action flow and the watermark-slot attribution tool, or record an explicit pre-event waiver.

### F-CKLB-22 - practice and integrity schemas absent; role DDL not in migrations
- **Severity:** MEDIUM
- **Evidence:** migrations/0001_init.sql:5,26,573 (only audit, app, gt schemas); roles created only in scripts/dev_db.sh and .github/workflows/ci.yml:93-117; config.py:23-26 references only app/gt DSNs
- **Impact:** DB-01a (S1) partial. The five-schema trust architecture (app/gt/practice/audit/integrity with per-service grants) is three schemas; per-process least-privilege roles (evaluator vs admin_api separation) are collapsed into gt_admin; a fresh production deployment from migrations alone would not create any roles or grants.
- **Fix:** Add the practice and integrity schemas (or a documented reconciliation waiving them for the redesigned four-level flow), split evaluator/admin roles, and move role/grant DDL into a versioned migration so deployments are reproducible.

### F-CKLB-23 - No external monitoring, status page or alerting
- **Severity:** MEDIUM
- **Evidence:** no probe/uptime/status-page artifacts anywhere in repo; frontend has no status link (App.tsx:25-30 route list, Landing.tsx sections); SECURITY_REVIEW.md:26 (external review pending); OBS-04a has no alerting code
- **Impact:** OBS-01a (S1) / G4-05 / RDY-06 / G1-01 (status link) / PR-42. Monitoring, alerting and the status page would share the VM's failure domain (nothing exists outside it), and the audience-facing safe-harbour/pen-test readiness items stay open.
- **Fix:** Configure an external uptime probe + synthetic journey, an out-of-provider status page linked from the landing footer, two independent alert channels, and tiered alerts linked to runbook entries; close the external pen test.

### F-CKLB-24 - Clock offset estimated from a single sample
- **Severity:** LOW
- **Evidence:** frontend/src/lib/format.ts:72-74 (offset = one server_time minus Date.now()); Workspace.tsx:463
- **Impact:** FEA-06a (S1, minor residual). A single RTT-slow sample skews the displayed countdown; server authority is intact (display-only), so the risk is cosmetic countdown jitter.
- **Fix:** Sample /v1/time several times, keep the lowest-RTT sample's offset, and re-estimate on each state poll.

### F-CKLB-25 - Body-size limit only enforced when Content-Length is present
- **Severity:** LOW
- **Evidence:** backend/app/main.py:71-72 (`cl = request.headers.get("content-length"); if cl and int(cl) > limit`)
- **Impact:** API-02a (S1, partial). A chunked upload without a Content-Length header bypasses the pre-handler size check; downstream caps (Pydantic field limits) still bound the JSON bodies, but the "cheap attacks cheap to reject" ordering has a hole.
- **Fix:** Enforce a hard cap in middleware by wrapping the receive stream (or run behind a proxy that enforces client_max_body_size, once a proxy exists).

### F-CKLB-26 - No Turnstile at activation or password reset
- **Severity:** LOW
- **Evidence:** grep turnstile/captcha: no matches in backend/app or frontend/src
- **Impact:** EDG-15a (S3) / AUTH-08. Activation and password-reset endpoints accept unchallenged automation (rate limits only).
- **Fix:** Add Turnstile verification on activate + password reset request (and login after repeated failures) once the edge exists.

### F-CKLB-27 - Job kinds share one retry policy; no jitter, no per-kind metrics
- **Severity:** LOW
- **Evidence:** backend/app/jobs.py:21-24 (single RETRY_BACKOFF_S, uniform max_attempts=5 in enqueue)
- **Impact:** WRK-04a (S2, minor). A flaky email/notification job consumes the same retry budget as evaluation; no per-kind metric exists, so queue observability rests on the admin health view only.
- **Fix:** Allow per-kind max_attempts/backoff in enqueue() (registry with policy + metric name per kind), add jitter to the backoff.

### F-CKLB-28 - Leaderboard snapshot cutoff uses the app server clock
- **Severity:** LOW
- **Evidence:** backend/app/routers/leaderboard.py:42 (`datetime.now(UTC) - timedelta(...)` for the frozen-delay cutoff), vs submissions.py:157 (clock_timestamp() for acceptance)
- **Impact:** PR-22 / TIM-02 hygiene (not the deadline decision). Snapshot delay is computed from an API process clock; a drifted host clock shifts the visible leaderboard window slightly and inconsistently between processes.
- **Fix:** Compute the cutoff with `db_now()`/clock_timestamp() in the same query.

### F-CKLB-29 - Auto-accept is live without the 99% precision validation gate
- **Severity:** MEDIUM
- **Evidence:** backend/app/matching.py:188-192 (accept_full fires by default); no blind validation set or precision measurement anywhere in repo/tests; thresholds are frozen at publication via rule_set_hash (admin.py:160-176)
- **Impact:** EVS-02a (S1 launch condition). The deterministic auto-accept path scores participants at machine speed with no measured precision evidence on a blind set; a mis-tuned threshold silently mis-scores honest participants.
- **Fix:** Build a labelled blind validation set, measure auto-accept precision (>= 99% required), record the result in SCORING_MODEL.md/LOAD gate evidence, and keep the threshold inside the frozen rule_set_hash.

## Cross-cutting observations

- The repo is internally honest: LOAD_TEST_REPORT.md, BACKUP_AND_RECOVERY.md, SECURITY_REVIEW.md and KNOWNS_LIMITATIONS_AND_FOLLOWUPS.md correctly mark the big S1 gaps (load test, backups, pen test, MFA, email) as open; no false claims of completion were found (PR-32/PR-33 respected).
- Most G4/G5 gate items are process/drill items that cannot be evidenced in a pre-deployment repo; they are correctly N-A/MISSING here, not silently passed.
- The strongest implemented areas are the submission transaction, deadline authority, idempotency (except concurrency convergence), GT isolation (real-role tests), the append-only ledger with unique award claims, and the prohibition register's security items (PR-01..PR-11).

---

### 4.14 SDC Samvitya Proposal - promise vs delivery (`proposal`)

# Proposal-vs-Delivery Audit — "Fall Back" Full-Stack Software Debugging Challenge

- **Agent:** proposal (Task ID 4-f)
- **Baseline document:** `/home/z/my-project/audit/baseline/sdc_proposal.txt` (SDC Samvitya event proposal, 168 lines)
- **Repo audited:** `/home/z/my-project/bug-hunt-hackathon`
- **Git HEAD:** `f1412b7eec6c92c4c168fd2b8a58182b34480387` (2026-11-26)
- **Method:** every promise/scope item in the proposal was extracted and verified against code/docs actually read (file:line evidence below). READ-ONLY audit; nothing in the repo was modified.

## Status table

Legend: DELIVERED / PARTIAL / NOT-DELIVERED / N-A (no code could deliver it; noted as operational TODO where relevant).

| # | Promise/Section | Requirement (short) | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|---|
| S1 | Event identity | "Fall Back" full-stack debugging challenge by SDC, VIT Bhopal | DELIVERED | backend/seed.py:551,583-586; frontend/src/pages/Landing.tsx:360 | Tenant + event `fall-back-2026` seeded; branding across UI |
| S2 | Event details | Proposed date 6 December 2026, IST | PARTIAL | backend/seed.py:583-586 (no `starts_at` inserted); frontend/src/pages/Landing.tsx:60-62 ("Start time not announced"); docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md:12-15 | Date exists only as display text presets; real schedule config is a blocking organizer TODO |
| S3 | Event details | Duration 180 minutes | DELIVERED | backend/seed.py:586,91; frontend/src/pages/Landing.tsx:117 | Stored on the event row + public summary |
| S4 | Event details | Event mode: offline | DELIVERED | backend/seed.py:89 ("mode":"offline"); frontend/src/pages/Landing.tsx:357 | Also enforced socially via rules (venue LAN) |
| S5 | Event details / rules | Team size 4-5 participants | PARTIAL | backend/seed.py:90,434 (stated); backend/app/routers/auth.py:438-445 (membership insert, no count check); backend/app/routers/admin.py:439-467 (team create, no size rule) | Stated in public copy and rules but never enforced by code → F-PRP-04 |
| S6 | Participation structure | Number of parts: 4 | DELIVERED | backend/seed.py:79-87,731-762; backend/app/flow.py:19 (LEVEL_COUNT=4); frontend/src/pages/Landing.tsx:134-139 | Four level stages + published schedule phases |
| S7 | Event overview | Preconfigured full-stack app with planted functional bugs + security weaknesses | DELIVERED | challenge-app/server.js:2-3; backend/seed.py:112-243 (GT_BUGS, incl. critical XSS BUG-03); challenge-app/ORGANIZER_ANSWER_KEY.md:12-23 | 10 planted bugs (275 pts) + option-B mirror app |
| S8 | How it works | Same preconfigured app with documented setup instructions + seeded issues | DELIVERED | challenge-app/README.md:6-16; backend/seed.py:629 (instructions ingested from README) | npm install / npm start; data on first start |
| S9 | How it works | Application source code provided (frontend, backend, API routes, config) | DELIVERED | backend/seed.py:41-53 (PARTICIPANT_FILES); backend/app/routers/challenges.py:109-143 (file content API) | Files served per team through the platform; path-traversal guarded |
| S10 | How it works | Each team receives the SAME app | PARTIAL | backend/app/routers/challenges.py:51-65 (single shared assignment); backend/seed.py:709-729 (A/B repo options); docs/REQUIREMENTS_RECONCILIATION.md:74-84 | v1 UI serves one identical app to all teams; the approved four-level baseline adds an A/B repo choice (Option B is a dev fixture, equivalence certification pending) → F-PRP-11 |
| S11 | How it works | Fix categories: broken UI, API errors, validation, DB/config faults | DELIVERED | backend/seed.py:118-119 (input_validation), 172-176 (data_handling), 206-215 (configuration), 231-242 (integration_api_contract) | Ground truth covers all promised categories |
| S12 | How it works | Participants register in teams of 4-5 | PARTIAL | backend/app/routers/admin.py:439-467,476-511 (organizer-created teams + invites); docs/PARTICIPANT_HANDBOOK.md:44-49 | No self-service registration/join; deliberate design ("registered by the club") → F-PRP-07 |
| S13 | How it works (bullet 7-8) | Submission mechanism: source code, fix explanation, test evidence, CTF flags | PARTIAL | frontend/src grep for `/v1/(levels\|team\|repo\|uploads\|runs\|progress)` = no matches; frontend/src/pages/participant/Workspace.tsx:380-397,425-440 (bug_report + ctf_flag only); backend/app/routers/levels.py:789-866,872-1001 (artifact upload/submit exists, API-only); docs/PARTICIPANT_HANDBOOK.md:60-63 ("Nothing you build or fix is uploaded anywhere") | CRITICAL: no participant-facing UI for source-code/artifact submission → F-PRP-01 |
| S14 | How it works (bullet 7) | Repaired app tested against predefined + hidden functional test cases | PARTIAL | backend/app/routers/admin.py:854-880 (manual `tests_passed/tests_total` recording); docs/DATA_MODEL.md:104 (`gt_test_cases` "not yet read by any code path"); backend/app/config.py:51 + backend/app/routers/levels.py:1168-1178 (runner disabled, RUNNER_UNAVAILABLE) | Mechanism is organizer-manual, not automated → F-PRP-02 |
| S15 | Technical requirements | Flag-verification mechanism | DELIVERED | backend/app/evaluator.py:235-316 (HMAC hash verify, max_awards, per-team cap) | Flags stored hashed; verification in worker |
| S16 | Event overview | Main score from restoring functionality; CTF flags = bonus points | DELIVERED | backend/seed.py:74-78 (weights 50/30/20, ctf_bonus_cap 100); backend/app/evaluator.py:291-311 (capped ctf_bonus ledger entries); frontend/src/pages/Landing.tsx:168-205 | Main-score weights are provisional pending owner approval (docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md:16-19) |
| S17 | How it works / Part 3 | CTF quests: encoded clue in comment, insecure access-control check, admin-corner endpoint | DELIVERED | challenge-app/public/app.js:4-6 (base64 comment = FLAG-2); challenge-app/server.js:44-61 + db.js:46 (client-only admin gate = FLAG-1); challenge-app/README.md:33-36 (admin corner declared in scope) | Both seeded flags verified by the evaluator |
| S18 | Part 3 / How it works | CTF quest: recovering a planted token from Git history | NOT-DELIVERED | `git log --all` (182 commits, no planted token); backend/seed.py:245-260 (only 2 flags exist); docs/HISTORY_REWRITE_REPORT.md (history sanitized) | No git-history CTF artifact anywhere → F-PRP-03 |
| S19 | Part 1 | Deliverable: working local setup + prioritized list of reproducible bugs | DELIVERED | backend/seed.py:424 (Level 1 explain text); backend/app/routers/levels.py:126-127 (one flag per bug with file/lines/category/explanation); challenge-app/README.md:18-29 | "Prioritization" = claimed_severity field (informational) |
| S20 | Part 2 | Deliverable: documented root causes, code fixes, verified flags | DELIVERED | backend/seed.py:425; backend/app/routers/levels.py:128-131 (1-5 ordered locations); backend/app/evaluator_level.py:151-170 (decide_multi cross-file matching) | Cross-file defect explicitly modeled |
| S21 | Part 3 | Deliverable: updated application + repaired source code + CTF flags with evidence | PARTIAL | backend/app/routers/levels.py:955-1001 (.zip/.diff/.patch artifact or computed diff, server-side); no frontend calls (see S13); docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md:25-27 (side-quest content is owner input) | Backend path complete and tested (backend/tests/test_flow_uploads.py), UI absent; side-quest content unset → F-PRP-01, F-PRP-10 |
| S22 | Part 4 | Deliverable: tests written, docs updated, fix report, verified flags; demo to panel | PARTIAL | backend/seed.py:427 (Level 4: "write the missing tests and update the documentation"); backend/app/routers/review.py:162-175 (rubric incl. testing); docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md:28-30 (rubric approval pending); demonstration = no code surface (N-A, ops) | API-only submission path; rubric provisional → F-PRP-10 |
| S23 | Event schedule | Exact phase durations 15/10/30/35/60/25/5 = 180 min | DELIVERED | backend/seed.py:79-87 (verbatim proposal schedule); frontend/src/pages/participant/Lobby.tsx:163-178 (rendered) | Published copy matches the proposal exactly |
| S24 | Event schedule (enforcement) | Schedule actually drives level windows on event day | PARTIAL | backend/seed.py:415-429 (LEVEL_WINDOWS = synthetic dev windows; Levels 3-4 'draft', no windows); docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md:12-15 | Readiness checklist blocks live transition until real schedule entered → F-PRP-05 |
| S25 | Technical requirements | Evaluation system: automated functional testing + flag verification + technical assessment | PARTIAL | backend/app/matching.py + backend/app/evaluator.py:107-208 (automated deterministic matching); evaluator.py:235-316 (flags); backend/app/routers/review.py (human review) | Automated testing of repaired code is absent (runner off) → F-PRP-02 |
| S26 | Technical requirements | Isolated challenge environment | DELIVERED | challenge-app/server.js:3 ("Everything runs locally"); docs/GROUND_TRUTH_ISOLATION.md:22 (gt schema, gt_admin only); backend/seed.py:40 (answer key excluded from participant storage) | Platform isolation + local-only challenge app |
| S27 | Technical requirements | Backup arrangements prepared and tested before event | PARTIAL | docs/BACKUP_AND_RECOVERY.md (runbook exists); backend/seed.py:600 (readiness item `backup_restore` unchecked) | Rehearsal is a blocking readiness item, not yet done |
| S28 | Rules | Work only within provided app/challenge environments | DELIVERED | backend/seed.py:454-459 (RULES_MD §4); backend/app/flow.py:235-342 (server-side stage gating) | Enforced procedurally + server owns state |
| S29 | Rules | No sharing of flags/solutions between teams | PARTIAL | backend/seed.py:458 (rule text); backend/app/evaluator.py:266-289 (one award per team per flag) | Rule is textual; cross-team flag sharing cannot be technically prevented (inherent) |
| S30 | Rules | Teams must submit before the deadline | DELIVERED | backend/app/routers/submissions.py:171-180 (ROUND_ENDED); backend/app/routers/levels.py:938-941; backend/app/auto_submit.py:266-293 + backend/worker.py:39-45 (deadline auto-submit) | Server clock + grace + server-side auto-submit of drafts |
| S31 | Rules | Organizers may disqualify teams (cheating, flag sharing, attacks) | PARTIAL | backend/app/routers/submissions.py:120 and levels.py:889 (team status checked) but no endpoint/UI sets team status (no `UPDATE app.teams` anywhere in backend/app) | No operator surface for disqualification → F-PRP-06 |
| S32 | Rules | All vulnerabilities/test data created by organizers | DELIVERED | challenge-app/ORGANIZER_ANSWER_KEY.md:3-4 (restricted); backend/seed.py:40-41 (excluded from participant files); docs/GROUND_TRUTH_ISOLATION.md | Ground truth authored/seeded by organizers only |
| S33 | Organization | Coordinators: faculty (Dr. Praveen Lalwani) + students (Kalpesh Parashar, Aashish Prasad) | PARTIAL | backend/seed.py:559-560 (both student coordinators seeded as organizers) | Faculty coordinator has no representation (cosmetic; no role for it) |
| S34 | Participation structure | Evaluation = automated functional testing, flag verification, technical assessment | PARTIAL | automated: backend/app/evaluator.py:107-316; manual: backend/app/routers/admin.py:854-880 | Two of three evaluation legs automated; functional testing manual → F-PRP-02 |
| S35 | Part 3 (technologies) | Approved tech: JS/TS, React, Node/Express, Python | DELIVERED | challenge-app/package.json (Express/node:sqlite); challenge-app-option-b/main.py:1-43 (FastAPI); README.md:20 (React 19 + Vite + TS) | Both stacks shipped |
| S36 | Expected outcomes | Learning outcomes (debugging, security awareness, teamwork) | N-A | — | Educational outcome; no code deliverable |
| S37 | Technical requirements | Laptops, venue network, editors, projector/display, certificates, prizes | N-A | docs/EVENT_OPERATIONS_PLAYBOOK.md:42-62 (venue/power/projector runbook) | Operational TODOs for the event team, tracked in ops playbook |
| S38 | Part 4 | Selected teams demonstrate solutions to the evaluation panel | N-A | — | Offline event-day activity; no platform feature needed |

**Counts:** DELIVERED 20 · PARTIAL 13 · NOT-DELIVERED 1 · N-A 3 · total 37 rows (N-A rows noted as operational TODOs).

## Findings

### F-PRP-01 — CRITICAL — No participant-facing surface for the promised source-code submission (Parts 3-4)
- **Evidence:** frontend `src` has zero calls to any four-level endpoint (`/v1/levels*`, `/v1/team/*`, `/v1/repo/*`, `/v1/uploads`, `/v1/runs`, `/v1/progress` — grep over `frontend/src` returns no matches); `frontend/src/pages/participant/Workspace.tsx:380-397,425-440` submits only `bug_report` and `ctf_flag` kinds (`backend/app/routers/submissions.py:55`); `docs/PARTICIPANT_HANDBOOK.md:60-63` states "Nothing you build or fix is uploaded anywhere; only your reports go to the platform"; the backend path exists (`backend/app/routers/levels.py:789-1001`) but is API-only.
- **Impact:** The proposal's core deliverable — "Teams will submit their updated source code, a brief explanation of fixes, test evidence" (baseline sdc_proposal.txt:50) and Part 3's "updated application with repaired features, source code" (lines 82-83) — cannot be performed through the shipped web product. Without repaired-code submissions, the 50% functional-test main score (line 33: "The main score will come from restoring application functionality") has nothing to evaluate on event day.
- **Fix:** Select and merge one of the three four-level frontend concept PRs (owner decision tracked in docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md:46-49, docs/REQUIREMENTS_RECONCILIATION.md:113-126) and fund its adaptation to `/v1/levels/*`; or add a minimal artifact-upload + level-submit panel to the existing Workspace. Update the participant handbook accordingly.

### F-PRP-02 — HIGH — "Predefined and hidden functional tests" are manual-only; no automated testing of repaired apps
- **Evidence:** `backend/app/config.py:51` (`runner_enabled: False`), `backend/app/routers/levels.py:1168-1178` (`POST /v1/runs` always RUNNER_UNAVAILABLE); `backend/app/routers/admin.py:854-880` (organizer hand-records `tests_passed/tests_total` per submission); `docs/DATA_MODEL.md:104` (`gt_test_cases` "not yet read by any code path"); `backend/seed.py:538` deletes but never seeds gt_test_cases; `challenge-app/ORGANIZER_ANSWER_KEY.md:156-163` confirms offline-only execution.
- **Impact:** The proposal promises "The repaired application will be tested against predefined and hidden functional test cases" (sdc_proposal.txt:48) and "An evaluation system with predefined and hidden functional tests" (line 116). Delivered: matching engine + manual recording. Missing: any predefined/seeded test suite and any automated execution, so the main-score component is entirely dependent on error-prone manual organizer entry during a 25-minute Part 4 window.
- **Fix:** Seed `gt.gt_test_cases` from the answer-key's "Hidden tests" lines; ship a runner adapter (ADR-010) or, minimally, an organizer checklist tool that walks the recorded hidden tests per submission; clearly disclose the manual procedure in the ops playbook if automation stays out of scope.

### F-PRP-03 — MEDIUM — CTF side-quest variety under-delivered; no planted token in Git history
- **Evidence:** only two flags exist per option — `backend/seed.py:245-260` (FLAG-1 access control, FLAG-2 base64 comment) and :398-413 (option B); repo git history (182 commits) contains no planted flag token; `docs/HISTORY_REWRITE_REPORT.md` documents the sanitized history.
- **Impact:** The proposal lists four CTF quest types (sdc_proposal.txt:77-79: Git-history token, encoded clue, documented-as-hidden endpoint, insecure access control) and "hidden tokens through code analysis, configuration review, API auditing" (line 29-30). Two-and-a-half of four are delivered. Also, 2 flags x 30 pts = 60 pts max vs the 100-pt bonus cap (`backend/seed.py:107`), so the cap can never be reached.
- **Fix:** Plant a git-history token in the challenge-app repo (e.g., a reverted commit carrying FLAG{...}) and seed it as a third gt flag; or adjust the cap/flag points to be internally consistent; document the final side-quest set (also KNOWN_GAPS item 4).

### F-PRP-04 — MEDIUM — Team size 4-5 is published but never enforced
- **Evidence:** `backend/seed.py:90,434` and `frontend/src/pages/Landing.tsx:119,306` state 4-5; `backend/app/routers/auth.py:438-445` inserts team membership with no size check; `backend/app/routers/admin.py:439-467` creates teams with no size rule; no `team_size` validation anywhere (grep over backend: only display strings).
- **Impact:** The proposal makes 4-5 members a participation rule (sdc_proposal.txt:20,38,125,144). An organizer can attach 2 or 8 members to a team without any warning; eligibility disputes have no platform support.
- **Fix:** Add a min/max member-count check on invite creation/activation (`app.invites` + `app.team_members` count) and surface team size in the admin dashboard; at minimum warn organizers when a team leaves the 4-5 window.

### F-PRP-05 — MEDIUM — Production schedule and level windows are not configured
- **Evidence:** `backend/seed.py:583-586` inserts the event without `starts_at`; `backend/seed.py:415-429` seeds synthetic level windows with Levels 3-4 in `draft` status (no windows); `docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md:12-15` (blocks READY); readiness gate `backend/seed.py:597-612` + `backend/app/routers/admin.py:1002-1041`.
- **Impact:** The proposal fixes 6 Dec 2026 and a 180-minute, 4-part schedule (sdc_proposal.txt:12,97-106). Delivered as display config only; as seeded, the event cannot go live (readiness blocks) and Levels 3-4 never open.
- **Fix:** Enter the real event schedule via `POST /admin/events/{id}/stages`/config (or the bootstrap endpoint `admin_levels.py:248`) for all four levels before READY; run the dry-run readiness item.

### F-PRP-06 — MEDIUM — No operator surface to disqualify or suspend a team
- **Evidence:** team status blocks submissions (`backend/app/routers/submissions.py:120`, `levels.py:889`) but `UPDATE app.teams` never appears in `backend/app` (grep, no matches); admin router has no team-status endpoint (`backend/app/routers/admin.py:432-516` covers create/list only).
- **Impact:** The proposal reserves disqualification rights for cheating/flag sharing/attacks (sdc_proposal.txt:134-135). On event day the only path is a direct database edit — untracked, unaudited, and slow under a 5-minute final-evaluation window.
- **Fix:** Add `POST /admin/teams/{id}/status` (with step-up + audit write) and a UI toggle in the admin dashboard; document the disqualification runbook step.

### F-PRP-07 — LOW — No participant self-registration or team join flow
- **Evidence:** `backend/app/routers/admin.py:439-511` (organizer creates teams/invites); `docs/PARTICIPANT_HANDBOOK.md:44-49` ("there is no self-service join flow in this event").
- **Impact:** The proposal's "Participants will register in teams of 4-5 members" (sdc_proposal.txt:38) reads like participant-driven registration; delivery is fully organizer-driven. This is a deliberate, documented choice, but it concentrates registration work on the 15-minute setup window.
- **Fix:** Keep as designed (documented) or add a lightweight invite-link team-join page; pre-create accounts before event day per the ops playbook.

### F-PRP-08 — LOW — Scoring weights/tie-break/penalty policy remain provisional
- **Evidence:** `backend/seed.py:74-78` (dev weights 50/30/20 "provisional"); `docs/REQUIREMENTS_RECONCILIATION.md:45-58` (R3: no invented production weights; CONFIGURATION_REQUIRED before finalization); `docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md:16-19` (blocks score finalization).
- **Impact:** The proposal promises scoring rules prepared and tested before the event (sdc_proposal.txt:119). Delivered: full ledger + tie-break machinery (`backend/app/scoring.py:135-154`); pending: owner-approved values. Risk of last-minute scoring disputes.
- **Fix:** Approve per-level weights, tie-break and penalty policy before READY (readiness-gated); freeze them via the admin config endpoint.

### F-PRP-09 — LOW — Documentation drift and pre-publication hazards
- **Evidence:** README.md:62-63 says "34-test suite / 37/37" but the tree now has 74 test functions (count across backend/tests: 74); `docs/ONBOARDING_GUIDE.md:49` says 34; `docs/PARTICIPANT_HANDBOOK.md:8-11` warns the worked example in section 4.4 leaks one real planted defect and must be replaced before distribution; open `[TO BE FILLED]` fields at `docs/PARTICIPANT_HANDBOOK.md:4-6`.
- **Impact:** Minor credibility drift; the handbook example is an answer leak if distributed as-is — a real (content, not code) risk to challenge integrity.
- **Fix:** Update test counts; replace the handbook's worked example with a fictional one; fill venue/contact/time fields before publishing.

### F-PRP-10 — LOW — Level 3 side-quest content and Level 4 rubric are wired but empty
- **Evidence:** `backend/seed.py:426-427` (L3 "complete the side quest"; L4 "write the missing tests"); `docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md:25-30` (side-quest content = organizer input; L4 rubric approval pending).
- **Impact:** Parts 3-4 of the proposal promise specific CTF quests and test-writing work; the level shells exist end-to-end (backend/tests/test_flow_*.py) but the actual content and rubric values are organizer deliverables that do not exist yet.
- **Fix:** Owner to supply Level 3 side-quest content and the Level 4 rubric weights; wire via stage config before READY.

### F-PRP-11 — LOW — Option B challenge is a development fixture; production A/B packages pending certification
- **Evidence:** `backend/seed.py:55-57,262-264` ("DEVELOPMENT FIXTURE ONLY... NOT the production challenge"); `docs/REQUIREMENTS_RECONCILIATION.md:74-84` (R5: final A/B repositories are organizer deliverables; two reviewers must certify equivalence); `docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md:20-24`.
- **Impact:** The proposal promises every team the same preconfigured application (sdc_proposal.txt:39); the approved baseline offers an A/B choice whose production content is not final. If run as-is, Option B would be a labeled dev fixture.
- **Fix:** Supply or approve final Option A/B packages, run the two-reviewer equivalence certification (readiness item `challenge_audit`, `backend/seed.py:602`) before READY.

## Operational TODOs (N-A items the code cannot deliver)
- Laptops/computers, venue LAN + power, code editors, projector/display, certificates and prizes (sdc_proposal.txt:111-118) — tracked qualitatively in `docs/EVENT_OPERATIONS_PLAYBOOK.md` (T-minus checklist, incident codes incl. TIM-10 venue power).
- Team demonstrations to the evaluation panel (sdc_proposal.txt:91) — event-day activity.
- Load-test rehearsal at the expected headcount for the four-level endpoints (`docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md:34-38`, readiness item `load_test_50`).

## Verdict
The platform over-delivers on infrastructure (auth, idempotent submissions, ground-truth isolation, scoring ledger, gates, auto-submit, CI, docs) and reproduces the proposal's facts faithfully in its public copy. The two gaps that matter for the promised event are (1) the missing participant UI for the four-level repair/submission flow (the approved baseline's only surface is the API) and (2) the absence of automated hidden functional testing of repaired code. Both are known, documented owner decisions — but as shipped, the repo cannot run the promised Parts 3-4 end-to-end through the web product.

---

### 4.15 Blind Spots and Cautions - risk-mitigation register (`blindspots`)

# Risk-mitigation audit — blind spots register

- **Agent:** blindspots (Task ID 4-g)
- **Baseline document:** `/home/z/my-project/upload/01-blind-spots-and-cautions.md` (94 risk items INT-01…AI-04, plus 14 decision rows DEC-01…DEC-14)
- **Repo audited:** `/home/z/my-project/bug-hunt-hackathon` @ git HEAD `f1412b7eec6c92c4c168fd2b8a58182b34480387` (2026-11-26)
- **Method:** read-only code audit. For every register item the question asked was: *did the code fall into this trap?* Evidence is file:line actually read. Status: MITIGATED / PARTIAL / UNMITIGATED / N-A (no code component in this repo, e.g. pure infra/ops or features deliberately not built).
- **Counts:** 47 MITIGATED, 24 PARTIAL, 0 UNMITIGATED, 37 N-A (108 rows = 94 risk items + 14 DEC rows). Findings: 3 HIGH, 9 MEDIUM, 6 LOW.

## Risk table

| Risk ref | Risk (short) | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| INT-01 | Verdict oracle via probing feedback | PARTIAL | backend/app/routers/submissions.py:371-381; backend/app/routers/admin.py:227-238; backend/app/evaluator.py:530-565; **leak: backend/app/routers/levels.py:650-657** | Defaults safe (hidden feedback, caps, cooldown, penalties at release only), but `GET /v1/team/score` returns the team's ledger total and per-level components before release → **F-BSP-01**. Also `leaderboard_mode=live` coupling with delay is not enforced (admin.py:241-243). |
| INT-02 | Planted-bug list incomplete → real bugs penalized | PARTIAL | backend/app/matching.py:171-180 (plausible → needs_review, never auto-penalized); backend/app/evaluator.py:394-404 (promotion = manual organizer action, no endpoint) | No auto-penalize implemented (good); promotion + deterministic rescore missing → **F-BSP-07** (docs L-11 acknowledge). |
| INT-03 | Variant fairness / collusion | PARTIAL | backend/app/routers/levels.py:467-570 (per-team A/B repo choice); backend/app/routers/admin_levels.py:141-184; backend/seed.py:55-58 | Variant sets exist but equivalence is asserted only by the dev fixture; no validation gate, no watermarking → **F-BSP-12**, **F-BSP-06**. |
| INT-04 | Multi-language unfairness | PARTIAL | backend/seed.py:55-58 (Option A = Node, Option B = Python, "same bug count…" asserted); admin_levels.py:141-184 | Options are language-different apps, self-selected by teams; no equivalence validation or published balancing mechanism → **F-BSP-12**. |
| INT-05 | Shotgun submissions / wide ranges | PARTIAL | backend/app/routers/submissions.py:83-85, 206-239 (span/caps/cooldown); backend/app/matching.py:100-109 (location score = distance only, span width not weighted) | A 25-line window covering the bug scores 1.0 like an exact hit; aliases include generic words (seed.py:249-262) → **F-BSP-05**. |
| INT-06 | Collusion in the room | PARTIAL | backend/app/routers/levels.py:730-741 (`ORDER BY path`, no shuffling); backend/app/config.py:53 (telemetry off) | No file-order shuffling, no watermark, no similarity/timing analysis → **F-BSP-06**. |
| INT-07 | Leaked challenge material | PARTIAL | No watermark code (grep: none); rules prohibit screenshots (backend/seed.py:456-459) | Deterrence (rules + acceptance record) only; attribution impossible → **F-BSP-06**. |
| INT-08 | AI usage cannot be technically prevented | MITIGATED | backend/app/config.py:52-53 (ai_assessment_enabled/telemetry_enabled = False); backend/seed.py:456-459 (rules state prohibition) | Platform makes no false claim of blocking AI; no automatic penalties from telemetry anywhere in code. |
| INT-09 | False accusations from telemetry | MITIGATED | backend/app/config.py:53; no integrity-action path keys off telemetry (backend/app/deps.py, evaluator) | Telemetry fully disabled; no auto-penalty logic exists. |
| INT-10 | Copy prevention oversold | MITIGATED | frontend/src/styles/app.css:1003-1005 (`user-select:none` only on `.line-no`); no DevTools detection | Treated as friction only; not described as security. |
| INT-11 | Penalties punish honest ambiguity | MITIGATED | backend/app/evaluator.py:530-546 (penalty only for `rejected_auto`, capped, at release); backend/app/matching.py:180-199 (borderline → review) | Structural rejects only; cap 20% of stage max. |
| INT-12 | Tie-breaks decided after the fact | MITIGATED | backend/app/scoring.py:135-149 (sort: score, fewer invalid, earlier last-accepted); backend/seed.py:449-451 (published in rules text) | Enforced by engine and published. |
| TIM-01 | Frontend timer trusted | MITIGATED | backend/app/routers/submissions.py:141-157 (row lock + single `clock_timestamp()` read); backend/app/routers/state.py:21-25; backend/app/db.py:73-75 | Server is sole clock authority for acceptance. |
| TIM-02 | Server clock drift/jump | MITIGATED | submissions.py:157; backend/app/routers/admin.py:317; backend/app/auto_submit.py:41 (DB clock for decisions) | All round decisions use the DB clock; auth/session paths use app `datetime.now(UTC)` (not fairness decisions); leaderboard cutoff uses app clock (leaderboard.py:42) — minor. chrony itself is ops. |
| TIM-03 | Network latency decides "late" | MITIGATED | submissions.py:159-179 (uniform `grace_seconds`, default 3 — admin.py:223); levels.py:938-941 | Grace applied uniformly server-side; rules text (seed.py:430-475) doesn't mention the grace window — publication gap noted. |
| TIM-04 | Start-of-round stampede / pre-delivery | PARTIAL | backend/app/routers/challenges.py:32-48 (`armed` allowed, no `starts_at` check); backend/app/routers/levels.py:703-714, 744-783 (repo files readable without stage gate); backend/app/flow.py:262-268 (armed + NULL starts_at → allowed) | No encrypted pre-delivery; challenge content is readable before the window opens once the stage is armed / repo locked → **F-BSP-02**. |
| TIM-05 | Pause/extend abused or mishandled | MITIGATED | backend/app/routers/admin.py:291-394 (reason code required, transitions audited, extend 1-3600s); admin.py:915-942 (per-user adjustments with reason codes) | Notice broadcast via announcements + `/state` version. |
| TIM-06 | Timezone confusion | MITIGATED | frontend/src/lib/format.ts:1-20 (all rendering Asia/Kolkata); admin.py:45 (default `Asia/Kolkata`); timestamptz columns (migrations/0001_init.sql) | Stored UTC, displayed IST. |
| AUTH-01 | JWT cannot be revoked | MITIGATED | backend/app/deps.py:65-88 (session `revoked_at`, status, `token_version` checked per request); auth.py:554-561 (reset revokes sessions+families) | Short TTL 600s (config.py:34); DB-backed instead of Redis denylist (equivalent or stronger). |
| AUTH-02 | Token storage / XSS | PARTIAL | frontend/src/lib/api.ts:44-52 (memory-only access token); auth.py:32-42 (HttpOnly/Strict/path-scoped cookie); main.py:86-89 (nosniff etc.) — **no CSP anywhere** | Storage design correct; strict CSP/Trusted Types absent → **F-BSP-04**. |
| AUTH-03 | Algorithm confusion / key mistakes | MITIGATED | backend/app/security.py:97-112 (`algorithms=[settings.jwt_algorithm]` pinned, iss/aud/exp/nbf/sid required, both audiences tried safely) | HS256 pinned (EdDSA is documented P1); no alg confusion possible. |
| AUTH-04 | Refresh race across tabs | MITIGATED | backend/app/routers/auth.py:275-311 (10s same-successor grace, family revocation outside); frontend/src/lib/api.ts:60-89 (single-flight per tab) | Server tolerance covers cross-tab races; Web Locks not needed. |
| AUTH-05 | Token expires during long operation | MITIGATED | frontend/src/lib/api.ts:140-147 (401 → one silent refresh → retry); submissions idempotency (submissions.py:123-139); server drafts (submissions.py:487-520) | No proactive 80% refresh timer; retry path + idempotency covers the trap. |
| AUTH-06 | SSE cannot send Authorization | MITIGATED | No SSE endpoints (backend/app/routers/state.py:1-5 — polling every ~5s); no token ever placed in a URL | Trap avoided by design (polling). |
| AUTH-07 | Argon2id DoS | MITIGATED | backend/app/security.py:27 (m=19456,t=2,p=1); auth.py:57-58 (20/min per IP, 10/min per email) | Sync endpoints run in FastAPI's bounded threadpool. |
| AUTH-08 | Open registration admits outsiders/duplicates | PARTIAL | auth.py:202-247 (admin-only register), auth.py:390-463 (single-use invites) — **but auth.py:70-86: first login with a registered-but-passwordless email sets the typed password** | Invite-based activation is bypassed for unactivated accounts → **F-BSP-03**. Turnstile absent (documented). |
| AUTH-09 | Admin account takeover | PARTIAL | backend/app/deps.py:141-162 (5-min password step-up); auth.py:470-493; admin.py:24-30 (GT via gt_session) | No TOTP/WebAuthn/Cloudflare Access; same process & app_api role for admin surface (not a separate deployment/role) → **F-BSP-11**. |
| AUTH-10 | Shared accounts | MITIGATED | auth.py:93-138 (cap of 2 with reclaim+eviction, audited); auth.py:614-652 (session list + revoke); ip_hash/user_agent stored (auth.py:140-152) | Similarity flags not built (telemetry off). |
| DAT-01 | Double-awarding points | MITIGATED | migrations/0001_init.sql:436 `UNIQUE(stage_id, team_id, award_unit_id)`; scoring.py:83-101 (`ON CONFLICT DO NOTHING`) | DB arbitrates; losing workers get False (evaluator.py:174-216). |
| DAT-02 | Duplicate submissions from retries | MITIGATED | submissions.py:96 (mandatory header), 123-139 (replay vs IDEMPOTENCY_CONFLICT); migrations/0001_init.sql:391 `UNIQUE(author_id, idempotency_key)` | Spec-exact. |
| DAT-03 | Ground truth reachable by participant API | MITIGATED | backend/app/db.py:40-44 (two engines); scripts/dev_db.sh:110-129 (gt schema granted to gt_admin only); backend/tests/test_gt_isolation.py | gt only touched via gt_session in evaluator/admin GT endpoints. |
| DAT-04 | Answer key edited after start | MITIGATED | admin.py:587-590, 659-660 (upload/freeze blocked unless draft/reviewed → GROUND_TRUTH_LOCKED), 704-705 (publish requires sealed) | Note: event config can be re-frozen mid-event without a status guard (admin.py:153-199) — audited but unguarded. |
| DAT-05 | Rescoring not reproducible | MITIGATED | matching.py:121-199 (pure deterministic, features recorded); scoring.py:14-15, 30-65 (append-only ledger); audit.py:20-95 (hash chain + verify) | `engine_version` not recorded anywhere (rule_set_hash is); AI reuse N/A (AI off). |
| DAT-06 | Line numbers drift | PARTIAL | models_gt.py:71 (`anchor_hash` column); backend/seed.py:959-990 (anchors computed at seed time, dev only); admin.py:748-811 (production `add_bug` never sets/validates anchors), 688-729 (publish validates nothing about GT) | Admin authoring path has no anchor or file/line validation → **F-BSP-08**. |
| DAT-07 | Multiple symptoms of one root cause | PARTIAL | scoring.py:83-101 (claims keyed by `award_unit_id` = bug **code**, not `root_cause_group`); evaluator.py:138-145; models_gt.py:53 (group modeled but unused for claims) | "One award per group" not enforced → **F-BSP-13**. |
| DAT-08 | Cross-component bugs (R2) | MITIGATED | matching.py:145-158 (any listed location scores; cross-file via aliases), 202-270 (decide_multi); borderline → review (matching.py:199) | Multiple acceptable locations per bug supported. |
| DAT-09 | Connection exhaustion | N-A | backend/app/config.py:27-28 (pool 8 + overflow 4 per engine) | Bounded pools in code; PgBouncer/replica budgets are deployment concerns not present in this repo. |
| DAT-10 | Backups never restored | N-A | docs/BACKUP_AND_RECOVERY.md (procedure only) | No code component; restore drill is a process gate (L-16). |
| DAT-11 | Redis as source of truth | MITIGATED | No Redis anywhere; jobs.py:1-38 (durable PG queue); scoring ledger in PG | Trap avoided by construction. |
| EVA-01 | Review backlog | PARTIAL | backend/app/routers/review.py:25, 65-100 (priorities, claim + timeout); admin.py:979 (backlog counter in live ops) | No SLA timers, no auto double review for high-severity → **F-BSP-17**. |
| EVA-02 | Reviewer inconsistency | PARTIAL | review.py:162-175, 210-225 (rubric + reason recorded per decision) | Calibration session / blind double review are process, not code; rubric structure exists. |
| EVA-03 | AI assessment attackable | N-A | config.py:52 (`ai_assessment_enabled=False`); no AI call paths in code | Not built (DEC-13 gate); kill switch exists. |
| EVA-04 | Evidence cannot be verified automatically | MITIGATED | levels.py:1168-1178 (runs disabled); admin.py:854-880 (organizer-recorded test results only); storage.py:1-8 (artifacts inert) | Participant-supplied steps never executed. |
| EVA-05 | Report text attacks reviewer (stored XSS) | MITIGATED | frontend/src/pages/review/ItemDetail.tsx:181 (pre-wrap text); components/SubmissionPayload.tsx:21; components.tsx:361-420 (PlainMarkdown never builds HTML); no `dangerouslySetInnerHTML` (grep) | Rendered as plain text only. CSP would be defense in depth (see F-BSP-04). |
| FE-01 | State lost on refresh/crash | PARTIAL | frontend/src/pages/participant/Workspace.tsx:148-230 (3s server autosave, restore, version-conflict reload); no IndexedDB queue, no React error boundary (grep) | Server drafts cover the tab-crash case; offline queue/error boundaries missing → **F-BSP-14**. |
| FE-02 | Stale client after deployment | PARTIAL | backend/app/main.py:64-92 (headers set, no `X-Min-Client-Version` anywhere — grep) | No min-client-version / reload prompt → **F-BSP-15**. Change freeze is process. |
| FE-03 | Monaco weight and CSP | N-A | Monaco is not used at all (grep: no monaco imports; Workspace.tsx uses textareas) | Risk does not apply to this codebase. |
| FE-04 | Large repository rendering | PARTIAL | admin.py:609-621 (server-side line index, capped 5000 lines/file); challenges.py:146-172 (server search, LIMIT 50); admin.py:566-633 (**no file-count cap on challenge upload**); levels.py:717-741 (full tree returned, no virtualization) | Bounded for the shipped fixtures; a huge repo would degrade → **F-BSP-16**. |
| FE-05 | Browser variance | N-A | frontend/tests/submission_payload.test.mjs (only test file) | Cross-browser matrix/pass is process; no code component. |
| FE-06 | Memory growth in long sessions | N-A | Textarea-based viewer; no Monaco models or query caches to grow | Not applicable. |
| NET-01 | Shared public IP blocks everyone | MITIGATED | deps.py:27-39 (limits keyed by identity); submissions.py:101, challenges.py:70,112,152; auth.py:57-58 (login additionally per-email) | Identity-keyed wherever authenticated; login per-IP limit generous (20/min). |
| NET-02 | WAF blocks legit bug reports | N-A | main.py:64-84 (app-level body-size limits; JSON transport; text storage) | WAF skip is edge/deployment config, absent from this repo. |
| NET-03 | Cloudflare transformations alter content | N-A | main.py:89 (`Cache-Control: private, no-store`) | CF settings are deployment; header hygiene done in code. |
| NET-04 | SSE buffered/cut by edge | N-A | No SSE (state.py:1-5 polling) | Not applicable. |
| NET-05 | Cookie and CORS misconfiguration | MITIGATED | main.py:54-62 (exact origins, allow-headers list); deps.py:170-177 (Origin + X-BHCTF-Client required on refresh); auth.py:32-42 (HttpOnly, Strict, path-scoped cookie) | No wildcards; CORS from env allow-list (config.py:57,68-69). |
| NET-06 | Venue connectivity failure | PARTIAL | frontend/src/lib/api.ts:131-138 (network failure → user-facing error only); no offline draft queue / auto-resubmission | Client-resilience half unimplemented (rest is uplinks/process) → **F-BSP-14**. |
| NET-07 | Cloudflare single provider | N-A | No CF config in repo | Deployment/runbook concern. |
| NET-08 | Free-plan limits | N-A | No plan config in repo | Deployment concern. |
| INF-01 | Laptop nodes in cluster | N-A | No k8s/cluster manifests in repo | Infra docs only. |
| INF-02 | Single control plane | N-A | No cluster manifests | Infra docs only. |
| INF-03 | DB on local-path storage | N-A | No storage manifests | Infra docs only. |
| INF-04 | Disk full | N-A | No volume/retention config in repo | Infra docs only. |
| INF-05 | OOM kills | N-A | No resource limits in repo | Infra docs only. |
| INF-06 | VPS provider terms/quotas | N-A | — | Organizational. |
| INF-07 | Certificate/DNS expiry | N-A | — | Organizational. |
| INF-08 | Secrets leakage | MITIGATED | config.py:31-38 (dev defaults clearly marked dev-only); `.env.example` only, no committed secrets; SECURITY_REVIEW.md F-10 | Rotation of dev defaults before D1 is a documented gate (KNOWNS L-19). |
| OPS-01 | Monitoring shares failure domain | N-A | — | External monitoring is deployment. |
| OPS-02 | No rehearsal | N-A | scripts/load_test.py exists but unrun (KNOWNS L-14) | Process gate. |
| OPS-03 | Changes during the event | N-A | — | Process (change freeze). |
| OPS-04 | Unclear incident ownership | N-A | — | Process. |
| OPS-05 | Participant communication gaps | MITIGATED | backend/app/routers/announcements.py:14-41; admin.py:891-912 (create, severity-graded); state.py:91 (announcements_version for clients) | In-app announcement path implemented. |
| OPS-06 | Alert fatigue | N-A | — | Monitoring process. |
| SEC-01 | Audience attacks the platform | MITIGATED | Ownership scoping on every object (submissions.py:341-404, drafts, artifacts levels.py:977-984); tests/test_authorization.py; generic error envelope (errors.py:16-54); safe-harbor rules text (seed.py:456-462) | External pen test still pending (SECURITY_REVIEW F-07) — process gap. |
| SEC-02 | IDOR | MITIGATED | submissions.py:386-404 (`author_id` scope, 404 not 403); leaderboard.py:65-125 (own team only); db.py:81-88 (UUIDv7 opaque ids) | Automated authz tests exist (test_authorization.py). |
| SEC-03 | Upload handling | MITIGATED | admin.py:566-633 (step-up, 512KiB cap, traversal/NUL rejection, inert text); storage.py:57-91 (zip bomb/symlink/device/duplicate-path rejection, no extraction); levels.py:789-866 (owner-scoped artifacts) | Never executed on shared infra. |
| SEC-04 | Supply chain | PARTIAL | backend/requirements.txt:1-12 (mix of `==` and `>=`, no hashes, no backend lockfile); frontend/package-lock.json present | No hash pinning or scanning evidence → **F-BSP-18**. |
| SEC-05 | SSRF / internal reachability | MITIGATED | No outbound fetch feature exists anywhere (no webhooks, link previews, URL fetches) | Trap structurally avoided. |
| SEC-06 | Logs contain sensitive data | PARTIAL | auth.py:519-521 (`print(f"[dev-mail] password reset token …")` — plaintext reset token to stdout/logs) | Documented as v1 no-email workaround, but it is the exact trap → **F-BSP-09**. |
| SEC-07 | Rate limits per replica | PARTIAL | deps.py:27-39 (in-process dict `_bucket`); scripts/run_dev.sh:36 (single uvicorn process) | Single-process D0 OK; scales wrong with replicas; keys never evicted (login per-IP) → **F-BSP-10** (docs L-05/F-06). |
| HUM-01 | Rules ambiguity | MITIGATED | seed.py:430-475 (published rules text: scoring, penalties, ties, AI, appeals); deps.py:121-138 + auth.py:659-692 (acceptance recorded with version + ip + audit) | Rules acceptance gate enforced server-side. |
| HUM-02 | Personal data obligations | MITIGATED | docs/PRIVACY_NOTICE.md + frontend Privacy page; minimal fields (users table); telemetry off; AI off → nothing shared with third parties | Legal sign-off pending (L-17) — process. |
| HUM-03 | Accessibility | PARTIAL | Workspace.tsx:83, 568-616 (adjustable font size, aria-live); aria attributes across UI (icons, components, Workspace) | Time accommodation supported (admin.py:923 `ACCOMMODATION` reason code); no WCAG validation pass. |
| HUM-04 | Onboarding confusion | PARTIAL | Multi-event capability exists (admin.py:48-93); no dedicated practice environment / workspace tour code | Organizers can run a practice event; nothing built-in. |
| HUM-05 | Disputes with no evidence trail | MITIGATED | security.py:118-124 (HMAC receipt code); submissions.py:328-338, 341-383 (receipt + own history); audit.py:20-95 (hash-chained audit + verify); admin.py:1078-1172 (exports with content hash) | Receipt is organizer-verifiable. |
| RUN-01 | Runner escape/abuse | MITIGATED | config.py:51 (`runner_enabled=False`); levels.py:1168-1178 (RUNNER_UNAVAILABLE); storage.py:1-8 (artifacts inert, never executed) | No code execution of participant input anywhere. |
| RUN-02 | Run button as verdict oracle | MITIGATED | No run executes against hidden inputs (levels.py:1168-1178); hidden tests exist only in `gt.gt_test_cases`, consumed by organizer-recorded results (admin.py:854-880) | Practice-run probing impossible. |
| RUN-03 | Runner overload | MITIGATED | Disabled + per-user rate limit stub (levels.py:1172) | Not reachable. |
| RUN-04 | Flaky official runs | N-A | No runner | Deterministic-only configuration per DEC-14. |
| RUN-05 | Untrusted output attacks reviewers | N-A | No runner output; artifacts/diffs rendered as plain text (levels.py:1098-1162 computes diffs server-side; UI renders text) | Not applicable while the runner is off. |
| RUN-06 | Free-tier VM split | N-A | Runner off | Fallback per DEC-14 implemented. |
| AI-01 | Non-reproducible AI scores | N-A | config.py:52 (AI off); no AI code | Not built (DEC-13 gate pending). |
| AI-02 | AI score leaks verdicts / privacy | N-A | AI off; feedback gating already in place for when enabled (submissions.py:371-381) | Not built. |
| AI-03 | AI provider outage/cost | MITIGATED | Kill switch exists (config.py:52) and is surfaced in live ops (admin.py:991-995); submissions never enqueue AI work | Submissions cannot wait on AI. |
| AI-04 | AI bias | N-A | AI off; substance-based rubric fields defined (matching.py:1-16, review.py:162-167) | Not built. |
| DEC-01 | Participation mode | N-A | Teams implemented end-to-end (teams, team members, leads — flow.py, levels.py) | Deviates from spec default (individual); documented. |
| DEC-02 | Feedback mode | MITIGATED | admin.py:228 (default `feedback_mode=hidden`) | Matches default. |
| DEC-03 | Leaderboard visibility | MITIGATED | admin.py:229 (default `hidden`); modes live/frozen/hidden implemented (leaderboard.py:35-56; evaluator.py:594-596) | Default is stricter than spec's `frozen`. |
| DEC-04 | R2 evaluation mode | MITIGATED | Deterministic matching + human review decide (evaluator.py, review.py); AI partial score off (config.py:52) | Matches default. |
| DEC-05 | Language handling R1 | N-A | Per-team A/B choice instead of "all files for all" (levels.py:467-570) | Deviation documented; see F-BSP-12. |
| DEC-06 | R2 environment | MITIGATED | Read-only viewer + server-computed diff/artifacts (levels.py:1098-1162); Run disabled (levels.py:1168-1178) | Matches default. |
| DEC-07 | Time window | MITIGATED | Global fixed stage windows (admin.py:323-333; submissions.py:159-179) | Matches default. |
| DEC-08 | Venue | N-A | Rules text: offline at venue (seed.py:433-434) | Policy input. |
| DEC-09 | Variants | N-A | Variant sets (A/B) without watermarking (levels.py, admin_levels.py) | Deviates from default (identical+watermark); see F-BSP-06/12. |
| DEC-10 | Penalty policy | MITIGATED | Capped penalty applied at release only (evaluator.py:530-546; admin.py:237) | Matches default. |
| DEC-11 | AI/output score split | N-A | AI off; no `ai_share` config anywhere | To be locked before enabling AI. |
| DEC-12 | What output score measures | N-A | Organizer-recorded hidden-test results instead (ADR-019; admin.py:854-880) | Deviation documented in code comments. |
| DEC-13 | AI provider and data shared | N-A | AI off pending provider gate (config.py:52; docs AI_TOOLING_RESEARCH_AND_DECISION.md) | Not built. |
| DEC-14 | Runner hosting | N-A | Runner off → deterministic-only scoring (levels.py:1168-1178) | Matches the documented fallback. |

## Findings

---

### F-BSP-01 — HIGH — Live team score leak breaks hidden feedback (verdict oracle)
- **Risk refs:** INT-01 (also DAT-05 spirit)
- **Evidence:** `backend/app/routers/levels.py:650-657` — `GET /v1/team/score` returns `"total": float(total)` and `"levels": list(by_level.values())` (per-level, per-component points) **unconditionally**; only `released_total` is gated on event status. Ledger evidence points are written immediately on auto-accept: `backend/app/evaluator_level.py:196-209` and `backend/app/evaluator.py:147-168`.
- **Impact:** During a live event a participant submits level flags, then calls `/v1/team/score` and reads the verdict from the score delta (an `evidence_report` component > 0 ⇒ at least one flag matched a planted bug; the magnitude indicates how many/which). This punches a hole through the entire hidden-feedback design (`feedback_mode=hidden`, masked statuses in `submissions.py:371-381`, penalties at release), letting a team probe the answer key across its members' one-shot level submissions — exactly the S1 failure INT-01 exists to prevent.
- **Fix:** In `team_score`, gate `levels` and `total` exactly like `released_total` (return `null` unless released — use `feedback_released` per stage, as `/v1/results/{stage_id}` does in `leaderboard.py:65-76`); optionally return only level *status*, not points, until release. Add a regression test asserting no score/points field is non-null pre-release on every participant endpoint.

### F-BSP-02 — HIGH — Challenge content readable before the round window opens
- **Risk refs:** TIM-04 (also INT-07)
- **Evidence:** `backend/app/routers/challenges.py:32-48` — `_require_released_stage` accepts status `armed` and never checks `starts_at`, so `/v1/challenges/{id}/files/content` and `/search` serve content pre-start. `backend/app/routers/levels.py:703-714, 744-783` — `/v1/repo/tree` and `/v1/repo/files/{path}` check only event status + repo lock + `level ≤ pointer level_no` (no stage status, no node, no `starts_at`). `backend/app/flow.py:262-268` — when armed with `starts_at` NULL, the gate allows entry.
- **Impact:** The register's design (TIM-04) is that content must not be readable before T0 (pre-delivered encrypted, key at T0). Here, once a stage is armed — or in the levels flow as soon as the team locks a repo while the level stage is still draft — participants can read the entire challenge repository and start hunting bugs before the clock starts, gaining effective extra time (unequal if some teams lock later). No encryption, no key release, no window enforcement on read paths.
- **Fix:** Enforce the window on every content route: reject when stage status ∉ {active, paused, ended, evaluating, released, final} or `now < starts_at` (read the DB clock once inside the transaction); in the levels flow additionally require `pointer.node = 'exec'` (the workspace gate) before `/repo/*` serves bytes; set `starts_at` at arm time (scheduled) instead of only at start.

### F-BSP-03 — HIGH — First-login password claim enables account takeover of unactivated accounts
- **Risk refs:** AUTH-08
- **Evidence:** `backend/app/routers/auth.py:70-86` — for a registered account with `password_hash` NULL (invited, not yet activated), **any** password typed at `POST /v1/auth/login` is hashed, stored and the account is marked active. The code itself flags it: "NOTE: this is a risk we are willing to take for this event."
- **Impact:** The register's mitigation for AUTH-08 is activation via single-use invite; this branch bypasses it entirely. Any participant (or outsider) who knows a registered-but-unactivated email (college emails are guessable) can sign in first, set the password, and operate as the victim: read challenges, consume the victim's per-file/per-round submission caps, submit wrong reports, and lock the real participant out. Directly exploitable against every account between invite creation and activation.
- **Fix:** Remove the password-claim branch: accounts without `password_hash` must complete `POST /v1/auth/activate` with the single-use invite token (which already sets the password, `auth.py:390-463`); `login` should return generic `AUTH_INVALID_CREDENTIALS` for passwordless accounts. If a soft onboarding flow is wanted, require the invite token at first login instead of a bare password.

### F-BSP-04 — MEDIUM — No Content-Security-Policy anywhere
- **Risk refs:** AUTH-02 (also EVA-05 defense-in-depth)
- **Evidence:** `backend/app/main.py:64-92` — response middleware sets `X-Content-Type-Options`, `Referrer-Policy`, `Cache-Control` but no `Content-Security-Policy`; repo-wide grep finds no CSP header or meta tag (only docs mentioning it as "accepted as defense in depth", docs/CHALLENGE_DESIGN_AND_GROUND_TRUTH.md:100).
- **Impact:** The register's AUTH-02 mitigation bundle is "access token in memory only + HttpOnly refresh cookie + **strict CSP, Trusted Types**". The storage half is correctly implemented (`frontend/src/lib/api.ts:44-52`, `auth.py:32-42`), but with no CSP an XSS in the SPA (dependency, markdown edge case, future inline style) can run with full script access and exfiltrate the in-memory access token or silently ride the refresh cookie path. In an audience of bug hunters, XSS *will* be attempted.
- **Fix:** Add a strict CSP in the middleware (`default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`), eliminate inline styles/handlers to allow `unsafe-inline`-free styles, and add `require-trusted-types-for 'script'` where supported.

### F-BSP-05 — MEDIUM — Wide-span reports score full location match (shotgun padding viable)
- **Risk refs:** INT-05
- **Evidence:** `backend/app/matching.py:100-109` — `location_score` is a function of the *distance* between the report range and the planted range only; span width never factors in. Only spans > 25 lines are rejected at intake (`backend/app/routers/submissions.py:83-85`). Alias keywords include generic words (e.g. BUG-01 aliases "like"/"wildcard"/"search" — `backend/seed.py:249-262`).
- **Impact:** The register requires "wide-range reports match only when their span is within a tolerance of the planted location". As implemented, a 25-line window covering the bug scores 1.0 exactly like a surgical 3-line report; `auto_full` additionally needs a category guess (families give 0.6) and only 0.2 alias evidence, which generic vocabulary can satisfy. With the 12-per-file / 80-per-round caps a participant can carpet a 300-line file with plausible text; misses mostly route to `needs_review` (no penalty) — shifting cost onto reviewers and rewarding padding.
- **Fix:** Weight by span in `location_score` (e.g. score = `min(1, planted_span / report_span)` when overlapping, or require the report span ≤ planted span + tolerance for a score of 1.0 with linear decay beyond); scale the alias-evidence threshold inversely with span; route max-span overlapping reports to `needs_review` instead of auto-accept.

### F-BSP-06 — MEDIUM — No watermarking, file-order shuffling, or similarity analysis
- **Risk refs:** INT-06, INT-07 (also DEC-09)
- **Evidence:** `backend/app/routers/levels.py:730-741` and `backend/app/routers/challenges.py:77-87` — file listings are `ORDER BY path`, identical for every team; no watermark slots anywhere in the upload/serve path (`admin.py:566-633`, `levels.py:744-783` serve raw stored content); `backend/app/config.py:53` — `telemetry_enabled=False`, and no similarity/timing analysis code exists.
- **Impact:** All teams receive byte-identical files in identical order, so a leaked/photographed copy cannot be attributed to an account (no watermark), and collusion (verbal/chat sharing, cross-team copy-paste) has no detection surface. The register treats watermarking as the attribution mechanism and shuffling/similarity flags as the collusion mitigations; none of the three exist in code.
- **Fix:** On serve, apply deterministic per-team transformations that preserve line numbers (comment/string alternates chosen per `team_id`, verified to keep line counts); shuffle file ordering per team at the tree endpoint; add a post-submission similarity job (n-gram overlap of descriptions + submission-time correlation) that writes organizer-visible flags only.

### F-BSP-07 — MEDIUM — Unplanned-bug promotion has no endpoint or deterministic rescore
- **Risk refs:** INT-02
- **Evidence:** `backend/app/evaluator.py:394-404` — `unplanned_valid` reviewer decision merely re-routes to `needs_review` ("promotion is a P2 capability"); no admin endpoint promotes a finding into ground truth, and crediting every team that reported it must be done by hand (`admin.py:1261-1301` generic manual adjustment is the only tool). Acknowledged in docs (KNOWNS L-11).
- **Impact:** The register's mitigation is that promotion "triggers a deterministic rescore that credits every participant who reported it (append-only ledger adjustments)". Today that path is manual SQL/console work under event-day time pressure: plausible-but-unmatched reports sit in review with no score, and crediting them consistently across all teams is error-prone — disputable results and manual repair, the exact S2 failure.
- **Fix:** Add a step-up admin endpoint `promote_unplanned` that inserts the gt bug (with anchors), records a `gt_revision`, scans the stage's `needs_review`/`rejected` submissions for location/alias overlap with the new bug, and appends reversal+award ledger entries for every matching team; audit with `actor_id` and reason.

### F-BSP-08 — MEDIUM — Ground-truth anchors not validated on the production authoring path
- **Risk refs:** DAT-06
- **Evidence:** `backend/app/routers/admin.py:748-811` — `add_bug` inserts locations without computing `anchor_hash` and without checking the file exists or lines are in range; `admin.py:688-729` — `publish_challenge` validates only the version status, never the GT. Anchors are computed solely by the dev seed (`backend/seed.py:959-990`, which even warns on pattern miss). The column exists (`backend/app/models_gt.py:71`).
- **Impact:** The register requires "publishing fails validation if anchors do not match the frozen file". On the real authoring path, a re-uploaded/reformatted file or a typo'd path/line silently invalidates every anchor and location for that challenge — matches fail or (worse) mis-hit, results become disputable, and repair requires a full rescore. Nothing stops publishing a challenge with zero GT bugs either.
- **Fix:** At `add_bug`/`add_flag`, compute and store `anchor_hash` from the current frozen file content and reject unknown `file_path` / out-of-range lines; at `freeze`/`publish`, fail unless every GT location's anchor re-verified against the frozen file and at least one GT bug exists.

### F-BSP-09 — MEDIUM — Password-reset token printed to process logs
- **Risk refs:** SEC-06
- **Evidence:** `backend/app/routers/auth.py:519-521` — `print(f"[dev-mail] password reset token for {body.email}: {raw}")`; the token is the bearer credential for `POST /v1/auth/password/reset` (auth.py:531-572), valid 30 minutes.
- **Impact:** Any operator/log aggregator/host access exposes live account-takeover credentials for arbitrary participants (reset then sign in). This is exactly the "tokens end up in logs" trap; the "organizer console" hand-off is documented, but the console path is the same print statement. Under an audience of adversaries, log hygiene on a shared VPS matters.
- **Fix:** Never print raw tokens. Store the token (hashed, with TTL + single-use, as now) and expose it only through a step-up-authenticated organizer endpoint returning it once, or integrate email delivery; add a log-scrubbing middleware allow-list for sensitive fields.

### F-BSP-10 — MEDIUM — Rate limiting is in-process only and never evicts keys
- **Risk refs:** SEC-07 (also NET-01 residual)
- **Evidence:** `backend/app/deps.py:27-39` — `_bucket: dict[str, list[float]]` per-process limiter; keys (e.g. `login:{ip}`) are never evicted (only the last 60 timestamps *per key* are kept), so distinct-key count grows unboundedly; `scripts/run_dev.sh:36` runs a single uvicorn (limits reset on restart and multiply per replica). Acknowledged in docs (SECURITY_REVIEW F-06, KNOWNS L-05).
- **Impact:** The register's trap is "in-process limiters multiply by the replica count". Any future second API replica (or `--workers N`) silently multiplies every "per-minute" limit; restarts reset windows (burst bypass). Additionally, an unauthenticated flood of distinct source keys grows the dict (memory) without bound.
- **Fix:** Move counters to a shared store (Redis token-bucket via Lua, or a PG counter table) with an in-process fail-open fallback; bound the key set (LRU/TTL eviction) regardless; assert a single-worker deployment in the runbook until then.

### F-BSP-11 — MEDIUM — Admin surface: password-only step-up, no MFA, no separation
- **Risk refs:** AUTH-09
- **Evidence:** `backend/app/deps.py:141-162` — step-up is a re-entered password valid 5 minutes (session row); `backend/app/routers/auth.py:470-493`; organizer/admin endpoints live in the same process and use the same `app_api` DB role (`backend/app/routers/admin.py:26`), with GT writes gated by step-up + a separate `gt_session` connection. No TOTP/WebAuthn/Cloudflare Access (documented as P1, SECURITY_REVIEW F-05).
- **Impact:** The register's mitigation bundle for the S1 "admin takeover reads the answer key" is Cloudflare Access + TOTP/WebAuthn + short admin sessions + step-up + **separate deployment and DB role**. Step-up exists (good), but a phished/reused organizer password yields: stage control, dispute resolution with point adjustments, exports, participant lists, invitations — without any second factor. The API process also holds `gt_admin` credentials, so process compromise reaches the answer key.
- **Fix:** Require WebAuthn/TOTP for `organizer`/`admin` roles at login (or front the admin surface with an Access policy); shorten admin access-token TTL and step-up window; split the admin/GT endpoints into a separate deployment using only the `gt_admin`-capable role, leaving the participant API process without GT credentials.

### F-BSP-12 — MEDIUM — A/B variant equivalence unvalidated and self-selected
- **Risk refs:** INT-03, INT-04 (also DEC-05, DEC-09)
- **Evidence:** `backend/app/routers/levels.py:498-537` + `backend/app/routers/admin_levels.py:141-184` — teams self-select Option A (Node, "Papyrus") or Option B (Python, "Marina"); equivalence is asserted only by the dev fixture comment (`backend/seed.py:55-58`: "same bug count, severities…"). No validation gate, no counterbalancing, no per-language balancing mechanism in code; docs list certification as a blocking owner decision (KNOWN_GAPS #3).
- **Impact:** The register requires either identical content + watermark (default) or *pre-validated equivalent* variants assigned counterbalanced, with a validation report before publish. As built, points across two different languages/stacks are only as comparable as the (unvalidated) fixtures; teams also self-select, so difficulty drift between options becomes scoring unfairness that cannot be repaired without a rescore.
- **Fix:** Add a publish-gate check comparing per-option GT aggregates (bug count, severity distribution, total points, file/line counts) that refuses event `ready` unless within tolerance; assign options counterbalanced (hash of team id) or keep the default identical-content+watermark; record the validation report as an audited artifact.

### F-BSP-13 — LOW — Root-cause group is not the award unit
- **Risk refs:** DAT-07
- **Evidence:** `backend/app/scoring.py:83-101` — claims are keyed by `award_unit_id` = bug `code` (`evaluator.py:138-145`, `evaluator_level.py:174-181`); `root_cause_group` is stored (`models_gt.py:53`) but never used in duplicate detection (`_already_awarded` returns codes, `evaluator.py:87-94`).
- **Impact:** The register's "one award per group" is not enforced: if authors encode several symptoms of one root cause as separate bugs sharing a `root_cause_group`, a team is paid for each symptom, making scores arbitrary across teams that report the root cause once vs. all symptoms.
- **Fix:** Make `root_cause_group` (or a canonical unit per group) the claim key: map bug → group at candidate load and claim/duplicate on the group id, or add a DB constraint/lookup that treats same-group bugs as one award unit per team.

### F-BSP-14 — LOW — No offline draft queue or error boundaries in the client
- **Risk refs:** FE-01, NET-06 (client-resilience half)
- **Evidence:** `frontend/src/pages/participant/Workspace.tsx:187-230` — autosave is a 3s server `PUT` (good), but a network failure surfaces as a notice only; there is no IndexedDB persistence and no React `ErrorBoundary` anywhere (grep). `frontend/src/lib/api.ts:131-138` — submit network errors throw to the caller with no queueing/auto-resubmission.
- **Impact:** The register's FE-01 mitigation is "drafts autosaved to IndexedDB **and** to the server; error boundaries per workspace region". With connectivity loss (venue Wi-Fi degradation — NET-06's client-resilience requirement), unsent autosaves and the in-progress submission depend on the participant manually retrying; a rendering error in one workspace region unmounts the whole app instead of one panel.
- **Fix:** Persist the working draft to IndexedDB on every change (debounced) with server sync as the transport; queue submission attempts with their `Idempotency-Key` and auto-flush on reconnect; wrap workspace regions in error boundaries that keep drafts intact.

### F-BSP-15 — LOW — No stale-client detection (X-Min-Client-Version)
- **Risk refs:** FE-02
- **Evidence:** `backend/app/main.py:64-92` — the middleware sets request-id/security headers only; repo-wide grep finds no `X-Min-Client-Version` emission or client-side version-check/reload logic; hashed immutable assets come from the Vite build only.
- **Impact:** A deployment during the event leaves clients on an incompatible build with no safe-reload prompt (drafts preserved only accidentally). The register's mitigation is a change freeze (process) **plus** the version header and client reload.
- **Fix:** Return `X-Min-Client-Version` (from settings/build metadata) on `/v1/state` and all responses; have the client compare on poll and prompt a reload that preserves in-memory drafts (save draft before reload).

### F-BSP-16 — LOW — Challenge upload has no file-count cap; tree not virtualized
- **Risk refs:** FE-04
- **Evidence:** `backend/app/routers/admin.py:566-633` — per-file 512 KiB and traversal checks, but no limit on the number of files per challenge version; `backend/app/routers/levels.py:717-741` and `challenges.py:77-87` return the whole file list; `Workspace.tsx:521` renders one `FileRow` per file with no virtualization. Mitigations that do exist: server-side search with `LIMIT 50` (`challenges.py:159-169`) and a capped line index (`admin.py:609-621`).
- **Impact:** The register's S2 trap (thousands of files freeze the explorer) is unguarded on the intake side: an oversized upload degrades the participant workspace for everyone on that option and slows the per-upload line-index rebuild.
- **Fix:** Enforce a file-count cap per challenge version at upload (reject beyond e.g. 500); paginate or lazily expand `/repo/tree`; virtualize the tree client-side.

### F-BSP-17 — LOW — Review queue lacks SLA timers and double review
- **Risk refs:** EVA-01 (also EVA-02 residue)
- **Evidence:** `backend/app/routers/review.py:25, 65-100` — priorities and a 10-min claim timeout exist; backlog is a single counter in live ops (`admin.py:979`); there is no age-based escalation, no SLA timer, and no blind double review for high-severity/disputed items (`needs_second_review` decision exists at review.py:172 but nothing schedules a second reviewer).
- **Impact:** The register's mitigation bundle for review backlog includes SLA timers, reviewer assignment and double review; with only priorities, an organizer cannot see breaching items and high-severity accepts rest on a single reviewer.
- **Fix:** Add `sla_due_at` to `review_items` (by priority), surface breaching items in live ops, and automatically open a second blind review for high-severity bugs or disputed decisions.

### F-BSP-18 — LOW — Backend dependencies not hash-pinned; no lockfile/scanning evidence
- **Risk refs:** SEC-04
- **Evidence:** `backend/requirements.txt:1-12` — a mix of exact pins (`fastapi==0.165.0`) and open minimums (`sqlalchemy>=2.0.44`, `pyjwt>=2.10.1`), no hashes, no backend lockfile; frontend has `package-lock.json` but no Dependabot/scan configuration in repo.
- **Impact:** The register asks for pinned-and-hashed dependencies, lockfiles and image scanning. Floating minimums make builds non-reproducible and can silently pull a compromised/renamed release; there is no automated vulnerability gate.
- **Fix:** Generate a hashed lockfile (uv/pip-tools `--generate-hashes`) committed to the repo, pin every runtime dep exactly, and add a CI job (pip-audit / OSV scan + image scan) that fails on known vulnerabilities.

---

## Summary

The codebase implements the register's core invariants faithfully: server-side clock and idempotent submissions (TIM-01/02/03, DAT-02), DB-arbitrated single awards (DAT-01), gt-schema role isolation with a real test (DAT-03), append-only ledger + hash-chained audit (DAT-05, HUM-05), refresh-family rotation with grace (AUTH-01/04), memory-only tokens with a path-scoped cookie (AUTH-02 storage half), path/zip safety (SEC-02/03), and plain-text rendering everywhere (EVA-05). The sharpest gaps are two self-inflicted leaks of the register's own S1 invariants — the ungated team-score endpoint (F-BSP-01) and pre-window content disclosure (F-BSP-02) — plus the deliberate-but-risky first-login password claim (F-BSP-03). Many remaining gaps (MFA, rate limiter sharing, promotion endpoint, CSP) are already self-documented in `docs/SECURITY_REVIEW.md` and `docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md` as accepted/follow-up items; this audit confirms them in code.

---

### 4.16 OWASP-style security audit (`security`)

# Security Audit Report — Bug Hunt CTF Platform

- **Agent:** security (subagent)
- **Task ID:** 4-h
- **Scope:** OWASP-style audit of `backend/` (FastAPI), `frontend/` (React+Vite), `challenge-app/` (Node), `challenge-app-option-b/` (Python), `scripts/`, `docs/`, seed/tests. Challenge-app bugs listed in `ORGANIZER_ANSWER_KEY.md` / `docs/CHALLENGE_DESIGN_AND_GROUND_TRUTH.md` are treated as intended design; only accidental/unplanned items there are real findings.
- **Baseline:** git HEAD `f1412b7eec6c92c4c168fd2b8a58182b34480387` (2026-11-26)
- **Mode:** READ-ONLY — no repo files modified, no packages installed, no servers/tests run.

## Per-area summary

| Area | Result |
| --- | --- |
| Authentication (JWT, refresh, passwords, reset) | Solid primitives (Argon2id, pinned HS256, iss/aud, rotation + reuse detection, token_version revocation). Two real gaps: the first-login account-claim flow and the invite/activate password-overwrite path. |
| Authorization (IDOR, admin gating, step-up) | Participant routers consistently ownership-scoped; gt endpoints step-up gated. Real gaps: unvalidated invite role (organizer→admin escalation), unscoped refresh-token revocation, and the activate `ON CONFLICT` password reset. |
| Injection (SQL, command, path traversal) | No string-built SQL anywhere (all `sqlalchemy.text()` binds; the one dynamic fragment in `jobs.py` is a fixed literal). No eval/exec/pickle/subprocess in app code. Path traversal defended on file-content, repo-file and upload paths; artifact storage keys are digest-derived, not filename-derived. |
| Secrets | No committed `.env` (gitignored; `.env.example` is placeholders only). Dev JWT secret + dev DB DSNs are code defaults without a production fail-fast; dev seed credentials hardcoded (documented dev-only). CTF flag plaintexts appear in organizer-side files only (seed.py, tests, answer key), never in participant surfaces. |
| File upload | Size caps (body 512 KiB, uploads 6 MiB), extension allow-list, ZIP central-directory inspection (entry count, decompression bomb, symlink/device rejection), no execution/extraction in-process. Gaps: Content-Length trust + read-before-check on the admin upload path. |
| Web (XSS, CORS, headers, cookies, rate limits, errors) | No `dangerouslySetInnerHTML`/`innerHTML` in the React frontend; exact-origin CORS; HttpOnly/SameSite=Strict path-scoped refresh cookie; stable error envelopes that do not leak internals. Gaps: no CSP/X-Frame-Options; in-process-only rate limiting. |
| SSRF / redirects / deserialization / dependencies | No outbound HTTP calls from the backend (no SSRF surface); no redirects from user input; no unsafe deserialization; deps are recent, floor-pinned, and requirements.txt documents a deliberate fastapi/starlette security bump. |
| Ground-truth isolation | **Verified clean**: no participant-reachable router imports `gt_session` (only the three step-up-gated admin gt endpoints); search/file endpoints read `app.challenge_file_lines`/`app.challenge_files` only; seed ingests an 11-file allow-list excluding `ORGANIZER_ANSWER_KEY.md`; flags stored as HMAC only. No finding. |

## Findings

### F-SEC-01 — HIGH — Invite creation accepts any role: organizer can mint admin accounts
- **Evidence:** `backend/app/routers/admin.py:470-473` (`InviteIn.role: str = "participant"` — no pattern/allow-list, unlike `RegisterIn` at `backend/app/routers/auth.py:199`), consumed unvalidated at `admin.py:497` (`"role": body.role`), and honored verbatim by activation at `backend/app/routers/auth.py:424` (`"role": inv["role"]` in the user INSERT).
- **Impact:** Any organizer (or an attacker with a hijacked organizer token; `create_invite` requires only `require_organizer`, no step-up) can create an invite with `role: "admin"`, activate it with an email they control, and obtain a full platform-admin account — bypassing the "only an admin may create organizer/admin accounts" rule enforced only on `/auth/register`.
- **Fix:** Add `role: str = Field(pattern="^(participant|reviewer)$")` to `InviteIn`, and reject organizer/admin roles unless the caller is admin (mirror `register`'s check, `auth.py:207-211`). Consider requiring step-up for invite creation, and audit-log the granted role.

### F-SEC-02 — HIGH — `POST /auth/activate` overwrites the password of any existing account
- **Evidence:** `backend/app/routers/auth.py:414-429` — the user INSERT ends with `ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'active'`. The invite email is organizer-chosen (`admin.py:494`) and there is no check that no user already exists for that email.
- **Impact:** An organizer (only role needed to call `create_invite`) can issue an invite for an existing privileged account (e.g. `admin@example.com`), activate it with a password they choose, and take over that account — its role is preserved by the conflict update. Combined with F-SEC-01 this is a complete organizer→admin escalation chain; the password reset also re-activates disqualified accounts via `status = 'active'`.
- **Fix:** On activation, if a user with the invite email already exists, either refuse (invite emails must be new) or require a dedicated confirmation flow; never silently reset an existing password from an invite. Verify the invite's event/user state and record which account was (re)created in the audit entry.

### F-SEC-03 — HIGH — First-login "claim" flow: NULL `password_hash` accounts are claimable, and disqualified accounts get re-activated
- **Evidence:** `backend/app/routers/auth.py:79-90` — `elif not user["password_hash"]:` sets the typed password, forces `status='active'`, and only *then* checks `user["status"] == "disqualified"` (against the already-overwritten dict from line 86), so the check can never fire for claimable rows. The schema allows NULL (`backend/migrations/0001_init.sql:89`: `password_hash VARCHAR(256)` — nullable, default `pending` status at line 90). The code comment (line 75) acknowledges: "this is a risk we are willing to take"; the flow is documented to participants (`frontend/src/pages/Login.tsx:46-51`).
- **Impact:** Any unauthenticated attacker who knows a registered email for a passwordless row (created by future import tooling, manual DB inserts, or any path that leaves `password_hash` NULL) sets that account's password on first attempt — for staff accounts too, since the flow is not role-restricted. A disqualified passwordless account is also silently re-activated. Currently no in-repo code path creates NULL-hash users (seed and both routers always hash), so exploitation requires such a row to exist — hence HIGH (auth bypass with preconditions) rather than CRITICAL.
- **Fix:** Restrict claiming to `role='participant'` rows, reject non-`pending`/`disqualified` statuses before writing, and require an out-of-band activation token or a server-side "password provisional" state instead of trusting the first typed password. At minimum, make `users.password_hash NOT NULL` (or a sentinel hash) so the claim branch is unreachable.

### F-SEC-04 — MEDIUM — `DELETE /me/sessions/{id}` revokes another user's refresh tokens (IDOR)
- **Evidence:** `backend/app/routers/auth.py:639-652` — the `app.sessions` UPDATE is scoped by `user_id`, but the follow-up `UPDATE app.refresh_tokens SET status='revoked' WHERE session_id = CAST(:sid AS uuid)` (lines 648-651) has **no user scoping**, and the endpoint returns `{"ok": True}` regardless of row count. Session IDs are UUIDv7 (time-ordered, `backend/app/db.py:81-88`), making enumeration partially feasible during an event window.
- **Impact:** Any authenticated participant who obtains/guesses another user's session UUID can force-logout that user's sessions (DoS) by revoking their refresh-token family — a cross-user destructive action on other participants' or staff sessions.
- **Fix:** Scope the second statement to sessions owned by the caller: `... WHERE session_id IN (SELECT id FROM app.sessions WHERE id = :sid AND user_id = :u)`, return 404 when no own session matched, and confirm both updates in one transaction.

### F-SEC-05 — MEDIUM — Default JWT secret and dev DB credentials ship in code with no production fail-fast
- **Evidence:** `backend/app/config.py:24-26` (DSNs `app_api:app_api_dev@...`, `gt_admin:gt_admin_dev@...`), `config.py:32` (`jwt_secret: str = "dev-only-insecure-secret-replace-me"`), and `.env.example:16-32` documents overrides but nothing enforces them. The single secret also derives the refresh-successor Fernet key (`backend/app/security.py:29`), receipt HMAC (line 121), flag HMAC (line 127) and IP hashes (line 132).
- **Impact:** A deployment that sets `ENVIRONMENT=production` but forgets `JWT_SECRET` (or the DSNs) starts silently with a publicly-known secret → universal token forgery (any role), refresh-successor decryption, and forgeable flag/receipt codes. There is no startup guard distinguishing dev from production values.
- **Fix:** Fail fast at startup: when `environment == "production"`, refuse to boot if `jwt_secret` equals the known dev default or is < 32 bytes of entropy, and require non-default DSNs. Log a loud warning otherwise. Separating the Fernet key from the JWT secret would also limit blast radius.

### F-SEC-06 — MEDIUM — Password-reset tokens are printed to stdout/logs
- **Evidence:** `backend/app/routers/auth.py:519-521` — `print(f"[dev-mail] password reset token for {body.email}: {raw}")`; the comment states "the reset link is surfaced through the organizer console and dev logs only" (no email provider in v1).
- **Impact:** Anyone with access to process logs (shared terminals, log aggregators, cloud consoles, `docker logs`) can read a live single-use 30-minute reset token and take over **any** account — including admin (`/auth/password/reset` at lines 531-572 performs the full takeover: password set, token_version bump, sessions revoked).
- **Fix:** Never print raw reset tokens. Store the token hashed (like invites) and expose it only through an authenticated organizer console endpoint (step-up gated) or a real email provider; add `print`/logging lint rules for secrets.

### F-SEC-07 — MEDIUM — In-process rate limiter: per-worker limits, restart resets, and unbounded key growth
- **Evidence:** `backend/app/deps.py:30-39` — module-level `_bucket: dict[str, list[float]]` (defaultdict); `rate_limit` prunes timestamps per key but never removes keys; login keys include attacker-controlled values: `rate_limit(f"login-u:{body.email.lower()}", ...)` (`auth.py:58`) and `f"reset:{ip}"` (`auth.py:502`).
- **Impact:** (a) Brute-force protection is only as strong as one worker process — multiple uvicorn workers each keep their own bucket, and any restart clears it; (b) an unauthenticated attacker can grow `_bucket` without bound by sending unique emails to `/auth/login` (each unique email creates a permanent dict entry with a list of up to 60 floats) — slow memory-exhaustion DoS and weakened `login-u` throttling.
- **Fix:** Move the limiter to a shared store (Postgres/Redis) or at minimum bound the dict (LRU/TTL eviction) and key it on the IP+user pair with a cap on distinct keys per IP. The DB-backed caps for submissions already exist; login/reset/step-up should follow.

### F-SEC-08 — LOW — No Content-Security-Policy or X-Frame-Options
- **Evidence:** `backend/app/main.py:87-89` sets only `X-Content-Type-Options`, `Referrer-Policy`, `Cache-Control`; nothing sets CSP or frame-ancestors anywhere in backend or frontend (`frontend/index.html:1-19`, `frontend/vite.config.ts`).
- **Impact:** Defense-in-depth gap: a future injection point or compromised dependency would run without a CSP backstop, and the console can be framed (clickjacking). Impact is limited today (React escapes all rendering, tokens live in memory, refresh cookie is SameSite=Strict + path-scoped).
- **Fix:** Add a strict `Content-Security-Policy` (default-src 'self', no inline scripts, frame-ancestors 'none' / X-Frame-Options: DENY) at the reverse proxy or the FastAPI middleware for the SPA and API responses.

### F-SEC-09 — LOW — Upload/body size checks trust Content-Length and read-before-check
- **Evidence:** `backend/app/main.py:69-84` rejects oversize bodies only when a parsable `content-length` header exceeds the cap (chunked transfer encoding bypasses it); the admin file upload reads the whole part into memory before checking size: `content = await file.read()` then `if len(content) > 512 * 1024` (`backend/app/routers/admin.py:572-574`). The participant artifact path is correct (bounded read, `levels.py:803-807`).
- **Impact:** A step-up-authorized organizer can exhaust API memory with a huge multipart part sent chunked (no CL) — a pre-authenticated DoS. Any client can bypass the generic body-size middleware with chunked encoding (JSON bodies then rely on Pydantic parse limits only).
- **Fix:** Stream uploads with a bounded reader (`file.read(max + 1)` chunks) and enforce a hard request-body cap independent of headers (e.g. ASGI middleware that counts streamed bytes).

### F-SEC-10 — LOW — Negative `limit` query params bypass result caps
- **Evidence:** `backend/app/routers/announcements.py:15-24` (`min(limit, 100)` — no lower bound; negative LIMIT in PostgreSQL means "no limit") and `backend/app/routers/admin.py:1051-1074` (`min(limit, 500)` for `/admin/audit`).
- **Impact:** `/v1/announcements?limit=-1` returns every announcement row and `/v1/admin/audit?limit=-1` every audit entry — unbounded result sets from a small table, a cheap resource-exhaustion probe and inconsistent pagination.
- **Fix:** Use `Query(ge=1, le=100)` / `le=500` constraints instead of `min()`.

### F-SEC-11 — LOW — Hardcoded dev credentials in seed/helper scripts
- **Evidence:** `backend/seed.py:576` and `:803` (`security.hash_password("Dev-only!Passw0rd!")` for admin, organizers, reviewers, all participants), printed at `seed.py:887-889`; `scripts/add_dev_account.py:36` (`DEV_PASSWORD = "Dev-only!Passw0rd!"`); role passwords in `scripts/dev_db.sh:99-106` (`app_api_dev`, `gt_admin_dev`, `scheduler_dev`).
- **Impact:** Every seeded account shares one documented password. The files are clearly labeled dev/test-only ("Never run against a live deployment", `seed.py:14`), so this is hygiene — but a copy-paste of the seed against a production DB hands out staff accounts wholesale.
- **Fix:** Generate random passwords at seed time and print them once (or write to a gitignored local file); add a technical guard (refuse to run when `environment != "development"`, as `add_dev_account.py:40-41` already does — port that guard to `seed.py`).

### F-SEC-12 — LOW — Challenge app: unplanned second XSS sink in the notes list (beyond intended BUG-03)
- **Evidence:** `challenge-app/public/app.js:106-121` — `renderNotes` builds `li.innerHTML = \`<a ...>${note.title}</a> <span ...>by ${note.author_name} ...\`` from user-controlled note titles, subjects and display names, in addition to the intended comment-render XSS (BUG-03, `app.js:131-138`, answer key).
- **Impact:** Unplanned (not in the answer key), same stored-XSS class as the intended BUG-03 but reachable from note creation rather than comments. It stays inside the local challenge app, so event impact is contained — but per the pre-event audit protocol (INT-02) it should be registered as an accepted unplanned defect, or reports against it will land in the `unplanned_valid` review path with no ground truth.
- **Fix:** Register it in the answer key revision history (accepted unplanned behavior) or patch `renderNotes` to use `textContent`; the challenge README fix guidance for BUG-03 covers the same escaping approach.

### F-SEC-13 — INFO — Intended challenge weaknesses confirmed contained; Option B fixture carries two unplanned auth gaps
- **Evidence (intended, per `ORGANIZER_ANSWER_KEY.md` / `docs/CHALLENGE_DESIGN_AND_GROUND_TRUTH.md`):** stored XSS via comment render (`challenge-app/public/app.js:131-138`), client-gated admin overview leaking the notice flag (`challenge-app/server.js:53-61`; flag seeded at `challenge-app/db.js:46`), base64 flag comment (`challenge-app/public/app.js:5`), single-round salted SHA-256 passwords (`routes/auth.js:5-7`), Option B mirrors (`challenge-app-option-b/main.py:38-43` unauthenticated `/admin/overview`, `routes/comments.py:18-25` HTMLResponse XSS).
- **Unplanned in Option B (dev fixture only — flag if it ever ships as an event package):** `challenge-app-option-b/routes/notes.py:35-41` trusts client-supplied `author_id` for note creation, and `routes/auth.py:58-65` serves `/api/auth/me?user_id=N` with no authentication (enumerates emails/names). Option B is explicitly labeled "DEVELOPMENT FIXTURE ONLY" (`seed.py:262-264`), so these are noted as design context, not scored platform findings.
- **Impact/fix:** No leak beyond the challenge apps' local scope. If Option B becomes the real package, register or fix the two unplanned auth gaps before freeze (the INT-02 protocol requires exactly this).

## Notes on verified-clean areas (no findings)

- **Ground-truth isolation:** every participant-reachable router uses `app_session` only; `gt_session` appears solely in the three step-up-gated admin gt endpoints (`admin.py:748-880`) plus the worker evaluator; challenge files/lines served to participants come from `app.challenge_files`/`app.challenge_file_lines`; seed ingests only the 11-file allow-list (`seed.py:41-53`); `gt_flags` stores HMACs only (`seed.py:1000-1014`). Flag plaintexts exist only in organizer-side repo files.
- **SQL/command injection:** all queries are parameterized `text()` binds; the sole dynamic fragment (`jobs.py:43-56`) is a fixed literal with values bound. No shell-outs, pickle, or eval in `backend/app`.
- **Path traversal:** `os.path.normpath` + `..`/absolute/NUL rejection on both file-content routes (`challenges.py:113-116`, `levels.py:752-754`, `admin.py:578-580`), with DB exact-path lookup (not filesystem); artifact keys are `owner/level/kind-digest` (`storage.py:30-44`).
- **JWT handling:** pinned HS256, iss/aud verified, exp/iat/nbf/sub/sid required (`security.py:97-112`); access tokens memory-only in the SPA (`frontend/src/lib/api.ts:44-52`); refresh cookie HttpOnly/SameSite=Strict/path-scoped with Origin+header CSRF check (`auth.py:32-46`, `deps.py:170-177`).
- **IDOR baseline:** submissions, drafts, disputes, results, team data, review queue interactions are all ownership- or membership-scoped with 404-instead-of-403 responses (`submissions.py:395`, `432-436`; `levels.py` passim).

## Severity counts

CRITICAL 0 · HIGH 3 · MEDIUM 4 · LOW 6 · INFO 1

---

### 4.17 Code quality audit (`quality`)

# Code Quality Audit Report

- **Agent:** quality (Task ID 4-i)
- **Scope:** Full repo code-quality audit of `/home/z/my-project/bug-hunt-hackathon` — backend (`backend/app`, routers, jobs/worker, seed, migrations, tests), frontend (`frontend/src`, tests), challenge fixtures (`challenge-app`, `challenge-app-option-b`), scripts, CI wiring, docs accuracy.
- **Baseline:** git HEAD `f1412b7eec6c92c4c168fd2b8a58182b34480387` (2026-11-26)
- **Method:** Read-only review (Read/Grep/Glob, read-only bash). Every finding cites file:line evidence actually read. Severity: HIGH = systemic issue that will cause production incidents or blocks maintainability; MEDIUM = significant quality debt; LOW = minor.

## Per-area summary

**Architecture/layering.** Clean module boundaries exist for flow state machine (`flow.py`), matching (`matching.py`), scoring ledger (`scoring.py`), storage (`storage.py`), and the job queue (`jobs.py`). But the router layer is where almost all policy, validation, and data access lives: 351 raw `text()` SQL statements across `backend/app`, ~210 of them inside `routers/`. `routers/admin.py` (1,322 lines) and `routers/levels.py` (1,187 lines) are god modules, and `auto_submit.py` (worker-side domain code) imports private helpers from a router. See F-QLT-02, F-QLT-04.

**Duplication.** Real, concrete duplication: evaluator vs evaluator_level (`_submission`, `_candidates_for_version`, award/ledger block), `matching.decide` vs `decide_multi` (~70 lines of shared threshold logic), seed.py's inline Option-A ingestion vs `_ingest_challenge`, Workspace.tsx's duplicated draft-hydration block, and the frontend's copy of backend state machines. The two challenge apps are *intentionally* parallel fixtures (bug parity maintained manually via seed manifests). See F-QLT-08, F-QLT-09, F-QLT-11, F-QLT-15, F-QLT-18, F-QLT-25.

**Error handling.** Good: no bare excepts (BLE lint enforced); broad excepts carry `noqa` + justification; `db.py:47-70` session context managers always rollback/close; `jobs.py` has claim/lease/backoff/dead-letter with crash recovery (`requeue_expired_leases`). Weak spots: the global exception handler never logs (F-QLT-06), one unguarded reset-token `print` (F-QLT-07), and a `needs_second_review` decision that dead-ends a submission (F-QLT-16).

**Typing.** Python: type hints are broadly present and decent; two invalid annotations and an in-memory rate limiter with unbounded keys (F-QLT-21, F-QLT-22). Frontend: **TypeScript strict mode is off** in `tsconfig.app.json` — the single biggest typing gap (F-QLT-03). No `any`/`@ts-ignore`/`as any` found in `frontend/src` (clean).

**Tests.** Backend: strong — 74 test functions across 12 files against a **real PostgreSQL** (`bughunt_test`, real `app_api`/`gt_admin` roles, no mocks), covering auth, authorization/IDOR, gt isolation, idempotency (incl. committed-key replay after deadline), matching decision table, scoring ledger immutability, and the four-level flow (gates, repo lock, uploads, auto-submit). E2E journey (46 checks) + CI with ruff/bandit/pip-audit/coverage gate 65%. Frontend: **one SSR XSS test only** (F-QLT-13). Results-total math with penalties is untested — and it is wrong (F-QLT-01). Docs claim 34/38 tests vs the actual 74 (F-QLT-14).

**Data layer.** Migration hygiene is good: tracked in `app.schema_migrations`, idempotent additive DDL (`migrations/0003_four_level_flow.sql:1-11`). Seed has a silent-degradation risk on GT anchor misses (F-QLT-11). ORM layer is ~740 lines of near-dead code duplicating the SQL schema (F-QLT-12). N+1 patterns at results release (F-QLT-17). One correctness bug in participant-facing totals (F-QLT-01).

**Frontend quality.** Clean api client (single `api()` wrapper, silent-refresh retry, normalized errors), clean auth context, decent aria usage (65 occurrences across 14 files). But `Workspace.tsx` is a 963-line god component with 20+ hooks, and state machines are hand-copied from the backend. See F-QLT-15, F-QLT-18.

**Config/ops.** pydantic-settings config with env override; CORS allow-list; good logging format in worker. Gaps: no production guard rejecting dev-default `jwt_secret` (F-QLT-19), unguarded dev-mail print (F-QLT-07), backend runtime deps unpinned/unlocked (F-QLT-24), scattered inline imports (F-QLT-23).

**Docs accuracy.** Mostly accurate and unusually candid (KNOWN_GAPS, SECURITY_REVIEW limits). Drift found in test counts (34/38 vs 74) and the TESTING_STRATEGY per-file table omitting all six `test_flow_*` files (F-QLT-14). SECURITY_REVIEW F-09 claim (no `dangerouslySetInnerHTML`) verified by grep — true. SYSTEM_ARCHITECTURE's claim that the outbox has no external consumer matches `dispatch_outbox` (marks delivered, no consumer) — accurate.

**Clean areas (no findings):** `db.py` session/rollback handling; `jobs.py` claim/lease/retry/dead-letter design; `storage.py` (atomic publish, safe zip inspection); `security.py` (Argon2id, pinned-algorithm JWT, refresh family rotation); `matching.py` decision-table unit tests; migration tracking; CI wiring; frontend `api.ts`/`auth.tsx`.

---

## Findings

### F-QLT-01 — HIGH — Participant results totals double-count penalties
- **Evidence:** `backend/app/routers/leaderboard.py:101-105` adds every ledger row (including `component="penalty"` rows) into `by_component`; `leaderboard.py:118` then computes `total = sum(by_component.values()) + penalties`, adding the (negative) penalty a second time. Penalty rows are written with `component="penalty", kind="penalty"` at `backend/app/evaluator.py:554-559`. Endpoint is consumed by `frontend/src/pages/participant/Results.tsx:28` (`/v1/results/${stageId}`).
- **Impact:** Whenever the release-time invalid-report penalty applies (default `fp_factor: 0.25` in `backend/app/routers/admin.py:237`, `backend/seed.py:108`), the displayed team total is lower than the true ledger sum by exactly the penalty amount. Participant-facing score reporting is wrong; disputes will follow. No test or e2e check covers results totals with a penalty entry (verified: no `/v1/results` assertions in `backend/tests` or `scripts/e2e_journey.py`).
- **Fix:** In `my_results`, exclude penalty rows from `by_component` accumulation (e.g. `if r["kind"] == "penalty": penalties += pts; continue` before line 105), so `total = sum(by_component.values()) + penalties` is correct; add a pytest covering a released stage with a penalty entry.

### F-QLT-02 — HIGH — God routers: business logic, validation, and data access all inline; no service layer
- **Evidence:** `backend/app/routers/admin.py` is 1,322 lines covering events, config freeze, stage lifecycle, teams, invites, challenges, ground-truth writes, announcements, time adjustments, live ops, readiness, audit viewer, CSV exports, disputes, manual adjustments, system health (`admin.py:1-1322`). `backend/app/routers/levels.py` is 1,187 lines covering level catalog, gates, workspace entry, drafts, repo lock, team views, repo file delivery, uploads, level submission, diff computation, and run stubs (`levels.py:1-1187`). Grep shows 351 `text(` raw SQL statements in `backend/app`, ~210 inside `routers/` (admin.py 73, levels.py 33, auth.py 44, submissions.py 22...). `main.py:5` claims "No scoring logic lives in handlers", but stage-pause/resume time math (`admin.py:341-357`), scoring weights validation (`admin.py:156-158`), and acceptance-caps policy all live in handlers.
- **Impact:** Systemic maintainability blocker: unit-testing policy requires a full database + HTTP stack; every change to a rule (e.g. pause/resume time math, caps, cooldowns) must be made inside a 1,000+ line router; merge-conflict and regression risk concentrate at exactly the files that change most. The two god routers alone are 2,509 of ~9,700 backend lines.
- **Fix:** Extract a `services/` layer (stage lifecycle, submission intake incl. validation helpers, admin adjustments, exports) and a thin data-access module per domain; keep routers to request/response mapping + dependency wiring. Move shared validation (`_validate_report_fields`, `_validate_flag`) next to `matching.py`/`flow.py` so the worker and routers share one implementation (also fixes F-QLT-04).

### F-QLT-03 — HIGH — TypeScript strict mode is disabled for the whole frontend
- **Evidence:** `frontend/tsconfig.app.json:3-23` and `frontend/tsconfig.node.json:3-20` contain no `"strict"` key (nor `strictNullChecks`/`noImplicitAny`); only `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` are set. Default for `strict` is `false`.
- **Impact:** 6,348 lines of TS/TSX compile with implicit `any` parameters, no null/undefined checking, and unchecked indexing. Runtime `undefined` crashes (e.g. `assignments[0]` patterns, optional API fields) reach production silently. This is a systemic typing gap behind an otherwise carefully written frontend (only 10 `as X` casts; zero `any`/`@ts-ignore`).
- **Fix:** Add `"strict": true` (and ideally `noUncheckedIndexedAccess`) to both tsconfigs; fix the surfaced errors (expect a bounded set given the disciplined codebase); keep `tsc -b` in the CI build (already runs via `npm run build`, `frontend/package.json:8`).

### F-QLT-04 — MEDIUM — Worker/domain module imports private helpers from a router (layering inversion)
- **Evidence:** `backend/app/auto_submit.py:25` — `from .routers.levels import MAX_LOCATIONS, FlagIn, _compute_diff_from_draft, _stage_computed_diff, _validate_flag`. The dead-line auto-submitter (job layer) reuses three underscore-private functions and the Pydantic model of the HTTP layer. Routers also reach into `flow._effective_end` (private): `levels.py:280, 371, 938`.
- **Impact:** Any refactor of `routers/levels.py` (e.g. the split recommended in F-QLT-02) breaks the worker's import; the same validation code must exist for HTTP and background paths but can drift because ownership is in the wrong module; circular-import risk grows.
- **Fix:** Move `FlagIn`, `_validate_flag`, `_compute_diff_from_draft`, `_stage_computed_diff` and the draft-payload construction into `flow.py` (or a new `level_service.py`); both `routers/levels.py` and `auto_submit.py` import them from there; rename `flow._effective_end` to a public name.

### F-QLT-05 — MEDIUM — `__import__()` antipattern in 12 places
- **Evidence:** `backend/app/jobs.py:34`; `backend/app/routers/submissions.py:282,302,507,518`; `backend/app/routers/admin.py:495,1168`; `backend/app/evaluator.py:227`; `backend/app/flow.py:101,108,116,169` (e.g. `__import__("json").dumps(...)`, `__import__("uuid").uuid4().__str__()`).
- **Impact:** Defeats static analysis: ruff/pyright cannot see the dependency, unused-import detection and import sorting are bypassed, and reviewers must mentally resolve imports. It also signals machine-generated code that survived review.
- **Fix:** Replace with normal top-level imports (`import json`, `import uuid`) — all 12 sites are in modules that can import these at top level. Add a ruff rule (e.g. `TID`/custom check) or code-review check to prevent recurrence.

### F-QLT-06 — MEDIUM — Unhandled exceptions and worker failures produce no server-side log
- **Evidence:** `backend/app/errors.py:76-80` — `unhandled_error_handler` builds the 500 envelope without logging `exc` anywhere. `backend/app/jobs.py:146` uses `traceback.print_exc()` instead of logging inside `run_one_job`. Worker itself logs properly (`backend/worker.py:50-51`), but the failure detail of every unhandled API exception is dropped.
- **Impact:** In production, the only trace of a 500 is a request id handed to the user; operators cannot diagnose incidents from server logs. Job failures print to stdout without structure or correlation.
- **Fix:** In `unhandled_error_handler`, call `log.exception("unhandled error on %s %s", request.method, request.url.path, extra={"request_id": request_id})` (module logger); in `jobs.run_one_job`, replace `traceback.print_exc()` with `log.exception("job %s (%s) failed", job_id, kind)`.

### F-QLT-07 — MEDIUM — Password-reset token printed to stdout unguarded in all environments
- **Evidence:** `backend/app/routers/auth.py:521` — `print(f"[dev-mail] password reset token for {body.email}: {raw}")` with no `settings.environment` check. (Contrast: `config.py:31-32` explicitly marks dev-only defaults and requires override.)
- **Impact:** In any deployment profile, a raw single-use password-reset token for an arbitrary (attacker-chosen) email lands in process logs — a token-leak channel and a quality/ops hygiene problem even before being a security one.
- **Fix:** Gate on `settings.environment == "development"` and/or route through `log.debug`, and surface the link via the organizer console path documented in `docs/DEPLOYMENT_RUNBOOK.md`; never print raw secrets.

### F-QLT-08 — MEDIUM — Evaluator logic copy-pasted between `evaluator.py` and `evaluator_level.py`
- **Evidence:** `_submission` duplicated at `backend/app/evaluator.py:27-41` vs `backend/app/evaluator_level.py:33-47` (near-identical row shapes); `_candidates_for_version` duplicated at `evaluator.py:44-84` vs `evaluator_level.py:50-94` (~40 lines each, same SQL and mapping); the claim/evidence-ledger/`create_review_item` block duplicated at `evaluator.py:136-180` vs `evaluator_level.py:172-214`.
- **Impact:** The two scoring pipelines are the platform's core; any fix to matching/award semantics must be applied twice and will drift (they already differ subtly, e.g. only the level path re-marks duplicates at `evaluator_level.py:216`).
- **Fix:** Extract shared `evaluation_service.py` with `load_submission`, `load_candidates`, and `award_evidence_component(...)`; have both handlers call it (naturally also enables unit tests without jobs).

### F-QLT-09 — MEDIUM — `matching.decide` and `decide_multi` duplicate the scoring/threshold logic
- **Evidence:** `backend/app/matching.py:121-199` vs `202-270`: identical category-family scoring (160-165 vs 245-250), identical combined formula (166-168 vs 251-253), identical auto-accept thresholds `L >= 0.9 and C >= 0.6 and alias >= 0.2` / `L >= 0.9 and C == 0` (188-189 vs 262-263), identical duplicate/thin-report handling (185-186, 197-198 vs 259-260, 268-269).
- **Impact:** ~70 lines of the rule table exist twice; changing a threshold for one path silently diverges the other. The decision table is what `test_matching.py` pins, so drift will only surface as test-vs-production mismatch.
- **Fix:** Extract `_score_candidates(candidates, per_location_scores, category, report_text, rule_set)` and `_gate(scored)` used by both functions; keep only the location-scoring strategy different.

### F-QLT-10 — MEDIUM — Nine admin endpoints take untyped `body: dict` and hand-validate
- **Evidence:** `backend/app/routers/admin.py:107` (`set_event_status`), `292` (`control_stage`), `398` (`release_results`), `689` (`publish_challenge`), `855` (`record_test_results`), `916` (`time_adjustment`), `1019` (`set_readiness`), `1195` (`resolve_dispute`), `1262` (`manual_adjustment`) — all `body: dict` with `body.get(...)` and ad-hoc checks, in a codebase that otherwise uses Pydantic (`EventIn`, `StageIn`, `BugIn`, etc.).
- **Impact:** No schema validation/documentation for the highest-privilege surface; `int(body.get(...))` on caller input (e.g. `admin.py:359`, `859-860`, `918`) raises `ValueError` → raw 500 instead of 422 when a non-numeric value is posted; drift between hand checks is easy.
- **Fix:** Define Pydantic models (with `Field` constraints) for each; replace manual `int()` conversions; the VALIDATION_ERROR catalog codes stay as-is.

### F-QLT-11 — MEDIUM — Seed silently continues when a ground-truth anchor pattern is not found; Option-A ingestion duplicates the helper
- **Evidence:** `backend/seed.py:956-960` — `find_line` miss prints `WARNING: anchor pattern not found ...` and `continue`s, leaving the GT bug with **no primary location**; secondary locations are skipped with no message (`seed.py:977-978`). Separately, Option A's file ingestion is written inline at `seed.py:637-666` while Option B uses the identical `_ingest_challenge` helper (`seed.py:695`, `900-932`).
- **Impact:** A one-line drift in a challenge file (rename, reformat) silently produces an unmatchable GT bug — every report for it gets `location_score = 0`, skewing scoring for that challenge with no hard failure at seed time. The duplicated ingestion block doubles the chance the two paths diverge.
- **Fix:** Make a missing primary anchor a hard seed failure (exit non-zero), or at minimum skip the whole bug loudly with a summary count and non-zero exit; replace the inline Option-A block with a call to `_ingest_challenge` (it already matches the signature).

### F-QLT-12 — MEDIUM — ORM model layer is ~740 lines of dead code duplicating the SQL schema
- **Evidence:** `backend/app/models_app.py` (611 lines) — only `ScoreLedgerEntry` and `LeaderboardSnapshot` are imported anywhere (`backend/app/scoring.py:27`); the other ~35 classes are unreferenced. `backend/app/models_gt.py` (131 lines, `GtBug`, `GtLocation`, `GtAlias`, `GtFlag`) is imported by no module (grep across `backend/`). The real schema lives in `backend/migrations/0001-0003*.sql`.
- **Impact:** Two parallel definitions of the schema that can drift; ~740 lines of dead code inflate the codebase and mislead readers (e.g. `models_gt.py`'s `GtLocation` name-collides with the live `matching.GtLocation` dataclass).
- **Fix:** Either commit to the ORM (use models consistently and generate migrations from them) or delete both files and keep the two actually-used classes next to `scoring.py`; document the SQL migrations as the single schema source.

### F-QLT-13 — MEDIUM — Frontend test coverage: a single SSR XSS test for 6,348 lines of UI
- **Evidence:** `frontend/package.json:11` (`"test": "node --test"`) runs exactly one test file: `frontend/tests/submission_payload.test.mjs:7-29` (renders `SubmissionPayload` and asserts hostile markup is escaped). No tests exist for `lib/api.ts` (silent-refresh retry logic, lines 141-147), `lib/auth.tsx` (session restore/login), Workspace autosave/version-conflict recovery (`Workspace.tsx:188-239`), or any page component. `docs/TESTING_STRATEGY.md:98` admits "targeted rendering regression tests, not a full browser/component E2E suite".
- **Impact:** The most delicate frontend behaviors (token refresh race, draft-conflict recovery, submission payload construction) have no automated regression net; a regression ships green from CI.
- **Fix:** Add Vitest + Testing Library; priority tests: `api()` refresh-retry (401 AUTH_TOKEN_EXPIRED → one retry), draft DRAFT_VERSION_CONFLICT recovery, Workspace submit payload shape, auth context transitions.

### F-QLT-14 — MEDIUM — Docs report stale test counts and omit six test files
- **Evidence:** `docs/TESTING_STRATEGY.md:7,15,46` claims "38 tests" / "38 pytest test functions"; `docs/SECURITY_REVIEW.md:11` claims "34/34 pass". Actual: **74** test functions across 12 files (`backend/tests/test_*.py`), including six `test_flow_*` files (38 functions: flow submissions 5, gates 9, uploads 12, repo lock 6, auto-submit 6) that do not appear in the doc's per-file coverage table at all (`TESTING_STRATEGY.md:30-37`).
- **Impact:** The readiness/audit picture in the docs is materially out of date; reviewers following the doc will not audit the four-level flow tests, and "passing status must be taken from the CI run" (line 46) is undermined by a wrong inventory.
- **Fix:** Regenerate the per-file table and counts from `pytest --collect-only -q`; add a docs check (or CI step) that fails when the documented count drifts from the collected count.

### F-QLT-15 — MEDIUM — `Workspace.tsx` is a 963-line god component with a duplicated draft-hydration block
- **Evidence:** `frontend/src/pages/participant/Workspace.tsx:78-963` — one component with 20+ `useState`/`useRef` hooks mixing file tree, drag-select code viewer, find-in-file, server search, report form, flag form, submissions tab, autosave, and draft restore. The form-hydration-from-draft logic is copy-pasted: `Workspace.tsx:157-176` vs `215-227` (same 10-field mapping written twice).
- **Impact:** Highest-churn participant surface is hard to reason about and test; the duplicated hydration mapping will drift when a field is added (classic source of "draft restore drops a field" bugs).
- **Fix:** Extract `hydrateFormFromPayload(payload): Partial<ReportForm>` used by both call sites; split `FileTree`, `CodeViewer`, `ReportForm`, `SubmissionsTab` into components (state already largely local).

### F-QLT-16 — MEDIUM — Reviewer decision `needs_second_review` dead-ends the submission
- **Evidence:** `backend/app/routers/review.py:171-173` accepts `needs_second_review` in the decision pattern; line 201-208 maps it to submission status `in_review`, but line 226 immediately marks the review **item** `decided`, and the enqueued `apply_review_outcome` (`backend/app/evaluator.py:319-404`) has no branch for it (only accept_full/accept_partial/reject_invalid/unplanned_valid are handled).
- **Impact:** A submission decided `needs_second_review` stays `in_review` forever with no open review item — it disappears from every queue (`review.py:38` filters `status IN ('open','claimed')`) and can never be finished. Reviewers are offered a button that produces a dead end.
- **Fix:** Either remove `needs_second_review` from `DecisionIn`'s pattern (v1 scope), or on that decision insert a fresh open `review_items` row (priority bump) instead of marking the item decided.

### F-QLT-17 — MEDIUM — `release_feedback` is N+1 with a new gt session per submission and repeated stage-max queries
- **Evidence:** `backend/app/evaluator.py:499-528` — for every accepted submission it opens `with gt_session() as gts:` (line 502) and runs one query for bug points; the penalty loop calls `_stage_max_points(session, stage_id)` per team (line 545; definition 568-576 re-runs the identical SUM per iteration). Pool is 8 + 4 overflow (`config.py:27-28`).
- **Impact:** At results release with, say, 300 accepted reports, that is 300 short-lived sessions/connections plus per-team stage-max queries inside one long transaction — slow release, pool churn, and a long-held transaction on the biggest write path of the event's final minutes.
- **Fix:** Batch-fetch `gt_bugs.points` per challenge version in one query before the loop (map code→points); compute `_stage_max_points` once before the team loop.

### F-QLT-18 — MEDIUM — Frontend hand-copies the backend state machines
- **Evidence:** `frontend/src/pages/admin/Dashboard.tsx:31-38` (`EVENT_TRANSITIONS`) duplicates `backend/app/routers/admin.py:96-103`; `Dashboard.tsx:41-51` (`STAGE_ACTIONS`) duplicates `admin.py:279-305` mapping (comment even says "as implemented by the backend").
- **Impact:** When a transition or action is added server-side (e.g. a new `extend` rule), the organizer UI keeps offering stale/illegal actions until someone remembers to update the copy — exactly the drift class this event cannot afford mid-competition.
- **Fix:** Serve the transition maps from a small authenticated admin meta endpoint, or generate them into a shared TS constant from the backend source at build time.

### F-QLT-19 — MEDIUM — No startup guard against production running on dev-default secrets/DB URLs
- **Evidence:** `backend/app/config.py:32` (`jwt_secret: str = "dev-only-insecure-secret-replace-me"  # MUST be overridden...`) and lines 24-26 (dev DB URLs with known passwords). There is no validator or lifespan check that rejects these values when `environment == "production"` / `profile != "d0-local"`.
- **Impact:** A misconfigured production deployment boots cleanly and signs tokens with a constant that is public in the repository — the comment is the only defense. Quality-of-configuration issue with incident-grade consequences.
- **Fix:** Add a `@model_validator` (or lifespan assertion) that raises at startup if `jwt_secret` equals the default, or the DB URLs contain `app_api_dev`/`gt_admin_dev`, whenever `environment != "development"`.

### F-QLT-20 — MEDIUM — Concurrent audit writes can fork the hash chain, making `audit_verify` report a false break
- **Evidence:** `backend/app/audit.py:35-43` reads the previous hash for the scope with a plain `SELECT ... ORDER BY seq DESC LIMIT 1` (no lock), then inserts; `nextval('audit.entries_seq')` (line 49) serializes seq numbers but not the prev-hash read. `audit_verify` (69-95) recomputes the chain strictly in seq order.
- **Impact:** Two concurrent audited writes in the same `event_scope` (e.g. a submission and an auto-submit, or two participants) can both read the same `prev_hash`; the later-seq entry then fails verification, permanently reporting "broken_at" on an untampered chain — the tamper-evidence mechanism loses trustworthiness exactly during event-day concurrency.
- **Fix:** Serialize per-scope appends (e.g. `SELECT ... FOR UPDATE` on the last entry, an advisory lock keyed on the scope, or a single-writer path), or store and verify per-entry `prev_hash` rather than a recomputed running chain.

### F-QLT-21 — LOW — No-op role check reads as a restriction but is none
- **Evidence:** `backend/app/routers/state.py:47` and `100`: `require_role("participant", "reviewer", "organizer", "admin")(p)` — the argument list covers every role, so the call can never fail for an authenticated principal.
- **Impact:** Misleading code; a future reader may assume `/state` and `/config` are participant-restricted and "tighten" it incorrectly, or the useless call hides a missing intended restriction.
- **Fix:** Delete the calls (authentication via `get_principal` is the actual gate) or replace with a comment stating "any authenticated role".

### F-QLT-22 — LOW — Invalid `callable` type annotations and unbounded rate-limit bucket keys
- **Evidence:** `backend/app/jobs.py:117` `HANDLERS: dict[str, callable]` and `backend/app/deps.py:100` `def require_staff() -> callable:` use the builtin `callable` (a function, not a type) as an annotation — only parses because of `from __future__ import annotations`. `backend/app/deps.py:30-39`: `_bucket` truncates each key's hit list to 60 but never removes stale keys.
- **Impact:** Annotations are meaningless to type checkers (`callable` is not `Callable`); the in-memory limiter grows one dict entry per distinct identity/IP forever (bounded for a 50-person event, unbounded for adversarial IPs).
- **Fix:** Use `Callable[[dict], None]` / `Callable[..., Principal]` from `typing`/`collections.abc`; add periodic eviction of keys whose newest hit exceeds the window.

### F-QLT-23 — LOW — Function-level inline imports scattered across the backend
- **Evidence:** `backend/app/routers/admin.py:441` (`import secrets`), `480` (`import secrets`), `484` (`from datetime import datetime, timedelta`), `576` (`import os`), `823` (`from ..security import flag_code_hash`), `1082-1083` (`import csv`/`import io`); `backend/app/routers/levels.py:797, 1170, 1183` (`from ..config import settings`); `backend/app/security.py:140` (`import json`); `backend/app/routers/leaderboard.py:40`; `backend/app/routers/review.py:84`.
- **Impact:** Inconsistent import style hides dependencies, defeats isort (`I` is enabled in `ruff.toml:16` but cannot reorder function-level imports), and suggests patched-in code.
- **Fix:** Hoist all to module top level (no circular-import hazard exists for these); keep ruff `I` clean.

### F-QLT-24 — LOW — Backend runtime dependencies are lower-bound only, with no lockfile
- **Evidence:** `backend/requirements.txt` mixes one exact pin (`fastapi==0.165.0`) with `>=` bounds for everything else (`sqlalchemy>=2.0.44`, `pyjwt>=2.10.1`, `cryptography>=46.0.5`, ...); dev tools in `requirements-dev.txt` are exactly pinned, but there is no `requirements.lock` (frontend has `package-lock.json`; `challenge-app-option-b/requirements.txt` is all `>=`).
- **Impact:** CI and the event-day deployment can resolve different versions than the rehearsal machine; a transitive release between freeze and event day changes runtime behavior. `pip-audit` runs (`.github/workflows/ci.yml:53-54`) but that does not freeze versions.
- **Fix:** Add a compiled lock (`pip-compile requirements.in > requirements.txt` or `uv lock`) used by CI and the deployment runbook; keep audit flexibility only in the manifest.

### F-QLT-25 — LOW — Challenge fixtures: intentional parallel implementations with manual parity
- **Evidence:** `challenge-app/` (Node/Papyrus) and `challenge-app-option-b/` (Python/Marina) implement the same product and mirrored bug set by design (e.g. `challenge-app-option-b/routes/notes.py:38-64` comments say "mirrors Option A"; `backend/seed.py:55-58` states same bug count/severities/categories/points). Parity is maintained by hand via the `GT_BUGS` / `GT_BUGS_B` manifests in `seed.py` — no automated equivalence check exists.
- **Impact:** The bugs are intentional CTF content (not defects to fix); the residual quality risk is quiet divergence between the two options (a bug fixed in one but not the other, or a severity drift), which would invalidate the "equal difficulty" premise the two-repo design depends on.
- **Fix:** Add a small CI test asserting structural equivalence of the two seed manifests (bug count, per-bug severity/category/points) so drift is caught mechanically; document Option A/B parity ownership.

---

## Verification notes / clean areas

- **No bare excepts:** only 6 `except Exception` sites in `backend/app`, each with rollback semantics or an annotated anti-enumeration rationale (`db.py:53,66`; `jobs.py:145` with `noqa: BLE001`; `auth.py:234` with comment; ruff `BLE` enabled at `ruff.toml:21`). The `auth.py:234` broad catch does convert infrastructure failures into a generic 422 — acceptable for anti-enumeration, but consider catching only `IntegrityError`.
- **Transaction discipline is genuinely good:** submission insert + jobs + outbox + audit in one `app_session()` (`submissions.py:259-314`); stage rows locked before `clock_timestamp()` (`submissions.py:141-157`, `levels.py:919-928`); `refresh()` explicitly commits the family revocation before raising (`auth.py:308-311`).
- **Tests use a real PostgreSQL** (`tests/conftest.py:22-46`), reseed per test (order independence, line 50-55), clear the rate-limit bucket (58-65), and drain jobs in-process (`worker_drain`, 123-128) — no fake DB anywhere.
- **CI is comprehensively wired** (`.github/workflows/ci.yml`): gitleaks, ruff check+format, bandit -ll, pip-audit, pytest with `--cov-fail-under=65` against a Postgres 17 service, e2e journey, frontend audit/lint/test/build, docs hygiene (em-dash and placeholder bans).
- **Frontend API client is consistent** (`lib/api.ts`): one wrapper, envelope-aware errors, single-flight refresh; no `any`, `@ts-ignore`, or `as any` in `frontend/src` (grep clean).
- **Docs that check out:** SECURITY_REVIEW F-09 (`dangerouslySetInnerHTML` absent) verified by grep; SYSTEM_ARCHITECTURE's "outbox has no external consumer" matches `evaluator.py:631-643`; KNOWN_GAPS items (runner disabled, manual email, provisional caps) match code (`levels.py:1168-1178`, `auth.py:519-521`, `seed.py:95`).

---

## 5. Verification notes and artifacts

- All evidence citations reference the audit baseline HEAD `f1412b7eec6c92c4c168fd2b8a58182b34480387`; line numbers may drift after subsequent commits.
- The five highest-severity claims were manually re-verified after the streams completed (all confirmed): first-sign-in password claim (`backend/app/routers/auth.py:79-86`), raw reset token printed to logs (`backend/app/routers/auth.py:521`), penalty double-count (`backend/app/routers/leaderboard.py:105` and `:118`), admin/reviewer routes imported into the participant SPA bundle (`frontend/src/App.tsx:16-19`), unvalidated invite role (`backend/app/routers/admin.py:470-511`).
- Per-stream raw reports (status tables and finding lists) are embedded as section 4 above; machine-readable merged findings are kept alongside this report (`findings_all.json`).
- Every CRITICAL/HIGH finding and every per-stream medium/low group is filed as a GitHub issue labeled `audit` under the milestone "Audit Round 1", including the recommended fix for each finding.

*Report generated on 2026-11-27 by a 17-stream parallel audit; see section 2 for methodology, severity model and caveats.*

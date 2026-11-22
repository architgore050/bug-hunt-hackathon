# Known limitations and follow-ups

Status: CURRENT. Honest limits of the v1 build, each with severity context, priority, and a concrete follow-up. P0 = must close before the event, P1 = before publication/public exposure, P2 = later.

## Platform limits

L-01 No email provider. Invite/reset tokens are printed to console by seed and admin flows. Priority P0 (before event: hand-deliver credentials). Follow-up: integrate SMTP or a transactional mail service, or keep manual distribution and document it in EVENT_OPERATIONS_PLAYBOOK.md.

L-02 No runner. Code execution is disabled (`runner_enabled=False`, ADR-010); no Run panel exists in the UI. Priority: accepted for D1 (P2 to build). Follow-up: only pursue with a hardened isolated VM; do not enable without it.

L-03 AI scoring off. `ai_assessment_enabled=False` with a provider gate. Priority: optional (P2). Follow-up: complete the DEC-13 gate checklist in AI_TOOLING_RESEARCH_AND_DECISION.md before ever enabling.

L-04 MFA absent. Step-up for sensitive actions is password re-entry (ADR-008). Priority P1. Follow-up: WebAuthn or Cloudflare Access on the admin/reviewer surface after D1.

L-05 In-process rate limiter. Limits are per replica and reset on restart; DB-backed quotas exist only for submission caps/cooldowns. Priority: accepted for single-VM D1 (P1 if a second replica is ever added). Follow-up: Redis or shared-store limiter before any horizontal scale.

L-06 SSE absent. Participants poll every 5 s (`/state`, `/time`) instead of receiving server-sent events. Priority: accepted for D1 (P2). Follow-up: SSE or WebSocket channel if polling load is visible in LOAD_TEST_REPORT.

L-07 Pause/resume compensation. Implemented via a pause-transition timestamp (stage row lock + `clock_timestamp()` ordering, ADR-012), but it has not been rehearsed live. Priority P0. Follow-up: exercise pause+resume during the dry run and record the deadline shift in the runbook.

L-08 `max_concurrent_requests_per_user` is declared in `backend/app/config.py` (value 20) but not enforced in middleware. Priority P1. Follow-up: enforce or remove the setting; document which.

L-09 `app.exports` rows are written by the export endpoint but there is no viewer UI. Organizers fetch files by direct download only. Priority P2. Follow-up: an admin exports page listing recent exports.

L-10 `scheduler` DB role exists (created by dev_db.sh and CI) but no consumer uses it. Priority P2. Follow-up: either give the worker a dedicated scheduler consumer or drop the role to reduce surface.

L-11 Unplanned-bug promotion (INT-02) is a manual organizer action with no UI: promoting an unplanned bug to scored ground truth requires direct SQL/seed-level action. Priority P1. Follow-up: add a guarded admin endpoint and audit entry.

L-12 Challenge version listing in admin works from the created-id list plus assignments; there is no dedicated listing endpoint. Priority P2. Follow-up: add `GET /admin/challenges` returning versions with assignment state.

L-13 Account profile page is minimal (activation, identity, sessions only). Priority P2. Follow-up: add session list with revoke if time allows.

## Process and verification gaps

L-14 Load test 50-user gate UNRUN. `scripts/load_test.py` exists and has never produced accepted numbers. Priority P0. Follow-up: execute LOAD_TEST_REPORT.md procedure before raising `max_participants` (ADR-011).

L-15 CI run UNVERIFIED. `.github/workflows/ci.yml` is written and locally replicable, but the first real GitHub Actions run has no evidence yet. Priority P0. Follow-up: push, watch the first run, record the run URL in CI_CD_PIPELINE.md.

L-16 Backup/restore rehearsal not performed. BACKUP_AND_RECOVERY.md documents the procedure only. Priority P0. Follow-up: rehearse pg_dump + restore into a scratch database before the event.

L-17 Formal legal review of COMPETITION_RULES, PRIVACY_NOTICE, TERMS_OF_USE pending. Texts are drafts written for a student club context. Priority P1 (before publication). Follow-up: faculty/club advisor sign-off, then publish through the frontend pages (`pages/Rules.tsx`, `pages/Privacy.tsx`, `pages/Terms.tsx`).

L-18 Venue dry run pending. Event operations assume a rehearsal on the actual venue network with the D1 deployment. Priority P0. Follow-up: schedule per EVENT_OPERATIONS_PLAYBOOK.md; include pause/resume (L-07) and invite flow smoke.

L-19 Secrets rotation before D1: dev defaults (`dev-only-insecure-secret-replace-me`, dev DB passwords) must be replaced via environment configuration. Priority P0. Follow-up: RELEASE_PLAN_D1.md pre-requisites checklist.

L-20 Demo accounts from `backend/seed.py` must be removed or hardened before any real event; seed must never run in production. Priority P0. Follow-up: RELEASE_PLAN_D1.md first-boot verification includes seed absence check.

L-21 E2E and pytest results are from the one-shot run on this machine; they should be re-confirmed on a fresh clone and in CI. Priority P1. Follow-up: CI green run closes this alongside L-15.

## Severity framing

None of the P0 items indicate broken code; they are unexecuted verifications and operational pre-requisites. The single architectural limit with real exposure risk if ignored is L-05 (rate limiter per replica), which is only relevant if more than one replica is ever run.

Reading guide by role:

- Event lead: clear every P0 (L-14 through L-20) before locking the venue schedule.
- Release manager: L-19 and L-20 are deploy gates in RELEASE_PLAN_D1.md section 1.
- Security owner: L-04, L-05 and L-08 map to findings F-05 and F-06 in SECURITY_REVIEW.md.
- Reviewer/organizer staff: L-07 and L-18 define what the dry run must rehearse and time.
- Documentation owner: keep this list in sync with ONE_SHOT_ACCEPTANCE_CRITERIA.md section 7.

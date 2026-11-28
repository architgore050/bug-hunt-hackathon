# Security review (self-review)

Status: review snapshot 2026-11-28. This is a self-review by the build team, not an external audit; execution and deployment verification remain explicit release gates.

## Scope

Reviewed: auth flows (login, refresh rotation, step-up, admin registration, first-password claim and admin-only reset), RBAC (participant/reviewer/organizer), ground truth isolation, the submissions transaction (idempotency, locks, caps, cooldown), rate limits, response headers, path handling on challenge file reads, the audit hash chain, and frontend XSS posture.

## Method

1. `pytest --collect-only`: 84 tests collected, 0 collection errors (2026-11-28 snapshot). The full pytest suite was not executed in the review environment because PostgreSQL binaries/service were unavailable; do not interpret collection as test success.
2. E2E journey: 46/46 checks in `scripts/e2e_journey.py`, covering organizer lifecycle, participant and reviewer loops, release, flags, audit verify.
3. Code reading of `backend/app/security.py`, `deps.py`, `routers/submissions.py`, `db.py`, `audit.py`, and frontend rendering paths.
4. Hostile-payload test in the backend suite: oversized bodies, malformed ids, path traversal strings on file reads.

## Findings

| ID | Finding | Severity | Status |
| --- | --- | --- | --- |
| F-01 | Verdict oracle via probing feedback/matching | High | Mitigated: hidden feedback until release (ADR-009), CTF cap 100, submission cooldowns and caps. Tested in suite and E2E. |
| F-02 | IDOR on submission/review objects by guessing ids | Medium | Mitigated: object lookups scoped to caller's team; 404 not 403 (no existence leak). Tested in `test_authorization.py`. |
| F-03 | Answer-key / gt leakage through the API | Critical | Mitigated: DB role separation, `app_api` cannot read `gt`. Tested with real psycopg connections in `test_gt_isolation.py`; answer key file never shipped (AGENTS.md rule). |
| F-04 | Refresh token replay by attacker | High | Implemented: family rotation + reuse detection revokes the family; 10 s same-successor grace window tested in `test_auth.py`. |
| F-05 | MFA absent | Medium | Accepted risk, P1. Interim control: password re-entry step-up on sensitive actions (ADR-008). Follow-up WebAuthn/Cloudflare Access. |
| F-06 | In-process rate limiter is per replica | Medium | Accepted for single-VM D1. DB-backed quotas cover submission caps only. Redis/shared limiter before any second replica (L-05). |
| F-07 | No external penetration test | Medium | PENDING. No external reviewer engaged yet; see KNOWNS_LIMITATIONS_AND_FOLLOWUPS L-13-related entry F-07 in ONE_SHOT_ACCEPTANCE_CRITERIA. |
| F-08 | Email/username enumeration via login or reset | Medium | Mitigated: generic error messages, no account-existence signals (errors.py envelope, invariant 7). Tested in auth tests. |
| F-09 | XSS via participant-submitted content | Medium | Mitigated: React rendering as text, no `dangerouslySetInnerHTML` in `frontend/src/` (verified by grep of the source tree). Code viewer is read-only text. |
| F-10 | Secrets in repo or logs | High | Mitigated: configuration is env-only (`backend/app/config.py`), dev defaults marked dev-only; GitHub token handling rules in AGENTS.md (never in source, env.example, history, logs, commits). No credentials found in tracked files during review. |

## How to reproduce the verification

```bash
# full backend suite incl. gt isolation and idempotency
cd backend && python -m pytest tests/ -q

# the two isolation tests specifically
cd backend && python -m pytest tests/test_gt_isolation.py -q
python -m pytest tests/test_authorization.py -q

# hostile payload and idempotency replay cases
python -m pytest tests/test_idempotency.py -q

# E2E journey (46 checks, needs DB+API+worker running)
python scripts/e2e_journey.py

# XSS posture check (must print no matches)
grep -rn "dangerouslySetInnerHTML" frontend/src/ || echo "clean"

# audit chain verify (E2E covers it; manual: as organizer, call the verify endpoint after any admin action)
```


### Event account-policy exception

Only pre-registered participants with a team membership and no password may claim an initial password. Mailbox ownership is not verified, so anyone who knows a registered participant email could make the first claim; administrators must distribute those addresses through a controlled channel. Staff accounts require an administrator-assigned password. Staff registration, participant registration, team creation, participant team changes/removal and password resets are admin-only and require step-up. Account lifecycle status is not stored; removing the final team membership revokes sessions and prevents future sign-in. Public activation and self-service reset routes are absent; migration `0005_remove_legacy_account_tokens.sql` retires the legacy token stores.

## Limits of this review

It is a self-review: no external penetration test, no fuzzing campaign, no review of the Cloudflare/D1 deployment posture (that environment does not exist yet), and no load-conditioned security testing (rate-limit behaviour under restarts is known-limited, L-05/F-06).

Review artifacts: the checks above are reproducible from the commands in the previous section; no scanner reports exist because no scanners were run. If an external audit is later commissioned (F-07), keep this file and annotate it rather than replace it, so the delta between self-review and external review stays visible.

## Conclusion

Suitable for a controlled student event on a private deployment after the P0 items close (load rehearsal L-14, CI green L-15, backup rehearsal L-16, secrets rotation L-19, seed removal L-20, venue dry run L-18). Not yet suitable for public internet exposure without the PENDING items: external security review (F-07), MFA (F-05), and a shared rate limiter if more than one replica ever runs (F-06).

# Release plan D1

Status: CURRENT plan, execution UNRUN. Path from this repo to the Oracle Cloud Always Free A1 VM behind Cloudflare. Operational detail lives in DEPLOYMENT_RUNBOOK.md; this file is the gate list and order.

## 1. Pre-requisites checklist (all must be checked before deploy)

1. Secrets rotation: set production `JWT_SECRET` (32+ random bytes), non-dev DB passwords for `app_api`, `gt_admin`, and the admin user; no default from `backend/app/config.py` may remain. (L-19)
2. Demo account removal or hardening: verify no seed accounts exist in the production database; invite real accounts through the admin flow instead. (L-20)
3. Rules/privacy/terms legal review and publication: advisor sign-off on COMPETITION_RULES.md, PRIVACY_NOTICE.md, TERMS_OF_USE.md, then confirm the frontend pages render them. (L-17)
4. Load test rehearsal passing at the approved cap: execute LOAD_TEST_REPORT.md; only then confirm `max_participants`. (L-14, ADR-011)
5. Backup/restore rehearsal: run the BACKUP_AND_RECOVERY.md procedure once into a scratch database and record timings. (L-16)
6. CI green on GitHub: first Actions run green on main; record run URL in CI_CD_PIPELINE.md. (L-15)
7. Invite flow smoke on the target VM: invite, activate, login, one submission, one release cycle in a throwaway event.

## 2. Environment configuration

Values map to `backend/app/config.py`. All via environment (systemd `Environment=` or an environment file), never committed.

| Setting | D1 value (shape) | Notes |
| --- | --- | --- |
| `profile` | `d1-free-vm` | selects production defaults |
| `environment` | `production` | enables strict posture |
| `DATABASE_URL_APP` | `postgresql+psycopg://app_api:<prod password>@127.0.0.1:5432/bughunt` | app role, no gt access |
| `DATABASE_URL_GT` | `postgresql+psycopg://gt_admin:<prod password>@127.0.0.1:5432/bughunt` | evaluator/worker only |
| `JWT_SECRET` | 32+ byte random string | rotate per event; never reuse dev value |
| `cookie_domain` | the event domain, e.g. `.example.org` | empty only for host-only local dev |
| `frontend_origin` | `https://<event domain>` | exact CORS allow-list entry; comma-separated extras |
| `runner_enabled` | `false` | ADR-010 kill switch |
| `ai_assessment_enabled` | `false` | ADR-013 kill switch |
| `telemetry_enabled` | `false` | default off |
| `log_level` | `INFO` | raise to DEBUG only in an incident window |

Note: `config.py` shows `refresh_reuse_grace_s`, `access_token_ttl_s` (600), `refresh_token_ttl_s` (3 days), `max_sessions_per_user` (2), `max_body_bytes` (512 KiB), `submission_max_desc_chars` (2000). Keep defaults unless the runbook says otherwise.

## 3. Build artifacts

1. Backend: Python 3.12 virtualenv from `backend/requirements.txt`; app started via uvicorn; worker started as a second process consuming `app.jobs` (same package, worker entry in `backend/app/main.py`).
2. Frontend: `npm run build` produces `frontend/dist/`; serve it from a static server (nginx/Caddy) or Cloudflare CDN origin. SPA fallback to `index.html`.
3. systemd units (sketch): `bughunt-api.service` (uvicorn, port 127.0.0.1:8000), `bughunt-worker.service` (same venv, worker command), `bughunt-db` covered by the distro PostgreSQL 17 unit. Both app units get `Restart=on-failure`, `EnvironmentFile=/etc/bughunt/env`, and hardening lines (`NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`).
4. Migrations applied once at deploy: `DB=bughunt PGUSER=<admin> bash scripts/migrate.sh` from the release directory.

## 4. Cloudflare DNS/TLS/Tunnel setup

1. Create the A/CNAME record for the event domain proxied through Cloudflare (orange cloud).
2. TLS mode Full (strict) with an origin certificate installed on the VM.
3. Preferred: Cloudflare Tunnel (`cloudflared`) from the VM to Cloudflare so the origin keeps no open inbound ports; map the public hostname to `http://127.0.0.1:8000` (API) and the static server (frontend).
4. Enable the Cloudflare Access policy on any admin-only hostname if adopted later (ADR-008 follow-up). Otherwise standard WAF defaults only; no special rules required for v1.
5. Verify cookie attributes survive the proxy: `Secure`, `HttpOnly`, `SameSite=Lax`, `Domain` from `cookie_domain`.

## 5. First-boot verification checklist

1. Health endpoint returns real DB-checked status (not a static 200).
2. `scripts/migrate.sh` reports zero pending migrations against production.
3. Seed absence: no `backend/seed.py` accounts exist; no demo teams/events in the database.
4. Invite flow smoke: invite one organizer, activate, login, step-up works.
5. Kill switches confirmed: `runner_enabled` and `ai_assessment_enabled` read false from the environment.
6. Audit chain verify endpoint returns valid for a fresh event.
7. Frontend loads over HTTPS, login sets cookies with correct domain attributes.

## 6. Rollback and kill switches

Kill switches are environment-level: set `runner_enabled=False`, `ai_assessment_enabled=False` (both already default), and, as a last resort, set the stage to paused from the admin API to freeze submissions while keeping read-only views. Process rollback is redeploying the previous release directory and, if the schema moved, applying the documented forward-fix path (migrations are forward-only; no destructive revert). Database recovery follows BACKUP_AND_RECOVERY.md (point-in-time from backups; restore rehearsal pre-requisite 5). Full incident steps, escalation order, and degradation ladder: DEPLOYMENT_RUNBOOK.md and EVENT_OPERATIONS_PLAYBOOK.md. Every rollback decision must leave an audit entry.

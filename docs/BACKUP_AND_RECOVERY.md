Status: describes the implementation as of 2026-11-22

# Backup and Recovery

Aligned with the D1 profile rules from the master docs:

- RPO/RTO are MEASURED in drills, never promised in advance.
- A backup is not real until it has been restored.
- "Backups never restored" is risk DAT-10 and its drill is a readiness gate.

## 1. What is durable

Everything that matters lives in PostgreSQL 17 (single database, e.g. `bughunt`):

- Schema `app`:
  - users, sessions, refresh tokens, events, stages, time adjustments, teams, invites.
  - challenge files and line index, assignments, drafts, submissions.
  - review items, reviews, disputes, award claims, the append-only score ledger, leaderboard snapshots.
  - announcements, jobs, outbox events, config revisions, rules documents, readiness items, exports (table present; the export endpoint currently returns CSV without persisting).
- Schema `gt`: ground truth (bugs, locations with anchor hashes, aliases, flag hashes, revisions).
  - Highest-sensitivity data; it must not land in any non-private location.
- Schema `audit`: the hash-chained audit log.

## 2. What is disposable

- API and worker processes: stateless; a restart reconstructs nothing but reconnects.
  - Worker in-flight jobs are recovered by the lease-expiry requeue (`jobs.requeue_expired_leases`).
  - At-least-once delivery is safe because outcomes are idempotent (unique `award_claims`, `_has_component` checks).
- Frontend build output and any static hosting: rebuilt from `frontend/` sources.
- Containers/VM: rebuildable; only the data volume and the env/secrets file need preserving.
- Dev artifacts: `bughunt_test` database, seed outputs, logs.
- Challenge source of truth additionally lives in git (`challenge-app/`) and with the organizers.
  - The DB copy of participant files can be rebuilt by re-uploading, but for a live event the DB copy is the served truth and is included in backups.

## 3. Current backup posture (honest)

As of 2026-11-22 the repository contains NO automated backup job, no WAL archiving configuration and no restore script.

- On D0, backups are manual.
- The master D1 target (base backups plus continuous WAL archiving to a separate provider/account, encrypted, keys with two custodians) is the required production posture and is work to do before an event.
- The readiness item `backup_restore` ("Backup/restore rehearsal completed and measured") blocks going live while unchecked.

## 4. pg_dump / restore procedure (manual, works today)

Take a backup (as the database owner or any read-capable role, from the DB host):

```bash
PGUSER=pgadmin pg_dump -h 127.0.0.1 -p 5434 -d bughunt -Fc -f bughunt_$(date -u +%Y%m%dT%H%M%SZ).dump
```

Notes:

- `-Fc` gives a compressed custom-format dump including all three schemas.
- Add `--schema=gt` dumps when the answer key must be stored separately under stricter custody.
- Store the dump outside the database host (separate provider/account), encrypted client-side; two custodians for the key.
- Never place ground truth in a public bucket.
- Roles and cluster settings are NOT in a plain `pg_dump`: record `app_api` / `gt_admin` / `pgadmin` credentials and the grant SQL (the grant block in `scripts/dev_db.sh`, with production passwords) alongside the dump.

Restore into a clean environment:

```bash
createdb -h 127.0.0.1 -p 5434 bughunt_restored
pg_restore -h 127.0.0.1 -p 5434 -d bughunt_restored --no-owner -Fc bughunt_<ts>.dump
# recreate roles/grants (dev_db.sh grant block with production passwords), then sanity-check:
psql -d bughunt_restored -c "SELECT count(*) FROM app.submissions; SELECT count(*) FROM gt.gt_bugs;"
```

Post-restore verification checklist (master guide 17.2):

1. Foreign keys valid; ledger totals reconcile against the exported CSV.
2. Audit chain verifies intact (`GET /v1/admin/audit/verify`).
3. Leaderboard snapshots present.
4. Ground-truth role test passes (`tests/test_gt_isolation.py` against the restored database).
5. One synthetic participant journey completes.

## 5. Rehearsal record (the placeholder that must be replaced by measurement)

- Rehearsal status: UNRUN as of 2026-11-22.
- No restore drill has been executed; no RPO or RTO number exists yet and none may be claimed.
- When run, record here and in the readiness evidence:
  - dump size and duration;
  - restore duration;
  - recovered timestamp;
  - measured data-loss window (RPO = time since last dump at drill time);
  - total RTO;
  - verification results and operator names.
- Then check the `backup_restore` readiness item.
- Until a drill passes, the honest statement is: RPO equals the manual dump interval (currently unbounded), RTO equals manual operator work time (unmeasured).

## 6. RPO/RTO statements consistent with the D1 profile

- No zero-loss claims.
- The profile has a single failure domain; a lost host loses everything since the last dump unless WAL archiving is implemented.
- Recommended production posture (from the master docs, to implement before the event):
  - nightly base backups plus continuous WAL archiving to a separate account;
  - alerting on archive lag and failed uploads;
  - pausing submissions if the archive falls behind the accepted RPO.
- With that in place, RPO becomes the archive lag (measured, typically seconds to minutes) and RTO is the restore-VM drill time (target one hour including verification, proven by the drill rather than asserted).
- Do not claim 99.9% availability, RPO 0 or any RTO number until drills meet the target repeatedly (master guide, explicit rule).

## 7. Audit checkpoint export

The audit chain is tamper-evident only up to the last externally anchored checkpoint; an attacker who controls the database could rewrite the whole chain (architecture 9.5).

- D1 mitigation to implement:
  - At a fixed interval during the event (master docs suggest at least once per minute or every 1,000 entries), export `SELECT ... FROM audit.entries ORDER BY seq` per scope plus the chain head (`scope, seq, hash`) to a separate storage account with object retention.
  - Sign the checkpoint with a key kept outside the database.
- The live verification endpoint (`GET /v1/admin/audit/verify`) remains the in-database check.
- The external checkpoint bounds how far back tampering can hide.
- This export job does not exist yet; it is a pre-event deliverable, not a v1 capability.

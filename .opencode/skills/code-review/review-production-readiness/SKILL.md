---
name: review-production-readiness
description: Operability and release-safety lens for code review. Use for database migrations, queries, indexes, queues, workers, schedulers, network calls, storage, caching, flags, config, logging, metrics, deploy/CI/infrastructure, performance-sensitive paths, or dependencies. Also use when the user asks "is this safe to ship", "can we roll this back", "what happens during the event", "will this scale", "do we have enough observability", or wants a pre-event readiness review.
---

# Production Readiness Review

Correct unit-tested code can still fail during a live event. Ask how the change behaves under restart, duplicate delivery, slow dependencies, mixed versions, and venue conditions.

Read [`../references/bughunt-review-policy.md`](../references/bughunt-review-policy.md). Findings use the shared format and severity scale from `code-review`. Skip sections the change does not touch.

## 1. Observability

- Structured logs include request/entity context without secrets, tokens, participant report text, or restricted answers.
- Errors are logged once at the boundary with cause, not repeatedly at every layer.
- Metrics or operational checks reveal error rate, latency, queue depth/age, worker progress, and business outcomes where relevant.
- Audit entries capture state-changing security, scoring, and administrative actions in the same transaction.
- Health checks reflect readiness, not just process liveness.
- Alerts and dashboards are actionable and linked to a runbook. A new critical path with no diagnosis signal is **major**.
- Event operators can distinguish "working", "busy", "paused", and "silently doing nothing".

## 2. Failure modes and resilience

For every database, queue, storage, network, and challenge-app interaction, examine slow, unavailable, error, malformed, and duplicate outcomes.

- Timeouts and limits are explicit.
- Retries are capped and only wrap safe operations.
- Queue handlers are idempotent under at-least-once delivery.
- Overlapping scheduler runs cannot double-submit or double-score.
- Backpressure and concurrency are bounded.
- One failed team, stage, or job does not stop unrelated work.
- Graceful degradation is honest. A fallback must not invent a verdict, score, deadline, or success state.
- Startup and shutdown handle migrations, worker drains, and in-flight transactions safely.

## 3. Data safety and migrations

- Migrations are ordered SQL files, forward-only, and expand/contract.
- Old and new application versions can coexist during deployment.
- DDL lock duration and table rewrite risk are considered against realistic data size.
- Backfills are batched, resumable, throttled, idempotent, and observable.
- Destructive changes have a forward fix, backup/restore path, and explicit scope confirmation.
- Constraints enforce award uniqueness and ledger immutability.
- Score corrections are linked entries, never mutation.
- Ground-truth grants remain isolated after every migration.
- New personal data has access controls, retention, and deletion behavior.

A migration incompatible with the running version, irreversible scoring corruption, or a grant exposing `gt` to `app_api` is **blocker**.

## 4. Submission and worker safety

Trace the complete transaction and delivery path:

1. Idempotency reservation.
2. Stage row lock.
3. Single `clock_timestamp()` read.
4. Validation in order: paused, not active, ended, caps, cooldown, schema.
5. Persisted receipt and audit state.
6. Atomic commit.
7. At-least-once worker delivery.
8. Evaluation and hidden feedback.
9. Release-time scoring.

Check process death at each boundary. A retry must return the original receipt, not create a second scoring opportunity. Deadline auto-submit must be deterministic, deduplicated, and safe when the scheduler overlaps itself.

## 5. Performance and capacity

- Look for unbounded queries, N+1 access, per-item network calls, missing pagination, oversized payloads, and repeated expensive work.
- Check database pools, worker counts, queue consumers, file descriptors, memory, and storage growth.
- Cache keys include team, user, stage, locale, and authorization context where relevant.
- Authorized data is not cached under a shared key.
- Costly loops and hostile inputs have quotas or caps.
- Capacity and latency claims point to a current measurement. Otherwise they are provisional.
- Load tests reflect the venue profile: shared network, offline operation, concurrent teams, polling, and worker behavior.

## 6. Rollout and rollback

- How does the change reach operators: direct deploy, flag, canary, or staged rollout?
- What is the rollback, and is it safe after new data has been written?
- Can an event be paused without losing drafts, receipts, or queue work?
- Are configuration and secrets provisioned before deploy?
- Do settings have safe defaults and startup validation?
- Does the system work with production-like timezone, TLS, proxy, filesystem, and multi-process assumptions?
- Are API, queue, and serialized-data contracts compatible across mixed versions?

## 7. Event-day operation

- The platform can start, pause, resume, end, release feedback, and export results without manual database edits.
- Database restore and worker recovery are rehearsed or explicitly marked unverified.
- The official event preset is reflected consistently in seed, UI, rules, and runbooks.
- Development mail behavior and demo credentials cannot leak into a real event.
- Offline-network assumptions and recovery steps are documented.
- Readiness items are not checked without evidence.

## Output

End with a short readiness note:

- What was verified and how.
- Remaining risks and owners.
- Rollback or forward-fix story in one sentence.
- First signals to watch after deploy, with expected values.
- Unverified capacity, backup, security, or rehearsal claims.

## Severity guidance

| Situation | Typical level |
|---|---|
| Migration breaks running version, irreversible corruption without recovery, duplicate scoring under retry, ground-truth grant leak, no limit on a critical external call | blocker to major |
| No useful logs for a critical path, unbounded queue, unsafe rollback, cache key missing team, scheduler overlap can double-submit | major |
| Missing non-critical metric, log noise, small-data index concern, config validation gap | minor |
| Log wording or operational style preference | nit |

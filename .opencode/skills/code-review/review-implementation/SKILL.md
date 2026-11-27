---
name: review-implementation
description: Implementation-quality lens for code review. Use for line-level review of correctness, edge cases, error handling, concurrency, async behavior, transactions, resource leaks, performance pitfalls, complexity, readability, naming, comments, type safety, duplication, and library API misuse. Use whenever the user asks "is this correct", "any bugs", "review my function or PR", "is this clean", "can this be simplified", or hands over a diff for general review.
---

# Implementation Review

This lens asks whether the code does what it claims on every path that can happen, in a way the next engineer can understand and safely change.

Read [`../references/bughunt-review-policy.md`](../references/bughunt-review-policy.md). Findings use the shared format and severity scale from `code-review`.

## 1. State intent, then trace it

Write the intended behavior in one sentence. Walk the happy path and each boundary below using concrete input. Prefer a test or reproduction when practical.

## 2. Correctness checklist

### Inputs and boundaries

- Empty, null, zero, one, many, maximum, duplicate, unsorted, and malformed values.
- Off-by-one errors in spans, line ranges, pagination, caps, and arrays.
- Numeric hazards: overflow, truncation, floating-point scoring, division by zero, rounding, unit mismatch.
- Text hazards: Unicode, normalization, byte versus character length, case folding, line endings, trailing whitespace.
- Time hazards: timezone, DST, clock skew, naive versus aware datetimes, repeated `now()` calls, expiry comparisons.
- Upload and path boundaries: size, content type, absolute paths, traversal, NUL bytes, symlinks, duplicate names.

### Control flow and state

- Every enum, stage, level, role, and feedback state has an intentional branch.
- Early returns do not skip rollback, audit writes, lock release, or cleanup.
- Flags cannot end in contradictory combinations.
- Conditions, precedence, truthiness, equality, and identity are used correctly.
- Retries, double clicks, duplicate queue delivery, and replayed requests remain correct.
- Client fields cannot override server-resolved assignment, identity, deadline, gate, verdict, or score.

### Error handling

- No empty catch, bare pass, ignored error code, or silent conversion of failure to success.
- Catch the narrowest meaningful exception.
- Errors use `backend/app/errors.py` and a stable catalog code.
- Responses and logs omit stack traces, secrets, tokens, and account-existence signals.
- Cleanup runs on every exit path.
- Multi-step operations roll back or compensate on partial failure.
- Retries are capped, use backoff and jitter where appropriate, and wrap only safe operations.
- External calls have timeouts and bounded payloads.

### Concurrency and transactions

- Shared state has synchronization or database enforcement.
- Check-then-act races are removed with locks, constraints, or atomic operations.
- Submission handling reserves the idempotency key first, locks the stage row, reads `clock_timestamp()` once, validates in the required order, and commits atomically.
- Lock order is consistent; locks are not held across slow external calls without justification.
- Transaction scope includes every read that informs a protected write.
- Queue handlers are idempotent and safe under at-least-once delivery.
- Award uniqueness and ledger immutability do not depend solely on application checks.
- Audit entries and domain changes commit together where required.
- Cancellation, worker shutdown, and process death leave recoverable state.

### Resources and performance

- Files, connections, sockets, listeners, locks, and temporary resources are released.
- Caches and in-memory maps have bounds and invalidation rules.
- Queries avoid unbounded result sets, N+1 patterns, and per-item network calls.
- User-controlled work cannot create unbounded CPU, memory, storage, or task fan-out.
- Do not micro-optimize. Require a hot path or measurement for performance claims.

### API and library use

- Functions, methods, flags, and packages exist in the versions used.
- Return values and error semantics match the library's documented behavior.
- SQL uses bound parameters and explicit UUID casts where repository conventions require them.
- Existing helpers are reused instead of reinvented.
- FastAPI dependencies and Pydantic models enforce validation at the boundary.

## 3. Repository-specific traces

- Auth: principal lookup, token version, session revocation, role checks, step-up freshness, refresh rotation.
- Submissions: idempotency conflict, original receipt replay, cooldown, caps, hidden feedback.
- Levels: server-owned pointer, gate state, repository lock, artifact validation, no-backtracking.
- Scoring: deterministic matching, capped bonuses, reversal linkage, unique claims, tie-breaking.
- Challenge access: assignment ownership, normalized paths, database-backed file list, restricted-key exclusion.
- Worker: claim/retry behavior, duplicate delivery, scheduler overlap, deadline auto-submit.
- Frontend: typed API boundary, draft reconciliation, timer display, no participant HTML rendering.

## 4. Clarity and maintainability

- Main logic is understandable in one pass.
- Names reveal intent and units.
- Comments explain why, constraints, and tradeoffs rather than narrating code.
- Types prevent invalid states where practical.
- Dead branches, unused parameters, and duplicated blocks are removed.
- Magic thresholds are named or tied to documented rules.
- Logging is useful and safe, not noisy or a substitute for errors.
- Style follows surrounding code; defer to lint and formatting tools.

## Calibration

- A realistic-path correctness or integrity bug is **major** or **blocker** based on blast radius.
- Wrong scoring, participant access to restricted truth, corruption, or a broken main event flow is **blocker**.
- Readability issues are **minor** unless they hide a bug.
- If a bug cannot be established, ask a `question` with the specific input or state that causes concern.
- Review removed code carefully. Deleted validation, checks, error handling, and tests deserve extra scrutiny.

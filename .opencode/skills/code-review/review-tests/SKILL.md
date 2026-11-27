---
name: review-tests
description: Test-quality lens for code review. Use to judge whether tests catch regressions, whether coverage is meaningful, and whether tests are flaky, over-mocked, brittle, tautological, or missing for risky behavior. Use for any PR with or without tests, security-boundary changes, database invariants, scoring and submission races, frontend rendering safety, or when the user asks "are these tests good", "is this well tested", "what is missing", "why are tests flaky", or "grade my tests".
---

# Test Quality Review

A test is valuable when it fails if behavior breaks and stays green when behavior does not. Test counts and coverage numbers alone prove neither.

Read [`../references/bughunt-review-policy.md`](../references/bughunt-review-policy.md). Findings use the shared format and severity scale from `code-review`.

## 1. Map behavior to tests

List changed behaviors: branches, fixes, errors, permission checks, state transitions, races, and boundaries. For each, identify the test that fails when the behavior is wrong.

- A bug fix needs a regression test that fails without the fix. Verify red against the base when practical.
- Negative and boundary paths matter: invalid input, denied access, expired time, duplicate delivery, dependency failure, concurrent calls.
- Security tests assert that team A cannot access team B's resource and that `app_api` cannot access `gt`.
- Missing tests for auth, scoring, data integrity, submission atomicity, or concurrency are **major**.

## 2. Mutation thinking

For key changed lines, ask what happens if a condition flips, `<` becomes `<=`, a constant replaces a result, a validation disappears, or an exception is swallowed.

- If a mutation would survive, record the gap.
- Use a scratch copy or reversible Git operations only. Restore all code afterward.
- Do not mutate a shared database or production-like state.
- Tests that execute code without asserting the relevant outcome are decorative.

## 3. Rubric

Score each dimension 0 to 3 with one sentence of evidence.

| Dimension | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| Behavior coverage | Core behavior untested | Happy path only | Main and some edge paths | Boundaries, errors, races, regressions |
| Fault detection | Passes with broken code | Catches blatant breaks | Catches most key mutations | Known failure shapes reliably caught |
| Refactor resilience | Breaks on internal change | Coupled in places | Mostly observable behavior | Behavior-focused |
| Determinism and speed | Flaky or order-dependent | Timing or sleep reliance | Stable and reasonably fast | Hermetic, isolated, fast |
| Clarity | Opaque setup | Intent needs digging | Clear scenario and assertion | Failure identifies the broken behavior |

Report scores and the single change that would most improve the lowest dimension. If no test change is needed, say so.

## 4. Repository-required evidence

Match the test layer to the risk:

- Pure matcher and scoring math: focused unit tests.
- SQL grants, constraints, triggers, and transaction races: real PostgreSQL integration tests.
- HTTP auth, ownership, validation, and response shape: API tests through the application.
- Queue retries and worker drains: deterministic worker tests.
- Participant content rendering: frontend SSR or DOM tests with hostile markup.
- Full participant journey: `scripts/e2e_journey.py` against a running stack.

Specific high-value cases include:

- Same idempotency key and payload returns the original receipt, including after deadline.
- Same key with a different payload conflicts.
- Concurrent claims for one award unit produce one winner.
- Ledger update/delete is denied and reversal linkage is enforced.
- Participant feedback remains coarse until release.
- `app_api` cannot read or write `gt`; the positive admin control still works.
- The platform never lists or serves `ORGANIZER_ANSWER_KEY.md`.
- Foreign submission IDs return the same not-found behavior as unknown IDs.
- Client-supplied identity, assignment, deadline, gate, verdict, and score fields cannot change server decisions.
- Submission validation occurs in the documented order with one clock read.
- Markdown-looking participant text is escaped, not interpreted as HTML.

## 5. What good looks like

- Assert returned values, persisted state, emitted events, and externally visible effects.
- Mock at an owned seam; do not mock the behavior under test.
- Use real PostgreSQL for SQL semantics and permissions.
- Inject clocks and randomness. No real network or fixed sleeps.
- Isolate database state and in-process rate-limit buckets.
- Use unique temporary resources and avoid test-order dependence.
- Give each test one reason to fail and a scenario-revealing name.
- Make Arrange, Act, Assert visible.
- Use contract tests for client/server schema drift.
- Add property or fuzz tests for parsers, serializers, and algorithms with clear invariants.

## 6. Anti-patterns

| Pattern | Why it is a problem |
|---|---|
| Test deleted, skipped, weakened, or changed to match possibly wrong output in the same PR | Hides the regression the test should catch |
| Only assertion is that a mock was called | Verifies setup, not behavior |
| Expected value computed with the same logic as the implementation | Tautology |
| No assertion or only "does not throw" | Executes without verifying |
| Large snapshots rubber-stamped on update | Reviewers stop reading failures |
| Private call order asserted as behavior | Breaks safe refactors and misses real defects |
| Real clock, network, sleep, shared global state, or order dependence | Flakiness |
| Giant test covering many unrelated behaviors | Opaque failures |
| Broad exception handling around assertions | Swallows failures |
| Coverage-chasing tests with no outcome check | Inflates metrics without protection |
| Mocked database used to prove SQL permissions or constraints | Cannot prove database behavior |

## 7. Coverage and flaky suites

Use branch coverage on changed lines to find untested paths. Do not praise a global percentage by itself or invent a threshold.

For flaky tests, reproduce repeatedly and under parallel or randomized order when available. Inspect time, randomness, shared state, async races, and external dependencies. Fix the cause. Retries and sleeps only hide it; quarantine needs an owner and tracked follow-up.

## Severity guidance

| Situation | Typical level |
|---|---|
| Risky auth, scoring, ground-truth, or submission behavior untested; regression test removed; database invariant tested only with mocks | major |
| Tests removed to conceal a failure, or a risky change ships with no meaningful protection | blocker when integrity is at stake |
| Surviving mutants on core logic, introduced flake, over-mocked integration seam | major to minor |
| Low-risk edge case, naming, minor duplication | minor or nit |

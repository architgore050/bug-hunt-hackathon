---
name: review-content-quality
description: Challenge-content and participant-copy lens for code review. Use when reviewing challenge-app or challenge-app-option-b fixtures, planted defects, participant-visible file lists, challenge READMEs, instructions, hints, rules, handbooks, feedback text, examples, scoring explanations, or the seed and API paths that publish them. Judges intentional-defect fidelity, reproducibility, solvability, difficulty, scope, answer leakage, restricted-material handling, copy accuracy, accessibility, and audit evidence. Use when the user asks whether a challenge is fair, solvable, correctly seeded, safe to publish, or free of accidental answers.
metadata:
  owner: bughunt
  version: "2.0"
  evidence_date: "2026-11-27"
---

# Challenge Content Quality Review

A CTF artifact can compile and still be unfair, unsolvable, misleading, or accidentally reveal its own ground truth. This lens reviews the challenge and the participant experience, not only the diff.

Read [`../references/bughunt-review-policy.md`](../references/bughunt-review-policy.md). Findings use the shared format and severity scale from `code-review`.

## Trust boundary

Do not open `challenge-app/ORGANIZER_ANSWER_KEY.md` during an ordinary review. `docs/CHALLENGE_DESIGN_AND_GROUND_TRUTH.md` also restates restricted organizer material; open it only when the user explicitly authorizes an organizer-side ground-truth review.

Review these boundaries instead:

- The participant-visible file list in `backend/seed.py` and the equivalent admin ingestion path.
- Assignment and file APIs.
- The `app_api` database role and `backend/tests/test_gt_isolation.py`.
- Frontend bundles and participant responses for restricted strings or per-bug data.
- Release gating for verdicts, matched codes, and points.

Never copy restricted answer material into a finding, report, screenshot, fixture, or participant-facing file.

## When to apply

| Signal | Examples |
|---|---|
| Challenge fixture changes | `challenge-app/**`, `challenge-app-option-b/**`, seeded database content, route behavior, browser code |
| Planted-defect intent changes | Add, remove, move, weaken, strengthen, or accidentally repair a seeded defect |
| Participant instructions change | Challenge README, rules, handbook, hints, UI copy, error messages, examples |
| Publication or ingestion changes | Participant file list, challenge version instructions, assignment content, exports |
| Feedback or explanation changes | Reviewer guidance, post-release feedback, scoring explanations, dispute text |
| The user asks about fairness or readiness | "Is this solvable?", "Does this leak an answer?", "Is the challenge audited?", "Can we publish this?" |

## When not to use this lens

- General documentation freshness: use `review-docs-sync`.
- Visual style and component architecture: use `review-architecture` and the frontend design doc.
- Infrastructure and deployment: use `review-production-readiness`.
- Pure backend refactors that cannot change challenge output: use implementation and tests.
- Platform security: use `review-security`, with this lens for participant-copy consequences.
- An organizer-only ground-truth edit without explicit authorization: stop and ask for scope.

## Core review rules

1. **Planted defects are intentional.** Do not report a documented seeded weakness as an accidental production bug. Review whether it remains reproducible, correctly scoped, and matched by the intended scoring contract.
2. **Unplanned defects are real.** A crash, dead end, data-loss path, or behavior outside the intended defect set can make the challenge unfair. Report it with reproduction and participant impact.
3. **Promises define discovery.** The participant README and instructions must describe expected behavior without naming the planted defects or their fixes.
4. **Solvability needs evidence.** Trace setup, trigger, diagnosis, repair, and verification. A defect that cannot be reached from the participant package is not a valid award unit.
5. **Difficulty must fit the event.** The official round is 180 minutes for teams of 4 to 5. Require a playtest or mark difficulty claims provisional.
6. **Answers stay separated.** No instructions, hints, source comments, UI states, logs, API responses, or bundles may expose restricted per-bug answers before release.
7. **Challenge danger stays local.** Intentional exploit surfaces must remain confined to the provided app and local data. They must not attack the platform, venue network, other teams, or external systems.
8. **Participant content stays inert.** Reports, comments, notes, markdown, and uploaded artifacts are text, never executable HTML on the platform.
9. **Do not fabricate audit evidence.** Two-reviewer certification, playtests, and readiness checks need named, dated evidence.

## Review order

1. **Identity and scope:** correct challenge, version, repository option, event rules, and participant package.
2. **Intent fidelity:** every intended defect still exists; no unintended repair or extra defect changes the game.
3. **Reproducibility and solvability:** setup, trigger, diagnosis, repair, and verification are reachable.
4. **Instructions and fairness:** promises, hints, examples, and difficulty support the intended discovery loop.
5. **Leakage and safety:** restricted answers, verdicts, external side effects, and unsafe rendering are absent.
6. **Scoring and evidence:** locations, aliases, test cases, caps, and audit records align with the current artifact.

For a challenge-only change, run this lens before general implementation and tests.

## Rubric

Score each dimension 0 to 3 with evidence. The score summarizes quality; it never overrides a blocker.

| Dimension | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| Intent fidelity | Intended defect missing or artifact teaches a different challenge | Drift in several places | Minor drift with clear recovery | Every intended behavior and boundary matches the authorized contract |
| Reproducibility and solvability | Cannot run or reach the defect | Fragile setup or unclear path | Repeatable trigger and verification | Clean setup, deterministic trigger, diagnosable cause, verifiable repair |
| Instructions and fairness | Promises contradict behavior or leak fixes | Misleading or incomplete guidance | Accurate with minor gaps | Accurate, proportionate, accessible, no answer leakage |
| Scope and safety | Challenge enables out-of-scope harm or platform execution | Unsafe edge is easy to trigger | Controls exist but evidence is thin | Local-only impact, bounded inputs, inert platform storage |
| Scoring alignment | Award cannot be verified or location is stale | Multiple ambiguous mappings | Mostly aligned | Stable anchors, fair aliases, hidden tests, duplicate protection |
| Evidence and audit | No run or audit evidence | Claims without artifacts | Reproduction and targeted tests | Independent audit, playtest, regression coverage, dated evidence |

Interpretation: 16 to 18 ready with minor comments; 11 to 15 request changes unless every major is an explicitly accepted follow-up; 6 to 10 request changes; 0 to 5 do not publish. Factual answer leaks, out-of-scope harm, and invalid scoring are never deferred quality debt.

## Evidence procedure

1. Classify the artifact: fixture, participant docs, ingestion, feedback, or audit evidence.
2. Read the participant-visible artifact and its callers. Use only authorized non-restricted contracts.
3. Run the app locally when needed and safe. Use existing dependencies; ask before a network install or destructive reset.
4. Reproduce from a clean local data state. Record exact steps and observed results.
5. Compare participant promises with behavior without reading the restricted key.
6. Run relevant backend, frontend, isolation, and E2E checks.
7. Inspect the publication boundary: file list, APIs, response payloads, bundle, exports, and release state.
8. Report confidence, participant impact, and the smallest corrective action.

The detailed checklist is in `references/content-quality-checklist.md`. The repeatable procedure is in `references/review-procedure.md`. Failure patterns are in `references/anti-patterns.md`. Use `templates/content-review-report.md` for the report.

## Finding format

```text
[severity][content-quality][confidence] path/to/artifact:LINE: Issue in one sentence.
Why it matters: the concrete fairness, solvability, leakage, or participant consequence.
Fix: the specific change and the check that should prevent recurrence.
```

For structured artifacts, cite the item ID or participant-visible route when a line number is not meaningful. Group repeated root causes.

## Severity guidance

| Situation | Typical level |
|---|---|
| Restricted answer or flag exposed before release; participant path to `gt`; challenge causes out-of-scope harm; intended award unit cannot be reproduced; platform executes participant code | blocker |
| Unplanned defect blocks a fair solution; instructions leak a real answer; fixture drift invalidates scoring anchors; missing independent audit for release | major |
| Ambiguous wording, thin hint, non-blocking accessibility issue, weak difficulty evidence | minor |
| Wording or presentation preference with no fairness impact | nit |
| Missing context or suspected issue without reproduction | question |
| Clear instructions, fair difficulty, strong isolation, useful audit evidence | praise |

A pre-existing content defect is still reported, but it blocks only the PR that introduces, worsens, or publishes it. Name an owner and follow-up for unrelated pre-existing issues.

## Non-negotiables

- Never approve an answer leak because "the tests pass".
- Never treat an intentional planted defect as an accidental bug without checking scope.
- Never read or reproduce restricted answer material in an ordinary review.
- Never edit a golden, seed, fixture, or participant artifact merely to hide a review failure.
- Never claim a playtest, audit, benchmark, or readiness pass that did not happen.
- Never re-litigate the immutable event preset or product scope; cite the governing doc and ask.

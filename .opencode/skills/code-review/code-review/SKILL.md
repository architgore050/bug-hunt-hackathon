---
name: code-review
description: Entry point for reviewing any Bug Hunt CTF code, configuration, documentation, or challenge-content change. Use whenever the user asks to review a PR, diff, branch, commit, patch, file set, challenge fixture, participant instructions, test suite, or security boundary; asks "look over my changes", "is this ready to merge", "audit this", "sanity check this", or "self-review before I open a PR"; or wants AI-written code checked. Triages the change, routes it to review-security, review-architecture, review-implementation, review-tests, review-docs-sync, review-production-readiness, and review-content-quality, then merges findings into one prioritized report with a clear verdict. Use this skill first even when the user names only one concern.
---

# Code Review Orchestrator

This skill decides what to review, in what order, and how to report. Specialist lenses hold the depth. The orchestrator keeps the review proportionate, evidence-based, and useful.

Read [`../references/bughunt-review-policy.md`](../references/bughunt-review-policy.md) before reviewing. Do not open `challenge-app/ORGANIZER_ANSWER_KEY.md` during an ordinary review.

## The standard

Approve a change when it improves the overall health of the codebase, even if it is not how the reviewer would have written it.

- Technical facts and concrete consequences beat opinions. If there is no bug, risk, maintenance cost, or violated rule, label the point `nit` or drop it.
- Repository conventions are the style authority unless the existing pattern is harmful.
- Where several designs are valid, the author's choice stands unless there is a demonstrable cost.
- Do not block on perfection. Do not approve a known correctness, integrity, or security defect.

## Step 1: Understand the change

1. Establish the base explicitly. Prefer `git diff origin/main...HEAD` for a branch, or the PR's actual base. Do not assume local `main` is current.
2. Read the PR description, linked issue, commit messages, and relevant docs. If intent is unclear, state a one-line assumption and proceed unless the answer would change the verdict.
3. Read whole files and callers, not only hunks. Find usages of changed signatures, routes, schemas, flags, and state transitions.
4. Check what CI already covers. Spend attention on design, intent, security logic, missing tests, and documentation truth.
5. Note mixed concerns or unusually large logic diffs. Suggest a split when review quality is at risk, but still report critical findings.
6. Respect trust boundaries. Never copy restricted answer-key material into a review, log, screenshot, or participant-facing artifact.

## Step 2: Triage to lenses

Read each selected lens's `SKILL.md` before applying it.

| Signal in the change | Lens |
|---|---|
| Always for logic or behavior | `review-implementation`, `review-tests` |
| Auth, permissions, user input, SQL, shell, HTML, paths, URLs, crypto, secrets, dependencies, CI, LLM/tool/agent code | `review-security` |
| New module, service, dependency, public API, schema, event, data model, moved boundary, cross-cutting pattern | `review-architecture` |
| Commands, config, env vars, public API, setup, directory layout, event facts, conventions, runtime versions | `review-docs-sync` |
| Migrations, queries, queue jobs, scheduler, flags, deploy/infra, network calls, hot paths | `review-production-readiness` |
| Challenge fixtures, planted defects, instructions, hints, participant copy, explanations, feedback, restricted-key handling | `review-content-quality` |

Scale depth to risk. Authentication, scoring, ground truth, concurrency, migrations, and irreversible operations get a deep pass. Docs-only and test-only changes get a lighter pass. For challenge-only changes, run `review-content-quality` before implementation and tests.

## Step 3: Review in priority order

1. Design and architecture: is this the right change in the right place?
2. Correctness, challenge integrity, and security: does it do what it should on unhappy paths without leaking truth?
3. Tests: would they catch a regression?
4. Operability: can it be deployed, observed, paused, and recovered during an offline event?
5. Docs: is what the repository tells people still true?
6. Readability and style: naming, comments, polish.

If a fundamental design problem makes line review wasteful, report it immediately and state that the detailed pass stopped there.

## Step 4: Verify before reporting

Prefer evidence in this order: run it, trace it, grep for callers and duplicates, inspect configuration and database constraints.

- **confirmed**: executed or traced with cited evidence.
- **likely**: strong code reading, not executed.
- **suspected**: a hunch; place it under Questions as a question, never an accusation.

Run relevant gates from the repository policy and record exact results. Never fabricate a pass, test count, benchmark, or security claim. Do not start a full local stack solely for review unless the user has approved that work.

## Reviewing AI-written code

Look specifically for:

- Invented functions, flags, packages, or configuration fields.
- Plausible code that mishandles boundaries, time, retries, or authorization.
- Tests weakened, deleted, skipped, or bent to match possibly wrong output.
- Unnecessary abstractions, speculative configuration, and scope creep.
- Reimplemented helpers that already exist.
- Swallowed errors and silent fallbacks that make failure look like success.
- Comments that narrate code or now contradict it.
- Client-side checks presented as server enforcement.
- Mocks that assert their own setup instead of observable behavior.

## Noise discipline

- Skip mechanics already enforced by lint, formatting, types, and CI unless the check is missing or bypassed.
- Group repeats into one root-cause finding and list affected locations.
- Cap nits at about five; summarize larger patterns once.
- Lead with the verdict and highest-impact issue.
- Mention specific strengths worth repeating.
- State what was not reviewed so approval is not read as broader than it is.

## Severity

| Level | Meaning | Blocks merge? |
|---|---|---|
| **blocker** | Reachable security or integrity failure, data loss, wrong scoring, restricted-data exposure, definite main-path correctness bug, unsafe breaking change, committed secret | Yes |
| **major** | Likely realistic-edge bug, missing risky-behavior tests, costly design, stale docs that mislead or enable unsafe action | Usually; justify any follow-up |
| **minor** | Real but low-impact maintainability, clarity, or robustness improvement | No |
| **nit** | Taste or polish; prefix with `nit:` | No |
| **question** | Missing context or suspicion; asks rather than asserts | No |
| **praise** | Something worth repeating | No |

Any blocker requires **Request changes**. Majors require changes unless the author explicitly names a safe, owned follow-up and no repository invariant is violated.

## Finding format

```text
[severity][lens][confidence] path/to/file.ext:LINE: Issue in one sentence.
Why it matters: the concrete scenario, participant impact, or integrity consequence.
Fix: the specific change, with a short snippet when useful.
```

For structured data, cite the item ID or JSON pointer when a line number is not meaningful.

## Report template

```markdown
## Review: <branch / PR title>

**Verdict:** Approve | Approve with comments | Request changes
**Summary:** <2 to 3 sentences: what changes, overall health, top issue.>
**Lenses applied:** <implementation, tests, security, ...>
**Skipped:** <lens>: <reason>

### Verification
- `<command>`: `<exact result>`

### Blockers
### Major
### Minor and nits
### Questions
### What's good
### Not reviewed / assumptions
```

If the user wants fixes rather than a report, make minimal changes for blockers and majors, re-run the relevant checks, and list exactly what changed. Never bypass a gate or edit a restricted artifact to make a review pass.

# Challenge content review report

Copy this into the review comment. Replace every angle-bracket field. Delete sections the change does not touch, but keep the verdict and "Not reviewed".

```markdown
## Review: <branch / PR title>

**Verdict:** Approve | Approve with comments | Request changes
**Summary:** <2 to 3 sentences: artifact, overall quality, top issue.>
**Lenses applied:** content-quality, <implementation, tests, security, ...>
**Skipped:** <lens>: <reason>

### Artifact and contract map

| Field | Value |
|---|---|
| Artifact class | fixture / participant docs / ingestion / feedback / audit |
| Artifact path | `<path or route>` |
| Participant-visible surface | `<README, UI, API, file list>` |
| Non-restricted contract | `<document or code boundary>` |
| Reference compared | `<participant promise, test, audit record>` |
| Restricted material opened? | `No` or `<explicit organizer-side authorization and scope>` |

### Evidence run

| Check | Command or procedure | Result |
|---|---|---|
| Clean fixture startup | `<documented setup>` | `<exact result>` |
| Reproduction | `<steps>` | `<observed result>` |
| Backend | `cd backend && pytest` | `<exact result>` |
| Frontend lint | `cd frontend && npm run lint` | `<exact result>` |
| Frontend tests | `cd frontend && npm test` | `<exact result>` |
| Frontend build | `cd frontend && npm run build` | `<exact result>` |
| E2E | `scripts/e2e_journey.py` | `<exact result or not run and why>` |
| Isolation boundary | `<role test and file-list assertion>` | `<exact result>` |

### Rubric

| Dimension | Score (0 to 3) | Evidence |
|---|---:|---|
| Intent fidelity | <0 to 3> | <one sentence> |
| Reproducibility and solvability | <0 to 3> | <one sentence> |
| Instructions and fairness | <0 to 3> | <one sentence> |
| Scope and safety | <0 to 3> | <one sentence> |
| Scoring alignment | <0 to 3> | <one sentence> |
| Evidence and audit | <0 to 3> | <one sentence> |
| **Total** | **<0 to 18>** | <ready / request changes / do not publish> |

Highest-leverage change: <the one change that would most improve the lowest dimension>.

### Blockers

- `[blocker][content-quality][confirmed] <path>:<line or route>: <issue>.`
  Why it matters: <participant, fairness, leakage, or integrity consequence>.
  Fix: <specific change and prevention check>.

### Major

- `[major][content-quality][confirmed] <path>:<line or route>: <issue>.`
  Why it matters: <consequence>.
  Fix: <specific change>.

### Minor and nits

- `[minor][content-quality][likely] <path>:<line>: <issue>.`
  Why it matters: <consequence>.
  Fix: <specific change>.

- `nit: <preference with no fairness impact>.`

### Questions

- `[question][content-quality][suspected] <path>:<line>: <missing context and the specific scenario that worries you>.`

### What's good

- <Specific strength worth repeating: clear promise, fair difficulty, strong boundary, useful evidence.>

### Coverage

| Area | Inspected | Result |
|---|---|---|
| Participant package and startup | <all / N of M> | <pass / findings> |
| Intended defects affected by diff | <all / N> | <pass / findings> |
| Instructions, hints, examples | <all / sample> | <pass / findings> |
| Restricted-material boundary | <file list, API, bundle> | <pass / findings> |
| Pre-release feedback | <routes and states> | <pass / findings> |
| Scoring anchors and tests | <all changed / N> | <pass / findings> |
| Accessibility and inert rendering | <surfaces> | <pass / findings> |
| Audit and playtest evidence | <records> | <pass / findings> |

### Follow-ups

| Finding | Severity | Artifact | Owner | Reproduction | Target |
|---|---|---|---|---|---|
| <finding> | <major/minor> | `<path>` | <owner> | <steps> | <release or follow-up> |

### Not reviewed / assumptions

- <What was not opened, run, rendered, or reproduced, and why.>
- <Assumptions about the authorized non-restricted challenge contract.>
- <Pre-existing defects reported but not blocking this PR.>
- Restricted organizer material was not opened or reproduced, unless explicitly authorized above.
```

## Verdict rules

- Any **blocker** means **Request changes**.
- A **major** means **Request changes** unless the owner explicitly accepts a safe, logged follow-up. Answer leaks, invalid scoring, out-of-scope harm, and unreachable award units never qualify.
- Otherwise approve, with comments for worthwhile minors.
- State whether approval covers challenge content only or the code path too.
- Always state what was not reviewed.

## Finding format reminder

```text
[severity][content-quality][confidence] path:line or route: Issue in one sentence.
Why it matters: the concrete participant or integrity consequence.
Fix: the specific change and the check that should prevent recurrence.
```

Severity: `blocker`, `major`, `minor`, `nit`, `question`, `praise`.
Confidence: `confirmed`, `likely`, `suspected`.

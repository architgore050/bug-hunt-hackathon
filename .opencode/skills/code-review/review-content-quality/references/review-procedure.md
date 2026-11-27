# Challenge-content review procedure

A repeatable path from a challenge-content diff to a defensible verdict.

## 0. Preconditions

Read:

- `AGENTS.md` and `../../references/bughunt-review-policy.md`.
- The participant-facing README, rules, handbook, and relevant UI copy.
- The fixture manifests and the participant file list in `backend/seed.py`.
- `docs/TESTING_STRATEGY.md` and `docs/FRONTEND_DESIGN_DIRECTION.md` when relevant.

Do not open `challenge-app/ORGANIZER_ANSWER_KEY.md` or `docs/CHALLENGE_DESIGN_AND_GROUND_TRUTH.md` unless the user explicitly authorizes organizer-side ground-truth review. Never reproduce their contents in a report.

Do not install dependencies, start services, reset databases, or run destructive scripts without the required approval. Prefer existing local installations and isolated temporary data.

## 1. Classify the artifact

| Artifact | Typical paths | Governing contract | Primary evidence |
|---|---|---|---|
| Node challenge fixture | `challenge-app/**` | Participant README, package manifest, authorized challenge contract | Clean startup and reproduction |
| Alternate fixture | `challenge-app-option-b/**` | Its README, requirements, authorized challenge contract | Clean startup and reproduction |
| Participant instructions | Challenge README, handbooks, rules, hints, UI copy | Official preset and published rules | Walkthrough against actual UI/API |
| Ingestion and publication | `backend/seed.py`, admin challenge routes, assignment/file APIs | Participant allow-list and trust policy | API response and database-role tests |
| Feedback and scoring copy | Reviewer guidance, results UI, release payloads | Scoring model and hidden-feedback policy | Pre/post-release response comparison |
| Audit evidence | Readiness records, review notes, playtest reports | Event operations playbook | Dated, named artifacts |

Write a three-line map:

```text
Artifact: <participant-visible path or route>
Contract: <non-restricted document or code boundary>
Evidence: <reproduction, tests, audit record>
```

If the map cannot be completed, identify the missing evidence as a finding.

## 2. Establish intended behavior

- Read what participants are promised.
- Separate intended planted weaknesses from unplanned defects.
- Identify the affected user journey and repository option.
- Check the official event preset and current rules.
- If intent is unclear, ask only when the answer changes the verdict.

Never infer ground truth by reading the restricted key. Use the authorized contract supplied for the review, participant promises, and observable behavior.

## 3. Reproduce from a clean state

1. Use a temporary or freshly initialized local data directory.
2. Follow the documented setup exactly.
3. Record runtime versions and startup output.
4. Trigger the behavior as a participant would.
5. Capture the symptom, relevant request, response, and UI state.
6. Trace the cause through participant-visible files.
7. Apply a minimal repair in a scratch copy when needed.
8. Verify the promised behavior and check for regressions.
9. Discard only the scratch artifacts created for the review. Never delete user data or the repository's ignored state.

A screenshot is optional. Exact steps and observed output are stronger evidence.

## 4. Inspect the publication boundary

- Compare the seed and admin-ingestion file lists with the intended participant package.
- Assert restricted files and organizer notes are excluded.
- Inspect assignment and file API responses for unexpected fields or content.
- Search frontend source and built output for restricted markers and per-bug data.
- Verify challenge files are served as inert text.
- Verify no participant upload or report executes on the platform.
- Compare pre-release and post-release participant payloads.

Use `backend/tests/test_gt_isolation.py` and the E2E answer-key-not-served check as evidence. Do not substitute a mocked permission check for a real database-role test.

## 5. Run relevant checks

Use the commands that match the changed surface:

```bash
cd backend && pytest
cd frontend && npm run lint
cd frontend && npm test
cd frontend && npm run build
```

Run `scripts/e2e_journey.py` only against an available running stack. Record exact output. Do not start a full stack or claim a pass when prerequisites are missing.

For fixture changes, also run the fixture's documented local startup and targeted reproductions. There may be no dedicated test script; say so rather than inventing one.

## 6. Sample deliberately

| Artifact size | Sampling rule |
|---|---|
| One small fixture | Inspect every participant-visible file affected by the diff and the startup path |
| Multiple intended behaviors | Reproduce every behavior affected by the change |
| Participant docs | Read every changed section in the rendered context |
| Hints and examples | Inspect all of them for real-answer leakage |
| File list and API payload | Inspect every entry and field |
| Scoring anchors | Inspect every changed anchor and alias against the current fixture |
| Audit evidence | Verify every release claim cited by the PR |

Never sample only the first items. Accidental answers and unplanned defects often live in examples, late sections, and error states.

## 7. Calibrate severity

| Defect | Default | Escalate when |
|---|---|---|
| Restricted answer, flag, verdict, or per-bug data exposed before release | blocker | always |
| Participant path to `gt` or platform execution of participant code | blocker | always |
| Challenge causes out-of-scope harm | blocker | always |
| Intended award unit cannot be reached or verified | blocker for release | ranking or completion is affected |
| Unplanned defect blocks a fair path | major | no workaround or many teams affected |
| Instructions leak a real answer or fix | blocker | always |
| Fixture drift makes scoring anchors or hidden tests wrong | major | wrong rankings or duplicate awards are possible |
| Setup depends on hidden steps or external services | major | app cannot run offline |
| Difficulty claim has no playtest | major when used for readiness | otherwise question |
| Ambiguous but accurate wording | minor | it changes the intended diagnosis |
| Suspected issue without reproduction | question | gather evidence first |

One root cause gets one finding with all affected locations. Distinguish new from pre-existing defects.

## 8. Write the report

Use `../templates/content-review-report.md`. Include:

1. Verdict and top issue in the first three lines.
2. Artifact and contract map.
3. Exact evidence and commands.
4. Rubric scores with one sentence each.
5. Findings by severity and participant impact.
6. Coverage table: inspected, sampled, skipped.
7. Follow-ups with owner, artifact, reproduction, and target.
8. What was not reviewed, including restricted material and unavailable runtime evidence.

If asked to fix content, make the smallest change that resolves blockers and majors. Re-run relevant checks. Never bypass a gate, edit evidence to hide a failure, or modify restricted material without explicit scope.

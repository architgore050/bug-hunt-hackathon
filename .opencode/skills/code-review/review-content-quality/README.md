# review-content-quality

Status: adapted for Bug Hunt CTF on 2026-11-27.

The challenge-content lens reviews fixtures, planted defects, participant instructions, hints, examples, feedback, ingestion boundaries, scoring alignment, and audit evidence. It distinguishes intentional challenge weaknesses from unplanned defects.

## Layout

| File | Purpose |
|---|---|
| [`SKILL.md`](SKILL.md) | Triggers, trust boundary, review rules, rubric, procedure, severity |
| [`references/content-quality-checklist.md`](references/content-quality-checklist.md) | Per-area checks and evidence |
| [`references/review-procedure.md`](references/review-procedure.md) | Classification, reproduction, verification, publication-boundary review |
| [`references/anti-patterns.md`](references/anti-patterns.md) | Recurring challenge-content failure shapes |
| [`templates/content-review-report.md`](templates/content-review-report.md) | Report skeleton with coverage and evidence tables |

## Trust boundary

An ordinary review must not open `challenge-app/ORGANIZER_ANSWER_KEY.md`. `docs/CHALLENGE_DESIGN_AND_GROUND_TRUTH.md` also restates restricted organizer material and requires explicit organizer-side scope. Review the participant file list, access controls, isolation tests, and release gates instead.

## Validation

Verify that every `SKILL.md` has valid frontmatter and that relative links resolve. Then run the repository checks relevant to the changed surface:

```bash
cd backend && pytest
cd frontend && npm run lint
cd frontend && npm test
cd frontend && npm run build
```

Do not claim an E2E or challenge-audit pass without running the required stack or producing the required evidence.

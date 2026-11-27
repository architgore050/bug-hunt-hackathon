# Code Review Skills

Status: installed for Bug Hunt CTF on 2026-11-27.

Eight reusable review skills share one evidence standard, severity scale, and finding format. The `code-review` entry point triages a change and routes it to the specialist lenses that matter.

| Skill | What it judges | Bundled references |
|---|---|---|
| `code-review` | Review scope, lens routing, evidence rules, severity, verdict, AI-written-code failure modes | none |
| `review-security` | Trust boundaries, access control, verdict-oracle leaks, secrets, supply chain, CI, agent/tool safety | `references/owasp-2025-checklist.md`, `references/agentic-and-llm.md` |
| `review-architecture` | Server authority, trust domains, module boundaries, contracts, reversibility, ADRs | none |
| `review-implementation` | Correctness, transactions, concurrency, state transitions, resources, API misuse | none |
| `review-tests` | Regression detection, database-enforced invariants, race coverage, determinism, test quality | none |
| `review-docs-sync` | README, AGENTS.md, API docs, runbooks, event facts, commands, configuration | `../references/agents-md-rubric.md` |
| `review-production-readiness` | Queue delivery, migrations, rollout/rollback, observability, capacity, offline event operation | none |
| `review-content-quality` | Challenge fixtures, planted defects, participant instructions, hints, feedback, restricted answer-key handling | `references/content-quality-checklist.md`, `references/review-procedure.md`, `references/anti-patterns.md` |

## How they fit together

```text
code-review
  understand -> triage -> review in priority order -> verify -> report
      |
      +-- architecture
      +-- implementation
      +-- security
      +-- tests
      +-- docs-sync
      +-- production-readiness
      +-- content-quality
```

Review order is deliberate: design and challenge-content correctness first, then implementation and security, tests, operability, docs, and style. A wrong challenge answer or a leaked verdict is a product defect, not a cosmetic issue.

## Use

Ask for a review in natural language, or load a skill explicitly:

- `code-review`: "Review this PR", "Is this ready to merge?", "Audit this diff"
- `review-security`: "Check this for authorization or data leaks"
- `review-tests`: "Would these tests catch the regression?"
- `review-content-quality`: "Check this challenge fixture and its participant instructions"

Keep all eight skill folders together. The orchestrator and lenses refer to sibling skills by ID and to supporting files by relative path.

OpenCode discovers these under `.opencode/skills/code-review/`. Each folder containing `SKILL.md` is one skill; supporting files stay private to that skill.

## Repository policy

Read [`references/bughunt-review-policy.md`](references/bughunt-review-policy.md) before applying any lens. It captures the non-negotiable rules from `AGENTS.md`: server-owned truth, ground-truth isolation, append-only scoring, hidden feedback, submission transaction order, safe rendering, and verified claims.

## Design principles

1. Evidence over opinion. Findings carry `confirmed`, `likely`, or `suspected` confidence.
2. Approve changes that improve code health. Do not block on taste or wave through defects.
3. Spend attention where machines cannot: design, intent, security logic, missing tests, and docs truth.
4. Trace data and state. Security follows source to sink; tests are judged by whether broken behavior would fail them.
5. Use one severity scale so blockers are not lost among nits.
6. Scrutinize AI-written code for invented APIs, weakened tests, unnecessary abstractions, swallowed errors, and scope creep.

## Customizing

- Add stack-specific detail in a lens's `references/` directory and link it from that lens's `SKILL.md`.
- Encode repository policy in the lens that owns it.
- If a lens is removed, also remove it from the orchestrator's routing table and this index.
- Keep documentation in English, without em dashes, and mark unverified claims explicitly.

## Sources and influences

The suite was adapted for Bug Hunt CTF from an internal review-skills bundle. Its method synthesizes:

- Google Engineering Practices, *The Standard of Code Review* and *What to look for in a code review* (CC-BY 3.0).
- OWASP Top 10:2025, OWASP API Security Top 10, and OWASP LLM/agentic AI guidance.
- Published guidance on maintaining useful AGENTS.md files.
- Mutation-testing and test-smell literature.
- Michael Nygard's ADR format and the expand/contract migration pattern.
- WCAG 2.2 and established instructional-design guidance for challenge content review.

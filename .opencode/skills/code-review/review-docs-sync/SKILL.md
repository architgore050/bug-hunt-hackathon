---
name: review-docs-sync
description: Documentation-freshness lens for code review. Use when a change may make written docs untrue, including README, AGENTS.md, API docs, runbooks, event operations docs, architecture and security docs, testing strategy, configuration examples, comments, and decision records. Use when commands, scripts, config, env vars, APIs, dependencies, runtime versions, directory layout, event facts, or conventions change, or when the user asks "are the docs up to date", "does AGENTS.md need updating", "review my README", or "what docs does this PR affect".
---

# Docs Sync Review

Docs are a promise about the system. A stale runbook can fail an event; a stale security claim can expose participants.

Read [`../references/bughunt-review-policy.md`](../references/bughunt-review-policy.md). For AGENTS.md, read `references/agents-md-rubric.md`. Findings use the shared format and severity scale from `code-review`.

## 1. Derive documentation impact

| Changed in code | Docs that may now be wrong |
|---|---|
| Commands, scripts, CLI flags | README, onboarding, AGENTS.md, CI docs |
| Env vars, config, defaults, flags | Config examples, deployment runbook, operations playbook |
| Endpoint, schema, event, behavior | API reference, data model, frontend contract, examples |
| Dependencies or runtime versions | Requirements, Docker docs, CI matrix |
| Layout, module names, moved files | Architecture docs, AGENTS.md pointers, links |
| Conventions, tests, branch/PR workflow | AGENTS.md, contributing docs, CI docs |
| Security or architecture decision | ADRs, security architecture, decision log |
| Event rules, schedule, team size, scoring | Competition rules, handbooks, operations playbook |
| User-visible behavior or breaking change | Release notes, migration guide |

Grep docs for old names, values, paths, commands, and defaults. Every now-false hit is a finding. A new required setting with no documentation is also a finding.

## 2. Verify claims

- Run documented commands or confirm scripts, targets, and flags exist.
- Check paths, links, anchors, snippets, versions, and defaults against current code.
- Compare API examples with actual request and response models.
- Treat recorded test results as historical evidence for that commit, not proof for the current change.
- Require measured or provisional wording for capacity, performance, and security claims.
- Never invent a pass, benchmark, readiness item, or test count to make docs look complete.

## 3. Repository facts that must stay consistent

- Product: Bug Hunt CTF. Event: Fall Back, Software Development Club, VIT Bhopal University.
- Official preset: 6 December 2026, 180 minutes, offline, teams of 4 to 5. The proposal PDF is immutable.
- `backend/seed.py` mirrors the official preset.
- Development credentials are labeled development-only; production requires replacement and an environment-provided `JWT_SECRET`.
- The restricted organizer answer key is never listed as participant content or described as an API resource.
- `AGENTS.md` remains the binding engineering policy. Do not weaken it in unrelated docs.
- New docs are English only, contain no em dashes, use real content, and mark unverified claims.

## 4. Judge each doc type

### README and onboarding

Could a newcomer reach a working local setup? Check requirements, database setup, migrations, seed, API, worker, frontend, tests, configuration pointers, and known limits. Prefer links to deeper docs over duplication.

### AGENTS.md

Keep it short, specific, true, and focused on non-discoverable rules that affect safety or task success. Update it in the same PR when commands, structure, or conventions change. Never include secrets or instructions to bypass tests.

### API and data docs

Check parameters, types, defaults, auth, error codes, ownership semantics, idempotency, hidden feedback, and examples. Flag any documented client authority over server-owned outcomes.

### Runbooks and event operations

Check startup, pause/resume, worker recovery, database restore, deadline handling, release, rollback, role assignment, and offline-network assumptions. A runbook step that fails is **major**; one that exposes restricted truth or corrupts scoring is **blocker**.

### Architecture, security, and decision records

Significant decisions need context, alternatives, decision, consequences, and status. Mark superseded records. Code that contradicts an accepted decision belongs in `review-architecture` as well.

### Comments and docstrings

Explain why and non-obvious contracts. Flag contradictions, commented-out code, and unowned task markers. Do not demand docstrings on self-evident code.

## 5. Anti-drift hygiene

- Keep one canonical source for each fact and link to it.
- Generate API or configuration reference material when practical.
- Add docs to the same PR as the behavior change.
- Keep package-specific detail near its code.
- Avoid copying large policy blocks into multiple files.

## Output

Produce a documentation-debt table:

| Doc | Location | Stale or missing claim | Evidence | Fix |
|---|---|---|---|---|

Then list what was verified. If asked to fix docs, make minimal factual edits without changing unrelated voice or structure.

## Severity guidance

| Situation | Typical level |
|---|---|
| Docs instruct unsafe disclosure, destructive scoring change, secret commit, or test bypass; quickstart cannot work and blocks release | blocker to major |
| Stale command, path, env var, API example, event fact, or security claim that misleads | major |
| Missing changelog, outdated screenshot, redundant prose, minor docstring gap | minor |
| Wording or formatting preference | nit |

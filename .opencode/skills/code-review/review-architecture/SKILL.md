---
name: review-architecture
description: Architecture and design lens for code review. Use when a change adds a module, service, dependency, or framework; changes an API, schema, event, data model, trust boundary, or progression rule; moves files; introduces a cross-cutting pattern; or when the user asks "is this the right design", "does this fit our architecture", "do we need an ADR", "is this over-engineered", or "review the structure". Judges boundaries, server authority, coupling, contract stability, reversibility, and whether significant decisions are recorded.
---

# Architecture and Design Review

Design flaws compound. Review design before line details. The question is not "is this how I would do it?" but "will this make the next ten changes easier or harder, and what does it cost to undo?"

Read [`../references/bughunt-review-policy.md`](../references/bughunt-review-policy.md). Findings use the shared format and severity scale from `code-review`.

## 1. Establish context

- Read the PR description, linked issue, relevant ADR, `AGENTS.md`, and architecture/security docs.
- Learn the existing layout and boundaries from code, imports, routes, migrations, and tests.
- Identify the current source of truth for time, identity, progression, verdicts, and scores.
- Find actual consumers with grep or tooling. Directories alone do not prove boundaries.

## 2. Placement and boundaries

- Does the code live where a maintainer would look for it? Does it have one nameable responsibility?
- Does dependency direction preserve the separation between API, worker, persistence, ground truth, and frontend?
- Does any participant-facing path import, query, serialize, or otherwise depend on `gt` or restricted organizer material?
- Are new cycles, cross-module private imports, or duplicated sources of truth introduced?
- Does the frontend make an eligibility, deadline, gate, verdict, or score decision that belongs on the server?
- Is identity derived from the authenticated principal rather than a body field, header, route hint, or client claim?

A second source of truth for event state or scoring is a **major**, and a **blocker** when it can change an outcome.

## 3. Abstraction and simplicity

- Does each new interface, layer, config option, or dependency serve a current requirement?
- Could a smaller change meet the stated need? Suggest a simpler design in two sentences when useful.
- Is non-trivial business logic duplicated? Three copies of a scoring or submission rule will diverge.
- Is complexity proportional to the problem and the one-shot event profile?
- Are invalid states representable that a type, constraint, or state machine could prevent?
- Are temporal requirements encoded in the API and transaction, not only comments?

Do not demand speculative microservices, distributed infrastructure, or generalized frameworks for this repository's documented profile.

## 4. Contracts and compatibility

Check public HTTP routes, request/response models, event and stage transitions, database schema, queue payloads, storage adapters, configuration, and frontend API boundaries.

- Who consumes the contract, and is the change backward compatible?
- If not, is there a versioning, migration, or deprecation path?
- Are error codes, nullability, ordering, pagination, and idempotency consistent?
- Are uniqueness, foreign keys, immutability, and ownership constraints enforced by PostgreSQL rather than only handler code?
- Can old and new application versions coexist during rollout?
- Does a migration follow ordered, forward-only, expand/contract rules?

A silent breaking change to a live contract is a **blocker** when participants or scoring are affected.

## 5. State, transactions, and delivery

- Who owns each piece of state, and which transaction may change it?
- Are idempotency reservation, stage locking, the single server clock read, validation, and commit one atomic operation where required?
- Are queue handlers safe under duplicate and out-of-order delivery?
- Are award claims unique at the database level?
- Are score corrections modeled as linked ledger entries rather than mutation?
- Can a crash between steps leave partial state? If so, is recovery explicit and tested?

## 6. Failure and scale at design level

- What happens when PostgreSQL, the worker, storage, or the challenge app is slow, unavailable, or returns malformed data?
- Is failure isolated to one team, stage, submission, or job?
- Is synchronous work incorrectly placed on a request path?
- Are queues, retries, and worker concurrency bounded?
- Will the design work at the documented event size without redesign? Require a concrete reason before flagging scale.
- For an offline venue, what is the recovery path for process restart, database restore, duplicate delivery, and interrupted network access?

## 7. Reversibility and ADRs

Classify the decision:

- **Two-way door:** internal function, private module, reversible UI change.
- **One-way door:** public contract, schema, data format, auth model, trust boundary, destructive migration, deleted data.

Scrutiny should scale with irreversibility. Recommend an ADR for a new service or datastore, auth/security model change, public contract change, cross-cutting pattern, or reversal of an earlier decision. Check `docs/AUTONOMOUS_DECISION_LOG.md`, architecture docs, and any ADR collection before requesting a new one.

A good ADR records context, real alternatives including "do nothing", the decision and rationale, consequences, and status. Code that contradicts an accepted decision is a **major** finding.

## Severity guidance

| Situation | Typical level |
|---|---|
| Participant path to `gt`, client-authoritative scoring, silently broken live contract, irreversible corruption without recovery | blocker |
| Boundary violation, second source of truth, new cycle, one-way-door decision without record or rollback, missing DB integrity constraint | major |
| Speculative abstraction, needless config, harmless misplaced code | minor |
| Pattern or naming preference with no concrete cost | nit/question |

Cite the import edge, query, contract consumer, duplicated rule, or missing constraint. Describe the future change or failure, not abstract purity. Offer an alternative with its tradeoff, and say when the author's approach is acceptable for now.

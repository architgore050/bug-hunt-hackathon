---
name: review-security
description: Security lens for code review. Use when code touches authentication, authorization, identity, sessions, user input, SQL, shell, HTML, paths, URLs, uploads, crypto, secrets, ground truth, scoring, dependencies, CI/CD, infrastructure, or LLM/agent/tool code. Also use for vulnerabilities, OWASP, injection, XSS, SSRF, CSRF, verdict leaks, restricted answer-key exposure, supply chain, prompt injection, or "is this secure". Traces attacker-controlled data to powerful sinks instead of relying on keyword matching.
---

# Security Review

Security review asks where untrusted data enters, what powerful thing it reaches, and what control prevents damage.

Read [`../references/bughunt-review-policy.md`](../references/bughunt-review-policy.md). For category detail, read `references/owasp-2025-checklist.md`. For model, agent, tool, skill, or MCP code, also read `references/agentic-and-llm.md`. Findings use the shared format and severity scale from `code-review`.

Do not open or reproduce `challenge-app/ORGANIZER_ANSWER_KEY.md` during an ordinary review.

## Method

1. Describe the new or changed trust boundary, privilege, input, or sensitive data in two sentences.
2. Trace sources to sinks.
   - Sources: request body, params, headers, cookies, uploaded files, filenames, queue payloads, user-written database rows, environment configuration, third-party responses, model output.
   - Sinks: SQL, shell, dynamic code, HTML, filesystem paths, outbound HTTP, redirects, deserializers, logs, authorization decisions, scoring, participant responses.
   - For each path, identify the control and confirm it fits the sink. HTML escaping does not protect SQL; a UI gate does not enforce authorization.
3. Check authorization on every route, handler, job, and query. Authentication is not authorization.
4. Run quick scans.
5. State the attack path: who, with what input, gets what. No plausible path means downgrade or drop. Describe attacks without writing working exploits.

## Repository-critical checks

### Identity and object access

- Identity and role come from the verified token and server-side principal, never the body.
- Participant queries scope by token-derived `author_id` or `team_id`.
- Foreign and unknown resource IDs are indistinguishable.
- Reviewer and organizer functions enforce server-side roles.
- Sensitive ground-truth and challenge-management routes require current step-up authentication.
- Assignment and challenge access are bound to the caller's team.
- A client cannot select another team's challenge by forging an ID.

### Ground truth and verdict oracle

- `app_api` cannot read or write `gt`. Tests use the real database role, not mocks.
- No participant route, serializer, frontend bundle, export, or log exposed to participants includes restricted key material.
- Flag plaintext is not returned or stored where the application role can read it.
- Verdicts, matched bug codes, point values, and penalty details remain hidden until `feedback_released`.
- Status codes, timing, error details, reviewer notes, and polling payloads do not form an answer oracle.
- Caps, cooldowns, and review routing cannot be bypassed with retries, aliases, concurrent submissions, or client-controlled fields.

### Integrity and replay

- Idempotency keys are scoped correctly and bound to a canonical payload hash.
- Same-key replay returns the original receipt; changed payload conflicts.
- Award uniqueness is enforced in PostgreSQL.
- Ledger rows cannot be updated or deleted; corrections reference the original.
- Audit writes and state changes share a transaction where required.
- Queue and scheduler handlers are safe under duplicate delivery and overlapping runs.

### Input and rendering

- SQL uses bound parameters.
- Paths are normalized and constrained to database-backed challenge files.
- Upload size and schema are bounded; challenge code remains inert text.
- Participant content renders through `PlainMarkdown` or text nodes.
- No `dangerouslySetInnerHTML` or other raw HTML path is introduced.
- Cookies use the documented `HttpOnly`, `SameSite`, `Secure`, and path settings.
- Refresh rotation preserves Origin and custom-header CSRF checks.
- CORS uses an exact allow-list, not wildcard origins with credentials.

### Secrets and errors

- No real token, password, private key, connection string, or restricted answer material appears in code, fixtures, docs, screenshots, or logs.
- Development credentials and default `JWT_SECRET` cannot silently become production configuration.
- Error responses use the stable envelope and catalog without stack traces or account-existence signals.
- Logs omit passwords, tokens, full sensitive payloads, and answer-key content.

## Quick scans

- New dependencies: intended package, credible publisher, lockfile pin, install scripts, license, maintenance.
- Dangerous APIs: `eval`, `exec`, `os.system`, `subprocess(shell=True)`, unsafe deserialization, raw HTML sinks, interpolated SQL, disabled TLS verification, weak randomness for security tokens, fast password hashes, hard-coded keys.
- Fail-open branches, auth after side effects, default-allow flags, swallowed authorization errors.
- CI: `pull_request_target` with untrusted code, mutable action references, broad token permissions, secrets in logs, skipped required checks.
- Infra: root containers, public storage, wildcard ingress/IAM, secrets in images, debug mode.
- Unbounded inputs, regexes, queries, uploads, queues, and concurrency.

## Principles

- Validate at the boundary and encode at the sink.
- Deny by default and enforce least privilege.
- Use platform primitives for crypto, sessions, CSRF, and password hashing.
- Fail closed. Error paths must not reveal more than success paths.
- Defense in depth is valuable, but a missing second layer is not a blocker if the first layer is sound.

## Severity guidance

| Situation | Typical level |
|---|---|
| Participant access to `gt` or restricted key, auth bypass, IDOR, reachable injection, committed secret, pre-release verdict leak, client-controlled score | blocker |
| Missing authorization on a sensitive path, unsafe grant change, weak crypto for real data, unpinned writable CI action | major |
| Missing rate limit, verbose error, defense-in-depth gap, non-vulnerable outdated dependency | minor |
| Theoretical issue requiring privileges the attacker already has | drop or question |

End with security assumptions, unverified areas, and follow-up tooling recommendations when relevant. Do not present review as a replacement for dependency scanning, penetration testing, or database grant verification.

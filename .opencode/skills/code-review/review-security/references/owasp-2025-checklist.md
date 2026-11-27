# OWASP Top 10:2025 diff checklist

Use this as a memory aid after tracing sources to sinks, not as a substitute for tracing. SSRF is included under A01 in the 2025 edition.

## A01 Broken Access Control

- Record lookup by user-supplied ID without ownership or team scope: IDOR/BOLA.
- Authorization only in the UI; missing server-side checks on routes, jobs, exports, or admin actions.
- Role, team, author, admin, or tenant fields accepted from client input.
- Path traversal in file reads, writes, downloads, and artifact names.
- SSRF through user-controlled URLs, redirects, DNS resolution, imports, or previews. Require allowed schemes and hosts, block private and link-local ranges, and re-check after redirects.
- Open redirects and credentialed CORS reflecting arbitrary origins.
- Function-level authorization missing on reviewer or organizer actions.
- Participant access to `gt`, restricted files, hidden tests, or per-bug ground truth.

Good: deny by default, object-level checks next to data access, token-derived identity, database-enforced trust boundaries, tests that team A cannot read team B's data.

## A02 Security Misconfiguration

- Debug mode, verbose errors, default credentials, sample endpoints, directory listing.
- Missing security headers, permissive CORS, unsafe cookie settings.
- Public storage, wildcard ingress/IAM, root or privileged containers, secrets in images.
- Unsafe XML or parser defaults.
- Development credentials or `JWT_SECRET` accepted in production.
- Runner or unsafe feature flag enabled by default.

Good: secure defaults, startup validation, minimal surface, explicit environment parity.

## A03 Software Supply Chain Failures

- New or bumped dependency with an uncertain name, publisher, maintenance status, or install script.
- AI-suggested package name that does not exist or may be typosquatted.
- Mutable action, orb, image, or artifact references instead of commit SHA or digest.
- `curl | sh`, unpinned downloads, fork PRs with secret access, broad `GITHUB_TOKEN` permissions.
- Lockfile drift, deleted lockfile, branch-based dependency, vendored code without provenance.
- Missing audit or SBOM step where the project already expects one.

Good: minimal dependencies, lockfiles, pinned updates, provenance, dependency scanning.

## A04 Cryptographic Failures

- Plaintext or weakly protected sensitive data.
- Fast password hash such as MD5, SHA-1, or unsalted SHA-256 instead of Argon2id, bcrypt, or scrypt.
- Home-grown crypto, static keys or IVs, nonce reuse, weak randomness for tokens.
- Secret comparison with ordinary equality instead of constant-time comparison.
- JWT with unchecked algorithm, missing expiry, issuer, audience, or signature verification.
- Keys stored with the data they protect and no rotation path.

Good: platform crypto primitives, environment-provided secrets, documented rotation.

## A05 Injection

- SQL built with concatenation, f-strings, or unsafe raw escape hatches.
- OS command injection through `shell=True`, backticks, or concatenated input.
- Argument injection when user input can begin with `-`.
- XSS through raw HTML, `dangerouslySetInnerHTML`, unsafe Markdown, or template auto-escaping disabled.
- Template, header, CRLF, log, regex, or expression-language injection.
- Unsafe deserialization of untrusted data.

Good: parameterized queries, context-aware output encoding, allow-list validation, no dynamic code from input. Participant content uses `PlainMarkdown` or text nodes.

## A06 Insecure Design

- No abuse-case thinking for login, reset, submissions, flags, reviewer actions, or expensive endpoints.
- Negative quantities, client-controlled points, skipped workflow steps, replayable actions.
- Race conditions on caps, cooldowns, awards, balances, or stage transitions.
- Sensitive actions without step-up or confirmation.
- Account recovery or login errors that disclose account existence.
- No separation between participant, reviewer, organizer, and ground-truth privileges.

Ask what a malicious but legitimate participant or staff user would try. Cross-reference `review-architecture`.

## A07 Authentication Failures

- Predictable session IDs, missing rotation, missing logout/reset revocation, excessive token lifetime.
- Tokens in URLs or browser storage when HttpOnly cookies are appropriate.
- Credential stuffing without throttling, default accounts, weak password policy.
- Recovery that bypasses authentication.
- OAuth/OIDC with unchecked state or nonce, open redirect URI, unsigned token, or confused token types.
- Session cap enforced only in application code under concurrent login.

Good: server-side principal checks, token versioning, refresh rotation and reuse detection, generic failures, database-backed revocation.

## A08 Software or Data Integrity Failures

- Auto-update or plugin loading without integrity checks.
- Unsafe deserialization or unsigned state driving privileged behavior.
- CI path that lets unreviewed code reach deployment.
- Artifacts not verified between build and deploy.
- Webhooks trusted without signature and replay protection.
- Score ledger update/delete, unlinked correction, or award uniqueness enforced only in handler code.

Good: append-only ledger, linked reversals, database constraints, verified artifacts, protected CI.

## A09 Logging and Alerting Failures

- Login failure, denied access, privilege change, or admin action not logged.
- Security event cannot be attributed to a request, user, or team.
- Password, token, report text, flag, or restricted answer written to logs.
- Log injection through unsanitized newlines.
- No actionable alert or runbook for a new critical failure.

Good: structured context, safe redaction, audit entries in the same transaction, actionable alerts.

## A10 Mishandling of Exceptional Conditions

- Error path fails open or treats partial success as success.
- Null, empty, oversized, or malformed input crashes the process or leaks internals.
- Unbounded memory, CPU, regex, upload, query, or retry behavior.
- Missing cleanup leaves locks, transactions, files, or sessions half-open.
- Retry storms against auth, submission, or scoring paths.
- Missing rollback creates inconsistent security or scoring state.

Good: stable error catalog, fail closed, bounded inputs, tested negative paths, atomic transactions.

## API-specific checks

- Object-level, function-level, and property-level authorization on every endpoint.
- Response fields expose data the caller should not see.
- Client can set identity, role, team, verdict, score, deadline, or gate fields.
- Pagination, payload, query, and batch limits are enforced.
- Third-party responses have timeouts and validation.
- Old or debug API versions remain exposed.
- Idempotency keys are scoped and bound to payload hashes.
- Pre-release responses do not reveal matching outcomes.

## CTF integrity checks

- Every participant-visible status is coarse until feedback release.
- Wrong, duplicate, malformed, and correct submissions cannot be distinguished by hidden verdict signals.
- Caps and cooldowns hold under concurrency and retries.
- Award claims are unique per stage, team, and award unit in PostgreSQL.
- Score corrections reference the original ledger entry.
- The platform never serves the organizer answer key.
- The `app_api` role cannot read or write `gt`.
- Challenge files are inert text and participant uploads never execute on platform infrastructure.

## Web-specific extras

- Cookie-authenticated state changes have CSRF protection or proven SameSite and Origin controls.
- Uploads validate content, cap size, use safe names, and serve with safe content type and disposition.
- Clickjacking defenses, postMessage origin checks, and safe external-link attributes.
- Cache keys include authorization context and do not mix teams or users.
- Host-header trust and subdomain takeover are considered.

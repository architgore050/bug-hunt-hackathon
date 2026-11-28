# Cloud agent prompt: team registration links and payment handling

Status: DRAFT prompt, not yet executed. The design it requests is not built.
This document is the brief for a cloud coding agent. Product decisions marked
OPEN must be answered by the human owner before implementation merges.

---

## Prompt (copy from here)

You are working on "Bug Hunt CTF", an event platform (FastAPI + PostgreSQL 16/17
modular monolith, React SPA, durable Postgres job queue) for a 1-day offline
debugging competition ("Fall Back", Software Development Club, VIT Bhopal
University, 6 December 2026, teams of 4-5, up to 50 participants / 12 teams).

Today accounts exist only through the organizer seed and organizer-created
invites. There is no public registration and no payments. Design and implement
team registration via registration links, with payments behind a placeholder
gateway adapter that is BUILT IN BUT DISABLED BY DEFAULT. In dev mode
(PAYMENTS_ENABLED=false) registration must complete without any payment so the
team can test all internal platform features.

Follow the repository's AGENTS.md invariants exactly. The non-negotiables:

1. The server owns truth. A client may never assert that a payment happened.
   Only verified gateway events (signed webhooks or server-to-server
   capture checks) may change payment state.
2. Money state is an append-only ledger, same discipline as the score ledger:
   no UPDATE/DELETE of payment rows; refunds and reversals are new entries
   referencing the original; every state transition is derived, never stored
   by overwrite.
3. Idempotency everywhere: webhook delivery is at-least-once, so every payment
   event carries a gateway event id that is unique-constrained; duplicate
   deliveries must be no-ops; concurrent attempts must resolve via row locks.
4. Least privilege and trust domains: payment tables live in the `app` schema
   only; nothing payment-related may touch the `gt` schema. New roles or
   grants must be justified.
5. Errors use the existing envelope (`backend/app/errors.py`) with stable
   catalog codes; never leak gateway internals, card data, or account
   existence.
6. Migrations are ordered forward-only SQL files in `backend/migrations/`.
7. All secrets (gateway API keys, webhook signing secrets) come from
   environment configuration; never in source, .env.example, docs, or logs.
8. Every capacity, security or performance claim you write must be measured
   or explicitly marked provisional.

### What to design and build

A. Registration flow (works today with payments off):
   - Organizer creates an event registration link: a single-use or
     expiring registration code tied to one event (and optionally one team
     slot). Model it next to the existing `teams.join_code` and `app.invites`
     patterns.
   - Team lead opens the link, creates the team (name, contact), adds 4-5
     member emails; members get accounts in `pending` status with an invite
     (existing invite mechanism) and complete signup by setting a password.
   - Registration state machine: draft -> pending_payment (only when payments
     enabled) -> confirmed -> withdrawn/cancelled. With payments disabled the
     transition is draft -> confirmed directly.
   - Caps enforced server-side: max teams, max participants, team size 4-5,
     registration deadline from the event row (server clock, never client).
   - Duplicate prevention: one confirmed team per registration code; one
     membership per (event, user); emails unique (existing constraint).

B. Payment adapter (placeholder now, real gateway later):
   - A provider-agnostic interface in `backend/app/payments.py` (or a package):
     create_checkout_session(team_registration) -> redirect/checkout id,
     verify_webhook(request) -> verified event envelope,
     get_capture(capture_id), refund(capture_id, amount_minor_units, reason).
   - Ship a `NoopGateway` used when PAYMENTS_ENABLED=false (default): no
     external calls, registration auto-confirms.
   - Ship a `FakeGateway` for tests and local rehearsal: deterministic
     success/failure/timeout scenarios driven by test-only fixtures.
   - The real gateway adapter is NOT built in this task; the interface and
     tests must make adding one a contained change. Mark the real-gateway
     choice OPEN (likely candidates for India: Razorpay, Cashfree, Stripe;
     UPI vs card; GST handling) and list the decision inputs.

C. Money invariants (the hard part, be explicit in the design doc):
   - Amounts stored as integer minor units (paise) plus currency code; never
     floats.
   - Payment ledger tables: payment_intents, payment_captures, payment_events
     (raw verified gateway events, append-only), payment_refunds. Each row
     references the registration and (for refunds) the original capture.
   - Refund and failure rules to define and implement:
     * checkout expires -> intent expires, no money moved, team can retry;
     * capture verified but registration fails (cap reached, deadline passed)
       -> automatic refund entry + operator alert;
     * duplicate capture for the same intent -> ledger records the event,
       triggers a single refund, never double-confirms;
     * team withdrawal before event start -> refund per policy flag
       (full/partial, organizer-configurable, OPEN decision);
     * event cancellation -> refund all confirmed registrations;
     * chargeback/dispute event -> flag registration, freeze participation
       pending organizer review (never auto-approve).
   - Reconciliation job in the existing worker/queue: nightly job compares
     ledger state against gateway state and writes discrepancies as audit
     entries. Webhook signature verification, timestamp tolerance, and replay
     protection are mandatory.
   - PCI scope: card data never touches our servers; hosted checkout redirect
     only. State this boundary in the design doc.

D. Audit and observability:
   - Payment state transitions write to the existing `audit` hash chain.
   - No card, token, or gateway secret material in logs or audit details.

E. API surface (participant + organizer), following existing conventions:
   - POST /v1/registration-links (organizer create), GET list/revoke;
   - public (unauthenticated or light-auth) registration endpoints under the
     link token: create team draft, add members, confirm;
   - organizer: registration list, manual confirm/comp (waiver), refund
     initiate, capacity dashboard;
   - webhook endpoint for the gateway (raw body, signature verified).

F. Tests (all gates must stay green, clean
   frontend build):
   - unit: adapter contract on FakeGateway (success, failure, timeout,
     duplicate webhook, out-of-order webhook, expired checkout);
   - ledger: idempotent replay, refund references original, no UPDATE/DELETE;
   - authorization: participant cannot confirm another team, cannot read
     another team's registration, webhook replay rejected, link expiry and
     single-use enforced;
   - e2e: extend scripts/e2e_journey.py with a registration journey in
     payments-off mode (link -> team draft -> members -> confirmed -> submit
     bugs -> results) and a payments-on rehearsal against FakeGateway
     including one auto-refund path.

G. Deliverables:
   1. docs/REGISTRATION_AND_PAYMENTS.md: state machines (registration and
      payment), sequence diagrams as text, failure matrix, OPEN decisions list;
   2. migrations + models + grants for the new tables;
   3. backend/app/payments package with NoopGateway and FakeGateway;
   4. endpoints + RBAC + error codes;
   5. frontend: registration link page and organizer registrations console
      following docs/FRONTEND_DESIGN_DIRECTION.md (case-file design system,
      bespoke SVG icons, no HTML rendering of participant content);
   6. test suite additions and an updated e2e journey;
   7. a short runbook section in docs/DEPLOYMENT_RUNBOOK.md for enabling a
      real gateway later (env vars, webhook URL registration, rotation).

Constraints: Python 3.12, SQLAlchemy 2.0 style with text() and explicit
CAST(... AS uuid) in raw SQL, FastAPI conventions as in the existing code,
no new infrastructure (no Redis, no external queue), feature flags follow the
existing kill-switch pattern (RUNNER_ENABLED, AI_ASSESSMENT_ENABLED).
PAYMENTS_ENABLED defaults to false everywhere including CI. Dev-only demo
credentials stay dev-only. Do not touch the `gt` schema or the answer key.
Keep the frontend build clean (no TODO/Lorem/XXX).

## End of prompt

---

## Local stopgap while this is being figured out

- Dev accounts can be added directly to the local database with
  `scripts/add_dev_account.py` (dev-only, refuses outside development).
- Registration links and payments stay out of the participant path until the
  design above is reviewed and accepted.

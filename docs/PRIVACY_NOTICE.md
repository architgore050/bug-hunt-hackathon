Status: v1 draft for organizer review, 2026-11-22

Open fields:
- [TO BE FILLED: club contact email]

# Privacy Notice (Fall Back platform)

This notice describes what the Fall Back competition platform collects, why,
what it does not collect, and how long it is kept. It is written for
participants of the event run by the Software Development Club (SDC), VIT
Bhopal University, on 6 December 2026 (proposed date). The version published
at /privacy inside the platform is the summary participants see; this document
is the fuller publication draft.

## 1. Who runs this

The platform is operated by the Software Development Club, VIT Bhopal
University, for the Fall Back event. Student coordinators: Kalpesh Parashar
(24BCE11194) and Aashish Prasad (25BAI11637). Faculty coordinator: Dr.
Praveen Lalwani. Contact for any privacy question or correction: [TO BE
FILLED: club contact email].

## 2. What is collected

- Account data: your email address, your name as provided at activation, your
  role (participant, reviewer, organizer, admin), your account status, and a
  short internal registration identifier generated at activation. Passwords
  are stored only as salted hashes; invite tokens and password reset tokens
  are stored hashed and single use.
- Team data: your team membership (team name, join code) and your team's
  status.
- Competition records: the submissions you file (report text, target file,
  line range, category, claimed severity, flag codes, timestamps), drafts you
  leave open, the review decisions made on them with reviewer rubric scores,
  your team's score ledger entries, and any dispute you file with its
  statement.
- Session and security logs: each sign-in creates a session record with a
  hashed IP (truncated HMAC, not the raw address), the browser user agent,
  creation time, and last-seen time. Rules acceptances are recorded per rules
  version with the same hashed IP treatment.
- Audit trail: every privileged action on the platform (activation, stage
  control, configuration changes, releases, dispute resolutions, ground
  truth operations) writes an entry to a hash-chained audit log: actor, role,
  action, entity, request id, timestamp. This is what makes scoring results
  reconstructable after the event.

## 3. Why it is collected

- To run the competition: deliver the challenge files, accept and receipt
  submissions, enforce the deadline, caps, and cooldowns server side.
- To score fairly: matching reports against ground truth, recording reviewer
  decisions, computing the ledger, and publishing results you can verify
  against receipts.
- To keep the event auditable and safe: the audit trail, session logs, and
  acceptance records support integrity checks, dispute resolution, and the
  post-event retrospective.

## 4. What is NOT collected

- No trackers, no third-party analytics, no advertising of any kind.
- No cookies beyond the first-party, HttpOnly refresh session cookie, scoped
  to the refresh endpoint path only.
- No AI provider data. AI-assisted scoring is disabled in this deployment
  (ai_assessment_enabled off per DEC-13); participant report text is not sent
  to any external AI service.
- No email marketing. Mail is limited to operational messages: invites and,
  when an email provider is configured, password resets. In the current v1
  deployment there is no mail provider; reset tokens are surfaced through the
  organizer console path, never by marketing mail.
- No sale or sharing of data with anyone outside the club's organizing team
  and review staff.

## 5. Retention

- Event data (accounts, teams, submissions, decisions, ledger, disputes, audit
  trail) is retained for the dispute window after results are released and
  for the club's results archiving, then reduced or archived.
- Local development data stays local. The seeded development database and any
  rehearsal data are not part of the event record and are discarded with the
  environment.
- Database backups and CSV exports (results, submissions, score ledger) are
  controlled by the organizers and covered by the same retention rule.

## 6. Your rights and contact

- You can see and verify your own data at any time: your submissions with
  receipts, your results ledger after release, and your session list through
  the platform API.
- Corrections (for example a name typo) and any deletion question go to the
  coordinators at [TO BE FILLED: club contact email].
- Good-faith reports about how this platform handles data are covered by the
  same safe harbor as security reports in the competition rules.

## 7. Deployment note

This event runs on the D0/D1 profile: a single-VM, free-tier deployment with
no service level agreement. The organizers keep the competition fair and
time-accurate by design (server-owned clocks, transactional receipts,
audited controls), but they do not guarantee uninterrupted operation, and
verified outages are handled through the announced time-adjustment process
rather than ad hoc extensions. Do not rely on the platform for anything
beyond the event.

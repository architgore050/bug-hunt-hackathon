Status: v1 draft for organizer review, 2026-11-22

Open fields:
- [TO BE FILLED: club contact email]
- [TO BE FILLED: venue and room]
- [TO BE FILLED: doors-open and start time on 6 December 2026]
- [TO BE FILLED: dispute window length, announced with results]

# Fall Back: Competition Rules

Fall Back is a full-stack debugging competition organized by the Software
Development Club, VIT Bhopal University. It runs offline on campus on
6 December 2026 (proposed date) for 180 minutes. These rules are the
participant-facing contract for the event; the version published through the
platform at /rules is the authoritative text, and acceptance is recorded per
version when you activate your account and inside the lobby.

## 1. Eligibility and teams

1. Teams of 4 to 5 participants, registered through the Software Development
   Club. Registration closes before the event; the club confirms team
   membership by email.
2. Every participant must be physically present at the venue
   ([TO BE FILLED: venue and room]) for the full event window. Doors open at
   [TO BE FILLED: doors-open and start time on 6 December 2026]; the round
   runs on the platform clock in Asia/Kolkata.
3. Accounts are personal. One account per person; sharing, lending, or
   transferring an account between people is prohibited.
4. The organizers may cap participation (provisional capacity: 50
   participants, 12 teams) and will confirm final numbers before the event.

## 2. Accounts, invites, and activation

1. Each registered participant receives a single-use invite link (valid 48
   hours) to the platform's activation page. Activation sets your password and
   records your acceptance of these rules for the published version.
2. Passwords must be at least 12 characters; the activation page also checks
   for upper and lower case letters, a digit, and a symbol.
3. If your invite expires or the link is lost, contact the organizers at
   [TO BE FILLED: club contact email] or at the registration desk for a
   reissued invite.
4. Acceptance of the rules version is a condition of submitting. The platform
   will not accept reports or file access from accounts without a recorded
   acceptance for the current version.
5. Keep your receipt codes. Every accepted submission returns an immutable
   receipt code; it is your proof of filing time and content for disputes.

## 3. The main task

1. Every team receives the same preconfigured full-stack application with
   intentionally planted defects (the Papyrus campus notes app: Node.js,
   SQLite, and a browser front end). You receive the source files through the
   platform when the round opens.
2. Your job: run the app locally, reproduce the failures, trace each one to
   its root cause, fix the code, and file structured bug reports through the
   platform before the deadline. Some defects span more than one file.
3. The application's own README lists the behaviors the app should have.
   The gap between promised behavior and observed behavior is your working
   list.
4. The server owns the clock. The round starts and ends by platform time
   (Asia/Kolkata); the countdowns in your lobby and workspace are the
   authoritative ones. There is a short grace period after the deadline for
   in-flight submissions only.
5. You do not need to submit fixed code through the platform in this event.
   Verification of repairs is done by the organizers offline using the hidden
   functional tests; your reports plus your recorded test results drive the
   functional component of your score.

## 4. Submission format and caps

A bug report contains: target file, line range, category, title, root cause
description, and optionally impact, evidence, suggested fix, and a claimed
severity.

1. Line span: at most 25 lines per report. Point at the defect, not the whole
   file.
2. Caps: at most 12 active reports per file and 80 reports per round per
   participant, enforced server side.
3. Cooldown: 20 seconds between reports on the same file.
4. Title: 5 to 120 characters. Description: at least 20 characters explaining
   the root cause (2000 maximum). Impact and evidence: up to 500 and 2000
   characters. Evidence is required for borderline matches in practice;
   include exact requests, outputs, or observed values.
5. Category taxonomy (choose the closest): logic, input_validation,
   authentication_authorization, injection, cryptography, resource_handling,
   concurrency, error_handling, configuration, integration_api_contract,
   data_handling, other.
6. Claimed severity (low, medium, high, critical) is informational only.
   Awarded points come from the platform's ground truth, never from the
   severity you claim.
7. Submissions need an active round. While the round is paused, submissions
   are rejected; after the deadline they are rejected with the round-ended
   error. A submission the server already accepted keeps its receipt even if
   the clock moved at the same moment.
8. Drafts autosave while you write; a draft is not a submission. Only a
   filed report with a receipt is scored.

## 5. Hidden feedback policy

1. Verdicts, matched bugs, and points are hidden until the organizers release
   results. Before release, your submission history shows receipt status
   only.
2. The leaderboard is hidden for this round by stage configuration until
   release.
3. Probing the evaluation with template or duplicate reports to extract
   verdict information early is a violation of these rules and undermines the
   cap system for everyone.

## 6. Scoring summary

The full model is documented for organizers; this is what participants need.

1. Main score: functional tests 50 percent, code review 30 percent, evidence
   and report quality 20 percent, applied per accepted finding. The weights
   are frozen before the event.
2. Functional tests: the organizers run hidden tests against the repaired app
   and record pass rates per finding.
3. Code review: reviewers score your root cause analysis and fix quality on a
   rubric. Findings without a reviewer score by release receive a default
   review quality (0.8), which is disputable in the window.
4. Evidence and report quality: computed from your report's own evidence
   against the finding, at match time.
5. Duplicate findings of the same defect by one team score once; later ones
   are marked duplicate and are not penalized.
6. Definitively invalid reports may carry a small capped penalty (2.5 points
   per invalid report, capped at 20 percent of the stage maximum), applied
   only at finalization and never shown live.
7. Tie-breakers: higher total, then fewer invalid reports, then the earlier
   last accepted finding.
8. Every scored point is traceable to a submission receipt in the results
   ledger you can see after release.

## 7. CTF side quests and their caps

1. The challenge app contains two optional flags. Finding them is in scope;
   investigating the app's admin corner is allowed.
2. Submit the exact flag string through the platform. A verified flag pays
   bonus points (30 per flag this event).
3. The total CTF bonus is capped at 100 points per team for the round.
   Wrong or duplicate codes earn nothing and are recorded.
4. Flags are a bonus, never a substitute: no prize position depends on flags
   alone.

## 8. Code execution note

No participant code runs on the platform in this event. You run the challenge
app on your own machine only; the platform stores and serves challenge files
inertly and never executes anything a participant uploads (participants do
not upload code at all in v1). Hidden functional tests are run by the
organizers offline, not by a platform runner.

## 9. Conduct and scope

1. Attack only the provided challenge application, on your own machine,
   inside the event window.
2. Attacking the platform, the venue network, other teams, or any external
   system is prohibited and grounds for disqualification.
3. Do not share findings, code, fixes, or flags between teams. Do not publish
   or broadcast challenge content during the event.
4. Screenshots of the challenge are prohibited for the main task; describe
   findings in your reports instead.
5. AI tools are prohibited for the main scored task. You may not use AI
   coding assistants, chatbots, or any LLM-based tool to produce, debug, or
   polish code, reports, or submissions during the competition window. Web
   search of documentation and reference sites is allowed; asking an AI to
   generate or transform content is not. The venue network is configured so
   AI services are unreachable during the round, and the honor declaration
   you accept at activation covers this clause. (Policy rationale and
   enforcement layers: docs/AI_TOOLING_RESEARCH_AND_DECISION.md.)
6. Proctors may inspect the screen and process list of a participant machine
   on reasonable suspicion, in the presence of a second proctor.
7. Be civil to volunteers, reviewers, and other teams. Harassment ends your
   event.

## 10. Disqualification criteria

The organizers may disqualify an account or a team, in whole or for affected
submissions, for:

1. Attacking anything outside the challenge app.
2. Sharing findings, code, or flags between teams, or using another team's
   material.
3. Using AI tools on the main scored task, or a second device to reach AI
   services.
4. Account sharing or impersonation.
5. Probing the evaluation with template reports.
6. Tampering with another team's environment, the venue network, or event
   hardware.
7. Repeated uncivil conduct after a warning.

Disqualification decisions are recorded by the organizers with reasons.
Affected accounts lose platform access (sign-in is refused with a
contact-the-organizers message); score effects are applied through the score
ledger so the audit trail stays intact.

## 11. Disputes

1. After results are released, a team may dispute any of its own results
   through the platform within the announced window
   ([TO BE FILLED: dispute window length, announced with results]).
2. File the dispute on the submission's page with a factual statement of what
   you believe was scored incorrectly. Release-default review scores and the
   invalid-report penalty are both disputable.
3. Resolutions are final. Outcomes and any point corrections are recorded in
   the score ledger with the resolution note.

## 12. Platform security safe harbor

Found a vulnerability in the competition platform itself? Report it privately
to the organizers immediately (desk or [TO BE FILLED: club contact email]),
without exploiting it beyond the minimum needed to demonstrate it. Good-faith
reports are welcomed and will not be penalized or pursued. This safe harbor
does not extend to attacking the platform for competitive advantage, which
remains grounds for disqualification.

## 13. Accessibility and accommodations

1. Participants who need accommodations (seating, screen readers, extra time,
   permitted assistive software) should request them from the organizers
   before the event ([TO BE FILLED: club contact email]) or at the
   registration desk on the day. v1 has no self-service profile form, so the
   request travels through the organizers and is recorded on the event.
2. Approved time adjustments are applied per participant through the
   platform's adjustment system with the ACCOMMODATION reason code, extend
   that participant's effective deadline, and are recorded in the audit
   trail. The affected countdowns reflect the adjustment automatically.
3. The platform targets WCAG 2.2 AA: keyboard operability, visible focus,
   text-plus-color status indicators, and reduced-motion support.

## 14. Privacy summary

The platform collects only what the competition needs to run and stay
auditable: your account email and name, team, submissions, review decisions,
scores, hashed session logs, and your rules acceptances. No trackers, no
third-party analytics, no AI provider data (AI scoring is disabled). Details
and your rights: the privacy notice at /privacy and
docs/PRIVACY_NOTICE.md. Questions: [TO BE FILLED: club contact email].

## 15. Governing context

These rules govern the Fall Back student event of the Software Development
Club, VIT Bhopal University. Where these rules overlap with the platform
terms of use, the rules document published through the platform is
authoritative. Faculty coordinator: Dr. Praveen Lalwani. Student
coordinators: Kalpesh Parashar (24BCE11194), Aashish Prasad (25BAI11637).

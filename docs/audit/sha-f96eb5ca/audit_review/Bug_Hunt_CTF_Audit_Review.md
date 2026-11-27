# Review of the Bug Hunt CTF Engineering Audit

Status: review of docs/audit/sha-f96eb5ca/Bug_Hunt_CTF_Audit.md, completed 2026-11-27
Reviewed SHA: current main (427f268). Delta between the audited tree (f96eb5ca) and main verified as exactly one commit, 3bd3a96 "Clarify participant points and level scores", plus the audit documents themselves. All verdicts below are against current main, which is valid per that delta.

## 1. Scope and method

This is a second-opinion review of the 227-finding audit. The review did not re-read the whole codebase; it verified the audit's claims directly against the code at main, in five independent verification passes covering every P0 finding and sampled P1/P2/P3 findings from all ten blocks (A through J), plus a fresh-eyes hunt for issues the audit missed and an analysis of the one commit the audit predates.

51 claim groups were verified. Result: 41 fully confirmed (80%), 5 partially correct, 4 describe intended behavior, 1 is flatly wrong. The fresh-eyes pass found 10 real issues the audit does not list. Ground truths were re-measured, not trusted: the CI workflow file, the test count, the audited-SHA-to-main diff, and the /v1/team/score contract were all checked directly.

Overall verdict on the audit: high quality and mostly trustworthy. Its cross-referencing discipline, its line citations, and its separation of severity tiers hold up under verification. Its weaknesses are: one fabricated P0 (F-I-02), a P0 (F-C-02) that is actually a documented product decision the audit should have classified as a ruling request rather than a defect, several missed opportunities to check the repo's own docs and code comments for intent evidence, arithmetic slips, and blindness to everything introduced by commit 3bd3a96, which lands on the most participant-visible screen in the event.

## 2. Findings that are intended behavior

These are audit findings where the code does what the audit says, but the behavior is deliberate, documented, and should be handled as a design decision, not a bug fix.

### 2.1 F-C-02 / F-F-04 / F-G-15: live pre-release participant points (audit called it a P0 ground-truth oracle)

The mechanism is real: GET /v1/team/score returns live ledger points before feedback release, and the dashboard polls it every 5 seconds. But it is a documented product decision, not a leak:

- docs/design/Bug_Hunt_CTF_Participant_Website_Spec.md mandates it: team points refresh "5 s during levels, 30 s otherwise" (line 92); the points card shows cumulative points with completed levels rendered as score / max points and unfinished levels showing "Evaluating" (lines 179-181, 210).
- Commit 3bd3a96 (after the audit, before main) rebuilt the endpoint around exactly this contract: an explicit released flag, per-level evaluation_status (not_submitted / evaluating / complete), max_points, and a points-versus-score split, documented in docs/SCORING_MODEL.md ("Participant display distinguishes cumulative points from evaluation score...") and docs/EVENT_FLOW.md section 7.
- New tests in backend/tests/test_flow_submissions.py pin the behavior: points visible while the event is live, evaluation_status transitions, score excluding ctf_bonus.

The audit itself flagged "needs product ruling" on F-G-15; the ruling has now been made in code, tests, and docs. Residual items the event team still owns:

1. The adversarial concern behind F-C-02 (participants can binary-search flags against live points) is a real tradeoff of the ruling. It needs an explicit accept/reject in the security docs, not a code change.
2. The clarification commit removed the old "unreleased" chip and the current/released total split from the dashboard, so pre-release points now render under a plain "Total points" heading with no provisional cue. That is a labeling regression, not the audit's leak.
3. Pre-release per-level score omits release-time penalties (SCORING_MODEL.md section 5: applied once, at release only), so displayed totals can silently drop at release. Participants should be told that release-time penalties exist.

### 2.2 F-A-01: first-login password claim (audit called it a P0 account takeover)

The mechanism is real, but it is an accepted-risk design decision, stated in the code: backend/app/routers/auth.py:70-75, "First sign-in flow: no activation invite needed... NOTE: this is a risk we are willing to take for this event." For an offline walk-in event with 50 students and rosters known in advance, frictionless activation was chosen deliberately.

One sub-claim remains a real, unintended bug: the disqualified resurrection. Line 86 rebuilds the user dict with status forced to "active" before line 90 checks status == "disqualified", so the check is dead code on the claim path. A disqualified participant without a set password can still claim the account. The fix is three lines: check status before mutating, keep the intended flow for everyone else. The audit's demand to replace the whole mechanism with invite-token activation contradicts a decision the repo has already made in writing.

### 2.3 F-A-07: password-reset tokens printed to server logs

Real, and deliberate: auth.py:519-521 documents it ("v1: no email provider configured... surfaced through the organizer console and dev logs only"), and docs/KNOWNS_LIMITATIONS_AND_FOLLOWUPS.md L-01 tracks the SMTP follow-up. Intended for v1. The operational consequence stands: whoever can read server logs can reset organizer accounts, so the deployment checklist must treat log confidentiality as a security boundary on a shared box.

### 2.4 F-G-06 / F-G-07: unescapable deadline modal (audit called it a P1 wall)

"No dismiss" is spec-mandated: docs/design/Bug_Hunt_CTF_Participant_Website_Spec.md line 69 "Modal, no dismiss", and the flow plan says the client polls progress until the pointer advances. That poll and the redirect exist (workspace useProgressQuery plus guardRedirect). The audit's "walled indefinitely" scenario only happens if the progress poll fails on a bad network, so the real finding is narrower than stated: add a visible retry/status state to the modal on poll failure. The modal's existence and unescapability are intended.

### 2.5 F-H-03 / F-H-08 / F-H-09: Option B (Marina) broken parity

Every factual sub-claim verified: FLAG-1 plaintext exists nowhere in the app, auth is client-supplied identity, the comment XSS is unreachable from its own UI, FLAG-2 decodes without the FLAG{} wrapper. But this is documented as a development fixture, not a second challenge: challenge-app-option-b README "Development-only challenge fixture... It is NOT the production challenge", and seed.py "Development fixture only - the production challenge packages are organizer deliverables". The audit's own Section 10 said as much ("an intentional A/B dev fixture, not cruft") but Block H and the parity narrative still score it as if it were production. As long as Option B never ships to participants, these are non-issues; keep the re-label-and-exclude decision, delete nothing.

### 2.6 F-H-01 (partial intent): BUG-XX labels in shipped source

The labels are real (9 of 10 bugs carry BUG-XX category and root-cause comments) and read as deliberate self-aware scaffolding (auth.js:50 "on purpose", app.js:131 "controlled"). But no README, answer key, or design doc declares them participant-facing teaching aids, and docs/CHALLENGE_DESIGN_AND_GROUND_TRUTH.md actively claims GT anchors are the only hints. Two corrections to the audit's framing: (a) the math is wrong, 250 of 275 points are labeled (BUG-09, 25 points, is the only unlabeled one), not "260 of 275"; (b) whether to strip labels is a difficulty ruling for the event team, and given the club audience, keeping them is a defensible choice. Decide it explicitly; do not treat it as an accidental leak. F-H-04 (FLAG-1 plaintext in shipped db.js) is different: that one contradicts the challenge design doc directly and is a genuine flaw.

### 2.7 F-B-01 (nuance inside a confirmed P0)

Staged payment is the documented design: SCORING_MODEL.md section 3 says level reports pay "evidence now, code_review from the reviewer or at release, functional_test when recorded". The defect the audit found is that the mechanics defeat this design (the LIMIT 1 without ORDER BY, the per-submission component cap, and the release backfill excluding kind='level_report'). The severity stands; the audit's description should be corrected to "implementation defeats documented staged payment" rather than "scoring was never designed to pay level reports".

## 3. Where the audit is wrong

1. F-I-02 (P0 number 8, "CI trigger corrupted, 'branches: ain]', CI never runs") is false. The workflow at the audited SHA and at main reads on: pull_request: branches: [main], push: branches: [main]. Verified three ways: current file, git show f96eb5ca:.github/workflows/ci.yml, and git log showing zero commits to the file in the window. The trigger is intact, the six jobs are real, and the audit's retraction of every "CI green" claim is unfounded. Wave 0 loses one item; the P0 count is 13, not 14. The repo should still add the workflow-schema lint it suggested, but as hardening, not as a fix for a break.
2. F-A-16 (cross-team ledger leak) is overstated. The stage-wide BOOL_OR(feedback_released) gate is real: one team's early release opens ledger reads for every team. But the data read is own-team only (leaderboard.py filters team_id to the caller). No participant can ever read another team's points or matched bug codes through this path. The real issue is "one team's early release prematurely reveals every team's own results", a fairness defect, not a confidentiality breach.
3. F-H-01 arithmetic: 250 points are grep-readable via labels, not 260-275.
4. F-C-10 characterization: malformed UUIDs produce a clean JSON 500 envelope (INTERNAL_ERROR, no traceback), not raw 500s with stack traces. Still the wrong status code and worth fixing; but invariant 7 (no stack leakage) is not violated.
5. F-I-01 framing: the README headline "load-ready for a 50-participant rehearsal" is real, but the same README qualifies the claim as provisional at lines 109-111 and the readiness gate mechanically blocks go-live on the load test. This is carelessness in a headline, not the invented-capacity violation it is presented as. The fix (reword the headline) stands.
6. Ground truth drift: the audit declares 74 tests and "AGENTS.md is the only correct document". True at audit time; current main has 75 test functions (the clarification commit added tests). AGENTS.md is now stale as well. The test-count-chaos finding is correct in kind, but the audit's own ground-truth number is already outdated, which proves its own point about single-sourcing volatile numbers.

## 4. What the audit missed

### 4.1 New defects introduced by commit 3bd3a96 (the audit predates this commit)

1. max_points is seeded as the whole-challenge total on every level. seed.py line 740 computes sum of all GT_BUGS points (275) inside the per-level loop, so all four level stages carry max_points = 275, while a level's realistic maximum payout is roughly 20 percent of that (evidence_report weight, runner disabled). The new dashboard renders score / max_points per level, so every team sees numbers like "12 / 275" for excellent work on the most-watched screen of the day, and the new test pins the wrong value as contract (test_flow_submissions.py asserts max_points == 275 for every level). Fix: per-level maxima in seed (and organizer-approved production values, which SCORING_MODEL.md already lists as an open field).
2. Stale query-key invalidation after the rename. LevelWorkspace.tsx line 352 still invalidates ['team-score'], but the query key was renamed to ['team-points'] (event-session.ts line 134). Post-submit points refresh is silently dead; only the 5-second poll recovers it. One-line fix.
3. The provisional cue was removed. The old ScoreCard rendered an "unreleased" chip and a current-versus-released total; the new PointsCard shows "Total points" unconditionally. Combined with item 6 below, pre-release display now overpromises.
4. evaluation_status can stick at "evaluating" forever with no operator remedy. The new status query counts jobs with status in (queued, running, dead) as still evaluating (levels.py lines 666-668). Dead is terminal, and no endpoint anywhere requeues or retries a dead job (admin.py only exposes a count). One poisoned evaluate job freezes that team's level card at "Evaluating" indefinitely, on the screen participants watch all day, during the tightest phase of the event.
5. The new status query is a correlated EXISTS over app.jobs payload JSON (j.payload ->> 'submission_id' = s.id::text) with no supporting index (migrations/0001 has no index on any payload expression) and jobs are never purged at runtime. It runs on every team-score call, polled every 5 seconds per team pre-release. At 10 to 12 teams it will probably hold, but it is the same class of unmeasured poll cost the audit flagged for /v1/progress, now with a JSON-expression join the schema cannot serve.
6. Displayed score includes penalties. score sums non-ctf_bonus ledger components (levels.py line 709-714), so release-time penalties are inside the numerator displayed against max_points. Combined with item 3, participants see a "final-looking" number that can silently drop at release.

### 4.2 Pre-existing defects the audit missed

7. Stage start derives the deadline from the event-level duration. admin.py lines 329-331 set ends_at = now + events.duration_minutes when starting any stage. duration_minutes is the single-stage v1 budget (seeded 180), while the four-level flow defines per-level windows (L2: 45 minutes). Starting Level 2 from the console silently gives it a 180-minute window that overlaps Levels 3 and 4. With F-G-14 (start is an unconfirmed single click) this is one stray click from a broken schedule. Fix: per-stage duration config consulted by start.
8. Migration 0003 uniqueness keys omit event_id. app.level_drafts UNIQUE (author_id, level_no), app.participant_progress UNIQUE (user_id, level_no), participant_pointers user_id UNIQUE. Runtime reads key on user+level only. A second event created in the same database (exactly what a pre-event rehearsal on the live box looks like) either collides with a 500 on first write or, worse, cross-bleeds drafts, progress, and gates between the rehearsal and the real event.
9. The extend action has no status gate and silently no-ops when ends_at IS NULL (admin.py lines 358-366): it returns ok:true while changing nothing on draft or bootstrapped stages, and can move ends_at on an already-ended stage. It is the panic button an organizer reaches for mid-incident.
10. Lease requeue ignores attempts. jobs.py lines 107-113 requeue any running row whose lease expired, without consulting attempts or max_attempts; only fail() dead-letters, and fail() runs only on catchable handler exceptions. A job that kills the worker process (OOM class) or legitimately outlives the 120-second lease is re-claimed forever, never dead-letters, and compounds item 4.

### 4.3 Areas re-checked and found clean beyond the audit's findings

Announcements and time_adjustment write paths, set_readiness (beyond F-C-16), the review claim/steal/decide lifecycle (beyond F-C-14, F-B-10, F-B-18), seed GT ingestion versus challenge-app source (allowlist matches the shipped tree, option A/B bug totals both 275), frontend persistence timers and IndexedDB open handling (beyond F-F-20), and challenge-app routes input handling. The audit's coverage of these areas was already sound.

## 5. Resolved ground truths

1. Repository visibility (F-J-12 "needs verification"): the repository is public. It was cloned anonymously over HTTPS with no credentials during this review. The RESTRICTED answer key and all flag plaintexts (db.js FLAG-1, answer key, seed GT) are therefore already exposed to anyone who finds the repo. This upgrades F-H-06/F-J-12 from "decide visibility" to "act": regenerate all flag secrets at handout-packaging time (never commit event flags), rotate the answer key, and consider history scrubbing. None of the audit's remediation waves currently contain this step.
2. CI status: healthy (see section 3, item 1).
3. Test count: 75 at main, up from the audit's ground truth of 74.
4. The clarification commit's contract change: /v1/team/score now returns points, score, max_points, evaluation_status, released, released_total, and is event-scoped (the pre-3bd3a96 version joined stages without event_id, which the commit fixed). The audit's line citations for this endpoint describe the old shape.

## 6. Corrected priorities

1. Drop F-I-02 from Wave 0. P0 count is 13.
2. Reframe F-C-02 from "gate the endpoint" to "own the decision": keep live points per spec, restore a provisional cue on the dashboard, disclose release-time penalties in participant copy, and record the binary-search risk as an accepted tradeoff in SECURITY_ARCHITECTURE.md.
3. Keep F-A-01's fix scoped to the dead disqualified check; do not replace the walk-in flow, which the repo explicitly accepts as a risk.
4. Add to Wave 0 (new, participant-visible, cheap): per-level max_points seeding, the ['team-score'] key fix, a requeue/retry endpoint for dead jobs plus evaluation_status treating dead as failed (with an operator-visible state), and per-stage duration for the start action.
5. Add to Wave 1: regenerate flags at packaging time given the public repo, event_id in 0003 uniqueness (before any rehearsal on the live database), attempts enforcement in lease requeue, and a status guard plus NULL handling in extend.
6. Keep the rest of the audit's Wave 0 and Wave 1 as written; 41 of 51 verified claim groups held up fully, and the healthy-subsystems inventory (section 3.2 of the audit) checked out everywhere it was sampled.

## Appendix: verdict table

| ID | Audit severity | Verdict | Note |
| --- | --- | --- | --- |
| F-B-01 | P0 | CONFIRMED | Staged payment is documented design; mechanics (LIMIT 1, backfill excludes level_report) defeat it |
| F-C-02 | P0 | INTENDED | Live points are spec-mandated and now documented in SCORING_MODEL.md; ruling made in 3bd3a96; own the oracle tradeoff |
| F-C-01 | P0 | CONFIRMED | 'pause' vs 'paused' mismatch, scalar_one raises, compensation dead; no resume test |
| F-A-01 | P0 | INTENDED with real residue | Accepted-risk walk-in flow per auth.py comment; disqualified resurrection is an unintended dead-check bug |
| F-D-01 | P0 | CONFIRMED | nohup only; no compose/systemd/Dockerfile in repo |
| F-H-01 | P0 | PARTIAL | Labels real but 250 of 275 points (not 260-275); intent undocumented; strip-or-keep is a difficulty ruling |
| F-C-03 | P0 | CONFIRMED | 'armed' accepted at submit; no starts_at check on the submit path |
| F-I-02 | P0 | WRONG | Trigger is clean [main] at f96eb5ca and main; zero commits to ci.yml in the window |
| F-J-01 | P0 | CONFIRMED | Event-facing docs still describe the retired single-stage shape |
| F-E-02 | P0 | PARTIAL | Coverage gap real; but the pinned behavior is now a documented contract, not a pinned bug |
| F-D-02 | P0 | CONFIRMED | Lock held across diff and artifact I/O |
| F-I-01 | P0 | PARTIAL | Headline real; README itself marks the claim provisional at lines 109-111 |
| F-H-02 | P0 | CONFIRMED | Whole-boot crash; answer key repro wrong |
| F-B-04 | P1 | CONFIRMED | No idempotency guard on penalty insert; documented flow double-enqueues |
| F-B-02 | P1 | CONFIRMED | 'missed' lockout permanent; no organizer recovery endpoint |
| F-B-03 | P1 | CONFIRMED | No status/deadline re-check inside lock; fires during pause |
| F-B-06 | P2 | CONFIRMED | points_visible has no writer; API_REFERENCE promises the value |
| F-B-09 | P2 | CONFIRMED | Drafts writable post-deadline; silent truncation at 12 flags |
| F-B-05 | P2 | CONFIRMED | Span-free full location score; substring aliases with generic keywords; top-1 only |
| F-A-02 | P1 | CONFIRMED | Five uses keyed from jwt_secret; no re-key path; rotation hazard undocumented |
| F-A-03 | P1 | CONFIRMED | Dev defaults with no fail-closed boot guard |
| F-A-06/25, F-C-08 | P1/P2 | CONFIRMED | Unlocked read-then-insert chain; unkeyed sha256; verify truncates at 5000 rows |
| F-A-07 | P1 | INTENDED | Documented dev-mail path; SMTP follow-up tracked in KNOWNS_LIMITATIONS L-01 |
| F-A-11 | P2 | CONFIRMED | Grace re-select omits status; normal path checks it |
| F-A-12 | P2 | CONFIRMED | No rate limit, no row lock, reuse-revocation writes no audit row |
| F-A-14 | P2 | CONFIRMED | Client version accepted verbatim; pre-accept of version 999 possible |
| F-A-16 | P2 | PARTIAL | Stage-wide early unlock real; cross-team leak claim wrong (own-team filter) |
| F-A-17 | P2 | CONFIRMED | Timing and status enumeration on login |
| F-C-05 | P2 | CONFIRMED | Free-string invite role; organizer can mint admin; typo bricks account |
| F-C-06 | P2 | CONFIRMED | NaN and inf pass the ==0 guard; 3bd3a96's isfinite guard did not touch admin adjustments |
| F-C-07 | P2 | CONFIRMED | add_flag has no status check; add_bug does |
| F-C-10 | P2 | CONFIRMED with nuance | 500 envelope, not raw traceback; still wrong status |
| F-C-14 | P2 | CONFIRMED | needs_second_review dead-ends; item decided, no requeue |
| F-F-03/F-G-03 | P1 | CONFIRMED | /v1/levels carries raw ends_at; warnings and progress bar fire early after adjustments |
| F-F-04/F-G-15 | P1/P2 | INTENDED | Spec mandates 5s live points; 3bd3a96 answers the product ruling; labeling regressions noted in section 4.1 |
| F-F-01 | P1 | CONFIRMED | Refresh failure collapses to logged-out |
| F-F-02 | P1 | CONFIRMED | Only AUTH_TOKEN_EXPIRED ends the session; evicted session polls forever |
| F-F-06/07, F-G-02 | P2/P1 | CONFIRMED | Client-vs-server clock compare; conflict dialog wires both buttons to one state |
| F-G-01 | P1 | CONFIRMED | Editor editable over pending/failed fetch; keystrokes become the draft |
| F-G-04 | P1 | CONFIRMED | Submit does not check flush outcome |
| F-G-05 | P1 | CONFIRMED | No unmount/pagehide flush; Explain and Rules lose up to 3s of edits |
| F-G-06/07 | P1/P2 | PARTIAL | No-dismiss is spec intent and the redirect poll exists; missing status/fallback on poll failure is the real gap |
| F-G-08 | P1 | CONFIRMED | Three contradictory stories; the "account created on first sign-in" copy is factually false against backend |
| F-G-17 | P2 | CONFIRMED | CTA dead-ends at dashboard redirect |
| F-F-08 | P2 | CONFIRMED | queryClient.clear never called; clearAllForUser has zero callers |
| F-G-09 | P2 | CONFIRMED | Two tabs, one draft, last-writer-wins |
| F-H-02 | P1 | CONFIRMED | Boot-killing crash; key's own repro contradicts its symptom text |
| F-H-04 | P2 | CONFIRMED | FLAG-1 plaintext in shipped db.js; contradicts the challenge design doc |
| F-H-06/F-J-12 | P1 | PARTIAL, now resolved | Platform-side guards exist (seed allowlist, isolation test, e2e 404); repo path unguarded; repo confirmed public |
| F-H-03/08/09 | P1/P2 | INTENDED | Documented dev-only fixture; exclude from event and stop scoring it as production |
| F-I-04/F-E-01 | P1 | CONFIRMED, updated | Chaos real; ground truth moved to 75; AGENTS.md now stale too |
| F-I-18 | P3 | CONFIRMED | 47 call sites, runtime reports 46 |
| F-D-14/F-J-04 | P2 | CONFIRMED | seed max_teams=10 vs rules 12 |
| F-D-01 | P0 | CONFIRMED | nohup, no supervision artifacts |
| F-D-03 | P1 | CONFIRMED | No statement/lock/idle timeouts anywhere; pool 8+4 |
| F-D-06/07 | P1 | CONFIRMED | Unguarded --reset TRUNCATE; row triggers only; GRANT ALL includes TRUNCATE |
| F-D-08 | P1 | CONFIRMED | Autocommit per statement; 0001 not re-runnable; no advisory lock |

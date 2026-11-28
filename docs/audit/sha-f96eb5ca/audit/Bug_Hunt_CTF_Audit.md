# Bug Hunt CTF Platform - Complete Engineering Audit

**Repository:** architgore050/bug-hunt-hackathon  
**Event:** Fall Back, Software Development Club, VIT Bhopal University, 6 December 2026  
**Findings:** 227 total (14 P0 / 53 P1 / 86 P2 / 74 P3) across 10 audit blocks  
**Prepared:** 27 November 2026 - CONFIDENTIAL: EVENT TEAM ONLY

## Table of Contents

- 1. Executive Summary
  - 1.1 The five most important things this audit found
  - 1.2 Systemic themes
  - 1.3 Effort to a defensible event
- 2. Audit Scope, Method and Confidence
  - 2.1 Scope
  - 2.2 Method
  - 2.3 Ground truth established for disputed facts
  - 2.4 Confidence and limitations
- 3. System Snapshot and What Is Genuinely Healthy
  - 3.1 What the system is
  - 3.2 What is genuinely well built (keep and protect this)
- 4. The Fourteen Event-Day Breakers (P0)
- 5. Obvious Issues to Fix
  - 5.1 Broken and dangerous organizer flows
  - 5.2 Broken participant-visible behavior
  - 5.3 Obviously wrong or stale documents and configuration
- 6. Silent Failures and Deeper Hard-to-Notice Issues
  - 6.1 Results are silently wrong (the scoring pipeline)
  - 6.2 Secrets and sessions silently break
  - 6.3 State machines with permanent dead ends
  - 6.4 Participant work can be silently lost or corrupted (frontend)
  - 6.5 Trust instruments that silently lie
  - 6.6 Ground truth can be silently mutated
- 7. What Breaks Under Load on a Cheap Server
  - 7.1 The collapse chain, in order
  - 7.2 The measurement gap: the capacity claim is currently unearnable
  - 7.3 What will not break
- 8. Blind Spots: What Nobody Is Thinking About Yet
  - 8.1 The audience is adversarial, and the surface reflects it
  - 8.2 Operational realities nobody wrote down
  - 8.3 Process blind spots: the last mile of the event
  - 8.4 Code-level assumptions that will not hold
- 9. What to Add
  - 9.1 Infrastructure additions (before any rehearsal)
  - 9.2 Test additions (highest value first)
  - 9.3 Frontend and participant-experience additions
  - 9.4 Process and documentation additions
- 10. What to Remove
  - 10.1 Dead code and dead weight
  - 10.2 Decisions to make (remove-by-decision)
- 11. Good Ideas, Wrong Implementations
- 12. Bad Ideas That Need Replacing
- 13. Looks Correct in Code, Wrong in Practice
- 14. Compliance Scorecard Against the Repository's Own Rules
- 15. Documentation vs Reality
  - 15.1 Confirmed drift inventory
  - 15.2 What actually matches (credit where due)
- 16. Prioritized Remediation Plan
  - 16.1 Wave 0 - event-day breakers (target: complete before any rehearsal)
  - 16.2 Wave 1 - operational readiness (target: T-14 to T-7)
  - 16.3 Wave 2 - hardening (target: T-7 to T-0, only after Wave 1)
  - 16.4 Wave 3 - after the event
- Appendix A: Consolidated Finding Index

## 1. Executive Summary

This document is a complete engineering and operational audit of the bug-hunt-hackathon repository, the platform for the Fall Back debugging CTF (Software Development Club, VIT Bhopal University, planned 6 December 2026, 180 minutes, offline, teams of 4 to 5). The audit was performed by partitioning the entire codebase and documentation set into ten blocks and assigning each block to a dedicated expert auditor: an application-security red-teamer, a distributed-systems and database-transactions specialist, an API and data-leak auditor, a DBA and release engineer, a test architect, two frontend specialists, a CTF challenge author, an engineering-documentation auditor, and an event-operations auditor. Every non-trivial file in the repository was read in full by at least one auditor. The audit produced 227 evidence-backed findings, each citing file paths and line numbers, distributed as 14 severity-P0 (event-day breakers), 53 P1 (major), 86 P2 (should fix) and 74 P3 (minor). A consolidated index of every finding appears in Appendix A.

The headline verdict is two-sided. The architecture is genuinely good, and in several areas better than typical one-shot builds: ground-truth isolation is enforced by real PostgreSQL roles and tested against them, the score ledger is protected by a database trigger, the job queue uses correct claim-lease-dead-letter mechanics, the v1 submission transaction follows its written invariant almost exactly, and the documentation set labels unverified claims honestly. The implementation, however, is not event-ready. The fourteen P0 findings are concentrated in exactly the code that decides the competition: the scoring pipeline, the submission and deadline machinery, the authentication surface, the deployment story, and the challenge handout itself.

### 1.1 The five most important things this audit found

First, the four-level scoring pipeline is structurally broken: a level submission containing N accepted flags only ever earns the 20%-weight evidence component for all but one arbitrary flag, because downstream scoring keys on submission_id with an unordered LIMIT 1 and the release-time backfill explicitly excludes level reports (F-B-01, evaluator_level.py and evaluator.py). Most accepted flags will land at roughly 20% of their earned value, silently and unevenly per team. Second, GET /v1/team/score returns live ledger points to participants before feedback release, turning the platform into a ground-truth oracle for adversarial teams; a test currently pins this leak in as correct behavior (F-C-02, F-E-02). Third, the organizer pause-resume control is broken end to end: resume always throws a 500 and the stage stays paused forever, and pause time compensation silently never happens due to a status-string mismatch (F-C-01, F-J-03). Fourth, the deployment story does not exist: the API and worker are started with nohup, there is no supervision, no statement or lock timeouts on PostgreSQL, and a dead worker at minute 170 silently cancels every deadline auto-submit (F-D-01, F-D-02, F-D-03). Fifth, the shipped challenge source self-labels 9 of 10 planted bugs with BUG-XX comments describing category and root cause, so the competition is solvable with grep in minutes (F-H-01), while the RESTRICTED organizer answer key sits inside the folder participants receive with no packaging guard (F-H-06).

### 1.2 Systemic themes

Beyond individual defects, four systemic patterns run through the findings. (1) Results integrity: the scoring, release and display path is the least verified, most broken subsystem, despite being the reason the platform exists. (2) The deadline cluster: every component that touches the end of a level window (auto-submit, drafts, countdown UI, warnings, locks) fails in a different way at exactly the moment it matters. (3) Trust instruments that lie: the audit hash chain false-alarms under normal concurrency and proves nothing against a real attacker; manual score adjustments accept NaN; the capacity claim is repeated in prose but cannot be earned with the broken load-test tool. (4) Documentation drift: the participant-facing documents still describe a retired single-stage event shape, six documents assert different test counts, and the CI trigger is corrupted so the documented merge gate can never fire (F-I-02).

### 1.3 Effort to a defensible event

The P0 remediation wave (Section 16, Wave 0) is approximately five to eight focused engineer-days: all fourteen breakers have small, well-understood fixes, and none requires an architecture change. The harder work is operational and procedural (Wave 1): rewriting the participant-facing documentation for the four-level flow, building a deployment artifact set, running a real load rehearsal, and closing the last-mile event gaps (registration at scale, dispute window, results ceremony). The audit's overall judgment: with Wave 0 and Wave 1 completed and a full rehearsal executed, this platform can credibly run the event; without them, several failure modes are near-certainties rather than risks.

## 2. Audit Scope, Method and Confidence

### 2.1 Scope

The audit covered the full repository at HEAD: the FastAPI backend (app core, eleven routers, evaluation and scoring engines, job queue, worker, three SQL migrations, test files), the React 19 frontend (lib, ui, components, 18 pages, styles, tests), both challenge applications (Node Papyrus and Python option B), seven operational scripts, CI configuration, and the complete documentation set of roughly 35 root documents plus the design folder, including text extraction of the four DOCX and two PDF design artifacts. Approximately 40,000 lines of code and documentation were in scope. No servers were started and no code was executed or modified; the audit is static, evidence-based analysis.

### 2.2 Method

The repository was partitioned into ten blocks sized by line count and cohesion. Each block auditor was given a real expert role (not a role-play): for example, the flow auditor worked as a database-transactions specialist hunting lock-ordering and idempotency violations, and the challenge auditor worked as a CTF author plus security reviewer verifying every answer-key claim against source. Each auditor read every assigned file completely, answered nine audit dimensions (obvious issues, silent failures, load behavior, blind spots, additions, removals, good-idea-wrong-implementation, bad-idea, looks-correct-but-impractical), and checked the block against the ten engineering invariants declared in AGENTS.md, which served as the audit's independent outside judge.

Findings were then cross-verified across blocks. Several of the most severe issues were independently discovered from two to four different angles, which is strong evidence they are real and not auditor artifacts: the pre-release points leak was found by the API auditor (endpoint logic), the test auditor (a test pins it), and both frontend auditors (the dashboard renders it); the pause-resume break was found by the API auditor in code and by the operations auditor in the runbook's stale description of it; the audit-chain false-break was found independently in two blocks; the load-test inadequacy was found in three blocks; and the test-count chaos was established with ground truth by three auditors independently.

### 2.3 Ground truth established for disputed facts

**Table 1: Disputed facts resolved by direct measurement during the audit**

| Claim in dispute | Ground truth | Evidence |
| --- | --- | --- |
| Test count | Docs asserted conflicting stale totals at audit time; no operator-facing authoritative number was kept | grep of 'def test_' across backend/tests, per-file counts by two auditors |
| E2E check count | Executed total derived from the script's check invocations minus the one mutually-exclusive branch pair | scripts/e2e_journey.py |
| Migrations | Three files: 0001_init, 0002_score_ledger_immutable, 0003_four_level_flow | backend/migrations/ |
| app schema tables | 38 (32 from 0001 + 6 from 0003) | CREATE TABLE inventory |
| CI workflow trigger | Corrupted: 'branches: ain]' - matches no branch, so CI never runs | .github/workflows/ci.yml:2-5 |
| Load test at event cap | Never run; every result cell in LOAD_TEST_REPORT.md is marked UNRUN | docs/LOAD_TEST_REPORT.md:3,53-63 |

### 2.4 Confidence and limitations

Every finding in this document carries a file and line citation from the auditor that read the code; none is speculative. Items an auditor could not fully resolve are marked 'needs verification' in the finding text and are concentrated in three places: the exact production network topology (whether a reverse proxy terminates TLS and whether X-Forwarded-For will be honored, which decides two rate-limiting findings), the exact Node.js version floor for node:sqlite on event laptops (F-H-07), and whether the GitHub repository is public (which decides the severity of the answer-key exposure, F-J-12). The main limitation of this audit is that it is static: nothing was executed, so performance findings are reasoned from code structure rather than measured; the audit's own load recommendation (Section 7) is therefore also a plan for what to measure.

## 3. System Snapshot and What Is Genuinely Healthy

### 3.1 What the system is

Bug Hunt CTF is a one-shot v1 build with a deliberate scope: teams receive a small full-stack application with ten planted defects (Papyrus, Node/Express, plus a Python variant Marina as a repo-choice option), reproduce failures, fix them, and report through the platform, earning capped CTF-flag bonus points. The platform itself is a FastAPI API and a Python worker over PostgreSQL 16/17 with three schemas separating trust domains (app domain data, gt ground truth reachable only by the gt_admin role, audit append-only chain), a React 19 + Vite + TypeScript SPA implementing a four-level participant flow (dashboard, repo lock, per-level workspaces with flag reports for levels 1-2 and artifact uploads for levels 3-4), an organizer console, a reviewer queue, and a durable SKIP LOCKED job queue driving evaluation, leaderboard refresh and deadline auto-submit.

### 3.2 What is genuinely well built (keep and protect this)

It is important for remediation planning to know what should not be touched. The following subsystems passed their audits with real, tested strength, and the fixes in this document are deliberately surgical so as not to disturb them.

**Table 2: Subsystems that passed audit with genuine strength**

| Subsystem | Why it is strong | Evidence |
| --- | --- | --- |
| Ground-truth isolation | Enforced by PostgreSQL roles, not code discipline; app_api has zero gt privileges; tested with real connections asserting InsufficientPrivilege | scripts/dev_db.sh:110-131, tests/test_gt_isolation.py:18-43 |
| Job queue mechanics | FOR UPDATE SKIP LOCKED claims, leases, bounded backoff, dead-lettering; work executed outside the claim transaction | backend/app/jobs.py:41-111 |
| v1 submission transaction | Stage-row lock, single clock_timestamp() read, ordered validation, one commit for submission + job + audit; matches invariant 5 | backend/app/routers/submissions.py:104-325 |
| Score ledger design | DB trigger rejects UPDATE/DELETE for every role; reversal entries reference originals; award-claim uniqueness at DB level | migrations/0002, 0001:436, scoring.py:83-101 |
| Refresh-token machinery | Rotation with successor encryption, 10s reuse grace, family revocation, session-cap eviction; tested including reuse detection | routers/auth.py:250-345, tests/test_auth.py:94-151 |
| Frontend durability core | Access token memory-only, refresh cookie path-scoped HttpOnly, drafts in IndexedDB plus versioned server drafts with debounced flush, caller-held idempotency keys | lib/api.ts, lib/persistence.ts, LevelWorkspace.tsx |
| Design-system compliance | Zero dangerouslySetInnerHTML, zero drop shadows/gradients/emoji in platform UI, PlainMarkdown text-node rendering, SSR test proving markup renders inert | frontend-wide greps, tests/submission_payload.test.mjs |
| Documentation honesty infrastructure | Status headers, UNRUN labels, open-field markers, unverified-claim flags - the habit is right even where content drifted | docs-wide checks by two auditors |
| Challenge bug craftsmanship (Option A) | All 10 planted bugs verified non-overlapping, observable, answer-key claims match code exactly, all 12 GT anchors match shipped files | ORGANIZER_ANSWER_KEY.md vs source, seed GT_BUGS |

The practical conclusion: this is not a rewrite situation. The 14 P0 fixes total a few hundred lines of change. The risk to manage during remediation is regression in the healthy core, which is why the test additions in Section 9 (especially the queue-redelivery and release-gating tests that today do not exist) should land before or with the code fixes.

## 4. The Fourteen Event-Day Breakers (P0)

These fourteen findings will each, with high probability, materially damage or end the event if unfixed. They are ordered by expected impact. Every fix is small; none requires redesign. Three compounding pairs deserve attention: the scoring pipeline and its leak (rows 1-2) together decide whether results are correct and secret; the stage-row lock and missing timeouts (rows 11-12) together form the most plausible whole-platform outage; and worker death plus absent supervision (row 5) is the one scenario with no recovery path at all.

**Table 3: P0 findings - the event-day breakers**

| # | ID | Breaker | Location | Fix and effort |
| --- | --- | --- | --- | --- |
| 1 | F-B-01 | Level scoring pays ~20%: only evidence_report is awarded per accepted flag; review/test components apply to one arbitrary unit per submission (LIMIT 1, no ORDER BY); release backfill excludes level reports | evaluator_level.py:172-214, evaluator.py:343-346,418-421,491-492 | Score every claim row; include level_report in backfill. M |
| 2 | F-C-02 | GET /v1/team/score leaks live points pre-release - a ground-truth oracle for adversarial teams; pinned by a test as correct | routers/levels.py:618-657; test_flow_submissions.py:73-76 | Gate on feedback release; fix the test. M |
| 3 | F-C-01 | Pause-resume broken: transition stores to_status='pause', resume looks up 'paused' -> 500, stage stuck paused forever; pause time never compensated | routers/admin.py:343-355,377-383 | Normalize status; add round-trip test. S |
| 4 | F-A-01 | First-login password claim: typing any not-yet-activated user's email at login sets their password and activates them; also resurrects disqualified accounts | routers/auth.py:70-91 | Require invite token for activation. S-M |
| 5 | F-D-01 | No deployment artifacts: API and worker run under nohup with no supervision, no restart policy, no TLS story; a dead process stays dead | scripts/run_dev.sh:36-37; no compose/systemd in repo | Compose or 3 systemd units + deploy script. M |
| 6 | F-H-01 | Challenge self-solves: 9/10 planted bugs self-labeled with BUG-XX category and root cause in participant-shipped source | challenge-app source files; ingested verbatim by seed.py:638-657 | Strip labels from participant bundle + grep gate. S |
| 7 | F-C-03 | Level submissions accepted while stage is merely 'armed' (pre-start): no window enforced, points can accrue before doors open | routers/levels.py:932-941, flow.py:253-268 | Require status=='active'. S |
| 8 | F-I-02 | CI merge gate can never fire: workflow trigger is corrupted ('branches: ain]') | .github/workflows/ci.yml:2-5 | Fix to [main]; verify first run. S |
| 9 | F-J-01 | Participant and organizer docs describe the retired single-stage event; merged main runs the four-level flow - the room will be run from wrong manuals | COMPETITION_RULES, PARTICIPANT_HANDBOOK, EVENT_OPERATIONS_PLAYBOOK, PRODUCT_SPEC | Rewrite event-facing docs for four-level flow. L |
| 10 | F-E-02/03/19 | Zero test coverage on the exact event-day code: feedback-hiding invariant (one test asserts the opposite), queue crash/retry/redelivery machinery, L3-L4 auto-submit artifact branch | tests/, conftest.py worker_drain, auto_submit.py:128-161 | Add the three test families. M |
| 11 | F-D-02 | Deadline auto-submit holds the shared stage-row lock across diff computation and artifact disk I/O; manual submissions serialize behind it | auto_submit.py:179,201 vs submissions.py:148 | Move diff/artifact work outside the lock. M |
| 12 | F-D-03 | No PostgreSQL statement/lock/idle timeouts anywhere: one wedged transaction pins a connection forever and the 12-connection pool exhausts | db.py:29-36; no timeout config in repo | Set statement/lock/idle timeouts per role. S |
| 13 | F-I-01 | README headline claims 'load-ready for a 50-participant rehearsal' while the load report says UNRUN everywhere - invariant 10 violated in the first paragraph a reader sees | README.md:9-11 vs 106-108; LOAD_TEST_REPORT.md:3 | Reword; keep claim provisional. S |
| 14 | F-H-02 | BUG-10's planted crash kills the whole client boot: login panel never unhides, notes never load, Enter-search does not work; answer key's repro is factually wrong | challenge-app/public/app.js:84 + index.html:20,58 | Scope the crash to the Search button. S |

A note on row 9 versus the rest: the documentation break is not a code bug, but it fails the event in the same way. Organizers will run stage control, repo-lock overrides and release from a playbook that does not mention level stages, and participants will follow a handbook describing a lobby and workspace that no longer exist. If only five things can be fixed before the event, they are rows 1, 2, 3, 4 and 5; row 9 must follow immediately because it governs how humans operate everything else.

## 5. Obvious Issues to Fix

These are defects a careful reviewer would catch on a normal walkthrough: broken flows, unvalidated inputs, endpoints that return success when nothing happened, and documents that contradict the repository they describe. They cluster in the admin/staff surface and the documentation set, which is consistent with how one-shot builds usually evolve: the participant-critical paths got the most attention, and everything an organizer touches at 2 a.m. got the least. None of these is subtle; all of them are cheap relative to the embarrassment or outage they cause.

### 5.1 Broken and dangerous organizer flows

**Table 4: Obvious issues in the staff/admin surface**

| ID | Sev | Issue | Location |
| --- | --- | --- | --- |
| F-C-01 | P0 | Pause-resume always 500s; stage permanently stuck paused (see Section 4) | routers/admin.py:343-383 |
| F-C-15 | P3 | release_results returns 200 ok for unknown actions (typo 'relese') and writes the typo into the audit chain | routers/admin.py:397-429 |
| F-C-16 | P3 | set_readiness returns ok when the row matched zero rows; stage ordinal MAX+1 race creates duplicate level stages; no UNIQUE(event_id, kind, ordinal) | admin.py:1018-1040, 247-249 |
| F-C-06 | P2 | Manual score adjustments and dispute adjustments accept NaN and unbounded points (float('nan') passes the ==0 guard and poisons SUM(points) for a team forever) | admin.py:1261-1301, 1224-1247 |
| F-C-05 | P2 | Invite endpoint accepts any role string including 'admin', so an organizer can mint an admin account, bypassing the admin-only creation guard; a typo'd role bricks the account silently | admin.py:470-511, auth.py:401-424 |
| F-C-07 | P2 | add_flag skips the challenge-status lock that add_bug enforces: ground truth can be mutated after seal/publish, mid-event | admin.py:821-851 vs 748-758 |
| F-C-12 | P2 | record_test_results accepts any submission_id, returns 200, and the job later dead-letters silently - one wrong ID means a team's score is missing at release | admin.py:854-880, evaluator.py:415-417 |
| F-C-14 | P2 | 'needs_second_review' marks the review item decided, so no second review can ever happen; the submission sits in_review forever, invisible to the queue | routers/review.py:201-226 |
| F-C-13 | P2 | Config freeze writes the string 'now()' into a timestamptz bind; weight parsing raises unhandled ValueError; the freeze is the pre-event snapshot act | admin.py:179, 156-158, 185 |
| F-C-18 | P3 | Admin input validation gaps: negative event duration, unbounded title vs VARCHAR(200), untyped bug locations, unbounded time_adjustment delta of plus/minus a billion seconds | admin.py:38-45, 536-539, 735-745, 918 |
| F-C-23 | P3 | Disputes have no rate limit or uniqueness; each POST overwrites submission status ('disputed' clobbers 'ledgered'); the disputes list is unpaginated | submissions.py:426-460, admin.py:1178-1191 |

### 5.2 Broken participant-visible behavior

**Table 5: Obvious issues on the participant surface**

| ID | Sev | Issue | Location |
| --- | --- | --- | --- |
| F-C-04 | P1 | my_submissions leaks pre-release verdicts: any status outside the whitelist is returned raw, so 'rejected_auto' and 'duplicate' reach participants before release | routers/submissions.py:371-381 |
| F-C-10 | P2 | Malformed UUIDs anywhere produce raw 500s instead of 404s on every fuzzable endpoint (CAST(:x AS uuid) raises DataError) | admin.py:111,1209; levels.py:980; submissions.py:395; review.py:113 |
| F-C-11 | P2 | Negative limit parameters (announcements, audit) reach SQL LIMIT and raise 500s; trivially fuzzable | announcements.py:15, admin.py:1051-1070 |
| F-C-20 | P3 | Duplicate-key races surface as 500s instead of clean replays/409s (idempotency, event slug, join codes) | admin.py:48-93, levels.py:896-917, submissions.py:124-139 |
| F-C-22 | P3 | my_team returns internal fields verbatim (idempotency_key, challenge_version_id, lock_source) to teammates | routers/levels.py:586-615 |
| F-G-06 | P1 | Deadline modal is unescapable with no status, spinner or fallback: if the worker lags, participants are walled behind 'Waiting for confirmation...' indefinitely | components/event/Warnings.tsx:133-143 |
| F-G-08 | P1 | Login screen carries three mutually contradictory account-creation stories on the highest-traffic screen of the day | pages/Login.tsx:45-91, Terms.tsx:14-16, EventDetails.tsx:188-193 |
| F-G-14 | P2 | Stage pause/start/arm are single-click actions (only 'end' is confirmed); a stray pause rejects every submission until noticed | pages/admin/Dashboard.tsx:386-394 |
| F-G-17 | P2 | 'Open workspace' CTA links to a route that redirects to the dashboard | pages/participant/Submissions.tsx:44, App.tsx:91 |
| F-G-26/27 | P3 | Editor caret not reset when switching files; read-only viewer shows 'Empty file' while a fetch is pending or failed | LevelWorkspace.tsx:561, CodeViewer.tsx:159-166 |

### 5.3 Obviously wrong or stale documents and configuration

**Table 6: Obvious documentation/configuration issues**

| ID | Sev | Issue | Location |
| --- | --- | --- | --- |
| F-I-02 | P0 | CI trigger corrupted ('ain]') - the documented merge gate never runs | .github/workflows/ci.yml:2-5 |
| F-I-04 | P1 | Six documents assert different test counts; AGENTS.md is the only correct one | README.md:18,62,101; SECURITY_REVIEW.md:11; CI_CD_PIPELINE.md:24,36; TESTING_STRATEGY.md:7,46 |
| F-I-05 | P1 | DATA_MODEL.md says 'exactly one migration', numbers the four-level migration as 0002, and omits 0002 (the ledger-immunity trigger) entirely | docs/DATA_MODEL.md:11,53,65 |
| F-I-08 | P2 | CI_CD_PIPELINE.md asserts 'There is NO .github/ directory' while describing a CI that actually runs six jobs including four security scanners | docs/CI_CD_PIPELINE.md:7-12 vs ci.yml |
| F-I-10 | P2 | PERFORMANCE_AND_CAPACITY.md says the load-test script and report 'do not exist' - both exist, and its own section 6 references the report | docs/PERFORMANCE_AND_CAPACITY.md:26 vs 83 |
| F-D-14 | P2 | Capacity arithmetic contradiction: seed sets max_teams=10 but the published rules promise 12 teams and seed's own capacity note says 12 | seed.py:586,95 vs COMPETITION_RULES.md:29-30 |
| F-D-17 | P2 | The two documents an operator actually follows are wrong: runbook asserted a stale pytest total; load report documents CLI flags that do not exist | DEPLOYMENT_RUNBOOK.md:41; LOAD_TEST_REPORT.md:47 vs load_test.py:79-81 |
| F-J-05 | P1 | Three files from unrelated projects (Zivon prototype handover, findMyDreamCollege eval report, a 1,688-line design-knowledge mission) live in docs/design, plus a byte-identical duplicate of the master prompt | docs/design/local-agent-handover.md, FMD-CLOUD-024-eval-live-report.md, 'Mission Build a Comprehensive.md', '(Copy).md' |
| F-J-13 | P2 | Onboarding guide asserted a stale test total; seed docstring says 6 participants in 2 teams when it seeds 9 in 2; registration prompt repeated that stale total | ONBOARDING_GUIDE.md:49; seed.py:4; CLOUD_AGENT...md:115 |

Recommended handling: fix Table 4 and Table 5 items in one validation-focused pass (pydantic constraints, existence checks, status whitelists, UUID coercion helpers), fix Table 6 items in a documentation-sync commit, and add the two CI greps that would have caught this class permanently: a docs-hygiene check for stale test-count literals, and a workflow-schema check that fails on malformed triggers.

## 6. Silent Failures and Deeper Hard-to-Notice Issues

This section is the heart of the audit. Silent failures do not crash, log, or alarm; they return 200, look successful, and produce wrong results or corrupted state that surfaces later, usually at the worst possible moment. The single most dangerous property this codebase exhibits is operations that report success while doing the wrong thing - and several of them are pinned by tests as correct behavior, which means the suite will defend the bug against you.

### 6.1 Results are silently wrong (the scoring pipeline)

The four-level scoring path has four independent silent-corruption mechanisms, and they compound. The primary one (F-B-01, P0) is structural: evaluate_level_submission writes one ledger entry per accepted flag but only under the 20%-weight evidence_report component; the code_review and functional_test components are applied by evaluator.py with 'SELECT ... WHERE submission_id = ... LIMIT 1' without ORDER BY, so they attach to one arbitrary award unit per submission regardless of how many flags it contained; and the release-time backfill that awards default review points filters on kind='bug_report' AND matched_bug_code IS NOT NULL, a predicate that excludes every level report. Net effect: flag 1 of a submission can reach full value, flags 2 through N are frozen at ~20%, two teams with identical findings diverge based on how they batched flags into submissions, and nothing anywhere logs an error. The fix must iterate all claim rows per submission and must include level reports in the backfill.

**Table 7: Silent scoring-corruption mechanisms**

| ID | Sev | Mechanism | Consequence | Location |
| --- | --- | --- | --- | --- |
| F-B-01 | P0 | Per-submission LIMIT 1 scoring + release backfill excludes level reports | Most accepted flags pay ~20% forever, unevenly per team; discovered publicly at release | evaluator.py:343,418,491 |
| F-B-04 | P1 | release_feedback penalty insert has no idempotency guard while the documented evaluate->release flow enqueues it twice | Double negative penalty entries; leaderboard SUM silently subtracts twice | evaluator.py:530-559; admin.py:412-418 |
| F-B-06 | P2 | points_visible column is never written by any code path | After release, participants see 0.0 points per submission while the leaderboard shows real totals - a guaranteed dispute wave | models_app.py:437; readers at submissions.py:375,418 |
| F-B-11 | P3 | Penalty and invalid-count queries filter kind='bug_report', excluding every level report; 'duplicate' collapses into 'rejected_auto' | The configured false-positive penalty is dead code for the actual event flow; duplicates read as 'you were wrong' | evaluator.py:536,605; evaluator_level.py:224-231 |
| F-B-18 | P3 | Review decisions overwrite submission status last-write-wins, even after points are ledgered | Post-release display contradicts paid points | routers/review.py:179-247 |
| F-C-06 | P2 | NaN passes the manual-adjustment guard into NUMERIC | One organizer paste makes a team's SUM(points) NaN across score, CSV export and tie-breaks | admin.py:1261-1301 |

### 6.2 Secrets and sessions silently break

The secret lifecycle is a single point of silent failure. flag_code_hash, receipt HMACs, refresh-successor encryption, JWT signing and ip_hash are all keyed from the same jwt_secret (security.py:29,93,121,129,135), and flag hashes are persisted at seed/admin time. AGENTS.md instructs operators to rotate JWT_SECRET before the event; if flags are ingested before rotation and the secret is rotated after, every correct flag submission fails verification forever, with no error anywhere pointing at the cause (F-A-02). The same rotation silently invalidates receipts issued pre-rotation. Compounding this: nothing at startup refuses production boot on dev-default secrets or database credentials (F-A-03), so a leaked repo default means mintable admin tokens. On the session side, the first-login password claim (F-A-01, P0) is silent and self-concealing: it flips status and overwrites password_hash in one UPDATE with no invite verification, and because the disqualified check reads the locally mutated dict it can never trigger on that path. The refresh grace path skips the user-status gate (F-A-11), so a disqualified user replaying within 10 seconds still mints fresh credentials, and token-family revocation - the signal that someone stole a refresh token - writes no audit row, so the one event that should page an organizer is invisible (F-A-12). Password-reset tokens are printed to server logs by an unauthenticated endpoint (F-A-07), making admin-account security equivalent to log-file confidentiality on a shared box.

### 6.3 State machines with permanent dead ends

Two flow-level dead ends will generate mid-event escalations that currently have no recovery path except hand-written SQL during a live competition. (1) The 'missed' status is excluded from DONE_STATUSES while the team gate counts it as 'waiting' (flow.py:23, 309-330): if a team lead never locks the repo, every member becomes 'missed' at the deadline, the pointer advances to level 2, and the entire team is locked out of levels 2-4 for the rest of the event behind the message 'Waiting for N teammates to finish level 1' - which they can never finish. (2) A no-show teammate who never logs in has no participant_progress or pointer rows, is invisible to auto-submit's INNER JOIN (auto_submit.py:54-69), and blocks the team gate forever via the NULL status. admin_levels.py has a repo-lock override but no endpoint to mark a participant missed, advance a pointer, or override a gate (F-B-02). Separately, auto-submit executes without re-checking stage status or the effective deadline inside its locked transaction (F-B-03): it fires during 'paused' (unfair, irreversible early submission), never fires after an early 'ended' (stranding participants), and can stamp received_at minutes after the deadline under worker backlog - prime dispute material. The reviewer's needs_second_review action dead-ends its own item (F-C-14), and draft saves are accepted after the deadline and silently truncated to the flag cap with no note (F-B-09).

### 6.4 Participant work can be silently lost or corrupted (frontend)

**Table 8: Frontend silent data-loss paths**

| ID | Sev | Path | Scenario | Location |
| --- | --- | --- | --- | --- |
| F-G-01 | P1 | Editor renders empty while file fetch is pending/failed and accepts keystrokes into the void | WiFi hiccup after switching tabs; participant types 'fix'; the submission diff replaces the whole file with 'fix' | LevelWorkspace.tsx:292-297,551-563 |
| F-G-04 | P1 | Submit proceeds when the pre-submit flush failed | Save-failed chip flashes in the last minute; participant submits; the server grades the stale draft | LevelWorkspace.tsx:165-208,333-345 |
| F-G-05 | P1 | No flush on unmount or pagehide | Clicking Explain/Rules (a normal mid-edit action) discards up to 3s of edits because cleanup cancels the debounce timers | LevelWorkspace.tsx:211-241,440-441 |
| F-F-06 | P2 | Draft reconciliation compares client clock to server clock | A skewed venue laptop silently picks a winner and the 5s conflict window can never fire | persistence.ts:328-335 |
| F-F-07 / F-G-02 | P2 | Conflict dialog offers two buttons wired to the same state | The 'choice' is a no-op; the older draft (possibly the real work) is dropped on next save | persistence.ts:316-336; LevelWorkspace.tsx:252-254,474-483 |
| F-F-01 | P1 | Session restore treats network-down and 5xx as logged-out | Reload during a WiFi blip kicks the participant to login; the venue's shared-NAT login limit then 429s the room | auth.tsx:41-66; api.ts:62-79 |
| F-F-02 | P1 | Revoked-session 401s never end the client session | A teammate's phone login evicts the laptop (session cap 2); the laptop polls 401 forever with no redirect | api.ts:141-147; auth.py:123-138 |
| F-F-08 | P2 | React Query cache survives logout and account switch | Next user on the shared machine sees the previous user's team name, score and repo choice rendered from cache | auth.tsx:83-92; main.tsx:21-29 |

### 6.5 Trust instruments that silently lie

Three mechanisms exist specifically so organizers can trust the system, and all three mislead under real conditions. The audit hash chain is written with an unlocked read-then-insert of prev_hash, so the first concurrent login burst guarantees two entries chained to the same parent and the verifier reports 'tampered' during normal traffic (F-A-06, F-C-08); the chain is additionally unkeyed SHA-256, so anyone with database-owner access rewrites rows and recomputes the whole chain undetectably, and audit_verify checks only the first 5000 rows while still reporting intact (F-A-25). The organizer's integrity dashboard therefore cry-wolfs exactly when it is busiest, training everyone to ignore the one alarm that matters. Second, unhandled 500s produce no structured log and no audit row (F-A-10), so during the event there is no way to correlate error bursts with actions. Third, dead-lettered jobs - a poisoned evaluate job means one team silently ungraded until release - surface nowhere except a health endpoint a human must think to poll (F-C-12, F-D-13). The outbox is written on every submission and delivered by nothing (F-D-10, F-B-15), a pattern that looks like delivery guarantees and provides none.

### 6.6 Ground truth can be silently mutated

Two paths break the seal discipline the platform promises. add_flag skips the challenge-status lock that add_bug enforces, so flags can be added or altered after publish, mid-event (F-C-07). The admin repo-lock override can update team_repo_choices including challenge_version_id - the migration comment calls the choice 'immutable' - while award claims and prior evaluations reference the old version's ground truth, and award units are not version-scoped (F-B-16). Both are audited, but an audit row is not a guard; nothing recomputes or blocks downstream decisions that reference stale truth.

## 7. What Breaks Under Load on a Cheap Server

Assume the documented deployment: one 2-4 vCPU, 4-8 GB box running PostgreSQL, the API, one worker, the SPA and (per team, locally) the challenge app. The audit's load analysis produced a specific, ordered collapse chain. The good news first: steady state is fine. Documented polling cadence puts 50 participants at roughly 30-40 requests/second of light queries, the schema and indexes fit the query patterns, the pool (8+4 per process) matches max_connections, and the burst is bounded by team count (about 10-12), not participant count. Nothing here requires a bigger server; it requires removing four specific cliffs and then measuring.

### 7.1 The collapse chain, in order

**Table 9: Load failure modes in expected order of onset**

| # | Trigger | Mechanism | Fix | Location |
| --- | --- | --- | --- | --- |
| 1 | Level deadline burst | Auto-submit holds the shared stage-row lock across diff computation and artifact disk I/O while every manual submission serializes on the same row; a slow or nearly-full disk stretches lock hold time | Move diff/artifact staging outside the lock; keep lock ordering pointer->stage | auto_submit.py:179,201; submissions.py:148 |
| 2 | Same, seconds later | No statement_timeout, no lock_timeout, no idle_in_transaction timeout anywhere; wedged transactions pin connections until the 12-connection pool exhausts and the whole API 500-storms | Set statement_timeout=5s, lock_timeout=3s, idle_in_transaction=10s per role | db.py:29-36 |
| 3 | T-0 login storm | Rate limiter keys on request.client.host; behind any proxy or Vite-style termination, the entire venue is 127.0.0.1 - one global 20-logins-per-minute bucket for the room; per-email lockout additionally lets anyone lock out a victim with 10 failed attempts | Honor X-Forwarded-For from a configured trusted proxy; rekey limits to (IP,email); raise per-IP cap for the event | deps.py:30-39; auth.py:56-58 |
| 4 | Any bored attacker | Unauthenticated DB-backed endpoints (/health probes both engines, /v1/time, /v1/public/*) take pooled connections with no cache and no rate limit; ~50 rps of junk occupies all connections | Server-side memoization (30-60s); cheap cached /health; global per-IP limiter on unauthenticated paths | main.py:112-118; state.py:21-25; public.py |
| 5 | Release window | Single worker drains evaluation jobs for the whole event; the 10s auto-submit scan runs inline and pauses draining; ~200-500 evaluate jobs at end->evaluate->release with zero latency metric surfaced | Run 2 workers (claim machinery already supports it); surface queue age in /health; measure per-job latency in rehearsal | worker.py:25-45; jobs.py:152-158 |
| 6 | Any attacker with curl | Body-size cap checks only the Content-Length header; chunked transfer bypasses it entirely and Starlette buffers the body - multi-GB POST means OOM on an 8 GB box | Enforce in-app byte counting or reject Transfer-Encoding; verify proxy body limit at deploy | main.py:69-84 |
| 7 | Hours of runtime | pgdata, artifacts, WAL and unrotated logs share one volume with no quota, no rotation, no df watchdog; Postgres PANICs on disk-full mid-event | logrotate config, df watchdog at 80%, artifact quota check in storage.save | run_dev.sh:35-37; storage.py:23-27 |
| 8 | Last minutes of L4 | Client autosave PUTs the entire draft payload (all edited files, up to 512 KiB each) every 3s of typing plus on every tab switch - the heaviest uplink traffic of the day on venue WiFi | Send only changed files; add idle floor; skip no-op flushes | LevelWorkspace.tsx:148-163,223-232 |
| 9 | All day, every tab | Fixed-interval polls with no jitter and no outage backoff across levels/progress/score/gate/audit/live endpoints; after a blip every client retries on the same tick | 10-15s intervals, +/-15% jitter, exponential backoff; drop pre-release score poll to 60s | event-session.ts:93-151; Dashboard.tsx:217-736 |
| 10 | Long-running process | In-memory rate limiter is an unbounded defaultdict keyed by arbitrary emails/IPs (memory DoS), resets on restart, is per-process | Prune/cap keys; document single-worker requirement; consider Postgres-backed limiter if workers increase | deps.py:30-39 |

### 7.2 The measurement gap: the capacity claim is currently unearnable

The 50-participant claim is marked provisional in the documentation, which is honest - but the instrument that could convert it to measured cannot simulate the event. scripts/load_test.py caps at 10 hard-coded participant emails (so --users 60 yields 7 virtual pollers), fires its 'burst' as a sequential await loop in a single client (so the stage-row-lock contention the report itself calls 'the number that matters' is structurally untestable), counts 429/500 responses inside its acknowledgement-latency sample, exercises no upload path, and documents CLI flags that do not exist (F-D-05, F-I-07, F-I-01). Additionally, CI's only live-stack gate (the e2e journey) never exercises the four-level flow the event will actually run - no level submission, no upload, no auto-submit (F-D-15, F-E-19). Until both are fixed, the platform is flying blind on its single most important operational question.

### 7.3 What will not break

For balance: the database design is not the bottleneck. All decision clocks are database clocks, lock ordering is consistent (pointer, then stage) across manual and auto paths with no deadlock found, the submissions and ledger indexes match the real query paths, exports are bounded, and the queue's claim machinery already supports multiple workers. The heavy participant poll (/v1/progress, roughly 16-22 queries) is survivable at this scale, though unthrottled (F-C-09). The audit's judgment is that a rehearsal on the real hardware after Waves 0 and 1 will pass if the collapse-chain fixes land first.

## 8. Blind Spots: What Nobody Is Thinking About Yet

These are the risks absent from the repository's own considerable documentation and from the team's apparent focus. Each is a thing the platform's own docs would flag if anyone had written them down. They fall into four families: the adversarial audience, operational realities, event-day process, and code-level assumptions.

### 8.1 The audience is adversarial, and the surface reflects it

It is a CTF; participants will attack the platform itself, and the docs correctly assume this - but several attack channels are open. The pre-release points oracle (F-C-02) and verdict-status leak (F-C-04) let teams binary-search ground truth with instant feedback. The matching engine is gameable: location scoring awards full marks for any overlapping range regardless of span (a 25-line blanket range scores against every bug it covers), alias evidence is plain substring containment with generic seed keywords like 'author' and 'count', and only the top-ranked candidate is ever decided - so carpet-bombing one file with 12 category guesses and keyword-stuffed descriptions auto-awards (F-B-05). Login timing enumerates registered emails (~1 ms vs ~30-80 ms Argon2, F-A-17). The client-chosen rules-acceptance version lets a participant pre-accept a future rules version and silently survive a mid-event rules bump (F-A-14). The invite endpoint's role string lets an organizer account mint admin (F-C-05). And outside the platform: the RESTRICTED answer key ships inside the folder participants receive with no packaging guard on the offline handout path (F-H-06, F-J-12), FLAG-1's plaintext sits in shipped db.js so the 'access-control' side quest is solvable by Ctrl+F (F-H-04), and the shipped source's BUG-XX labels hand over 260 of 275 points to anyone who greps (F-H-01).

### 8.2 Operational realities nobody wrote down

**Table 10: Operational blind spots**

| Blind spot | Why it will bite | Evidence |
| --- | --- | --- |
| No backup automation, restore drill UNRUN | Single failure domain; RPO equals 'the last manual pg_dump an operator remembered'; the readiness item that blocks go-live cannot be satisfied with anything in the repo | BACKUP_AND_RECOVERY.md:37,78 |
| No watchdog or alerting | A dead API/worker/Postgres is discovered by 50 participants' browsers; dead-lettered jobs (one team silently ungraded) surface nowhere | runbook monitoring is a human at T-60; F-D-13 |
| No NTP/clock requirement at an offline venue | Every deadline derives from clock_timestamp(); an un-synced VM shifts all windows uniformly and invisibly; the risk register (TIM-02) knows this, the runbook never checks it | F-D-16, F-J-15 |
| Disk-fill has no owner | pgdata + artifacts + WAL + unrotated logs on one volume; Postgres PANIC on disk-full mid-event is low-probability, total-impact | F-D-11 |
| The venue AI-block is asserted, not engineered | Rules make network-enforced AI blocking a disqualification basis; no named owner, no blocklist, no test method, no fallback if campus IT cannot deliver | PLAYBOOK:46-49; RULES:166-168; F-J-10 |
| 50 laptops x first npm install | Node 22.5+ prerequisite with no pre-event verification, no spare-laptop pool, no offline npm fallback; node:sqlite may not load on stock 22.x (needs version verification) | HANDBOOK:60-65; F-J-11, F-H-07 |
| Room logistics are unwritten | Check-in roster, seating to separate teams, power, projector fallback, printing rules - none in the ops playbook; the design DOCX risk register knew about them and they never migrated | F-J-15 |

### 8.3 Process blind spots: the last mile of the event

Registration is not actually solved for a real event: the registration/payments subsystem exists only as an unexecuted design prompt, provisioning 10-12 teams means roughly 50 manual one-at-a-time console invites with 48-hour expiries, and there is no bulk import, no registration-deadline enforcement, no capacity dashboard (F-J-07). The dispute window is deferred to 'announced with results' in three documents - a value no document owns - which makes the privacy notice's retention period circular (F-J-08). Nothing documents winner announcement, prizes or certificates, though the proposal promises them, and the proposal's five-minute 'final evaluation and results' phase collides with a real workload of per-submission manual test-result entry plus review-backlog clearing that nobody has ever timed (F-J-09, ADR-019's follow-up is still open). Post-event data export, retention and deletion are acknowledged as 'a pre-event deliverable' that does not exist (F-I-14), and the privacy notice lacks photography/CCTV/ID-check disclosure and any under-18 handling despite being an offline university event (F-J-16 - flagged for review, not legal advice). Finally, the readiness gate is honest but every item points at evidence nobody has produced and owners are roles, not people with dates (F-J-14).

### 8.4 Code-level assumptions that will not hold

Three deeper assumptions deserve attention before they fail. First, TRUNCATE bypasses row-level triggers: the append-only ledger guarantee has a one-statement hole, and app_api holds TRUNCATE via GRANT ALL (F-D-07) - seed.py already normalizes exactly this operation, so one muscle-memory command on the live database deletes every team, submission, ledger row and ground truth with no guard (F-D-06). Second, cap checks are read-then-write races: max_awards counting and the per-team bonus cap can be oversubscribed by two concurrent final-slot submissions, and claim uniqueness does not arbitrate either (F-B-07). Third, cross-DB-role grants live only in dev_db.sh, not in migrations, so a database provisioned by migrate.sh alone fails in confusing ways at boot (F-C-26 cross-question, F-I-03). Each has a one-line or one-script fix; each fails catastrophically and without warning.

## 9. What to Add

Additions are prioritized by event-day risk reduction per unit of effort. The first group is non-negotiable infrastructure that the platform implicitly promises and explicitly lacks; the second group is the test coverage that will keep the fixes from regressing; the third group is participant-facing hardening; the last group is process and documentation that the event team needs to operate the day.

### 9.1 Infrastructure additions (before any rehearsal)

**Table 11: Infrastructure additions**

| Addition | Closes | Effort |
| --- | --- | --- |
| Deployment artifact set: docker-compose (postgres, api, worker, caddy) or three systemd units with Restart=always, healthcheck on /health, log forwarding; one scripts/deploy.sh | F-D-01, F-D-13 | M |
| PostgreSQL fuses: statement_timeout 5s, lock_timeout 3s, idle_in_transaction_session_timeout 10s on both engines | F-D-03 | S |
| Backup cron (nightly + pre-event pg_dump -Fc off-box) plus one timed restore drill recorded in the runbook | F-D-04 | M |
| One-minute watchdog cron: curl /health plus SQL for dead/queued jobs older than 60s, pushing to a chat webhook | F-D-13 | S |
| Fail-closed production config guard: refuse boot when environment=production with default secrets, dev credentials or localhost origins | F-A-03 | S |
| Separate secrets: JWT_SECRET, FLAG_HMAC_KEY, RECEIPT_HMAC_KEY; document rotation order (rotate, then re-enter flags) | F-A-02 | S |
| TRUNCATE guard trigger on score_ledger_entries plus REVOKE TRUNCATE from app_api; seed --reset requires environment=development and an explicit confirmation flag | F-D-07, F-D-06 | S |
| scripts/prod_db.sh: scram-sha-256 bootstrap with env passwords (the trust-auth dev script is not a production path) plus a first-tenant/first-admin bootstrap procedure | F-D-09, F-I-03 | S |
| Proxy-aware rate limiting: honor X-Forwarded-For from a configured trusted proxy; rekey login limits to (IP, email); raise the per-IP cap for the venue | F-A-08, F-F-01 | S |
| Migration robustness: run each file in a single transaction (-1) and take an advisory lock; grants for DB roles promoted from dev_db.sh into migrations | F-D-08, F-C-26 | S |
| Admin recovery endpoints: mark participant missed / advance pointer / override team gate, each audited | F-B-02 | M |
| Realistic load test rewrite: provision N real accounts, concurrent login, asyncio.gather simultaneous burst, upload phase, worker-lag probe; then actually run it at cap and record results | F-D-05, F-I-07, F-J-02 | M |
| Four-level e2e journey appended to scripts/e2e_journey.py (lock repo, L1-L2 flags, L3 upload, force-expired level, assert auto-submit) | F-D-15, F-E-19 | M |
| logrotate for logs/*.log and a df watchdog at 80% | F-D-11 | S |

### 9.2 Test additions (highest value first)

**Table 12: Missing tests that map to event-day failure modes**

| Test | Protects | Evidence base |
| --- | --- | --- |
| Pre-release masking: /v1/submissions, /v1/submissions/{id}, /v1/progress, /v1/team/score return no verdicts/points before release | Invariant 6 - currently zero pytest coverage and one test asserts the opposite | F-E-02, F-C-02 |
| Queue redelivery: lease expiry -> requeue -> duplicate evaluate job -> still exactly one award claim; handler exception -> retry -> dead-letter visible to admin | The machinery that runs when a worker crashes mid-evaluation has never executed under test | F-E-03, F-B-10 |
| L3/L4 artifact close-out: manual upload binding and deadline auto-submit diff branch with a saved file edit | The code that fires at the L3 deadline for every team has zero coverage | F-E-19, F-E-10 |
| Concurrent same-idempotency-key submissions (barrier race): one 202 + replay or one clean 4xx, never 500 | The exact scenario the key exists for - flaky retry at the deadline | F-E-04, F-B-08 |
| Time-adjustment extension honored by manual submit and auto-submit; exact deadline boundary | Organizer '+5 min' is unverified end-to-end; the grace test is a 3-second race | F-E-06 |
| Rate-limit and cap enforcement (login burst, submission burst, SUBMISSION_CAP_REACHED) | The two mechanisms standing between you and a scripted brute-force are untested; the fixture wipes the limiter | F-E-05, F-E-12 |
| RBAC matrix over the admin router (reviewer cannot control stages; organizer cannot hit admin-only routes) | 3 of ~40 endpoints spot-checked today | F-E-09 |
| Unhandled-exception envelope: forced 500 returns the stable catalog code with no traceback | Invariant 7's second half is asserted nowhere | F-E-11 |
| Pause->resume round-trip with time compensation | The P0 organizer flow | F-C-01, F-J-03 |
| Full L4 journey plus foreign-artifact and corrupt-zip rejection | No test completes a four-level flow today | F-E-10 |

### 9.3 Frontend and participant-experience additions

A global connection banner driven by navigator.onLine plus a recent-failure flag in api.ts, replacing the dead OfflineBanner (F-G-19); an auto-submit receipt probe so the deadline modal can confirm what actually happened (F-G-07, F-G-06); ends_at_effective surfaced in GET /v1/levels and used by every countdown and warning (F-F-03, F-G-03); tri-state session restore (logged-out vs network-uncertain) with an offline banner and retry (F-F-01); auth-expired handling that clears the token and redirects on non-token-expiry 401s (F-F-02); fetch timeouts via AbortSignal.timeout (F-F-09); queryClient.clear() on login/logout (F-F-08); a per-stage selector on the Results page (F-G-18); Escape-then-Tab in the editor for keyboard users (F-G-25); TypeScript strict mode and tests for api.ts, event-session.ts and format.ts (F-F-11, F-F-12); a conservative CSP meta plus lazy-loaded admin/review bundles (F-F-23); and a boot-time backend-reachability check for the deployed same-origin /v1 assumption (F-F-04 cross-question).

### 9.4 Process and documentation additions

One four-level operations section in the event playbook (level stage control, repo-lock override, auto-submit monitoring, gate recovery) (F-J-01); an event-day operations document covering backup verification, disk/queue/worker checks every 15 minutes, and the end-of-event export/deletion list (F-I-14); a results timeline that replaces the proposal's five-minute fantasy, with the test-results entry step timed in the dry run (F-J-09); a registration runbook or bulk CSV import with a T-2 provisioning checklist and named owners (F-J-07, F-J-14); the dispute window written down in one place with the retention policy derived from it, plus winner-announcement, prize and certificate steps (F-J-08); a venue-logistics section (check-in roster, seating, power, AV fallback, chrony verification, second uplink test) (F-J-15); a participant machine-check email (node -v) and a spare-laptop/minimum-crew continuation rule (F-J-11); and the missing security-doc paragraph disclosing and deciding the login-sets-password path (F-I-13).

## 10. What to Remove

Removal matters as much as addition: dead mechanisms mislead future maintainers and auditors about what the system actually does. Every item below is safe to remove or archive now; none is load-bearing.

### 10.1 Dead code and dead weight

**Table 13: Removals**

| Item | Why it is dead | Evidence |
| --- | --- | --- |
| Outbox writes and dispatch_outbox handler | Rows are inserted on every submission; nothing ever enqueues the delivery job or consumes events. A delivery mechanism that delivers nothing is worse than none | F-D-10, F-B-15 |
| scheduler DB role | Granted everywhere, used by nothing; the worker runs as gt_admin (wider than needed) instead | F-D-19, F-A-21 |
| Dead config knobs | submission_max_desc_chars (routers hardcode 2000), max_concurrent_requests_per_user (never enforced - SECURITY_ARCHITECTURE.md admits it), announcements.audience (written, never read/filtered) | F-A-21 |
| Test dependencies in runtime requirements | httpx, pytest, pytest-timeout in requirements.txt contradict the dev-requirements header | F-D-18 |
| docs/design foreign files and duplicate | local-agent-handover.md (a different project's founder handover), FMD-CLOUD-024 (findMyDreamCollege eval), Mission Build a Comprehensive.md (a design-knowledge brief), and the byte-identical master prompt copy - the next agent told to 'read docs/design' will ingest instructions to run scripts that do not exist here | F-J-05 |
| ~2,400 lines of executable agent prompts as authority docs | The clean-room prompt was never executed and its execution now would delete the merged four-level frontend; the orchestrator prompt embeds a git history-rewrite procedure; none carries a status header | F-J-06, F-J-19 |
| Dead frontend code | describe() both branches identical, getAccessToken (zero callers), mounted ref, dead duplicate useServerOffset on Landing, duplicated payloadLines (reuse SubmissionPayload), dead OfflineBanner (or wire it up), 'X-Stage-Id' header in conftest (backend never reads it) | F-F-14, F-G-22, F-G-23, F-E-13 |
| requirements drift and .gitignore residue | Duplicate tools/ entries, upload/ and sources_extracted/ leftovers | F-D-22 |

### 10.2 Decisions to make (remove-by-decision)

Three removals require an owner decision rather than a commit. (1) Option B (challenge-app-option-b) is an intentional A/B dev fixture, not cruft - but its parity claim is false today: FLAG-1 is unsolvable (the plaintext exists nowhere in the app), its comment-XSS endpoint is unreachable from its own UI, its auth is fake (client-supplied identity), and its FLAG-2 decodes without the FLAG{} wrapper. Either fix it to true parity or re-label it as a dev-only fixture and exclude it from the event (F-H-03, F-H-08, F-H-09; the repo's own KNOWN_GAPS lists the A/B certification as a READY blocker). (2) The v1 single-stage submission path (POST /v1/submissions with its cooldowns and caps) is now a parallel flow to the four-level path; if the event will never use it, say so in the runbook, because its penalty configuration is otherwise silently trusted (F-B-04 cross-question, F-B-11). (3) Export blob persistence: every CSV export click stores a full copy in app.exports in a second transaction; store metadata and a hash instead (F-C-17).

## 11. Good Ideas, Wrong Implementations

This section separates the idea from the execution, because in every case below the idea deserves to survive and the implementation deserves to be replaced. The pattern worth naming: each of these was designed at the right altitude and then implemented with one localized flaw - a missing lock, a wrong string, an unchecked status - that the tests could not catch because the tests never exercised the code path.

**Table 14: Good idea, wrong implementation**

| The good idea | What is right about it | What is wrong with the execution | Fix |
| --- | --- | --- | --- |
| Frictionless first login | Zero-setup onboarding for 50 walk-in accounts is the right UX goal | The mechanism (typed password claims the account) is an unauthenticated account takeover, and it resurrects disqualified users; the invite machinery that solves this already exists | Invite-token activation (F-A-01) |
| Hash-chained audit log | Tamper evidence for the actions that decide the event is the right goal | Unlocked read-then-insert chains false-break under concurrency; unkeyed SHA-256 is recomputable by anyone with DB access; verify checks 5000 rows then says intact | Advisory lock per scope, HMAC with an out-of-DB key, full-coverage verify, exported checkpoints (F-A-06, F-C-08, F-A-25) |
| Idempotency-key reservation | Reserve first, replay on retry - exactly right for deadline flakiness | Implementation is check-then-insert; concurrent duplicates crash as 500 instead of replaying or 409 | INSERT ... ON CONFLICT DO NOTHING as the first statement (F-B-08, F-C-20) |
| Server-owned deadline auto-submit | The server must own the end of every level; pointer arbitration via FOR UPDATE is genuinely well done | The executor never re-checks stage status or effective end inside the lock; fires during pause; skips after early end; holds the lock across diff and disk I/O | Re-check status/deadline after lock; move I/O out (F-B-03, F-D-02) |
| Feedback hidden until release | The platform's defining fairness promise | Enforced per-endpoint by hand; /v1/team/score is ungated, non-whitelisted statuses leak raw, the gate in my_results is stage-wide BOOL_OR, and a test pins the leak | One release-gate helper used by every participant read (F-C-02, F-C-04, F-A-16) |
| Deterministic matching | Auto-award with replayable decisions is the right throughput model for 50 teams | Span-overlap scores full for any overlap, alias evidence is substring matching with generic keywords, and only the top-ranked candidate is decided | Require winning-candidate alias evidence, rate auto-awards, ORDER BY the candidate query (F-B-05) |
| Dual draft persistence | IndexedDB + versioned server drafts with debounced flush is the correct durability architecture | Reconciliation compares client clock to server clock, the conflict dialog wires both buttons to one state, and nothing flushes on unmount/pagehide | Version-number reconciliation, real two-sided conflict, flush-on-unmount (F-F-06, F-F-07, F-G-05) |
| Deadline warning system | 5/3/1-minute warnings plus a blocking modal is the right UX for a 180-minute event | Warnings and countdowns read raw ends_at while the server honors ends_at_effective - the first organizer time adjustment makes the UI scream a false deadline | Use ends_at_effective everywhere (F-F-03, F-G-03) |
| Pause with time compensation | TIM-05: shifting ends_at by pause duration preserves promised working time - exactly the right ops primitive | The transition log stores to_status='pause' and the resume query looks for 'paused', so compensation silently never runs and resume 500s | Normalize the status; test the round trip (F-C-01, F-J-03) |
| Forward-only migrations via script | Ordered, tracked, expand/contract discipline is present and CI applies migrations | migrate.sh runs files statement-by-statement in autocommit and 0001 is not re-runnable, so a mid-file failure wedges the schema with no convergence path | Single-transaction per file plus advisory lock (F-D-08) |
| A/B challenge parity | Offering two equivalent challenge apps is good design for a debugging CTF | Option B's flag is unsolvable, its XSS is unreachable, its auth is fake, and its README claims parity that does not exist | Fix to parity or re-label dev-only (F-H-03, F-H-08, F-H-09) |
| Honest capacity gating | A readiness gate that mechanically blocks go-live until the load test passes is rare and admirable | The gate points at a tool that cannot simulate the event (10 pollers, sequential burst, wrong documented flags) | Rewrite the instrument, then run it (F-D-05, F-J-02) |

## 12. Bad Ideas That Need Replacing

Where Section 11 separated idea from execution, this section lists ideas that are wrong even if implemented perfectly, together with their replacements. Adopting the replacements is mostly a one-afternoon decision each; keeping the originals is what turns small code fixes into architectural liabilities.

- Password-claim login as an activation mechanism (F-A-01). Replace with invite-token-only activation; the invite flow already exists at /auth/activate. Even implemented safely, 'type your teammate's email, get their account' is the wrong primitive for an adversarial audience where rosters are known.
- Unkeyed hash chain as tamper evidence (F-A-06). Replace with an HMAC chain keyed outside the database plus daily exported checkpoints - or drop the 'tamper' language and call it what it is: an append log. A verifier that false-alarms during normal traffic is worse than no verifier.
- Top-1-only candidate decision in matching (F-B-05). Replace with: decide the winning candidate per dimension, require alias evidence on the candidate that wins on location, and sample auto_full awards in review. Substring alias evidence plus span-free location scoring is a slot machine, not a grader.
- Two contradictory definitions of 'done' for a level (F-B-02). DONE_STATUSES excludes 'missed' while the gate treats 'missed' as waiting, and auto-submit advances the pointer on 'missed'. Replace with one definition plus an explicit organizer override endpoint; a state machine with an unrecoverable state and no operator exit is a design bug, not an edge case.
- Client-clock draft reconciliation (F-F-06). Replace with the draft version number both sides already track; timestamps become a tiebreaker at most. Client input must never decide which draft is truth - this is the frontend's only violation of the platform's own first invariant.
- Five-second polling of an aggregation endpoint to render pre-release points (F-F-04, F-G-15). Replace with 60s polling until release plus an invalidation on the release event - or, better, decide the product question first (Section 13) and stop polling an unreleased ledger entirely.
- Evaluate->release as two actions that both enqueue a non-idempotent job (F-B-04). Replace with a single transition (or make the handler idempotent and keep the two-step UX). Two buttons that double-charge penalties when pressed in the documented order is an operator trap.
- Hand-adapting a trust-auth dev script as the production bootstrap (F-D-09, F-I-03). Replace with scripts/prod_db.sh (scram-sha-256, env passwords, localhost-only pg_hba) plus a documented first-tenant/first-admin bootstrap; the runbook currently dead-ends at 'no tenant exists. Run the seed script.' - the script it names is forbidden on production.
- GRANT ALL PRIVILEGES to app_api (F-D-07). Replace with least-privilege grants; the whole trust model's strength is DB-enforced roles, and TRUNCATE-on-app_api quietly removes one of the three guarantees.
- nohup as a deployment story (F-D-01). Replace with supervised processes; nothing else in this list matters if a dead worker stays dead at minute 170.
- Executable agent prompts stored as authority documents (F-J-06, F-J-19). Replace with archived copies under docs/design/archive/ with SUPERSEDED status banners; a prompt whose execution would delete the merged frontend must not look like documentation.

## 13. Looks Correct in Code, Wrong in Practice

These items pass review as code and fail as operations. Each one reads cleanly, has no bug in the usual sense, and still should not survive contact with the event. This is the audit dimension where 'correct' and 'sensible' diverge.

**Table 15: Correct code, impractical system**

| Item | Why the code is 'correct' | Why it is wrong in practice | Location |
| --- | --- | --- | --- |
| max_concurrent_requests_per_user=20 | The setting exists, is documented in SECURITY_ARCHITECTURE.md, and the limiter code is clean | Nothing enforces it anywhere - a declared limit is worse than no limit, because readers believe protection exists | config.py:43-44, F-A-21 |
| points_visible column | Default 0, typed, read by two endpoints with careful float handling | No writer exists in the codebase, so the post-release participant view of points is permanently 0.0 while the leaderboard is right | models_app.py:437, F-B-06 |
| rule_set_hash threading | The hash is computed, stored on stages and carried through job payloads - model replayability hygiene | It is never verified against the rule set actually used at evaluation, so the 'frozen rules' audit trail cannot prove what rules a decision used | models_app.py:270, F-B-17 |
| dispatch_outbox handler | Correct SKIP LOCKED delivery code, properly marked delivered | Nothing ever enqueues it; the mechanism is a no-op that implies guarantees it does not provide | evaluator.py:631-644, F-D-10 |
| Penalty configuration (fp_factor, cap) | Correctly computed, matches SCORING_MODEL.md to the digit | The queries implementing it filter kind='bug_report', which excludes every level report - the feature is dead for the flow the event runs | evaluator.py:536,605, F-B-11 |
| Password reset via logs | Rate-limited, generic responses, token hashed at rest - the security mechanics are right | With no email provider, the recovery path for the organizer's own account is 'read the server log file'; this will not survive a live incident | auth.py:500-523, F-A-07 |
| Stage-wide feedback gate in my_results | BOOL_OR(feedback_released) over the stage is a coherent read of 'release' | One team's early release unlocks every team's ledger read including matched bug codes - if stage-wide is intended, the code should say so; as written it leaks | leaderboard.py:65-94, F-A-16 |
| Readiness gate items | Honest, mechanically enforced, nothing can be falsely checked without intent | Every item points at evidence the current tooling cannot produce (load test cannot simulate 50 users; backup drill has no script), so the honest gate forces either delay or dishonesty | seed.py:598-600, F-J-02 |
| Five-minute results phase (proposal) | Consistent with the proposal's phase schedule, propagated through all docs | Release requires evaluate + per-submission manual test-result entry + review-backlog clearing for ~10 teams; nobody has timed it; ADR-019's follow-up is open | SDC_SAMVITYA_PROPOSAL.pdf:105, F-J-09 |
| 'Immutable' repo choice with admin override | The override is audited and restricted to admin | Overriding challenge_version_id mid-event invalidates evaluations and award claims already keyed to the old version's ground truth | admin_levels.py:94-108, F-B-16 |
| Zip device-node rejection | Mode check looks like a defense-in-depth win | It checks the wrong bits (socket instead of char/block devices); harmless today only because nothing is ever extracted - the guard is a lie waiting for a consumer | storage.py:80-82, F-A-13 |
| Export blob persistence | Second transaction, content-addressed, returns the CSV correctly | Every click during disputes stores a full duplicate blob; the content is returned anyway, so persistence adds risk without value | admin.py:1158-1171, F-C-17 |

One meta-observation spans this table: the platform repeatedly implements a mechanism at the right altitude and then leaves the last wiring step undone - the config knob without enforcement, the column without a writer, the hash without a consumer, the gate without an operator exit. A pre-event review pass that asks one question of every such mechanism - 'who consumes this?' - would have caught most of Section 10 and this section without reading a single line twice.

## 14. Compliance Scorecard Against the Repository's Own Rules

AGENTS.md declares ten engineering invariants that govern any contributor. They served as this audit's independent outside judge: each block auditor checked every invariant against their files, and the scorecard below aggregates those verdicts with the strongest evidence for each. The pattern is consistent and important: the invariants that are enforced by the database (2, 3, 4) pass robustly; the invariants enforced by code discipline at many call sites (1, 5, 6, 7) pass in their core paths and fail at the edges; and the invariants about honesty (10) fail in the documentation layer that no code reviewer reads.

**Table 16: Invariant compliance scorecard**

| # | Invariant | Verdict | Strongest evidence |
| --- | --- | --- | --- |
| 1 | Server owns time, state and truth; identity from token | PASS core / FAIL edges | Identity and clocks are token- and DB-derived everywhere in the core paths; failures: client chooses the rules-acceptance version (F-A-14), submissions accepted on 'armed' pre-start stages (F-C-03), time_adjustment deltas unbounded (F-C-18), client clock decides draft reconciliation (F-F-06) |
| 2 | Ground truth is a separate trust domain | PASS (strongest) | DB-role enforced, real-role tested, zero gt references in participant routers (F-C-02 evidence pass, E-23 narrow-sweep caveat); the only exposure is the offline handout path (F-H-06) and repo visibility (F-J-12) |
| 3 | Score ledger is append-only | PASS with a hole | DB trigger blocks UPDATE/DELETE for every role (0002); but TRUNCATE bypasses row triggers and app_api holds TRUNCATE via GRANT ALL (F-D-07) |
| 4 | Award claims unique; handlers idempotent; at-least-once queue | PARTIAL FAIL | UNIQUE(stage,team,unit) + ON CONFLICT is textbook; but handlers are not uniformly idempotent: penalties double (F-B-04), flag caps race (F-B-07), review items can duplicate (F-B-10); redelivery never tested (F-E-03) |
| 5 | Submission reserve->lock->clock->ordered validate->one commit | MOSTLY PASS | All three submit paths follow the order with one clock read after locks; deviations: reserve is check-then-insert (F-B-08), v1 validates schema before caps (F-B-17), auto-submit re-checks nothing (F-B-03) |
| 6 | Feedback hidden until release | FAIL | Three participant-visible leak channels: /v1/team/score live points (F-C-02), raw non-whitelisted statuses (F-C-04), stage-wide BOOL_OR gate (F-A-16); and zero pytest coverage with one test asserting the leak (F-E-02) |
| 7 | Error envelope; no stack traces or existence signals | PASS handled / FAIL edges | Catalog codes and generic messages throughout; but RequestValidationError and Starlette HTTPException bypass the envelope (F-A-09, F-C-21), invalid UUIDs 500 (F-C-10), and login timing enumerates emails (F-A-17) |
| 8 | Migrations ordered, forward-only, expand/contract | PASS mechanism / FAIL ops | Clean additive history; but partial application wedges deployment (autocommit, non-idempotent 0001) (F-D-08), and grants exist only in dev_db.sh, not migrations (F-C-26) |
| 9 | Case-file design system; never render participant content as HTML | PASS with 2 nits | Zero dangerouslySetInnerHTML/innerHTML, PlainMarkdown text nodes, SSR test; exceptions: text-glyph icon substitutes for the required bespoke SVG icons (F-G-21), three off-token hex colors |
| 10 | Every capacity/security claim measured or marked provisional | FAIL | README headline claims load-readiness while the load report is UNRUN (F-I-01); unverifiable 'last recorded run' receipts (F-I-20); six docs assert stale test counts as fact (F-I-04); the declared concurrency cap is unenforced (F-A-21) |

## 15. Documentation vs Reality

The documentation set is the platform's most distinctive feature: roughly 35 cross-referenced root documents with status headers, honesty markers and an explicit traceability chain. The audit's documentation finding is therefore paradoxical and worth stating precisely: the docs are honest about unknowns and wrong about knowns. Where the team did not know something (load results, backup drills, pen test), the docs say UNRUN and block go-live - exemplary. Where the team did know something, the docs have drifted from the code they describe, and several drifted documents are exactly the ones an operator or participant will follow on the day.

### 15.1 Confirmed drift inventory

**Table 17: Documents whose claims were verified against code and found false or stale**

| Document | Drift | Severity |
| --- | --- | --- |
| README.md | Headline claims load-readiness (contradicted by its own section); test-count drift in one file; unverifiable 'last recorded run' receipts | P0/P1 |
| COMPETITION_RULES.md + PARTICIPANT_HANDBOOK.md + EVENT_OPERATIONS_PLAYBOOK.md + PRODUCT_SPEC_WEBSECTIONS.md | All four describe the retired single-stage event shape (lobby, three-panel workspace, one 180-minute round); the merged four-level flow appears in no participant- or organizer-facing document; 12-team promise vs 10-team platform cap | P0/P1 |
| DATA_MODEL.md | 'Exactly one migration'; four-level tables attributed to 0002; the DB-enforced ledger trigger (actual 0002) absent from every doc; 32 tables vs actual 38 | P1 |
| CI_CD_PIPELINE.md | 'There is NO .github directory'; the pytest suite; describes the e2e-in-CI job as 'future, do not fake' while six jobs including four security scanners run | P2 |
| PERFORMANCE_AND_CAPACITY.md | Says the load-test script and report do not exist - both exist; its own section 6 names the report as the results home | P2 |
| LOAD_TEST_REPORT.md | Honest UNRUN cells, but describes a concurrent burst that is sequential and documents CLI flags that do not exist | P1 |
| TESTING_STRATEGY.md | Wrong totals; coverage table omitted tests including the entire four-level flow suite; stale CI wiring section | P2 |
| EVENT_FLOW.md | Documents config keys (levels.lead_no_lock_policy, auto_after_grace_s, scoring.team_dedupe) and an auto-lock path that do not exist anywhere in code | P1 |
| SECURITY_ARCHITECTURE.md / SECURITY_REVIEW.md | 'No automated vulnerability scanning is configured' while gitleaks, bandit, pip-audit and npm audit run in CI; baseline counts stale; the login-sets-password risk is disclosed only in a code comment | P2 |
| docs/design/ prompts (3 large files) | No status headers; clean-room prompt unexecuted and dangerous to execute; orchestrator prompt embeds a history-rewrite procedure; master prompt matches neither shipped docs nor reality; plus 4 foreign/duplicate files | P1 |
| ONBOARDING_GUIDE.md | stale test total; seed docstring says 6 participants when it seeds 9 | P2 |

### 15.2 What actually matches (credit where due)

For calibration, the audit also verified a large sample of claims and found them exact: SCORING_MODEL.md's every number (weights 0.5/0.3/0.2, review composition, auto-accept thresholds, tie-break order) matches scoring.py, matching.py and evaluator.py; API_REFERENCE.md matched 33 of 34 endpoints on method, path and role; GROUND_TRUTH_ISOLATION.md matches the grant script and tests nearly line for line; the deployment runbook's D0 steps match the actual scripts; the ops playbook's incident section is strong and endpoint-accurate; and the answer key's ten entries all match the shipped source. The drift is a maintenance-process failure, not a comprehension failure. The structural fix is small: single-source the volatile numbers (one file that CI greps and docs reference), require a docs update in the same commit as any endpoint/schema/flow change (the repo's own convention already demands this; enforce it in the docs-hygiene CI job), and give every document in docs/design a status banner.

## 16. Prioritized Remediation Plan

The plan is organized as four waves with a definition of done per wave. Effort markers: S = under half a day, M = one to three days, L = three or more days. Owners are roles, not names; the audit recommends assigning one named owner per wave-0 item immediately, because the readiness-gate finding (F-J-14) shows role-only ownership produces no evidence.

### 16.1 Wave 0 - event-day breakers (target: complete before any rehearsal)

**Table 18: Wave 0 - P0 remediation**

| Item | Findings | Effort | Owner |
| --- | --- | --- | --- |
| Close first-login password claim; invite-token activation only; refuse claim on disqualified | F-A-01 | S-M | Backend lead |
| Fix per-unit scoring: iterate all claim rows, ORDER BY award_unit_id, include level_report in release backfill, create per-flag review items | F-B-01, F-B-10 | M | Backend lead |
| Fix pause/resume status mismatch + time compensation; round-trip test | F-C-01, F-J-03 | S | Backend lead |
| Gate /v1/team/score and statuses on feedback release; delete the test that pins the leak; add masking tests | F-C-02, F-C-04, F-E-02 | M | Backend lead |
| Require stage 'active' for level submissions; treat 'armed' as closed in gates | F-C-03 | S | Backend lead |
| Auto-submit: re-check status/deadline inside lock; skip paused; mark missed on ended; move diff/artifact outside lock | F-B-03, F-D-02 | M | Backend lead |
| Team-gate recovery: count 'missed' as done or add organizer override endpoint; handle row-less participants in auto-submit | F-B-02 | M | Backend lead |
| Penalty idempotency guard; IntegrityError -> 409/replay mapping for idempotency and flow init | F-B-04, F-B-08, F-B-13 | S | Backend lead |
| Strip BUG-XX and defect-explaining comments from participant bundle; grep gate in CI; scope BUG-10 crash to the Search button | F-H-01, F-H-02 | S | Challenge owner |
| Deployment artifacts: compose or systemd units with restart + healthcheck; deploy script | F-D-01 | M | Infra lead |
| Postgres fuses (statement/lock/idle timeouts); TRUNCATE trigger + REVOKE; seed --reset env guard | F-D-03, F-D-07, F-D-06 | S | Infra lead |
| Fix CI trigger to [main]; observe first green run; fix README headline and stale counts everywhere | F-I-02, F-I-01, F-I-04 | S | Release manager |
| Queue redelivery + lease tests; L3/L4 auto-submit tests | F-E-03, F-E-19 | M | QA owner |
| Capacity decision: 10 or 12 teams, one number everywhere (seed, rules, capacity note) | F-D-14, F-J-04 | S | Event lead |

Definition of done for Wave 0: every P0 fixed with a test that fails before and passes after; pytest suite green on a freshly created database; the four-level e2e journey green against a running stack; one full deployment from scratch on a clean VM using only committed artifacts; and a code-freeze discipline announced so the fixes stop regressing.

### 16.2 Wave 1 - operational readiness (target: T-14 to T-7)

**Table 19: Wave 1 - operations and docs**

| Item | Findings | Effort |
| --- | --- | --- |
| Rewrite the four participant/organizer documents for the four-level flow; reconcile capacity number; add level-stage ops section | F-J-01, F-J-04 | L |
| Rewrite load_test.py (real accounts, concurrent burst, uploads, worker-lag probe); run at cap on target hardware; record results; update runbook flags | F-D-05, F-I-07, F-J-02 | M |
| Backup cron + timed restore drill; watchdog cron with chat webhook; logrotate + df watch | F-D-04, F-D-13, F-D-11 | M |
| prod_db.sh + tenant/admin bootstrap + registration bulk import (or executed registration-links prompt) + T-2 provisioning checklist with named owners | F-D-09, F-I-03, F-J-07, F-J-14 | M |
| Proxy-aware rate limits; server-side caching of unauthenticated endpoints; login-limit capacity plan for venue NAT | F-A-08, F-A-04 | S-M |
| Secret split + rotation runbook + fail-closed config guard | F-A-02, F-A-03 | S |
| Frontend event-day fixes: tri-state session restore, auth-expired redirect, ends_at_effective everywhere, editor success-gating, flush on unmount, conflict dialog two-sided, deadline modal status/exit, queryClient.clear(), timeouts | F-F-01/02/03/08/09, F-G-01/02/03/04/05/06 | M-L |
| Answer-key packaging guard (pack_handout.sh asserting absence) + repo visibility decision + Node version verification for venue laptops | F-H-06, F-J-12, F-H-07 | S |
| Docs single-sourcing (test counts, migration inventory, CI as-built) + status banners on design prompts + archive foreign files | F-I-05/08/10, F-J-05/06/19 | S |
| Dispute window + results timeline + ceremony/prizes written down; privacy notice photo/CCTV/age additions routed to legal review | F-J-08, F-J-09, F-J-16 | S-M |

### 16.3 Wave 2 - hardening (target: T-7 to T-0, only after Wave 1)

**Table 20: Wave 2 - selected P1/P2 hardening**

| Item | Findings |
| --- | --- |
| Matching hardening: winning-candidate alias evidence, auto-award sampling, ORDER BY candidate query | F-B-05 |
| Flag-cap advisory locks; refresh-token row lock + rate limit + reuse audit; UUID coercion helper; envelope handlers for framework errors | F-B-07, F-A-12, F-C-10, F-A-09 |
| Audit chain: advisory lock per scope, HMAC key, full-coverage verify, daily checkpoint export | F-A-06, F-C-08, F-A-25 |
| Polling: jitter, backoff, merged participant-state poll, 60s pre-release score | F-G-10, F-F-04, F-F-13 |
| Draft reconcile by version; autosave payload reduction; upload cap served from config | F-F-06, F-F-07, F-G-16, F-G-30 |
| RBAC matrix tests; cap tests; export content test; audit scoped assertions; drop-the-blanket-limiter-wipe fixture | F-E-05/07/09/12/17 |
| Admin validation pass (pydantic bounds everywhere), record_test_results existence check, dispute rate limit + unique index, stage ordinal unique index | F-C-06/12/18/23, F-D-23 |
| CSP meta, strict TS, lib tests, lazy admin/review bundles, global offline banner wired | F-F-11/12/23, F-G-19 |
| Option B parity decision executed (fix to parity or re-label dev-only) | F-H-03/08/09 |

### 16.4 Wave 3 - after the event

Defer to post-event: architecture-level changes that carry regression risk disproportionate to their pre-event value. These include unifying the two submission paths into one parameterized flow, replacing the in-memory rate limiter with a shared implementation if multi-worker deployment ever happens, adopting signed audit checkpoints with external verification as a documented workflow, replacing OFFSET-style list patterns if the event grows beyond a few hundred teams, and deciding whether Option B becomes a maintained second challenge or an archive. Also post-event: the honest retrospective on which documented-but-unbuilt capabilities (outbox delivery, auto-lock policy, concurrency cap) should be either built or deleted from the docs permanently - the audit's Sections 10 and 13 give the starting list.

## Appendix A: Consolidated Finding Index

The table below lists all 227 findings from the ten audit blocks, with severity, location and a one-line summary. IDs are stable and are referenced throughout this document. Severity: P0 = event-day breaker, P1 = major, P2 = should fix, P3 = minor.

### Block A - Auth and security core (backend/app core + auth/state/challenges/leaderboard/announcements/public routers)

| ID | Sev | Location | Summary |
| --- | --- | --- | --- |
| F-A-01 | P0 | routers/auth.py:70-91 | First-login password claim = account takeover of unactivated accounts; resurrects disqualified users |
| F-A-02 | P1 | security.py:29,93,121,129,135 | One secret for JWT, flags, receipts, ip_hash; rotation silently breaks flag verification and receipts |
| F-A-03 | P1 | config.py:24-32,57 | No fail-closed guard: production can boot on dev secrets/credentials/origins |
| F-A-04 | P1 | main.py:112-118; state.py:21-25; public.py | Unauthenticated DB-backed endpoints with no cache/rate limit; pool exhaustion DoS against 12-connection pool |
| F-A-05 | P1 | main.py:69-84 | Body-size cap checks only Content-Length; chunked bodies bypass; OOM risk |
| F-A-06 | P1 | audit.py:35-49,69-95 | Audit hash chain false-breaks under concurrency; unkeyed; verify truncates at 5000 rows |
| F-A-07 | P1 | routers/auth.py:500-523 | Password-reset tokens printed to server logs by unauthenticated endpoint; no audit row |
| F-A-08 | P1 | deps.py:30-39; auth.py:56-58 | Login limiter: per-email lockout DoS; no X-Forwarded-For handling = one global bucket behind proxy |
| F-A-09 | P2 | main.py:94-95; errors.py | Framework errors (422/404/405) bypass the error envelope; invalid UUIDs 500 |
| F-A-10 | P3 | errors.py:76-80 | Unhandled 500s produce no structured log or audit record |
| F-A-11 | P2 | routers/auth.py:279-298 | Refresh grace path skips user-status gate; disqualified user can mint tokens |
| F-A-12 | P2 | routers/auth.py:250-345 | Refresh rotation race (no row lock), no rate limit, reuse-revocation writes no audit entry |
| F-A-13 | P2 | storage.py:80-82 | Zip device-node check tests wrong mode bits (socket, not char/block devices) |
| F-A-14 | P2 | routers/auth.py:655-692 | Rules-acceptance version is client-chosen; pre-accepting future version defeats version gating |
| F-A-15 | P2 | deps.py:30-39 | In-memory limiter: unbounded key space (memory DoS), restart-wipes, per-process |
| F-A-16 | P2 | routers/leaderboard.py:65-94 | my_results gate is stage-wide BOOL_OR; one early release unlocks all teams' ledger reads |
| F-A-17 | P2 | routers/auth.py:76-89 | Login timing channel enumerates registered emails (~1ms vs ~30-80ms Argon2) |
| F-A-18 | P2 | routers/auth.py:38; main.py:50-51 | Secure cookie and API docs coupled to environment flag, not transport; two opposite failure modes |
| F-A-19 | P2 | routers/public.py:48-70 | /v1/public/rules serves unfrozen rule drafts (no frozen_at filter) |
| F-A-20 | P2 | deps.py:159-160; auth.py:168+; leaderboard.py:42 | App wall-clock used where the DB clock is declared authoritative; silent skew |
| F-A-21 | P3 | config.py:43-44; admin.py:898 | Dead knobs: unenforced concurrency cap, unused submission_max_desc_chars, audience column never read, scheduler role unused |
| F-A-22 | P3 | announcements.py:15,24 | Negative limit 500s; audience never filtered; un-rate-limited |
| F-A-23 | P3 | main.py:66-67 | Client-supplied X-Request-Id trusted verbatim; poisoned correlation, oversized echoes |
| F-A-24 | P3 | deps.py:57; errors.py:67-73 | Wrong code for missing bearer; literal {n} in user-visible message; 429 copy wrong |
| F-A-25 | P3 | audit.py:69-95 | audit_verify LIMIT 5000 reports intact on truncated chains; jsonb round-trip can false-break hashes |
| F-A-26 | P3 | migrations/0001:519; auth.py:63 | Case-sensitive email unique index vs lower(email) lookups: duplicate identity, nondeterministic login target |

### Block B - Flow, matching, scoring, evaluation, auto-submit, queue

| ID | Sev | Location | Summary |
| --- | --- | --- | --- |
| F-B-01 | P0 | evaluator_level.py:172-214; evaluator.py:343,418,491 | Level scoring pays evidence_report (~20%) only; review/test components attach to one arbitrary unit (LIMIT 1); release backfill excludes level reports |
| F-B-02 | P1 | flow.py:23,309-330; auto_submit.py:54-69,183-199 | 'missed' and never-initialized participants permanently block the team gate; no organizer recovery endpoint |
| F-B-03 | P1 | auto_submit.py:34,164-181 | Auto-submit does not re-check stage status/deadline; fires during pause; skips after early end; post-deadline received_at under backlog |
| F-B-04 | P1 | evaluator.py:530-559; admin.py:412-418 | release_feedback penalty not idempotent; documented evaluate->release double-enqueue double-charges penalties |
| F-B-05 | P2 | matching.py:100-118,160-257; seed.py aliases | Matching gameable: span-free location score, substring aliases with generic keywords, top-1-only decision; non-ASCII aliases silently never match |
| F-B-06 | P2 | models_app.py:437; submissions.py:375,418 | points_visible never written; post-release participant points show 0.0 |
| F-B-07 | P2 | evaluator.py:266-298 | Flag cap checks are read-then-write races; max_awards and per-team bonus cap can be oversubscribed |
| F-B-08 | P2 | submissions.py:123-140,263; levels.py:895-917 | Idempotency reservation is check-then-insert; concurrent duplicates crash as 500 instead of replay/409 |
| F-B-09 | P2 | levels.py:423-461; auto_submit.py:80-93 | Drafts writable after deadline; auto-submit races the read; >12 flags silently truncated with no note |
| F-B-10 | P2 | jobs.py:102-111; evaluator.py:215-232 | Lease-expiry double-execution safe only for some handlers; review items can duplicate (no partial unique) |
| F-B-11 | P3 | evaluator_level.py:224-231; evaluator.py:536,605 | duplicate collapses to rejected_auto; penalty and invalid-count queries exclude level reports - penalty dead for the live flow |
| F-B-12 | P3 | scoring.py:167-183; models_app.py:534-546 | Leaderboard snapshot MAX(version)+1 race; no UNIQUE(stage_id, version) |
| F-B-13 | P3 | flow.py:87-120 | init_participant_flow check-then-insert race -> 500 on first-touch double fire |
| F-B-14 | P3 | submissions.py:142-154; levels.py:920-928; config.py:27-28 | Stage-row serialization: adequate at 50 teams but a global chokepoint with no headroom measurement; lock ordering consistent |
| F-B-15 | P3 | evaluator.py:631-644 | dispatch_outbox marks events delivered without delivering anything |
| F-B-16 | P3 | admin_levels.py:94-108 | Repo-lock override can re-point the 'immutable' challenge version mid-event, invalidating prior evaluations |
| F-B-17 | P3 | submissions.py:182; evaluator.py:126; evaluator_level.py:128 | Validation order deviates from invariant 5 text; min_description_chars hardcoded; rule_set_hash carried but never verified |
| F-B-18 | P3 | review.py:179-247 | Review decisions last-write-wins can contradict ledgered points |
| F-B-19 | P3 | auto_submit.py:63 | Tautological EXISTS predicate in _pending_participants |

### Block C - Admin/levels/submissions/review routers

| ID | Sev | Location | Summary |
| --- | --- | --- | --- |
| F-C-01 | P0 | admin.py:343-355,377-383 | Pause->resume: transition stores 'pause', resume looks up 'paused' -> scalar_one() raises -> 500, stage stuck paused; no test |
| F-C-02 | P0 | levels.py:618-657; evaluator_level.py:196-209 | /v1/team/score returns live ledger points pre-release - ground-truth oracle; test pins it as correct |
| F-C-03 | P1 | levels.py:932-941; flow.py:253-268 | Level submissions accepted on 'armed' (pre-start) stages; no window enforced; gates treat armed as open |
| F-C-04 | P1 | submissions.py:371-381 | my_submissions leaks rejected_auto/duplicate statuses pre-release (non-whitelisted statuses returned raw) |
| F-C-05 | P2 | admin.py:470-511; auth.py:401-424 | Invite role unvalidated: organizer can mint admin; typo'd role bricks the account |
| F-C-06 | P2 | admin.py:1261-1301,1224-1247 | Manual adjustments accept NaN and unbounded points; poisons SUM(points), CSV, tie-breaks |
| F-C-07 | P2 | admin.py:821-851 | add_flag skips challenge-status lock; ground truth mutable after seal/publish |
| F-C-08 | P2 | audit.py:35-43; admin.py:1043-1047 | Audit chain false breaks under submission burst (concurrent same-scope writes) |
| F-C-09 | P2 | levels.py:197-238,663-697; flow.py:235-330 | Participant polls run 16-22 queries with 4 gate computations; heaviest pollers unthrottled |
| F-C-10 | P2 | admin.py:111,1209; levels.py:980; submissions.py:395; review.py:113 | Invalid UUIDs produce raw 500s instead of 404s on fuzzable endpoints |
| F-C-11 | P2 | admin.py:1051-1070 | Negative limit on audit endpoints -> Postgres LIMIT error -> 500 |
| F-C-12 | P2 | admin.py:854-880 | record_test_results accepts any submission_id, returns 200, silently dead-letters later |
| F-C-13 | P2 | admin.py:179,156-158,185 | Config freeze binds string 'now()' to timestamptz; weight parse ValueError; rules_version + 0 no-op |
| F-C-14 | P2 | review.py:201-208,226 | needs_second_review marks item decided; no second review possible; submission stuck in_review |
| F-C-15 | P3 | admin.py:397-429 | release_results returns ok for unknown actions and audits the typo |
| F-C-16 | P3 | admin.py:1018-1040,247-249 | set_readiness silently succeeds on 0 rows; stage ordinal MAX+1 race; no UNIQUE(event,kind,ordinal) |
| F-C-17 | P3 | admin.py:1078-1172 | CSV exports unaudited and stored as duplicate blobs per click |
| F-C-18 | P3 | admin.py:38-45,536-539,735-745,918,688-717 | Admin model validation gaps: negative duration, unbounded fields, untyped locations, unbounded delta, cross-event assignment |
| F-C-19 | P3 | admin.py:572-574,614-621 | Challenge upload read-then-check; 5000 single-row INSERTs per file in one transaction |
| F-C-20 | P3 | admin.py:48-93; levels.py:896-917; submissions.py:124-139 | Duplicate-key races surface as 500s (slug, idempotency, join codes) |
| F-C-21 | P3 | main.py:94-95; errors.py | FastAPI default 422s and middleware ValueError bypass the envelope |
| F-C-22 | P3 | levels.py:586-615,197-238; submissions.py:468-520 | Internal identifiers returned to participants; drafts accept any challenge_version_id |
| F-C-23 | P3 | submissions.py:426-460; admin.py:1178-1191 | Disputes: no rate limit/uniqueness; status clobbering; unpaginated queue |
| F-C-24 | P3 | admin.py:147-150,220-224 | Config mass-assignment: arbitrary stage config keys accepted without enum validation |
| F-C-25 | P3 | admin_levels.py:270-276 | Level stages bootstrapped with empty config, bypassing DEFAULT_STAGE_CONFIG and rule_set_hash |
| F-C-26 | P3 | admin.py:751-759,800-810 | add_bug TOCTOU across two sessions; audit written on gt session; grants live only in dev_db.sh |

### Block D - Migrations, seed, worker, scripts, CI, ops

| ID | Sev | Location | Summary |
| --- | --- | --- | --- |
| F-D-01 | P0 | run_dev.sh:36-37; DEPLOYMENT_RUNBOOK.md:8 | No deployment artifacts; nohup only; no supervision/restart/TLS; dead worker stays dead |
| F-D-02 | P0 | auto_submit.py:179,201; submissions.py:148 | Auto-submit holds stage-row lock across diff computation and artifact disk I/O; submissions serialize behind it |
| F-D-03 | P1 | db.py:29-36; .env.example:19-20 | No statement/lock/idle-in-transaction timeouts anywhere; wedged transaction pins pool |
| F-D-04 | P1 | BACKUP_AND_RECOVERY.md:37,78 | No automated backups, no WAL archiving, restore drill UNRUN; RPO unbounded |
| F-D-05 | P1 | load_test.py:86,113,141-170 | Load test cannot simulate event: max ~10 pollers, sequential burst, 429s counted as acks, no uploads |
| F-D-06 | P1 | seed.py:490-544,500 | seed --reset TRUNCATEs everything with no environment guard or confirmation flag |
| F-D-07 | P1 | 0002:13-16; dev_db.sh:116; 0003:110-111 | Ledger immutability has TRUNCATE hole (row triggers only); app_api holds TRUNCATE via GRANT ALL |
| F-D-08 | P1 | migrate.sh:45-46; 0001_init.sql:28 | Migrations applied statement-by-statement in autocommit; 0001 not re-runnable; partial application wedges schema |
| F-D-09 | P2 | dev_db.sh:55,100-107 | Only DB bootstrap is a trust-auth dev cluster with hard-coded dev passwords; no production equivalent |
| F-D-10 | P2 | submissions.py:297-303; levels.py:1063; evaluator.py:631 | Outbox is write-only: rows inserted, nothing ever enqueues delivery |
| F-D-11 | P2 | run_dev.sh:35-37; storage.py:23-27; dev_db.sh:16 | pgdata, artifacts, WAL, unrotated logs share one volume; no quota/rotation/df watchdog |
| F-D-12 | P2 | worker.py:25-45; auto_submit.py:266-293 | Single worker; scan runs inline blocking drain; release backlog unmeasured; no queue-age metric |
| F-D-13 | P2 | main.py:112-118; DEPLOYMENT_RUNBOOK.md:88 | No external watchdog or alerting; dead-lettered jobs surface nowhere |
| F-D-14 | P2 | seed.py:586,95 | Capacity contradiction: max_teams=10 vs 12-team promise; 50 participants unreachable at min team size |
| F-D-15 | P2 | e2e_journey.py:112-244; ci.yml:212-214 | CI's live e2e covers only the v1 flow; the four-level event flow has no live-stack gate |
| F-D-16 | P2 | jobs.py:42,59,109; db.py:73-75 | Queue uses Python clock vs DB decision clocks; NTP nowhere in the runbook |
| F-D-17 | P2 | DEPLOYMENT_RUNBOOK.md:41; LOAD_TEST_REPORT.md:47 | Operator-facing docs contradict code: stale test totals; nonexistent CLI flags |
| F-D-18 | P3 | requirements.txt:14-16 | Test deps (httpx, pytest) in runtime requirements contradict dev-requirements header |
| F-D-19 | P3 | dev_db.sh:105-107; config.py:24-26 | scheduler DB role granted everywhere, used by nothing |
| F-D-20 | P3 | seed.py:549-554; run_dev.sh:22 | seed not idempotent without --reset; run_dev.sh hardcodes DB var dev_db.sh honors |
| F-D-21 | P3 | .env.example | Artifact dir and upload cap settings missing from env template |
| F-D-22 | P3 | .gitignore:25,41,5-6 | Duplicate tools/ entries and residue paths |
| F-D-23 | P3 | 0001_init.sql:221-238; seed.py:730-762 | No DB uniqueness on (event_id, ordinal) for level stages; duplicate ordinals corrupt pointer mapping |
| F-D-24 | P3 | worker.py:32-52; jobs.py:41 | No graceful shutdown; SIGTERM abandons in-flight job until 120s lease |
| F-D-25 | P3 | 0001_init.sql:548-571 | Index over-provisioning on hottest tables: harmless at event scale, note for future |

### Block E - Backend test suite

| ID | Sev | Location | Summary |
| --- | --- | --- | --- |
| F-E-01 | P1 | README.md:18,62,101 vs AGENTS.md:58 | Test-count drift: README contradicts itself and AGENTS.md; ground truth 74 |
| F-E-02 | P0 | tests/ (grep: no release tests); test_flow_submissions.py:74-76 | Invariant 6 has zero pytest coverage; one test asserts pre-release score visibility (the leak) as correct |
| F-E-03 | P0 | conftest.py:123-128; jobs.py:102-111 | Queue lease/retry/dead-letter/crash-recovery machinery bypassed by synchronous worker_drain; zero tests |
| F-E-04 | P1 | test_idempotency.py:26-36 | Concurrent same-idempotency-key submissions untested; reservation race outcome unknown |
| F-E-05 | P1 | deps.py:33-39; conftest.py:59-65 | Rate limiting never asserted; fixture wipes the limiter before/after every test |
| F-E-06 | P1 | test_flow_auto_submit.py:156 | Grace test is a 3-second race; time_adjustments path untested; no boundary tests |
| F-E-07 | P2 | seed.py:490-543; test_auth.py:187-189 | Audit assertions are weak >=1 counts over a table seed-reset never clears |
| F-E-08 | P2 | test_scoring.py:237-256 | Leaderboard: only tie-break comparator tested; ledger->snapshot SQL, refresh job, visibility gating untested |
| F-E-09 | P2 | test_authorization.py:35-56 | Admin RBAC spot-checks cover ~3 of ~40 endpoints; organizer-vs-admin boundary untested |
| F-E-10 | P2 | test_flow_uploads.py | Upload gaps: corrupt zip, entry-count bombs, foreign artifact_id, and no test touches Level 4 at all |
| F-E-11 | P2 | conftest.py:73 | Unhandled-exception envelope path never exercised (raise_server_exceptions default) |
| F-E-12 | P2 | submissions.py:206-224 | Submission caps (per-file 12, per-round 80) untested; level flag cap untested |
| F-E-13 | P3 | conftest.py:118 | X-Stage-Id header is dead plumbing; backend never reads it |
| F-E-14 | P2 | test_auth.py:64-83 | Step-up expiry, access-token expiry, invalid-signature, reset-token single-use untested |
| F-E-15 | P1 | conftest.py:35-46; dev_db.sh:84-86 | Test DB never recreated fresh; stale schema masks migration drift |
| F-E-16 | P3 | test_flow_repo_lock.py:100; test_scoring.py:172-173 | Seed-coupled literals make the suite brittle to seed edits |
| F-E-17 | P2 | tests (grep export\|dispute\|announce: 0 hits) | CSV exports, disputes, announcements: zero pytest; e2e checks one substring |
| F-E-18 | P1 | test_scoring.py:124-141; test_flow_repo_lock.py:60-78 | All concurrency tests are in-process threads; no pool/worker-process realism |
| F-E-19 | P0 | auto_submit.py:128-161; tests (levels/4: 0 hits) | L3/L4 auto-submit artifact branch has zero coverage; the auto-submit tests exercise only Level 1 |
| F-E-20 | P3 | test_auth.py:44-51 | Reset-token test bypasses issuance; name over-promises |
| F-E-21 | P3 | test_flow_repo_lock.py:7 | Dead imports in suite; otherwise lean |
| F-E-22 | P2 | seed.py:494-533 | Reset is a hand-maintained DELETE list, not TRUNCATE CASCADE; FK-less tables keep stale rows |
| F-E-23 | P2 | test_gt_isolation.py:18-38 | GT isolation narrow: 3 statements, not an information_schema sweep over all gt tables |
| F-E-24 | P3 | conftest.py; seed.py:490+ | Full reseed per test = minutes of wall time; trajectory pressure toward shared fixtures |

### Block F - Frontend lib/state/persistence/auth

| ID | Sev | Location | Summary |
| --- | --- | --- | --- |
| F-F-01 | P1 | auth.tsx:41-66; api.ts:62-79 | Session restore treats network-down/5xx as logged-out; mass re-login trips venue NAT login limit |
| F-F-02 | P1 | api.ts:141-147; config.py:38 | Revoked-session 401s never end the client session; endless silent poll loop, no redirect |
| F-F-03 | P1 | api-levels.ts:48-59; Warnings.tsx:68; ProgressBar.tsx:87 | All deadline warnings/countdowns use raw ends_at, not ends_at_effective; false 'Time's up' after any time adjustment |
| F-F-04 | P1 | event-session.ts:132-142; Dashboard.tsx:242; levels.py:618-657 | 5s polling of unreleased ledger; pre-release points rendered; load multiplication + invariant-6 tension |
| F-F-05 | P2 | api.ts:141-151 | 401 body read twice; every 401 loses its envelope (code, message, request_id) |
| F-F-06 | P2 | persistence.ts:328-335 | Draft reconcile compares client clock to server clock; skewed laptops silently pick winners |
| F-F-07 | P2 | persistence.ts:46-48,332-334; LevelWorkspace.tsx:252-254 | Conflict outcome carries one state; both dialog buttons hydrate the same object |
| F-F-08 | P2 | auth.tsx:83-92; main.tsx:21-29 | React Query cache survives logout/account switch; previous user's data flashes |
| F-F-09 | P2 | api.ts:125-130 | No timeout/AbortController on any fetch; hung sockets accumulate on venue WiFi |
| F-F-10 | P2 | event-session.ts:195-199 | Raw ISO timestamp rendered in participant-facing copy |
| F-F-11 | P2 | tsconfig.app.json; tsconfig.node.json | TypeScript strict and noUncheckedIndexedAccess off in both configs |
| F-F-12 | P2 | frontend/tests/ | No tests for api.ts, event-session.ts, format.ts - the highest-risk lib logic |
| F-F-13 | P2 | event-session.ts:93-151; levels.py:663-697 | Per-tab 0.65-0.9 req/s concentrated on /v1/progress (~16-22 queries); 30-45 rps at full occupancy |
| F-F-14 | P3 | api.ts:37-52; auth.tsx:27-34; persistence.ts:148-163 | Dead code: describe branches, getAccessToken, mounted ref, unwired clearAllForUser |
| F-F-15 | P3 | auth.tsx:83-92; persistence.ts:147 | Logout leaves participant drafts in IndexedDB contrary to module's stated intent |
| F-F-16 | P3 | api.ts:68 | Manually set Origin header is a browser-forbidden header; works only by accident |
| F-F-17 | P3 | auth.tsx:75-76 | login() fabricates a Me when /v1/me hiccups; rules banner reappears |
| F-F-18 | P3 | diff.ts:93-119,128-187 | Fallback diff is positional (undocumented); two-hunk path untested |
| F-F-19 | P3 | persistence.ts:198-200 | readFlags trusts any array as FlagDraft[]; only unguarded field in the reader |
| F-F-20 | P3 | persistence.ts:68-93 | IndexedDB open has no onblocked handler; future version bump can hang saves forever |
| F-F-21 | P3 | format.ts:72-74; event-session.ts:51-60 | Clock offset is a single unsmoothed sample biased by RTT |
| F-F-22 | P3 | api-levels.ts:317-321 | Artifact upload has no idempotency key; retry stages duplicates |
| F-F-23 | P3 | index.html; vite.config.ts; App.tsx | No CSP on the SPA; admin/review code ships in the participant bundle |

### Block G - Frontend pages/components

| ID | Sev | Location | Summary |
| --- | --- | --- | --- |
| F-G-01 | P1 | LevelWorkspace.tsx:292-297,551-563; EditableEditor.tsx:73-86 | Editor renders empty while file fetch pending/failed and accepts keystrokes; submission diff replaces whole file with typed fragment |
| F-G-02 | P1 | LevelWorkspace.tsx:252-254,474-483; persistence.ts:316-336 | Conflict dialog offers two buttons wired to the same draft; older draft unreachable |
| F-G-03 | P1 | Warnings.tsx:66-80; ProgressBar.tsx:86-96 vs levels.py:228; flow.py:221-232 | Deadline warnings use raw ends_at vs workspace's ends_at_effective; false deadline during time adjustments |
| F-G-04 | P1 | LevelWorkspace.tsx:165-208,333-345 | Submit proceeds against stale server draft when pre-submit flush fails; no save-status interlock |
| F-G-05 | P1 | LevelWorkspace.tsx:211-241,440-441 | No flush on unmount/pagehide; Explain/Rules navigation discards up to ~3s of edits |
| F-G-06 | P1 | Warnings.tsx:133-143 | Deadline modal unescapable, no status/timeout/fallback; worker lag walls participants |
| F-G-07 | P2 | Warnings.tsx:126-128 | Deadline modal claims auto-submission the UI never verifies; no receipt poll |
| F-G-08 | P1 | Login.tsx:45-91; Terms.tsx:14-16; EventDetails.tsx:188-193 | Three contradictory account-creation stories on the highest-traffic screen; venue NAT login limit unaddressed in UI |
| F-G-09 | P2 | persistence.ts; LevelWorkspace.tsx:174-186 | Two tabs of one participant fight over one per-user draft; last-writer-wins, no conflict surface |
| F-G-10 | P2 | event-session.ts:93-151; Dashboard.tsx:217-736; Queue.tsx:20 | Polling matrix ~30-40 rps at occupancy; no jitter/backoff; PUT draft unthrottled |
| F-G-11 | P2 | event-session.ts:51-83; Warnings.tsx:54 | Clock-offset failure silently disables every deadline warning and countdown |
| F-G-12 | P2 | types.ts:253-272; ItemDetail.tsx:114 | Review detail lacks claimed_by_me; any reviewer gets an editable form on another's claim |
| F-G-13 | P2 | ItemDetail.tsx:34-40,247-287 | Rubric sliders default 0 and are optional even for accept_full; no zero-rubric guard |
| F-G-14 | P2 | Dashboard.tsx:386-394 | Stage pause/start/arm single-click (only end confirmed); mis-click rejects all submissions |
| F-G-15 | P2 | levels.py:618-657; Dashboard.tsx:236-257 | Team score exposes per-stage/per-component points pre-release; needs product ruling |
| F-G-16 | P2 | LevelWorkspace.tsx:148-163,223-232,303-312 | Autosave PUTs entire draft payload (all edited files) every 3s + on tab switches; heaviest uplink of the day |
| F-G-17 | P2 | Submissions.tsx:44; App.tsx:91 | 'Open workspace' CTA dead-ends at a redirect to dashboard |
| F-G-18 | P2 | Results.tsx:19-31 | Results page can only ever show the current round; released L1 results unreachable later |
| F-G-19 | P3 | chrome.tsx:189-207 | OfflineBanner dead code; no global connection indicator |
| F-G-20 | P3 | Challenges.tsx:141-150 | Stale-closure error check gates invalidation in publish flow |
| F-G-21 | P3 | LevelWorkspace.tsx:453,530 | Text-glyph icons substitute for required bespoke SVG icons (invariant 9 icon clause) |
| F-G-22 | P3 | Landing.tsx:11-19,347 | Dead duplicate server-offset hook on Landing |
| F-G-23 | P3 | ItemDetail.tsx:19-27 vs SubmissionPayload.tsx:6-14 | payloadLines duplicated instead of reusing the security-boundary component |
| F-G-24 | P3 | flagValidation.ts:24 | Client mirrors backend validation with hardcoded tolerance; wrong friendly errors if config changes |
| F-G-25 | P3 | EditableEditor.tsx:47-56 | Tab hijack with no Escape hatch; keyboard users cannot Tab out |
| F-G-26 | P3 | LevelWorkspace.tsx:561 | Editor caret/selection not reset when switching files (no key prop) |
| F-G-27 | P3 | CodeViewer.tsx:159-166 | Viewer shows 'Empty file' while fetch pending/failed |
| F-G-28 | P3 | StepUp.tsx:23,44-58 | Step-up validity chip never ticks; expiry not reactive |
| F-G-29 | P3 | Submissions.tsx:65-69 | Clickable rows lack role/Space activation; screen readers announce nothing |
| F-G-30 | P3 | UploadDialog.tsx:27 | Hardcoded 6 MiB client upload ceiling may not match server |
| F-G-31 | P3 | Challenges.tsx:19-36 | Organizer challenge-id list persists in localStorage on shared machines |
| F-G-32 | P3 | LevelWorkspace.tsx:174-186 | Version-conflict resolution silently overwrites latest server draft (last-writer-wins) |

### Block H - Challenge apps and answer key

| ID | Sev | Location | Summary |
| --- | --- | --- | --- |
| F-H-01 | P0 | server.js:23-25; db.js:50-54; routes/*.js; public/app.js (9 files) | 9/10 planted bugs self-labeled with BUG-XX category and root cause in participant-shipped source; grep = 275 points |
| F-H-02 | P1 | public/app.js:84; index.html:20,58 | BUG-10 crash kills whole client boot: login panel never unhides, notes never load, Enter-search false; answer key repro wrong |
| F-H-03 | P1 | seed.py:398-405 vs option-b/main.py:38-43 | Option B FLAG-1 unsolvable: plaintext exists nowhere in the Marina app; blocks A/B equivalence certification |
| F-H-04 | P2 | db.js:46; seed.py:44 | FLAG-1 plaintext in shipped db.js; access-control side quest solvable by Ctrl+F |
| F-H-05 | P2 | public/app.js:111-112 (both apps) | XSS surface broader than answer key: note titles/authors also interpolated into innerHTML; unplanted path outside GT tolerance |
| F-H-06 | P1 | challenge-app/ORGANIZER_ANSWER_KEY.md in handout folder | RESTRICTED answer key inside the folder participants receive; no packaging guard on offline path |
| F-H-07 | P2 | README.md:8; package.json:10-12; db.js:3 | Node engine floor likely wrong for node:sqlite; npm start can fail on stock 22.x laptops (needs version verification) |
| F-H-08 | P2 | option-b routes/auth.py:58-65; routes/notes.py:14-65 | Option B fake auth: client-supplied identity, no ownership checks; unplanned vulnerabilities outside the 10 GT units |
| F-H-09 | P2 | option-b routes/comments.py:18-25; public/app.js:4 | Option B comment XSS unreachable from UI; FLAG-2 decodes without FLAG{} wrapper |
| F-H-10 | P3 | ORGANIZER_ANSWER_KEY.md:28-29,43-44,95-96 | Answer-key inaccuracies: no stack leak exists (generic 500); banner is text not a link |
| F-H-11 | P3 | public/index.html:14; app.js | Dead 'My notes' nav: unplanned defect that will eat report slots |
| F-H-12 | P3 | option-b README.md:6; main.py:28; routes/auth.js:16-20 | Cosmetic drift: nginx claimed but absent; deprecated on_event startup; dead ttl parameter |

### Block I - Engineering documentation vs code

| ID | Sev | Location | Summary |
| --- | --- | --- | --- |
| F-I-01 | P0 | README.md:9-11 vs 106-108; LOAD_TEST_REPORT.md:3 | README headline claims load-readiness while the load report is UNRUN everywhere; invariant 10 violated in the first paragraph |
| F-I-02 | P0 | ci.yml:2-5 | CI trigger corrupted ('ain]'); the documented merge gate can never fire; all 'CI green' evidence void |
| F-I-03 | P1 | DEPLOYMENT_RUNBOOK.md:69-71; auth.py:202-247 | No production bootstrap: first tenant/first admin impossible without the forbidden dev seed; register endpoint undocumented |
| F-I-04 | P1 | README.md:18,62,101; SECURITY_REVIEW.md:11; CI_CD_PIPELINE.md:24,36; PERFORMANCE_AND_CAPACITY.md:28; DEPLOYMENT_RUNBOOK.md:41; TESTING_STRATEGY.md:7,46 | Test-count chaos: conflicting stale totals across six docs; AGENTS.md only correct one |
| F-I-05 | P1 | DATA_MODEL.md:11,53,65 | DATA_MODEL says one migration, misnumbers four-level as 0002, omits the ledger-trigger migration entirely |
| F-I-06 | P1 | EVENT_FLOW.md:101-106,173-175 | EVENT_FLOW documents config keys and auto-lock path that do not exist in code |
| F-I-07 | P1 | LOAD_TEST_REPORT.md:20,22,47-48,73 vs load_test.py | Report overstates tool: burst sequential not concurrent, documented flags do not exist, 'appends to report' false, 60 pollers impossible |
| F-I-08 | P2 | CI_CD_PIPELINE.md:7-12,24,36,59-63 vs ci.yml | CI doc asserts no CI exists while six jobs run; four security scanners and coverage gate absent from docs |
| F-I-09 | P2 | TESTING_STRATEGY.md:7,15,30-37,46,130 | Wrong totals; coverage table omitted tests including the entire four-level flow suite |
| F-I-10 | P2 | PERFORMANCE_AND_CAPACITY.md:26 vs 83 | Doc says load-test script/report do not exist; both exist; self-contradiction within the doc |
| F-I-11 | P2 | SECURITY_ARCHITECTURE.md:88; SECURITY_REVIEW.md:11 | 'No automated vulnerability scanning' while four scanners run; stale baseline numbers |
| F-I-12 | P2 | API_REFERENCE.md sections 2,8 vs auth.py:195-247 | POST /v1/auth/register (admin-only) absent from API reference; operationally important omission |
| F-I-13 | P2 | SECURITY_ARCHITECTURE.md:9 vs auth.py:70-86 | Login-as-activation risk disclosed only in a code comment, never in security docs |
| F-I-14 | P2 | BACKUP_AND_RECOVERY.md:37,78,110; DEPLOYMENT_RUNBOOK.md:114-130 | No monitoring/alerting story, no incident procedure, no post-event export/retention/deletion procedure anywhere |
| F-I-15 | P3 | DATA_MODEL.md:13; SYSTEM_ARCHITECTURE.md:47 | Stale table counts: 32 described, 38 actual |
| F-I-16 | P3 | API_REFERENCE.md:154 vs 189-190 | Section 9 contradicts section 10 on RUNNER_UNAVAILABLE |
| F-I-17 | P3 | SOURCE_OF_TRUTH_AND_TRACEABILITY.md:45 | Worker entry attributed to backend/app/main.py instead of backend/worker.py; self-violates its own pointer rule |
| F-I-18 | P3 | e2e_journey.py:222,224 | the documented check total is runtime-true but source-grep-ambiguous; documented in one place only |
| F-I-19 | P3 | load_test.py:11 vs 175-193 | Docstring claims appending to the report file; prints to stdout only |
| F-I-20 | P2 | README.md:61-63 | Unverifiable 'last recorded run' claims; no run log or CI artifact exists |

### Block J - Event operations, product, legal, design docs

| ID | Sev | Location | Summary |
| --- | --- | --- | --- |
| F-J-01 | P0 | COMPETITION_RULES.md:48-152; PARTICIPANT_HANDBOOK.md:67-232; EVENT_OPERATIONS_PLAYBOOK.md:107-306; PRODUCT_SPEC_WEBSECTIONS.md:188-327 | All four event-facing docs describe the retired single-stage event; four-level flow documented nowhere participant/organizer-facing |
| F-J-02 | P0 | LOAD_TEST_REPORT.md:3,53-63; KNOWNS_LIMITATIONS:35; PLAYBOOK:37 | Load test at cap never run while the readiness gate blocks go-live on it; four-level polling profile absent |
| F-J-03 | P1 | admin.py:338-382 vs EVENT_OPERATIONS_PLAYBOOK.md:192-199 | Pause/resume time compensation silently never happens (status-string mismatch); playbook describes a different stale failure |
| F-J-04 | P1 | COMPETITION_RULES.md:29-30 vs seed.py:583,95 | Rules promise 12 teams; platform enforces 10; team 11 rejected at the desk |
| F-J-05 | P1 | docs/design/local-agent-handover.md; FMD-CLOUD-024; Mission Build a Comprehensive.md; (Copy).md | Three foreign-project files plus a byte-identical duplicate live in docs/design |
| F-J-06 | P1 | docs/design/ three large prompt files (~2,400 lines) | Stale executable prompts as authority docs; clean-room prompt unexecuted and would delete the merged frontend; orchestrator embeds history-rewrite procedure |
| F-J-07 | P1 | CLOUD_AGENT_PROMPT_REGISTRATION_PAYMENTS.md:3-5; admin.py:439-512 | Registration not solved: subsystem exists only as unexecuted prompt; ~50 manual one-at-a-time invites |
| F-J-08 | P1 | COMPETITION_RULES.md:7,200; PLAYBOOK:314; PRIVACY_NOTICE.md:75-77 | Dispute window deferred in three docs (retention circular); winner announcement, prizes, certificates documented nowhere |
| F-J-09 | P1 | SDC_SAMVITYA_PROPOSAL.pdf:105; PLAYBOOK:282-306; admin.py:854-855 | Five-minute results phase vs real workload of per-submission manual test-result entry; ADR-019 follow-up open |
| F-J-10 | P1 | PLAYBOOK:46-49; RULES:166-168; AI_TOOLING:109-113 | Venue AI-block asserted not engineered: no owner, blocklist, test method, or fallback |
| F-J-11 | P1 | HANDBOOK:60-65; RULES:24-26 | Node 22.5+ prerequisite with no pre-event verification, spare laptops, offline npm fallback, or min-crew rule |
| F-J-12 | P1 | ORGANIZER_ANSWER_KEY.md:1-8; AGENTS.md:21-23 | Answer key in possibly-public GitHub repo; needs visibility verification |
| F-J-13 | P2 | ONBOARDING_GUIDE.md:49,65; seed.py:4 | Stale counts in onboarding/decision docs; seed docstring wrong |
| F-J-14 | P2 | EVENT_OPERATIONS_PLAYBOOK.md:35-44 | Readiness-gate items point at evidence nobody produced; owners are roles not people with dates |
| F-J-15 | P2 | EVENT_OPERATIONS_PLAYBOOK.md (whole) vs design DOCX risk register | Room logistics unwritten: check-in roster, seating, power, AV fallback, NTP check, printing, spare laptops |
| F-J-16 | P2 | PRIVACY_NOTICE.md; TERMS_OF_USE.md vs design spec DOCX | Privacy gaps: no photo/CCTV/ID disclosure, no under-18 handling, no DPDP framing, unfilled contact; retention circular |
| F-J-17 | P2 | AUTONOMOUS_DECISION_LOG.md:119-125 vs security.py:118-121 | ADR-016 misdescribes receipt derivation; rotation guidance omits receipt invalidation |
| F-J-18 | P2 | SOURCE_OF_TRUTH:15-16 vs REQUIREMENTS_RECONCILIATION:8,13-26 | Two living reconciliation docs contradict each other on the event shape; R2's missing-attachment claim now false |
| F-J-19 | P2 | docs/design/*.md (6 files) | Design prompts carry no status/authority headers - exactly where ambiguity is most dangerous |
| F-J-20 | P3 | docs/design/bug_hunt_ctf_setup.pdf | Setup PDF describes an unrelated CTFd/Juice-Shop design; protected only by a hierarchy note in another doc |

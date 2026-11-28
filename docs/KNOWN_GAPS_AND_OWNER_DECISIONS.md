Status: created 2026-11-25 for the four-level event flow branch

# Known Gaps and Owner Decisions

Everything the four-level flow needs that cannot be decided by an agent.
Each item lists whether it blocks marking the event READY (the readiness
checklist in the admin console and `docs/ONE_SHOT_ACCEPTANCE_CRITERIA.md`
enforce the blocking ones).

## Blocking before READY (event-critical)

1. Production schedule. The seed ships synthetic level windows (minutes) that
   are clearly labeled. The real 6 December 2026, 180-minute schedule must be
   configured per level (stage windows) and rehearsed. 
   Owner decision: Add ability to schedule and plan the event ; during the even admin must have the ability to reduce or increase the timing of each level . the full even must be planned out by the admin along with questions, solutions, marks, scores, etc .  
2. Final per-level score weights, tie-break and penalty policy. Dev defaults
   are provisional and labeled; the baseline forbids inventing production
   weights. 
   Owner decision: approve the policy; blocks score finalization; Admin must have the ability to alter the ability to alter the scores .
   and publication.
3. Final A/B challenge repositories with equivalent ground truth and hidden
   tests. The shipped Option A (Papyrus) and Option B (Marina) are
   development fixtures. Two independent reviewers must certify equivalence
   (difficulty, bug count, severity distribution) before READY. 
   Owner decision: supply or approve final packages; blocks READY.
4. Level 3 side-quest definition. The level is wired end to end but the side
   quest content is organizer input. 
   Owner decision: allow the admin or organizers to add the side quest , side quests are implanted in both Papyrus, Marina they will be part of repo ; blocks
   READY.
5. Level 4 test/documentation rubric and reviewer allocation. The review
   flow exists; the rubric weights are configuration. Owner decision:
   approve rubric; blocks READY.
6. Lead-no-lock policy. `levels.lead_no_lock_policy` supports `manual`
   (dev default) and `auto_after_grace_s`. 
   Owner decision: choose the
   production policy and default option; blocks READY.
7. Load test at the expected headcount. The platform caps (50 participants /
   12 teams) are provisional (ADR-011); the four-level endpoints add polling
   surfaces that should be included in the next load-test run. 
   Owner decision: confirm expected teams x participants and run the profile;
   blocks READY.
8. Runner approval. Run stays disabled (ADR-010). If Run is wanted for
   Levels 3-4, an isolated runner design and capacity review must pass.
   Owner decision: approve ; blocks READY Run is
   expected on event day for level 3 and levle 4.

## Non-blocking (tracked, with owners)

9. Frontend concept selection. PRs #16, #17, #18 (recreated concepts) remain
   mutually exclusive alternatives; the owner picks one and funds its
   four-level adaptation (the backend keeps every v1 endpoint stable, so all
   three still run today). PR #19 (rebuild-base) is the shared baseline.
10. Fork PR #15 (landing-page contribution) cannot be reopened or recreated
    until the fork syncs with the rewritten main; recovery note is posted on
    the PR.
11. E2E journey extension for the four-level loop (scripts/e2e_journey.py
    covers the v1 loop; the flow test suite covers the four-level loop
    in-process).
12. IndexDB/local persistence and Monaco workspace behavior for Levels 3-4
    live in the frontend concepts; the server draft API they need
    (`GET/PUT /v1/levels/{n}/draft`, artifacts, computed diff) is shipped.
13. Email/invite delivery stays manual (organizer console), unchanged from
    v1.

## What was deliberately NOT built in this branch

- No production answer keys for Option B beyond the clearly labeled fixture
  manifest in `backend/seed.py` (the fixture mirrors Option A's structure so
  both options can be exercised; it is not event content).
- No runner implementation (the endpoint answers RUNNER_UNAVAILABLE by
  design; see EVENT_FLOW.md section 8).
- No AI assessment integration (DEC-13 unchanged).
- No new frontend implementation: the three concept PRs plus the rebuild-base
  PR cover frontend alternatives; merging one is an owner decision.

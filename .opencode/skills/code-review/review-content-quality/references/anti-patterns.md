# Challenge-content anti-patterns

Recurring failure shapes, their participant impact, and the check that should prevent them.

## 1. Accidental repair

**Symptom.** A refactor removes, masks, or makes an intended planted defect unreachable.

**Why it matters.** The advertised award unit cannot be reproduced or scored fairly.

**Detect.** Re-run the affected participant journey and compare with the authorized non-restricted contract.

**Default.** Major; blocker when the challenge cannot be completed as designed.

**Fix.** Restore the intended behavior or revise the challenge and scoring contract together under organizer authorization.

## 2. Unplanned defect

**Symptom.** The app has a crash, dead end, data-loss path, or behavior outside the intended defect set.

**Why it matters.** Teams can lose time or be punished for a valid report the scoring contract does not cover.

**Detect.** Audit the full participant journey, including setup, errors, refresh, empty states, and repeated actions.

**Default.** Major; blocker when it prevents a fair solution.

**Fix.** Repair the defect or explicitly register it as accepted challenge behavior with organizer approval.

## 3. Hidden setup step

**Symptom.** The app works only after a manual database edit, seeded account, environment variable, or file the README never mentions.

**Why it matters.** Participants cannot reach the intended discovery path from the published package.

**Detect.** Start from a clean local data directory and follow the README exactly.

**Default.** Major; blocker when the app does not run.

**Fix.** Automate initialization or document the step and provide the required material.

## 4. Promise-behavior mismatch

**Symptom.** The participant README promises behavior the app never implements, beyond the intended planted defects.

**Why it matters.** Teams chase a defect that has no valid award or repair path.

**Detect.** Walk every promise against the actual UI and API.

**Default.** Major.

**Fix.** Correct the promise or implement the behavior. Keep intended defects unchanged.

## 5. Real answer in an example

**Symptom.** A handbook, hint, comment, screenshot, or sample report describes an actual planted defect or fix.

**Why it matters.** It gives one team the answer and invalidates difficulty calibration.

**Detect.** Read every participant-visible example as a solver. Compare with the authorized challenge contract without opening restricted material.

**Default.** Blocker.

**Fix.** Replace with a fictional example that teaches report quality without matching a real award unit.

## 6. Restricted file in the package

**Symptom.** The organizer answer key, ground-truth notes, or operator-only document appears in the participant file list or bundle.

**Why it matters.** The challenge's truth is exposed directly.

**Detect.** Inspect the seed allow-list, admin ingestion, assignment response, file API, and built frontend output.

**Default.** Blocker.

**Fix.** Remove it from participant publication, rotate exposed secrets or flags, and add a regression test.

## 7. Verdict oracle

**Symptom.** Pre-release status, timing, error text, points, reviewer notes, or polling payloads differ based on whether a report matched.

**Why it matters.** Participants can binary-search ground truth without valid findings.

**Detect.** Compare participant responses for correct, incorrect, duplicate, malformed, and borderline submissions before release.

**Default.** Blocker.

**Fix.** Coarsen every participant-visible signal until `feedback_released` and test the full response shape.

## 8. Stale scoring anchor

**Symptom.** A fixture edit moves or changes the code but stored line anchors, aliases, or hidden tests still target the old shape.

**Why it matters.** Correct reports can be rejected and incorrect reports can match.

**Detect.** Resolve every changed anchor against the current participant file and run matching tests.

**Default.** Major; blocker if rankings can be wrong.

**Fix.** Update the authorized ground-truth revision and verify anchor hashes, ranges, aliases, and tests together.

## 9. Unreachable award unit

**Symptom.** The intended behavior requires unavailable credentials, a hidden route, timing that cannot occur, or data the participant cannot create.

**Why it matters.** The challenge promises points for an impossible task.

**Detect.** Reproduce setup, trigger, repair, and verification using only participant material.

**Default.** Blocker for release.

**Fix.** Make the path reachable or remove the unit and adjust scoring before publication.

## 10. Difficulty by accident

**Symptom.** The main blocker is obscure tooling, missing documentation, or brute-force waiting rather than debugging skill.

**Why it matters.** The 180-minute round measures luck or setup friction instead of investigation.

**Detect.** Run a timed playtest with someone outside the authoring team and record where time is spent.

**Default.** Major when used to justify readiness.

**Fix.** Improve feedback, documentation, or fixture design. Keep the intended learning goal.

## 11. Out-of-scope side effect

**Symptom.** Challenge behavior contacts external services, accesses host secrets, attacks the platform, or affects another team.

**Why it matters.** A local debugging exercise becomes a real security incident.

**Detect.** Trace network calls, filesystem paths, environment access, storage, and published rules.

**Default.** Blocker.

**Fix.** Confine the behavior to loopback and local challenge data. Add boundary tests.

## 12. Participant HTML execution

**Symptom.** Reports, comments, notes, markdown, or artifacts render as raw HTML on the platform.

**Why it matters.** Participant-controlled content can attack reviewers or organizers.

**Detect.** Inspect rendering components and run hostile-markup SSR/DOM tests.

**Default.** Blocker.

**Fix.** Use `PlainMarkdown` or text nodes and keep raw HTML sinks out of participant paths.

## 13. Broken offline setup

**Symptom.** The fixture needs an external API, CDN, remote database, or package download that the venue network blocks.

**Why it matters.** Teams cannot start the challenge during the offline event.

**Detect.** Follow setup with external network unavailable and inspect all runtime requests.

**Default.** Major; blocker when the app cannot start.

**Fix.** Vendor required assets, remove the dependency, or provide an approved offline package.

## 14. Ambiguous repair path

**Symptom.** Many unrelated changes appear to fix the symptom, but hidden tests accept only one implementation.

**Why it matters.** Fair repairs are rejected and reviewers cannot apply a consistent rubric.

**Detect.** Try at least two plausible repairs and inspect what the hidden test actually asserts.

**Default.** Major.

**Fix.** Test observable behavior rather than a private implementation detail, or document the required contract.

## 15. Duplicate or overlapping award

**Symptom.** Two award units can be claimed by the same report or one root cause, or aliases overlap enough to auto-match unrelated reports.

**Why it matters.** Scoring becomes arbitrary and duplicate awards are possible.

**Detect.** Run reports for each unit and near-neighbor root causes through the matcher.

**Default.** Major; blocker when duplicate scoring is reachable.

**Fix.** Clarify unit boundaries, adjust aliases, and keep database-enforced uniqueness.

## 16. Placeholder or organizer note leakage

**Symptom.** Participant docs contain unfilled venue fields, organizer instructions, internal comments, or draft warnings.

**Why it matters.** The published artifact looks unfinished and may reveal internal challenge context.

**Detect.** Search participant docs and rendered UI for draft markers, bracketed fields, and organizer-only language.

**Default.** Major for answer leakage; minor for harmless draft text.

**Fix.** Complete or remove the field before publication and add a publication checklist.

## 17. Fake audit evidence

**Symptom.** A PR claims a playtest, independent review, load test, or readiness pass without a dated artifact.

**Why it matters.** Organizers may ship an untested challenge based on false confidence.

**Detect.** Follow every evidence link and verify the exact commit, date, reviewer, and result.

**Default.** Blocker when it gates release.

**Fix.** Produce the evidence or mark the claim unverified and keep readiness blocked.

## 18. Unfair penalty or cap

**Symptom.** An intended exploration path exceeds caps, triggers cooldown, or is penalized despite being necessary to diagnose the challenge.

**Why it matters.** Correct investigation is punished and teams avoid valid evidence.

**Detect.** Playtest the intended discovery loop while filing realistic reports and retries.

**Default.** Major.

**Fix.** Adjust caps, cooldown, duplicate handling, or penalty rules before publication and update the scoring docs.

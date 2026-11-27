# Challenge-content quality checklist

Work top to bottom. Skip a section only when the artifact cannot contain it, and state why.

Evidence labels: **confirmed** means opened, run, or reproduced; **likely** means strong reading; **suspected** is a question.

Do not open restricted organizer material during an ordinary review.

## 1. Identity and package integrity

| Check | Evidence | Default severity |
|---|---|---|
| Artifact matches the intended challenge, version, and repository option | Diff, seed configuration, participant README | major |
| Participant package contains every file needed to run and diagnose the app | Clean local setup | blocker if the app cannot run |
| Setup commands and runtime versions match manifests | README plus `package.json` or `requirements.txt` | major |
| Local data initializes without manual hidden steps | Fresh data directory and startup output | major |
| No restricted file is present in the participant package | File-list inspection and seed allow-list | blocker |
| No generated artifact, cache, credential, or operator note is accidentally published | Published file list and API response | blocker for secrets or answers |

## 2. Intentional-defect fidelity

- Compare the changed fixture with the authorized non-restricted challenge contract.
- Confirm each intended defect in the affected area still exists in the intended form.
- Check whether a refactor accidentally repaired, moved, masked, or made a defect unreachable.
- Check whether an intentional defect now creates a second, unplanned defect.
- Do not "fix" a planted defect merely because it is insecure or incorrect in production.
- If ground truth changes, require an organizer-side revision and matching scoring update under explicit authorization.

Default: a missing or unreachable intended award unit is **major** or **blocker** based on scoring and fairness impact. An accidental repair that invalidates an award is **major**.

## 3. Reproducibility and solvability

For each affected behavior:

1. Start from the documented clean state.
2. Perform the participant-visible trigger.
3. Observe the symptom.
4. Identify the code-level cause from participant files.
5. Apply a plausible repair.
6. Verify the promised behavior.
7. Confirm unrelated intended behavior still works.

Flag setup that depends on hidden accounts, timing, external services, manual database edits, or organizer-only knowledge unless the instructions provide them.

A defect that cannot be reached or verified from the participant package is **blocker** for release.

## 4. Instructions and promises

- The README describes expected behavior, not the location or fix of a planted defect.
- Every participant action referenced by the instructions exists in the UI or API.
- Examples use fictional defects and do not reproduce a real planted answer.
- Hints are optional, proportional, and do not make one team's path impossible.
- Error messages help participants recover without revealing ground truth.
- Terminology matches the app, platform, rules, and reviewer guidance.
- Event facts match the official preset: 6 December 2026, 180 minutes, offline, teams of 4 to 5.
- Placeholders and organizer notes are removed before publication.

A real answer in participant instructions is **blocker**. A misleading promise that sends teams toward a dead end is **major**.

## 5. Difficulty and fairness

- The intended discovery path fits the 180-minute round with time to verify and report.
- Early, middle, and late difficulty are deliberate rather than accidental.
- A team can make progress without knowing a hidden implementation detail.
- Cross-file diagnosis is supported by readable code and useful symptoms.
- Repairs do not require unrelated refactors or unavailable tooling.
- Flags are optional bonuses and do not replace the main task.
- Point values and caps match the published scoring model.
- Difficulty and completion claims cite a playtest or are marked provisional.

Unplayable or mathematically impossible challenge content is **blocker**. Unsupported difficulty claims are **major** when used to justify release readiness.

## 6. Leakage and feedback integrity

- No participant file, comment, hint, example, log, or UI state exposes a real answer or flag.
- No per-bug code, location, alias, point value, or hidden test is exposed before release.
- Submission status remains coarse until `feedback_released`.
- Wrong, duplicate, timeout, and malformed submissions do not reveal matching details through differences in status, timing, or error text.
- Reviewer notes and post-release feedback are checked before publication.
- Restricted strings do not appear in frontend bundles, API responses, CSV exports, or client logs.
- The platform never serves the organizer answer key.

Any participant-visible restricted answer or pre-release verdict leak is **blocker**.

## 7. Scope and safety

- Challenge exploit surfaces are limited to the provided app and local data.
- Instructions prohibit attacking the platform, venue network, other teams, and external systems.
- Intentional dangerous behavior cannot make external network calls or access host secrets.
- Local services bind to the documented loopback interface and port.
- Participant uploads and reports remain inert text on platform infrastructure.
- Destructive fixture behavior is reproducible from clean local data and does not affect the platform database.
- Security examples are sufficient to teach the concept without becoming out-of-scope attack tooling.

Out-of-scope harm or platform execution of participant code is **blocker**.

## 8. Scoring alignment

- Every intended award unit has a current participant-visible symptom and a verifiable repair.
- Stored line anchors match the current fixture and detect line drift.
- Aliases describe the actual root cause without making unrelated reports auto-match.
- Hidden functional tests verify behavior rather than a particular implementation when possible.
- Duplicate reports cannot score the same unit twice for one team.
- Caps, cooldowns, penalties, and bonus limits match the published rules.
- CTF flags are verified by hash and never returned in plaintext.
- Corrections use linked ledger entries.

Anchors or tests that score the wrong behavior are **major** or **blocker** when they can change rankings.

## 9. Participant accessibility and copy

- Instructions are readable, structured, and usable with keyboard and screen reader.
- Code examples and error states are available as text, not only color or images.
- UI copy follows the Case File design direction and contains no em dashes.
- Participant content is rendered with `PlainMarkdown` or text nodes.
- Status is communicated with text plus color.
- Timers and async states have accessible announcements.
- Copy is encouraging and does not shame incorrect attempts.
- No fake testimonial, guarantee, or unverified capacity claim appears.

Serious accessibility barriers are **major**; participant HTML injection is **blocker**.

## 10. Evidence and audit

- Reproduction steps and observed output are attached.
- Relevant backend, frontend, isolation, and E2E checks have exact results.
- Challenge changes include targeted regression coverage.
- Independent challenge audit and playtest evidence are dated and named.
- Unplanned defects are fixed or explicitly registered by organizers.
- Readiness items are not checked without proof.
- Known limitations are documented honestly.
- No live external service, paid model, or venue network is required for a basic review.

Missing evidence for a new failure mode is **major**. A fabricated audit or readiness claim is **blocker** when it gates release.

## Final sign-off

| Question | Answer |
|---|---|
| Participant package runs from a clean state? | |
| Affected intended defects remain reachable? | |
| No unplanned defect blocks a fair solution? | |
| Instructions are accurate and answer-free? | |
| Difficulty claim has evidence or is provisional? | |
| Restricted material and verdicts stay hidden? | |
| Challenge impact is local and bounded? | |
| Scoring anchors and tests match the fixture? | |
| Participant content is accessible and inert? | |
| What was not reviewed? | |

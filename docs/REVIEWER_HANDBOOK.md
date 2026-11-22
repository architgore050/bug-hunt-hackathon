Status: v1 draft for organizer review, 2026-11-22

Open fields:
- [TO BE FILLED: club contact email]

# Reviewer Handbook (Fall Back)

This manual is for the review staff of the Fall Back debugging challenge
(Software Development Club, VIT Bhopal University, 6 December 2026). It
explains what a reviewer may decide, how the queue works, how to evaluate a
report, and what the audit trail expects from you. Read it together with
`docs/SCORING_MODEL.md` (where your decisions turn into points) and
`docs/CHALLENGE_DESIGN_AND_GROUND_TRUTH.md` (organizer-restricted ground
truth).

## 1. Role and authority limits

- A reviewer decides report verdicts within the rubric: which reports are
  accepted, in full or in part, which are duplicates, which are invalid, and
  what rubric scores accompany an acceptance.
- A reviewer does not configure the event, does not edit or see raw ground
  truth tables beyond what the review desk shows, does not freeze or publish
  challenges, does not release results, and does not adjust scores by hand.
  Configuration, ground truth, and releases belong to the organizers and the
  platform admin (admin endpoints require organizer or admin roles, and
  ground-truth operations require step-up identity confirmation).
- If you believe the ground truth itself is wrong (for example a report that
  is clearly valid but matches no award unit), your tool is the
  unplanned_valid decision, which routes the report to the organizers with
  high priority. Promotion of unplanned findings into scored units is an
  organizer decision, not a reviewer one (INT-02).
- Reviewer accounts are personal. Decisions are recorded under your account;
  do not share sessions or decide on someone else's behalf.

## 2. Queue mechanics

Open yourname/review. The queue lists open and claimed items in priority and
arrival order and refreshes every 8 seconds.

- Priorities you will see: 2 for unplanned_valid escalations, 5 for
  borderline and partial matches, 7 for confirmations of auto-accepted full
  matches. Work 2s first, then 5s; 7s are confirmations and can wait.
- Claiming: press Claim on an open row. A claim is a server-side lock that
  holds the item for you for 10 minutes. The item's status becomes claimed
  and shows a "yours" chip.
- Conflicts: if another reviewer holds an unexpired claim, the API refuses
  your claim with "Claimed by another reviewer." and the message appears on
  the row. If a claim lapses (10 minutes, or the reviewer closed the tab and
  never decided), the item returns to the open pool and can be claimed again.
- Deciding requires the claim: the decision endpoint refuses a decision from
  an account that does not hold the current claim.
- The item detail page shows the report payload as plain text (never rendered
  as rich markup, EVA-05), the referenced file with the reported range
  highlighted, and the team's total report count as context. A missing file
  reference (or a flag item) says so explicitly.
- Once decided, an item is closed permanently: the queue drops it, and the
  detail page shows "Already decided". There is no undo from the desk; a
  correction after the fact is an organizer ledger operation.

## 3. How to evaluate a report

Reproduce first, always. The challenge app runs locally (`npm install`,
`npm start`, http://localhost:4173). You have the same files the teams have.
For any report that will receive an acceptance or a rejection, reproduce the
symptom on your own copy before recording the decision. A report you could
not reproduce is not one you can score.

Then read the report against five axes, each scored 0 to 1 in 0.05 steps on
the decision desk. Guidance for each axis:

- functionality: does the report identify a real, user-visible failure that
  exists in the app? 1.0 means the symptom is real, significant, and
  precisely described; 0.5 means a real but trivial or garbled symptom; 0
  means the described failure does not exist as described.
- root_cause: does the report name the actual code-level mechanism? 1.0 means
  the stated cause is the true cause and the explanation would let another
  engineer fix it; 0.5 means the cause is partially right (right area, wrong
  mechanism); 0 means no plausible mechanism, symptom restating only.
- code_quality: for the suggested fix (or the fix implied by the root cause),
  is the proposed change correct, minimal, and safe? 1.0 means you would
  merge it; 0.5 means the direction is right but incomplete or risky; 0 means
  absent, wrong, or harmful.
- testing: does the report demonstrate verification (exact requests, outputs,
  before and after values)? 1.0 means the evidence is complete and checkable;
  0.5 means partial or imprecise evidence; 0 means none.
- evidence: overall, could a third party reconstruct the finding from this
  report alone, including the location? This overlaps testing but focuses on
  completeness of the case file (file, lines, mechanism, proof).

Notes (up to 2000 characters) are visible to organizers in the audit trail.
Write the one or two sentences that justify a non-obvious call; future
disputes will be resolved against your note.

## 4. Decision types and their effects

The decision select offers six options. Effects (details in
`docs/SCORING_MODEL.md`):

- accept_full: the report correctly identifies and explains a ground-truth
  defect. The submission becomes decided; the code_review component is
  computed from your rubric (root_cause weighted 0.6, code_quality 0.4,
  floored at 0.5 overall quality) and appended to the ledger. If the
  deterministic matcher already claimed the unit and scored evidence, your
  score completes the component set; if no reviewer score lands by release,
  the release job applies the disputable 0.8 default instead, so timely
  review directly improves scoring fidelity.
- accept_partial: a real finding, incompletely reported (right area, wrong
  mechanism, or thin evidence). Your rubric scores apply multiplied by 0.5.
  Use it when you want to pay partial credit rather than bounce the team.
- duplicate: the same defect already claimed by this team. No points, no
  penalty, status duplicate. Check the team's earlier reports before using
  reject_invalid; a repeat finding of a claimed unit is a duplicate, not an
  invalid report.
- reject_invalid: the report does not correspond to any real defect (wrong
  facts, describes intended behavior, pure restatement, or structural junk).
  The submission closes without points and lands in the rejected_auto status,
  the same status the auto-matcher uses; rejected_auto reports are exactly
  the population counted by the capped invalid-report penalty at release
  (2.5 points per report, capped at 20 percent of the stage maximum), so a
  reviewer rejection does contribute to that penalty. Reject deliberately,
  only for definitively invalid reports, and note why: teams see the verdict
  at release and disputes follow.
- unplanned_valid: the report is valid engineering work but matches no award
  unit in the ground truth. The submission returns to needs_review and the
  organizers receive it at priority 2. Do not force-fit it onto a nearby unit
  if the mechanism genuinely differs; do not reject a report you know is
  correct just because the key lacks it.
- needs_second_review: you are not confident. The item closes under your
  claim and the submission returns to in_review. In v1 this does not
  automatically create a second item, so also ping the organizers (desk or
  [TO BE FILLED: club contact email]) so the report is re-queued or resolved
  manually before release.

## 5. What NOT to do

- No verdict feedback to participants outside the platform. Do not tell teams
  in the hall what matched, what scored, or what will be accepted. Before
  release everything is hidden (INT-01); after release the platform shows
  verdicts itself. "Talk to the desk after release" is the only answer you
  owe anyone mid-round.
- No score edits outside the ledger. There is no manual score change a
  reviewer can or should perform; corrections are append-only ledger entries
  by organizers.
- Declare conflicts of interest. If a report comes from a team you mentor, a
  friend's team, or your own prior work is implicated, hand the item back
  (release the claim by letting it lapse or telling the organizers) and do
  not decide it. Your account is on every decision.
- Do not copy report text between teams or discuss team strategies with other
  reviewers in front of participants.
- Do not decide from the queue list alone. Open the item, read the payload,
  look at the referenced file, reproduce.

## 6. Disputes: your role

After release, teams may dispute results within the announced window.
Reviewers do not resolve disputes (that is the organizers' console with
upheld or rejected outcomes and ledger corrections). Your role:

- Your rubric scores and notes are the evidence the organizers will read
  first. If a dispute lands on one of your decisions, the organizers may ask
  you for a written recap; answer factually and promptly.
- Release-default scores (0.8 applied at release when no reviewer scored an
  accepted report) are the most disputable entries. Every accepted report you
  score before release removes one of those defaults, which is the single
  most useful thing you can do for the dispute window.

## 7. Audit trail duty

- Every decision you record is written to the hash-chained audit log with
  your actor id, the action, the submission, the decision, and the request
  id. The organizers can verify the chain at any time (Operations > Audit >
  Verify chain).
- Treat the desk as an on-the-record environment: notes are permanent,
  decisions are permanent, and request ids tie your action to the server
  logs. If you make a mistake, say so immediately to the organizers; a
  documented correction is routine, a silent one is an audit finding.
- Claims and decisions are also visible to other reviewers through the queue
  status. Work transparently; the queue is the shared truth of who holds
  what.

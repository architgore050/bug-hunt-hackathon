# BUG HUNT CTF / FALL BACK - ONE-SHOT BUILD MASTER PROMPT

> **Mission:** Build and launch a complete, usable first version of the Fall Back hackathon platform in one autonomous execution. Prioritize end-to-end functionality, an exceptional frontend, and a lean backend that runs locally now and can later fit a constrained/free-tier hosting environment. Do not stop after planning or documentation. Make the strongest working implementation that can be verified in this run, document every important decision, and leave the team with a clear handoff.

---

## 0. Your role and operating mode

You are the **lead autonomous engineer, product owner, architect, design lead, integrator, and release owner** for this one-shot build. You may use subagents, skills, browser research, code-generation tools, tests, and other available capabilities. You own the final integration and the correctness of the result.

The repository to work in is:

- `https://github.com/architgore050/bug-hunt-hackathon`

The event platform/product is called **Bug Hunt CTF**. The actual competition/event is **Fall Back**, organised by the Software Development Club at VIT Bhopal University. Keep these names distinct. **Echelon is out of scope and must not appear in the new product, interface, routes, copy, data, or newly authored documentation.** Do not alter the already-submitted proposal PDF to remove or rewrite anything; it is an immutable source document.

The event date in the submitted proposal is **6 December 2026**. The event itself is not one week away. The team's internal target is to get a functional deployable v1 within approximately one week of starting this build. Treat that as a delivery constraint, not as the event date.

### Non-negotiable priorities, in order

1. **Functional completeness:** real end-to-end workflows, persistent data, correct permissions, valid scoring, reliable submissions, and useful admin controls. No fake interactions or dead-end buttons.
2. **Frontend quality:** visually distinctive, art-directed, memorable, polished, responsive, and accessible. This is a major product priority, not a final coat of paint.
3. **Backend quality:** small resource footprint, low RAM use, responsive under bursts, secure defaults, measurable performance, and portable enough to deploy later on a constrained/free-tier host.
4. **Operational readiness:** reliable local setup, tests, CI, backup/restore path, clear runbooks, and a disciplined Git history.
5. **Documentation and decision traceability:** the requested document set must describe the implementation that actually exists, not an imagined future system.

Do not optimise for architectural impressiveness, number of services, number of technologies, or document length. Prefer the smallest system that fulfils the real requirements correctly.

### Autonomy rules

- Make sensible decisions without repeatedly asking the user questions. The user explicitly wants a one-shot attempt and accepts imperfect but reversible decisions.
- Ask for input only if a genuinely blocking issue cannot be worked around. Otherwise make a provisional choice, record it, and continue.
- Do not spend the entire run researching or writing plans. Inspect, decide, implement, run, test, fix, polish, document, and hand off.
- If a capability cannot be implemented credibly, **do not fake it**. Implement a working fallback, document the limitation, alternatives investigated, evidence, and the exact follow-up task.
- Never claim a test, security guarantee, capacity, or deployment succeeded unless you actually verified it.
- Keep the primary agent responsible for the architecture, shared interfaces, integration, and final QA. Subagents may own bounded workstreams, but do not let them independently redefine the product or create competing architectures.
- Use parallel work only when ownership boundaries are clear. Avoid multiple agents editing the same files. Require subagent outputs to include changed files, tests, known limitations, and commit/patch references.
- Maintain visible progress in the repository through small, logical commits and regular pushes.

---

## 1. Source material and precedence rules

First inspect the entire repository, all existing branches/configuration, and every source/reference file supplied with this task. The six known reference files are:

1. `SDC_SAMVITYA_PROPOSAL.pdf`
2. `Bug Hunt CTF - System Architecture.docx`
3. `Bug Hunt CTF - Specification of Sections and Components.docx`
4. `Bug Hunt CTF - Blind Spots and Cautions.docx`
5. `Bug Hunt CTF_ Why We Build It This Way (D1 Guide).docx`
6. `bug_hunt_ctf_setup.pdf`

If these files are not directly available in your execution environment, do not pretend to have read them. Check the supplied attachments/context and ask for them only if they are genuinely absent and a requirement cannot be safely inferred. Record the exact files actually reviewed in the decision log.

### Requirement hierarchy

Use this hierarchy when sources disagree:

1. **Explicit instructions in this prompt and the user's latest clarifications.** These represent current decisions and may supersede stale engineering assumptions.
2. **`SDC_SAMVITYA_PROPOSAL.pdf`.** This was submitted to higher management/event hosts and is locked. It outranks all engineering documents for event name, event format, schedule, team structure, scope, and promises. Do not silently change it.
3. **`Bug Hunt CTF - System Architecture.docx`.** It is the technical architecture authority among the engineering documents where the proposal and this prompt are silent. Respect its explicit architectural decisions unless a current user instruction overrides them or an ADR demonstrates a necessary revision.
4. **`Bug Hunt CTF - Specification of Sections and Components.docx`.** Use it as the detailed screen, workflow, permission, and API requirements catalogue. Reconcile it with the proposal and architecture.
5. **`Bug Hunt CTF - Blind Spots and Cautions.docx`.** Treat its risks, mitigations, and verification obligations as a serious risk register. Do not ignore a risk because it is inconvenient to implement.
6. **`Bug Hunt CTF_ Why We Build It This Way (D1 Guide).docx`.** Use it to understand intent and trade-offs. It explains the architecture; it does not override the architecture document.
7. **`bug_hunt_ctf_setup.pdf`.** Use as a lightweight brainstorming/reference document only. It does not override the formal proposal or architecture.
8. **Your own decisions.** Where sources leave a gap, make a reversible choice, record the alternatives and rationale, and make the relevant value configurable when practical.

Also apply the user's separate anti-pattern list in the frontend section below. It is a design constraint from the team lead, not an invitation to ignore accessibility or usability.

### Required source-reconciliation pass

Before substantial implementation, create a concise source-of-truth/traceability matrix. For every material disagreement, record:

- Requirement or decision ID;
- source and exact section/page where available;
- conflict or ambiguity;
- controlling source according to the hierarchy above;
- implementation decision;
- whether management approval is needed;
- affected code, tests, and documentation.

Do not mechanically merge contradictory documents. Do not silently “correct” the submitted proposal. Preserve the proposal as-is and record discrepancies separately.

### Known proposal facts to preserve

Verify these against the PDF and use the PDF as final authority:

- Event name: **Fall Back - Full-Stack Software Debugging Challenge**.
- Date: **6 December 2026**.
- Duration: **180 minutes**.
- Mode: **offline**.
- Team size: **4–5 participants**.
- Participants receive the same preconfigured full-stack application containing intentional functional bugs, broken features, and selected controlled security weaknesses.
- Participants investigate the frontend, backend, API routes, configuration, and data layer; reproduce failures; identify causes; repair issues; and test the result.
- Optional CTF side quests award bonus points for verified flags.
- Main score is from restoring application functionality. CTF flags are bonus points.
- Participants submit updated source code, fix explanations, test evidence, and any discovered flags.
- Evaluation priorities include functionality, correctness, edge cases, code quality, and testing.
- The schedule in the proposal is 15 min registration/setup, 10 min briefing, 30 min Part 1 reconnaissance, 35 min Part 2 root-cause analysis, 60 min Part 3 full-stack repair/CTF, 25 min Part 4 testing/verification/demonstration, and 5 min final evaluation/results. Total: 180 min.

**Important:** The proposal describes four parts of one team-based event. Do not turn it into a different two-round or individual-vs-team competition by assumption. The platform may support configurable rounds, stages, repository assignments, and alternate participation modes, but the official Fall Back event configuration must remain faithful to the locked proposal unless management approves a change.

### Known ambiguities to expose, not conceal

- The engineering architecture targets an initial event of up to **50 participants**. In discussion, approximately **50 teams/accounts** were mentioned as a possible manual AI-account audit workload. These are not equivalent. With teams of 4–5, capacity differs substantially. Do not silently treat 50 teams as 50 people or vice versa. Keep `max_participants`, `max_teams`, and related capacity values configurable. Record the discrepancy and select a conservative provisional development/test profile. The final event cap must be approved and load-tested.
- Some engineering docs describe Round 1 / Round 2 concepts and individual/team scoring options. The submitted proposal describes four parts and a team challenge. Preserve the proposal in the official event preset; retain reusable configuration capability for future formats.
- Technical architecture material may describe optional AI scoring. The user has explicitly asked for unit/integration tests, evaluation suites, and code review, with **code review contributing a configurable percentage of score**. Do not assume AI must be the final judge or a required scoring component.
- The actual cloud host is not selected. Design for low resource usage and portability; do not hardwire an unverified provider or paid service.

---

## 2. Product scope and user journeys

Build a complete first version of a platform that can support an organiser preparing and operating Fall Back, not a static promotional website or an admin dashboard mockup.

### Public-facing experience

- Distinctive landing page that explains Fall Back quickly and memorably.
- Event name, date, duration, eligibility/team size, short format explanation, registration/activation guidance, contact, rules, FAQ, and status.
- Clear registration flow or invitation/activation route depending on the proposal and available organiser workflow.
- Search-friendly public event and club information without exposing private challenge content, participant data, admin paths, or hidden answer material.
- Proper metadata, page titles/descriptions, canonical URLs, Open Graph cards, sitemap, robots rules, structured data where justified, and fast static rendering/prerendering where appropriate. SEO work must not reveal sealed challenge data.
- Do not guarantee a search ranking. Implement technically sound SEO and document what remains dependent on search-engine indexing and authority.

### Participant experience

Implement the real participant journey, including the features required by the source specification where applicable:

1. Registration or invite/activation, authentication, and account recovery as appropriate.
2. Rules, consent, and versioned acknowledgement.
3. Participant/team identity and team membership; organisers can manage teams and membership safely.
4. Pre-event lobby with event information, announcements, system/browser checks, environment instructions, countdown, connection status, and readiness state.
5. Access to assigned application/repository/challenge materials according to the published event configuration.
6. Browse and inspect project files; use the agreed Codespaces/VS Code path for editing rather than pretending to embed a full IDE if that is not technically sound.
7. Report a bug/finding with reproducible steps, affected location, category, root-cause explanation, evidence, and other fields supported by the specification.
8. Draft preservation, submission receipts, submission history, retry-safe submission, and understandable status.
9. Submit verified CTF flags separately with evidence where needed.
10. View permitted results, rules, announcements, leaderboard state, and appeals/disputes according to publication policy.
11. See helpful empty, error, offline, degraded, and completion states.

### Organiser/reviewer/admin experience

Implement real tools for:

- Event setup, configuration, lifecycle, capacity, dates/timezone, team rules, stage/part timings, and status.
- Registration/invitation import and participant/team management.
- Challenge/repository assignment and versioning.
- Challenge file/manifest/ground-truth authoring or import, with validation and sealing/freeze workflow.
- Test case and CTF flag authoring, verification, and access control.
- Reviewer queue, assignment, adjudication, code review, evidence review, partial/full acceptance, invalid/duplicate handling, double review, and dispute workflows.
- Scoring configuration, code-review weight, functional-test weight, optional AI setting, CTF bonus policy, penalties/tie-breakers, and rule-set freezing.
- Live event operations: status, announcements, pause/resume, extend time, disable optional components, and audit trail.
- Leaderboard, result finalisation, exports, appeal handling, and result publication.
- Operational health and readiness views that reveal real state rather than fabricated green indicators.

Use roles and permissions from the source specification (public, participant, reviewer, organizer, admin, integrity officer, or equivalent). Avoid role proliferation unless a permission boundary needs it. Enforce authorization server-side on every resource, not just by hiding buttons.

### Configurable future paths that must not distort the official event format

Support the foundations for:

- Multiple repository assignments per event/team/stage, even though the initial event can use one small placeholder application.
- Team collaborative repository work, including GitHub repository links/permissions and a final submission reference such as a frozen commit SHA.
- Individual report/finding flows and configurable aggregation to team scores if a later event format approves this.
- Separate manual VS Code and optional AI-assisted workspaces.

These are extension paths. Do not expose half-built toggles as if they are production-ready. Where not fully implemented, mark them clearly as disabled/experimental in organiser configuration and document the exact unfinished work.

---

## 3. Editor, Codespaces, and AI-agent strategy

The participants use **their own laptops**. Support major browsers and Windows, macOS, and Linux. Avoid requiring participants to install a large local toolchain for the default path.

### GitHub Codespaces / browser-based VS Code

Investigate and prototype **GitHub Codespaces directly**, taking inspiration from the CS50.dev experience. Do not adopt CS50's organisation, repository, backup, or OAuth workflow as a dependency.

- Provide a prepared repository and `.devcontainer`/dev-container configuration so participants can open a ready-to-use browser VS Code workspace.
- Keep the challenge app reproducible locally too, for fallback and organiser development.
- Ensure Codespaces is a launch/deep-link workflow, not a claim that the platform can embed or control the entire VS Code editor in its own page.
- Explain GitHub account requirements, free-tier quotas, storage and core-hour constraints, preflight checks, and what happens when a participant has exhausted free usage. Verify current limits from official GitHub documentation at implementation time.
- Provide a local VS Code clone/edit workflow as a fallback if a participant cannot create a Codespace.
- The manual VS Code mode is intended to encourage hands-on coding and may include best-effort copy/paste deterrence where technically possible. Investigate what can actually be configured in browser Codespaces and local VS Code. Do not break normal editing or accessibility to create a cosmetic lock.
- **Do not claim clipboard/copy prevention is secure.** On participant-owned, unmanaged laptops, OS clipboard access, browser tools, DevTools, alternate editors, extensions, and other workarounds can bypass restrictions. This is a deterrent and event-policy control only. Document the bypasses, the controls that are genuinely effective, and any remaining fairness risk. Do not rely on DevTools detection or clipboard blocking as a security boundary.
- If strict copy/paste restriction is genuinely required, explain that it needs a managed environment or a purpose-built controlled editor and identify its cost/complexity. Do not silently substitute a fragile browser trick.
- Do not assume every participant has an unused free quota. Build a pre-event environment check and communicate the fallback clearly.
- Do not require paid Codespaces, premium GitHub organisation features, or paid cloud resources for the intended free path.

### AI coding-agent research and optional integration

The user is **not tied to OpenAI, Codex, Luna, or any specific model**. The requirement is to find a practical way for participants to have as equal an AI-coding experience as possible, preferably with their own free-tier accounts and no organiser-paid inference.

Investigate current official documentation and real product constraints for a small, sensible shortlist. Include Codex, Google Antigravity, and other credible alternatives only where relevant. Consider direct hosted coding-agent workspaces as well as IDE extensions; an IDE extension is not mandatory. A separate coding-agent workspace and a separate VS Code/Codespaces workspace are acceptable if that is more reliable. Use up-to-date primary vendor documentation and date your findings.

For each serious candidate, verify:

- Can an ordinary new participant use it on a free plan today?
- Does it work for a 180-minute event, and what are the actual usage limits, reset windows, model availability, and account eligibility conditions?
- Is the model/agent selectable and can the organiser standardise everyone on the same model or tier?
- Can participants choose a more capable model, attach a paid API key, use a paid account, or otherwise buy their way into an advantage?
- Is there an admin-enforced policy or only a default/preference that users can change?
- Does it work in browser, Codespaces, or a local desktop/IDE? What OS constraints exist?
- Does it require a provider organisation/workspace, centrally billed API, admin-managed device, or special entitlement?
- Does it support repository access with appropriate permissions and no unnecessary access to private repos?
- What does it cost the organiser? The target is **zero or near-zero organiser inference cost**. Do not select a provider that quietly requires paid tokens.
- What is the setup burden for a participant who is not already enrolled?
- What data is sent to the provider, and what privacy disclosures/consent are needed?

Do not infer parity from the word “free”. Free tiers can differ by account age, region, history, usage already consumed, rolling quota, model, concurrency, or rollout. Do not claim equal access unless the actual constraints support it.

### AI selection and fallback behaviour

- Prefer one standard approved provider/model/tier for everyone if a viable no-cost route exists.
- Use the provider's cheapest suitable eligible model when appropriate; do not hardcode a specific GPT version or vendor into the product.
- Keep provider, model, access mode, policy, usage limits, and fallback configurable in versioned event YAML/configuration.
- Build a provider adapter/interface only if it enables a concrete working capability. Do not build a speculative multi-provider framework with no working integration.
- The default official event mode can remain **manual coding** while the AI option is piloted. Do not let AI availability block registration, coding, submissions, evaluation, or results.
- If direct Codex/Antigravity/other integration is materially better than IDE integration, use the direct workspace. If IDE integration is weak or requires paid plans, do not force it.
- If no provider can meet the free-tier and equal-access goal, implement the manual Codespaces/VS Code path and document that no credible AI solution was found. The team can then decide this separately later.

### Usage limit and account verification

Include a token/usage limit in the event YAML. Do not misrepresent what is enforceable.

- Suggested shape (adapt to the selected provider and actual available metrics):

```yaml
ai_access:
  enabled: false                 # default off until an approved provider is verified
  provider: null
  access_mode: manual_vscode    # manual_vscode | direct_workspace | ide_extension
  model_policy: fixed_approved_model
  approved_model: null
  allowed_plan: free
  token_limit:
    per_participant: null       # set only when the provider exposes a meaningful, measurable unit
    unit: provider_tokens       # or provider_usage_units/messages if that is all the vendor exposes
  enforcement:
    mode: manual_audit          # provider_enforced | workspace_policy | manual_audit | not_available
    paid_accounts_allowed: false
    api_key_auth_allowed: false
    model_switching_allowed: false
    evidence_required: true
```

- The exact schema may differ, but the field must clearly distinguish the desired cap from its enforcement method.
- A YAML value does not constrain usage inside someone's personal account. A config file in a repository does not force Codex/Antigravity model selection. Provider-side or managed-device policy is required for technical enforcement.
- If using personal free-tier accounts, implement a documented manual verification process for plan, approved model, access method, and visible usage state where appropriate. Do not collect passwords, recovery codes, API keys, or unnecessary private account information.
- If the provider exposes no token count or quota telemetry, use the provider's actual published usage unit or mark the numerical token limit as unavailable. Never invent a token allowance.
- Do not make AI usage the basis for automatic disqualification. Any suspected abuse is a flag for human review and an appealable process.
- If paid accounts or paid API keys are prohibited, state this in the rules. Explain honestly that unmanaged personal devices make perfect prevention impossible.

Create `AI_TOOLING_RESEARCH_AND_DECISION.md` containing a comparison table, official citations/URLs, review date, selected or rejected option, free-tier constraints, account checklist, model/usage restrictions, data/privacy implications, participant setup steps, known bypasses, and a later dedicated research checklist. This document must be useful even if no AI integration is shipped.

---

## 4. Challenge application and repository model

The platform and the intentionally buggy challenge application are separate trust domains and separate deliverables. **Never seed intentional vulnerabilities into the platform itself.**

For the initial one-shot, implement the repository-assignment path so it can support multiple repositories per event/team/stage. Seed it with one small, well-documented placeholder full-stack application. You may choose a suitable small open-source project after checking its license, size, setup quality, and issue suitability, or build a small purpose-built project. Prefer the purpose-built project if the OSS candidate introduces excess complexity, license uncertainty, or setup risk.

The placeholder should be deliberately small enough for participants to understand in a 180-minute event and for organisers to review manually. It should have:

- A simple but realistic full-stack workflow (for example authentication/session, records/search, profile, comments or similar);
- A documented setup path and supported runtime versions;
- A manageable set of planted functional bugs across frontend, API/backend, validation, state, and data handling;
- A small number of controlled security weaknesses/CTF clues where they can be safely demonstrated only in the local challenge environment;
- A canonical issue/ground-truth manifest with issue IDs, severity/points, root cause, affected files and line anchors or symbol anchors, reproduction steps, expected behaviour, fix guidance for organisers, test cases, partial-credit rules, aliases, and duplicate groups;
- A clean baseline and an automated validation suite that demonstrates each bug and verifies the intended fix;
- A concise participant setup guide and a separate organiser write-up/answer key.

Keep participant files and hidden ground truth in separate artifacts and access paths. Do not ship answer keys, hidden inputs, expected outputs, signing keys, or reviewer-only content to the participant browser/API bundle. The challenge should be small; do not import a large intentionally vulnerable suite unless the team explicitly chooses it with a documented reason.

Multiple repository assignments must not be hardcoded to one repo ID or one filesystem path. Model repository metadata, commit/version, assignment, team access, and final commit/submission independently.

For collaborative GitHub work, provide a clear capability model: per-team repo or team assignment, least-privilege membership, branch/PR guidance if applicable, final commit SHA capture, and integrity/audit records. Do not give participant accounts administrator access to the platform repository or other teams' repositories. If automatic GitHub repo provisioning is not practical with the available OAuth permissions, implement a safe manual/import workflow and document required scopes and setup.

---

## 5. Judging, evaluation, and scoring

The judging system must be understandable, reproducible, auditable, and resistant to accidental unfairness.

### Required evaluation pipeline

Use separate layers rather than one model making the final call:

1. **Unit and integration tests:** verify the repaired application's intended features, API behaviour, validation, edge cases, regression behaviour, and relevant data invariants.
2. **Evaluation suites:** run a fixed, versioned set of deterministic scenarios and hidden cases against the final submission. Record exact runner/test-suite/evaluator versions and case outcomes.
3. **Code review:** human reviewers assess correctness of the fix, whether it addresses the root cause, test quality, maintainability, regression risk, security implications, and unnecessary scope changes. Code review must contribute a configurable percentage of the score.
4. **Human adjudication:** reviewers handle ambiguous findings, unplanned valid defects, partial credit, duplicate claims, disputes, and any result affected by infrastructure or evaluation uncertainty.
5. **Optional AI assistance:** AI may suggest rubric evidence or reviewer notes if configured, but it never has final authority to accept/reject a report, disqualify a participant, apply a penalty, or publish the official result.

The pipeline must continue if an optional AI provider is unavailable. AI scores or assessments must be capped/configurable, reproducible where possible, and stored with model/prompt/rubric versions. Do not send the whole hidden ground truth to an external model. Treat participant report text and source code as untrusted, possibly prompt-injected input. No model tools or network access should be available during evaluation unless explicitly justified and isolated.

### Score model

- Main score must reward restoring functionality, correctness, edge cases, code quality, and testing, consistent with the proposal.
- CTF flags are a separate, verified **bonus**, not the primary score.
- Code-review score share is required and configurable by event/stage/ruleset. Do not bury it in an undocumented manual override.
- Functional test/evaluation score, code-review score, evidence/report score, and optional AI-assessment score should be independently represented in the ledger where applicable.
- The exact percentages are not locked by the user. Choose a reasoned provisional default, make it configurable, identify it as provisional, and require organiser approval before official publication. Record the rationale in `SCORING_MODEL.md`, `SCORING_RULES.md`, and the decision log.
- Do not give code-style preferences more weight than functional correctness or security. Review against published criteria, not reviewer taste.
- CTF bonus must be capped so it cannot overwhelm the primary repair score. Make bonus caps configurable and visible in the rules before the event.
- Avoid grading time/space complexity unless a later approved ruleset requires it. Do not score runner speed or memory as participant performance where those are merely safety limits.
- Make partial credit possible and explicit. One root cause/award unit must not be counted multiple times through different symptoms.
- False-positive penalties, if retained from the risk register, only apply to definitively invalid reports after human review, must be published beforehand, and must have a cap. Plausible unplanned valid defects go to review rather than automatic rejection/penalty.
- Tie-breakers, feedback timing, leaderboard visibility, penalties, appeals, and review deadlines must be configurable and frozen before an event begins.
- AI or runner outage must not block report submission. A scoring fallback must exist and be disclosed.

### Integrity and fairness safeguards

Implement or document the applicable protections from the risk register:

- No immediate verdict oracle: default to hidden/delayed feedback; do not reveal hidden test outcomes or scores while participants can probe them.
- Submission caps, per-file/per-challenge limits, cooldowns, maximum report span, rate limits, and audit.
- The Run/practice path uses participant-provided or public sample inputs only; hidden inputs are only used by evaluator-triggered official runs.
- Same challenge content for everyone plus watermarking/ordering where justified. Watermarking deters and attributes leakage; it does not prevent copying.
- Similarity/collusion/AI-use telemetry is advisory only. It must never automatically punish or disqualify someone.
- Unplanned defects must be reviewable and promotable into ground truth with deterministic rescoring/ledger adjustments.
- Human review, double review for configured high-risk/disagreement cases, and appeals.
- Store an immutable or append-only score ledger. Corrections are adjustment/reversal entries, not destructive overwrites.
- Freeze event/ruleset/challenge/evaluator versions at publication and record hashes with submissions/results.

---

## 6. Frontend art direction: exceptionally important

This is one of the highest-priority parts of the build. The result must look art-directed and intentional, not like a generated admin template with a dark theme and a gradient.

### Design intent

Create an identity for **Fall Back / Bug Hunt CTF** that feels technically credible, editorial, cinematic, and memorable. The user wants a strong storytelling-oriented experience: the landing page should create anticipation and make the nature of the competition instantly clear. The participant workspace should feel like a serious, well-crafted tool. The admin/reviewer experience must be just as coherent and usable.

Use these sources as an inspiration library. Visit the relevant ones, inspect examples, extract patterns, and record what you actually used. Do not blindly copy a site, UI kit, or template. Some names may have changed or may be difficult to locate; verify rather than hallucinate.

**Reference library supplied by the user:**

- 21st.dev
- Origin kit
- Spell UI
- Kawaii
- Kinetics
- Animation Dictionary
- Fontshare
- Fonts In Use
- Fontesk
- Scrolltide
- GetLayers
- MotinSites
- Pinterest
- Coolors
- Unsection
- details.so
- Supahero
- backgrounds.supply
- Gradient Lab
- Super Visuals
- Awwwards
- curated.design
- UI SFX
- Bencho
- MotionSites skill
- Particles Casberry
- Daisy UI
- Refero
- UI Watermelon
- Cult UI

Explore relevant examples from the reference set and use them to establish a consistent visual language. Avoid using a huge number of unrelated effects merely because the references contain them.

### Anti-patterns to avoid

The team lead explicitly dislikes the following. **Do not use these as default design solutions:**

- Harsh gradients;
- Lucide icons;
- Pure white backgrounds;
- Rainbow colouring;
- Drop shadows as the main depth treatment;
- Three feature cards in a row;
- Emojis as interface icons;
- Liquid glass;
- Em dashes in interface copy;
- Inter, Geist, or Space Grotesk as the primary typeface;
- Coloured left stripes as the main component motif;
- Fake testimonials;
- Generic bento grids;
- Terminal-window decoration that adds no function;
- “It’s not X, it’s Y” copywriting formulas;
- Checkmark bullets as a visual gimmick;
- Three pricing tiers;
- Fake product demos or screenshots pretending to be functional;
- Excessively soft corner radii;
- Purple-and-black as a default palette;
- Skeleton loaders;
- Radial orbs and generic dot grids;
- Sparkle icons;
- Animated arrows;
- Omitting Terms of Service or Privacy Policy;
- Hover animations as the main interaction feedback;
- Neon colours;
- Basic pastel palettes.

Do not interpret this list as prohibiting every subtle use of a colour, border, radius, or motion. It prohibits generic, overused, decorative solutions. Choose a specific palette and typography system with a rationale.

### Design principles

Apply Dieter Rams' ten principles as practical review criteria:

1. Good design is innovative.
2. Good design makes a product useful.
3. Good design is aesthetic.
4. Good design makes a product understandable.
5. Good design is unobtrusive.
6. Good design is honest.
7. Good design is long-lasting.
8. Good design is thorough down to the last detail.
9. Good design is environmentally conscious.
10. Good design is as little design as possible.

Translate these into a system that is useful, distinctive, fast, restrained, legible, and consistent. Do not quote the principles as a substitute for applying them.

### Required frontend process

1. Inspect all existing assets, brand/logo files, and the source docs. If the user supplied an actual logo, use it appropriately. If no logo exists, create a restrained temporary identity/wordmark that can be replaced later. Do not invent an official logo or claim approval.
2. Research the inspiration library and create a short `FRONTEND_DESIGN_DIRECTION.md` with references visited, selected visual principles, palette, typography, layout logic, imagery/motion direction, and rejected patterns.
3. Design the public landing page and one representative authenticated workspace screen before spreading components across the whole product. Validate the art direction early.
4. Create reusable design tokens and real component primitives. Avoid one-off inline styling and inconsistent spacing.
5. Implement every core state: default, loading, empty, error, offline, degraded, disabled, success, and permission-denied. Since skeleton loaders are prohibited, use stable layout shells, subtle progress treatment, or meaningful status feedback instead.
6. Use real product content and realistic seed data. No fake testimonials, meaningless counters, invented partner logos, or buttons that only look interactive.
7. Iterate from actual browser screenshots at representative screen sizes. Fix the visual issues, not merely the code warnings.

### Frontend quality bar

- A distinctive and coherent public landing page with a clear narrative and strong first impression.
- High-quality typography; use a typeface with a clear rationale and suitable licence. Avoid the banned primary fonts. Self-host/subset where it improves performance and licensing clarity.
- Intentional use of editorial scale, spacing, grid, image treatment, texture, and contrast. Avoid a generic three-card hero/features/pricing layout.
- Meaningful visual hierarchy and restrained transitions. Motion must have a purpose, not be a constant distraction.
- Beautiful and functional participant workspace: repository/file navigation, code-reading area or launch path, structured report creation, evidence, submissions, announcements, timer/status, and responsive panels.
- Reviewer and admin screens must have strong information hierarchy, efficient tables/forms, readable review context, and safe destructive actions. Do not neglect them while polishing the landing page.
- Mobile-first responsive behaviour for public pages, lobby, rules, results, and leaderboard. Code-heavy workspace may be desktop-optimised but must not become unusable on narrow screens; provide a clear minimum-width explanation only where truly necessary.
- Use accessible semantic HTML, keyboard operation, focus visibility, labels, colour contrast, screen-reader feedback, and reduced-motion support. Target WCAG 2.2 AA per the specification.
- Do not use icons from Lucide. Prefer clear typography, CSS-drawn forms, a carefully chosen permitted icon set, or bespoke SVGs.
- Avoid unnecessary third-party scripts, heavy animations, giant client bundles, and large unoptimised images.
- Be honest about live versus demo state. No fake chart data on operational screens.

### Visual verification matrix

At minimum, capture and review pages at widths around 360, 390, 768, 1024, 1440, and 1920 CSS pixels. Test major flows in current Chrome/Chromium, Firefox, Safari/WebKit, and Edge where available. Check keyboard-only navigation and reduced motion. Record unavailable browsers or untested combinations rather than implying universal verification.

---

## 7. Backend and architecture: lean, responsive, scalable by evidence

The user wants a backend that works locally now, but has the shape and resource discipline to run efficiently on a constrained/free-tier host later. Hosting is not selected. Do not optimise around one provider's proprietary service unless it is behind an adapter and is replaceable.

### Architecture profile

- Implement **D0 local development first** with a repeatable local startup path, seeded fixtures, migrations, and tests.
- Design toward a lean **D1 student/free deployment profile**. The architecture document describes a small single-failure-domain deployment and explicitly avoids promising high availability. Re-check its current details and adapt only where justified.
- D2/high-availability infrastructure is deferred. Do not build Kubernetes, microservices, distributed caches, or multi-region systems merely to look production-grade.
- Prefer a modular monolith. Separate processes only for justified trust boundaries or different workload/resource needs.
- Use PostgreSQL as the durable source of truth if consistent with the existing architecture. Avoid adding Redis by default; a PostgreSQL-backed durable job queue and bounded in-process cache are preferred for the lean profile unless measurement says otherwise.
- Keep the frontend statically hostable/CDN-friendly. Keep API/stateful work on the backend.
- Keep provider-specific capabilities behind narrow interfaces/adapters (object storage, email, identity, realtime, telemetry, code runner).
- Keep tenant/event ownership explicit in the data model even if the first deployment serves one organiser.

### Performance and low-resource requirements

- Minimise runtime services, containers, dependencies, startup work, memory use, and idle CPU usage.
- Use bounded worker concurrency, bounded database pools, explicit request/body/output limits, and backpressure.
- Keep API handlers short and avoid blocking CPU-heavy or slow network work in request paths.
- Use background jobs for evaluations, email, exports, score aggregation, and other noncritical work.
- Implement durable jobs with leases/retries/dead-letter visibility and idempotent handlers. Do not claim exactly-once queue delivery; enforce exactly-once business outcomes with database constraints and idempotency.
- Use indexes based on query paths, cursor pagination for large collections, no unbounded result sets, and avoid N+1 database queries.
- Cache only derived/read-heavy data with short TTLs and clear invalidation. Caches must be disposable; PostgreSQL remains authoritative.
- Avoid aggressive polling. Use the architecture's modest polling interval for D1 and only add SSE/shared realtime infrastructure if it has measured value and a fallback.
- Avoid large telemetry systems and external managed services that consume the free-tier budget. Use structured logs and basic health/metrics endpoints first.
- Measure memory, CPU, database connections, queue age, request latency, and bundle size under the expected profile. Record actual measurements and test environment.
- Do not advertise “heavy load” support based on code structure alone. Define a tested event cap and measurable acceptance criteria.

### Submission durability and timing

- Server owns the event clock, eligibility, state, deadlines, grace periods, and scoring. Browser timers are display only.
- Use idempotency keys for mutating operations, particularly submissions. A retry with the same key/payload returns the original receipt; same key with a different payload returns a conflict.
- Commit the submission, durable evaluation job, audit event, and outbox intent atomically where required.
- Use the server clock once within a transaction when deciding deadline acceptance. Handle pause/resume/extension races safely.
- If the database cannot durably accept a submission, do not show “received”. Keep local draft/outbox state, show a degraded state, and allow a safe retry.
- Preserve an immutable or append-only record for scoring and adjudication changes.

### Runner and untrusted code

Running participant-supplied code is one of the highest-risk platform features.

- Never execute participant code inside the participant API, admin API, evaluator, database host, or trusted web process.
- Follow the system architecture's separate runner trust boundary. The runner must have no secrets, no outbound internet, no cloud metadata access, no route to the database or other teams, strict CPU/RAM/process/disk/time/output limits, non-root execution, read-only base filesystem, and disposable per-run workspaces.
- Practice runs must use only participant-supplied or public sample inputs. Hidden inputs are evaluator-only and only for official runs.
- Treat output as untrusted plain text; cap it and never interpret it as HTML/Markdown/scripts.
- If a separate isolated runner cannot be safely provisioned in the D0/D1 scope, disable code execution and the Run panel for that profile. Provide deterministic test/evaluation through a trusted offline process or documented organiser workflow. Never run untrusted code on the platform host just to make a demo look complete.
- Local Docker isolation is useful for development, but do not represent ordinary containers as a complete security boundary against a capable attacker.
- Runner failure must not block normal report submission.

### Security baseline

Implement and test relevant controls from the architecture and blind-spots register:

- Strict role- and ownership-scoped authorization on every endpoint and object. Prevent IDOR across participants, teams, events, reviewers, and tenants.
- Separate participant-facing and organiser/admin capabilities and credentials. Separate ground-truth/hidden-test data from participant-facing data; verify that participant DB roles cannot read it.
- Strong password/session handling or a well-supported identity provider; secure/HttpOnly/SameSite cookies where applicable; CSRF and exact CORS controls; rate limits and abuse controls.
- Server-side validation, parameterized SQL, output encoding, safe error messages, request IDs, upload size/type limits, archive traversal/zip-bomb defenses, and plain-text rendering for untrusted output.
- No secrets in frontend bundles, source control, Docker layers, CI logs, test fixtures, or challenge repositories. Use environment/secrets management and secret scanning.
- MFA/step-up verification for sensitive admin/ground-truth actions where feasible; log and audit privileged changes.
- Restrictive CSP and security headers; HTTPS assumptions documented.
- Data minimisation, documented retention/deletion, and privacy-safe telemetry.
- Never expose hidden answer keys, hidden test inputs, private flags, or unpublished judge feedback to participant-facing APIs.
- Threat-model prompt injection and untrusted challenge/report content if any AI feature is active.
- Include safe-harbor/reporting instructions for security issues and prohibit attacks outside the provided challenge environment.

---

## 8. Technology decisions and implementation style

Read the system architecture and inspect the current repository before choosing the stack. The reference architecture's likely baseline is React + TypeScript + Vite + Tailwind for the frontend, FastAPI for the API, and PostgreSQL for durable state. Prefer it if it remains suitable and does not conflict with the actual repository. You may adjust a component only with a clear, recorded reason tied to implementation speed, compatibility, memory use, security, or maintainability.

- Avoid gratuitous framework churn.
- Type shared API contracts where possible; generate/validate clients from OpenAPI if practical.
- Keep domain logic out of route handlers and UI components.
- Use explicit module boundaries and typed schemas.
- Add database migrations from the first schema change. Avoid destructive migrations without an explicit forward-fix/rollback plan.
- Pin production dependencies and container images; do not rely on floating `latest` tags.
- Keep runtime configuration separate from code and validate it at startup.
- Provide one obvious local start command and a short local developer guide.
- Seed deterministic demo accounts/data only in development/test profiles. Never ship known credentials in a live deployment.

---

## 9. Repository, Git, credentials, and release workflow

The repo may currently be empty, but verify its actual state. Never assume. Before making changes:

1. Inspect `git status`, branches, remotes, current history, repository settings you can access, and existing files.
2. Confirm the current branch and remote before pushing.
3. Do not overwrite existing work or force-push as a convenience.
4. If the repository is empty, initialize the agreed project structure and commit an initial baseline.

### Branching and release

- Use focused feature branches and small logical commits.
- Push regularly so work survives a cloud-agent environment reset.
- Open PRs into `main` where GitHub access permits. Keep `main` releasable.
- Maintain a separate `prod` branch as the promotion/release branch. Promotion to `prod` requires the documented cyber/security review and the readiness gate. Do not bypass this step just to claim deployment readiness.
- Do not merge unreviewed or failing code merely to make progress. If protected-branch permissions prevent a PR or merge, report the exact blocker and leave pushed branches/PRs where possible.
- Never force-push or rewrite shared history without explicit approval.
- Use `gh` CLI or supported GitHub APIs where available. Verify every push/PR result.
- Add CI gates for format/lint, type checks, unit tests, integration tests, migrations, security/authorization tests, dependency scans, and end-to-end smoke tests as appropriate.

### Secrets and personal access token

A GitHub PAT may be supplied to the coding agent. Treat it as a secret:

- Read it only from a secure environment variable or secret store (for example `GH_TOKEN`); never paste it into source, `.env.example`, shell history, markdown, logs, screenshots, or commits.
- Do not print it, decode it, or expose its scopes in public output.
- Use minimum required scopes and only the intended repository.
- Verify authentication without echoing credentials.
- Do not request or store participant passwords, AI passwords, personal API keys, or recovery codes.

If push permissions are unavailable, continue implementation locally, run tests, and provide a clean patch/branch plus exact instructions. Do not falsely claim remote delivery.

---

## 10. Reuse of existing agent skills

Inspect `https://github.com/architgore050/zivon` for reusable skills and conventions. Relevant categories include:

- Prompting and agent design / autonomous coordination;
- Product design, PRD, feature decomposition, and acceptance criteria;
- Systems design, backend architecture, database, APIs, and ADRs;
- Frontend product design, accessibility, performance, and SEO;
- Independent code review and security review;
- Evaluation, observability, and reproducible testing;
- Skill creation/adaptation.

Do not copy every skill or pull in content-factory, physics, voice, or other unrelated product-specific workflows. Select a small relevant subset, inspect their actual contents and licences/provenance, adapt only what helps, and document what was reused or changed. Avoid spending more time importing the skill repository than implementing the product.

---

## 11. Required documentation deliverables

Create and maintain all 27 documents below. They must be consistent with one another and with the actual code. These are minimum deliverables, not a reason to pad documents with generic text.

1. `PRD.md`
2. `SCOPE_AND_MILESTONES.md`
3. `SYSTEM_ARCHITECTURE.md`
4. `ARCHITECTURE_DECISION_RECORDS.md`
5. `FRONTEND_ARCHITECTURE.md`
6. `BACKEND_ARCHITECTURE.md`
7. `DATABASE_DESIGN.md`
8. `API_SPECIFICATION.md`
9. `CHALLENGE_SYSTEM.md`
10. `EVALUATION_ENGINE.md`
11. `SCORING_MODEL.md`
12. `SECURITY_ARCHITECTURE.md`
13. `THREAT_MODEL.md`
14. `TESTING_STRATEGY.md`
15. `DEPLOYMENT_RUNBOOK.md`
16. `DOCKER_GUIDE.md`
17. `CI_CD_PIPELINE.md`
18. `BACKUP_AND_RESTORE.md`
19. `MONITORING_AND_OBSERVABILITY.md`
20. `LOAD_TESTING.md`
21. `SECURITY_TESTING.md`
22. `EVENT_DAY_RUNBOOK.md`
23. `PARTICIPANT_GUIDE.md`
24. `COMPETITION_RULES.md`
25. `SCORING_RULES.md`
26. `PRIVACY_POLICY.md`
27. `TERMS_AND_CONDITIONS.md`

Also create and maintain:

- `AGENTS.md` - canonical project instructions, architecture summary, coding conventions, security constraints, test commands, subagent ownership rules, source hierarchy, and how future agents should continue safely.
- `AUTONOMOUS_DECISION_LOG.md` - every meaningful autonomous decision with: decision ID, date, requirement/source, context, options considered, selected option, rationale, alternatives rejected, trade-offs, risks, reversibility, evidence, code/docs/tests affected, and reviewer follow-up.
- `ONE_SHOT_ACCEPTANCE_CRITERIA.md` - executable pass/fail criteria for the v1, divided into P0/P1/P2. Include user-journey acceptance, design/frontend acceptance, security, performance, data integrity, browser/device coverage, CI, documentation, and operational readiness. Each criterion must have a verification method and evidence location.
- `SOURCE_OF_TRUTH_AND_TRACEABILITY.md` - source precedence, requirement map, conflicts, requirement IDs, and links from source requirements to implementation/tests/docs.
- `AI_TOOLING_RESEARCH_AND_DECISION.md` - current free-tier agent research and chosen/fallback plan.
- `FRONTEND_DESIGN_DIRECTION.md` - actual inspiration research and the approved design language.
- `OPEN_DECISIONS_AND_FOLLOW_UP.md` - unresolved items, why unresolved, options, evidence needed, owner/role, priority, and suggested next step.

### Documentation quality rules

- No empty templates, “TBD” walls, generic textbook filler, or claims that a feature exists when it does not.
- Use MUST/SHOULD/MAY for normative requirements where helpful.
- State what is implemented now versus planned/deferred/disabled.
- Record actual versions, environment assumptions, commands, ports, migrations, test evidence, and limitations.
- Cite source document names and section/page IDs when known.
- Keep privacy policy and terms suitable for India and the actual organiser/event context. Research applicable current requirements from authoritative sources; do not invent legal claims or pretend to provide legal sign-off. Clearly mark drafts for organiser/legal review before publication.
- Update duplicated requirements across docs when a decision changes.

---

## 12. Work plan: execute, do not merely propose

Use the following sequence flexibly, but do not skip a phase without recording why.

### Phase A - reconnaissance and truth-finding

- Inspect the repository, current code, branches, issue tracker/README, available credentials, runtime, and supplied documents.
- Inspect the Zivon skills repository selectively.
- Build the source-reconciliation matrix and identify P0 contradictions.
- Identify capabilities available in the agent environment: terminal, browser, image assets, GitHub, package managers, test runners, subagents, and deployment preview.
- Check the user-supplied logo/brand assets if present.
- Write down the smallest end-to-end scope that satisfies the proposal and the current user priorities.

### Phase B - decide and establish the working baseline

- Create a lightweight project plan with P0/P1/P2 and a critical path.
- Define domain entities, state machines, API contracts, permission rules, and a provisional scoring config before independent agents start overlapping work.
- Record high-impact decisions as ADRs.
- Establish the monorepo/repo layout and coding/test commands.
- Get the app booting locally as early as possible.

### Phase C - implement the complete vertical slice

Build in coherent end-to-end slices rather than creating disconnected screens. At minimum, demonstrate:

1. Organiser creates/configures an event and challenge/repository assignment.
2. Participant registers/activates, authenticates, joins a team, accepts rules, and reaches the lobby.
3. Participant opens assigned project instructions/files or Codespaces launch route.
4. Participant creates a structured bug report/finding and submits it.
5. The backend persists it reliably and creates the required evaluation/review work.
6. Reviewer sees it in a real queue, reviews evidence/code-review criteria, and records an auditable decision.
7. Scoring ledger and leaderboard/results reflect the decision correctly.
8. Organiser can publish results and handle a dispute/appeal or at least administer the complete state transition.
9. Verified CTF flag submissions can be recorded and added as bounded bonus points.

The exact UI can differ if source documents require it, but the underlying path must be real. Seed enough data to exercise every role and state.

### Phase D - frontend art direction and polish

- Complete the design-direction research.
- Build and refine public landing, participant workspace, reviewer queue, and admin surfaces.
- Use real screenshot-based iteration at the viewport matrix.
- Fix responsive issues, typography, spacing, contrast, awkward content density, navigation, empty/error/offline states, keyboard paths, and reduced-motion behaviour.
- Verify there are no inert buttons, broken links, unstyled browser defaults, placeholder assets, fake metrics, or console errors.

### Phase E - quality, security, performance, and failure tests

- Run format/lint, type checks, unit, integration, contract, migration, and end-to-end tests.
- Test tenant/team/resource isolation and IDOR cases.
- Test role permissions, answer-key isolation, hidden test confidentiality, and admin actions.
- Test duplicate submissions, idempotency, deadline boundary, network retry, process restart during submission, queue retry/dead letter, and scoring replay.
- Test uploads/archives against path traversal, symlink, decompression bomb, oversized payload, malformed file, and unexpected MIME scenarios if upload is supported.
- Test prompt injection/untrusted content boundaries if AI is enabled.
- Test runner isolation or verify that the runner is disabled when the security boundary is unavailable.
- Measure startup RAM, steady-state RAM, idle CPU, request p50/p95/p99, DB connection count, queue age, and bundle size on the available local machine.
- Run a load test at the configured provisional concurrency and a burst at expected peak. Include login burst, lobby, challenge reads, submission deadline rush, and reviewer/evaluator backlog. Never claim the architecture's 50-person target or any higher team capacity without test evidence.
- Simulate AI provider outage, runner outage, browser offline, database unavailability, and static-host/API degradation; verify defined fallback states.
- Conduct a security review and write a prioritised defect list. Fix P0 and feasible P1 issues before calling the build complete.

### Phase F - operational handoff

- Verify clean clone → setup → migration → seed → run → test from documented commands.
- Confirm no secret or answer key is accidentally committed or served.
- Confirm backup/export and restore instructions are executable. If a real external backup destination is unavailable in D0, test local backup/restore and clearly mark external backup as deployment follow-up.
- Provide an event-day runbook, incident roles template, pause/extend procedure, communications templates, and change-freeze guidance.
- Create a release candidate on `main` or a PR to `main`; do not promote to `prod` without the cyber gate.
- Push regularly and verify remote state.
- Produce final handoff summary, what works, commands, URLs/ports, test results, screenshots, known limitations, cost assumptions, and prioritised next tasks.

---

## 13. Acceptance criteria: what “done” means

The build is not complete merely because the UI renders or the tests pass. The following should be treated as P0 unless demonstrably blocked by unavailable external credentials/services.

### P0 - usable, real v1

- Repository has a documented, repeatable local run path.
- Public event landing page is visually complete, responsive, and carries the correct Fall Back identity/details.
- Real authentication and role checks work for participant and organiser/reviewer/admin paths.
- Event/team/participant state is persisted and validated server-side.
- Rules/consent and event status are versioned or otherwise auditable.
- Participant can access the assigned challenge/project and submit a structured report with an idempotent receipt.
- Submission data survives process restart and is not duplicated on retry.
- Reviewer can inspect, decide, and record an auditable code-review/evaluation outcome.
- Scoring is configurable, includes a nonzero code-review component, maintains an auditable ledger, supports CTF bonus, and produces consistent results.
- No participant endpoint can expose hidden ground truth or another participant/team's data.
- Admin can manage event lifecycle and publish a result/leaderboard.
- Critical user journeys have automated end-to-end coverage.
- No critical security issue is known to be left unmitigated; any unavoidable limitation is explicit and disables the risky feature where necessary.
- All required docs exist and accurately describe what was built.

### P1 - important quality

- High-quality reviewer/admin experience and complete empty/error/offline/degraded states.
- Cross-browser and cross-OS compatibility verification for the supported matrix.
- Codespaces launch path plus local VS Code fallback documented and tested as far as credentials allow.
- One small placeholder full-stack challenge app with seeded issues, answer key separated, tests, and setup guide.
- Multiple repo assignment data model and at least one working assignment.
- CI includes relevant security, migration, unit/integration, and end-to-end checks.
- Basic observability, load test, and restore rehearsal evidence.
- SEO fundamentals and accessible interaction details.

### P2 - deferred but prepared

- Alternate AI coding-agent integrations that cannot be proven free/equitable during the one-shot.
- Additional challenge repositories and sophisticated repository provisioning automation.
- Advanced realtime, high availability, multi-region, distributed caching, Kubernetes, complex analytics, and multi-tenant commercial SaaS functions.
- Any D2 guarantees that require paid or multi-failure-domain infrastructure.

### Frontend sign-off is independent

Even if P0 functionality is met, do not declare the frontend complete until the art direction is demonstrably implemented. Review the actual screenshots, not just CSS/code. The frontend should feel like a considered competition brand and professional developer tool, not a generic SaaS admin template.

---

## 14. Failure modes and response rules

Plan for the following scenarios rather than assuming the happy path:

- Repo is not empty or contains unexpected history;
- GitHub permission/token is absent, expired, or too broad;
- Source documents are missing, contradictory, or outdated;
- User logo/assets are unavailable;
- A chosen AI provider's free tier changes, is region-limited, exhausted, or does not support the IDE/workspace path;
- A participant has no unused Codespaces allowance or cannot use a supported browser;
- Some participants use local VS Code and others use Codespaces;
- Participants have inconsistent operating systems and runtimes;
- Registration count exceeds the architecture's 50-participant target;
- Users try to access another team's repository/submissions or admin resources;
- Participants spam reports to infer hidden ground truth;
- Hidden answer keys accidentally enter frontend bundles, static assets, logs, or participant packages;
- Participant uploads contain malicious archives or malformed files;
- The runner is unavailable or insecure;
- AI/model response is unavailable, slow, nondeterministic, or prompt-injected;
- A reviewer disagrees with another reviewer or a participant appeals;
- The backend restarts during a submission or job;
- Database is unavailable or nearly out of disk;
- Queue backlog grows during the deadline rush;
- Email, external storage, Cloudflare, Codespaces, or another third-party dependency is down;
- Browser loses connectivity, refreshes, or opens multiple tabs;
- Event time is paused/extended while requests are in flight;
- A score correction is needed after publication;
- An unplanned real bug is discovered in the challenge;
- A participant tries to attack the platform rather than the provided challenge environment.

For each high-severity scenario, implement a safe failure response, operator instruction, or explicit disabled state. Prefer pausing over recording an uncertain score or falsely acknowledging a submission.

---

## 15. Final response required from you

When the one-shot work is complete, provide a concise but evidence-rich handoff with:

1. **What was delivered:** real features, not a generic summary.
2. **How to run it:** exact setup/start/test commands and local URLs/ports.
3. **Primary user journeys verified:** organiser, participant, reviewer, and end-to-end scoring.
4. **Frontend evidence:** screenshots/preview links and viewport/browser coverage; identify any untested combinations.
5. **Test results:** tests run, pass/fail counts, load profile, RAM/CPU/latency measurements, and any gaps.
6. **Security posture:** what was tested, unresolved findings, disabled risky features, and the cyber-review gate.
7. **AI/Codespaces result:** selected integration or no-AI fallback, current free-tier evidence, account requirements, limitations, and the contents of `AI_TOOLING_RESEARCH_AND_DECISION.md`.
8. **GitHub state:** branch, commits, pushes, PR URLs, and whether anything was promoted to `prod` (normally not without review).
9. **Documents created:** confirm all 27 and the additional handoff documents.
10. **Known limitations and next priorities:** P0/P1/P2, with precise work items and reasons.
11. **Decision summary:** the most consequential autonomous decisions, trade-offs, and decisions the team must personally approve.

Do not claim full completion if material P0 criteria remain unmet. State what is genuinely functional, what is partial, what is disabled, and what the team needs to do next.

---

## 16. Begin now

Start by checking repository state and reading all source documents. Then establish the source-of-truth matrix, make the minimum architectural decisions needed to start, and get a running local baseline immediately. Continue through implementation and verification. Do not finish after writing this plan. The mission is to deliver the strongest working v1 possible in this run, with a stunning frontend, trustworthy judging, lean backend, and honest handoff.

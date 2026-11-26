# BUG HUNT CTF — CLEAN-ROOM FRONTEND REBUILD EXECUTION PROMPT

> **Mission:** Replace the existing frontend with a genuinely exceptional, fully functional, independently art-directed frontend. Do not inspect or reuse the existing frontend implementation. Develop several materially different concepts in parallel, document each concept before coding it, implement each as a complete alternative, and open a separate reviewable pull request for every finished concept against `main`. The result must be beautiful, but it must also preserve and correctly use the real product workflows and backend.

---

## 0. Role, outcome, and non-negotiable priorities

You are the autonomous **frontend rebuild director**. You own the clean-room reset, design exploration, concept selection/execution, integration with the existing backend, visual QA, accessibility, performance, Git workflow, pull requests, and final handoff. You may use multiple subagents. You must use them to explore genuinely different design directions rather than asking several agents to make minor variations of one template.

Repository: `https://github.com/architgore050/bug-hunt-hackathon`

Product: **Bug Hunt CTF**. Event: **Fall Back**, organised by the Software Development Club at VIT Bhopal University. Do not reintroduce Echelon or unrelated prior project branding.

### The hierarchy of priorities

1. **A stunning, coherent, memorable frontend.** It must look designed by someone with taste and a point of view, not like a stock SaaS dashboard or AI-generated component gallery.
2. **Real functionality.** All important screens and interactions must work with the existing backend and real application state. Do not sacrifice workflows for a beautiful static mock-up.
3. **A clean, maintainable frontend system.** Strong layout, typography, interaction, responsive behaviour, design tokens, reusable primitives, and clear component boundaries.
4. **Performance and accessibility.** Fast initial rendering, low bundle weight, restrained motion, WCAG 2.2 AA target, keyboard and screen-reader usability.
5. **Reviewable delivery.** Concept documents, granular commits, regular pushes, independent branches, complete PR descriptions, screenshots and verification evidence.

Do not optimise for number of components, number of animations, novelty for its own sake, or how much code is generated. Make deliberate choices and finish them properly.

### What went wrong last time

The previous one-shot implementation interpreted “storytelling” too literally as large blocks of explanatory text. That is not an acceptable interpretation. **A narrative website is not an essay with a hero heading.** Narrative must be communicated through visual composition, art direction, pacing, contrast, imagery, movement, interactive reveals, spatial relationships, and the progression of the experience. Copy should support the visual story, not carry the entire experience.

Do not repeat the previous output with a different palette. Begin with a blank design slate.

---

## 1. Absolute clean-room rule: do not read the existing frontend

This instruction is unusually strict and overrides normal repository-inspection habits.

### You MUST NOT inspect the current frontend implementation

The lead agent, design agents, implementation agents, reviewers, and browser/design subagents must not read, open, cat, print, parse, summarise, index, or otherwise inspect the content of existing frontend implementation files before the clean-room reset. Do not use `cat`, `sed`, `less`, `grep`, `rg`, IDE previews, AST tools, screenshots, browser rendering, component explorers, or GitHub code browsing to learn how the current frontend was built.

This restriction covers, at minimum:

- React/Vue/Svelte/Angular or other frontend source files;
- JSX, TSX, JS, TS, CSS, SCSS, HTML, templates, component files, page files, hooks, stores and frontend utilities;
- current frontend screenshots, recordings, visual snapshots, storybook stories, or running instances;
- old design tokens, theme files, UI component libraries, layout definitions and style sheets;
- frontend tests or snapshots when their purpose is to describe or preserve the old visual implementation.

You may inspect **paths, filenames, file types, directory structure, Git metadata and repository status** to identify the frontend boundary. Do not inspect frontend file contents. Do not infer that the old implementation is worth preserving because some of its code looks reusable. It is intentionally being discarded.

### What you may inspect

You may inspect:

- backend source code, routes, schemas, database models, auth and permission logic, API tests, OpenAPI files and backend configuration;
- architecture/product/specification documents, event rules and existing non-frontend project documentation;
- `package.json` and lockfiles, Vite/build configuration, TypeScript configuration, lint/format/test configuration, CI, Docker/devcontainer files, deployment configuration, environment variable **names**, `.env.example` and `.gitignore`;
- brand assets and the actual logo image/SVG as an asset, if present. You may inspect the image itself, but not a screenshot of the old site containing it;
- generated API contracts and schema files when their purpose is to describe the backend interface rather than the existing UI implementation.

Never read real `.env` files or secrets. Do not expose secrets in logs, commits or PRs.

### Required clean-room reset subagent

Launch a dedicated **Frontend Reset / Repository Custodian** subagent before design concepts begin. Its job is to identify and remove the existing frontend application implementation while preserving the infrastructure needed to build and run a replacement.

The reset subagent may inspect the repository tree and filenames to classify paths, but it must not read the content of frontend implementation files. It should produce `docs/frontend/FRONTEND_RESET_INVENTORY.md` with:

- the frontend application root(s) it identified;
- source-code paths removed;
- assets reviewed and which were retained or removed;
- build/dev/test/deployment configuration preserved;
- files it deliberately left untouched because ownership was ambiguous;
- any config or package dependencies that need cleanup after the new implementation is chosen.

The reset must remove the old UI implementation, not merely hide it behind a new route or place a new landing page in front of it. Remove old pages, components, styles, old design system, old client-side application state, old frontend-only mock data, and obsolete frontend-specific UI implementation. Preserve the backend and all unrelated project code.

**Preserve at minimum, where present and still relevant:**

- backend and database code, migrations, schema, fixtures and backend tests;
- `package.json` / workspace manifests and lockfiles (clean up dependencies later, after the new stack is chosen);
- Vite/build configuration, TypeScript configuration and path aliases;
- lint, formatting, test-runner, browser-test and code-generation configuration;
- `.env.example` and documented environment-variable names, but never real secret values;
- `.gitignore`, Dockerfiles, Compose files, devcontainer/Codespaces configuration;
- CI workflows, deployment manifests, reverse-proxy configuration and scripts;
- API schemas and generated clients only when they are independent backend contracts and still valid;
- legal/privacy documents, product documentation, event rules, challenge data, seed data and non-frontend assets that are actually required.

Do not casually delete the whole `src` directory if it contains backend code. Do not delete package manifests or lockfiles as a shortcut. If frontend and backend are intertwined in one directory, identify boundaries by path and ownership; if a path cannot safely be classified without reading implementation code, leave it untouched and report it rather than risking backend loss.

### Safety and backup before deletion

Before any destructive operation:

1. Inspect `git status`, current branch, remote, current `HEAD`, untracked files and recent commits. Do not read frontend source while doing so.
2. Preserve the user's current work. If there are uncommitted or untracked changes, create a recoverable backup (including untracked files) before proceeding. Do not discard, overwrite, reset, clean or silently stash away user work. Push a backup branch when credentials and remote access permit; otherwise retain a local recovery artifact and document it.
3. Create a named checkpoint branch/tag from the exact pre-reset state.
4. Create a dedicated clean-room base branch from the latest intended `main` state. Never perform the destructive reset directly on `main`.
5. Have the reset subagent make the frontend deletion as a distinct, clearly described commit. Push it.
6. Verify that backend files, migrations, environment templates, build configuration and CI configuration remain present. Run backend tests that do not require the old frontend.

If a clean reset cannot be done safely because frontend/backend ownership is unclear, do not guess destructively. Isolate the new frontend in a clearly bounded app directory and report the unresolved old files for human review.

---

## 2. Establish the real frontend contract before designing

Use a separate **Backend / Product Contract Auditor** subagent. It may read backend code and product/architecture documents, but not the current frontend implementation.

It must produce `docs/frontend/FRONTEND_INTEGRATION_CONTRACT.md`, describing the actual product surface the new frontend must support:

- existing public and authenticated routes/pages required by the product specification;
- API endpoints, HTTP methods, request/response schemas and pagination/filter/sort behaviour;
- authentication, session refresh, logout, activation/invitation and password/reset flows where implemented;
- roles and permissions: public, participant, reviewer, organizer, admin, integrity officer or the actual roles present;
- event, team, round/stage, repository/challenge, submission, score, review, leaderboard and announcement state;
- server-owned countdown/time, paused/extended state, deadline/grace handling and timezone rendering;
- drafts, autosave, submission receipts, retry/idempotency, offline/degraded states and reconnect behaviour;
- validation/error formats, request IDs and useful support information;
- existing feature flags, disabled features, environment variables and integration assumptions;
- backend capabilities that are missing, inconsistent, incomplete or currently mocked;
- which screens are necessary for a functional release and which are future/deferred.

Use the existing API as the source of truth. Do not invent endpoints, roles, status values or data fields. Where the backend contract is undocumented, inspect the backend and record what actually exists. Distinguish implemented, partially implemented, missing and ambiguous functionality.

If the backend lacks an endpoint the UI genuinely needs, record the exact gap and propose the smallest backwards-compatible change. Do not rewrite backend modules or change database semantics just to make one visual concept convenient. The lead agent must approve any necessary backend/API change, document it, add tests, and keep it minimal.

The contract auditor must not recommend copying old page layouts or component organisation. It is describing product behaviour, not the old UI.

---

## 3. Parallel concept exploration: separate, genuinely different ideas

Launch **at least three and no more than four independent design-concept subagents** in parallel. They must not inspect the existing frontend source or old screenshots. Give each the backend integration contract, product requirements, brand/logo asset (if any), reference library, anti-patterns and constraints.

Each agent must invent a distinct creative direction, not a reskin. Vary the visual metaphor, composition, typographic system, visual assets, page rhythm, navigation model, information hierarchy and interaction grammar. Do not let all agents converge on a dark dashboard with different accent colours.

Suggested starting territories (agents may reinterpret or replace them):

1. **The Incident Archive** — editorial evidence, forensic documentation, archival typography, layered artefacts, annotated visual records and a strong sense of discovery.
2. **The Recovery Instrument** — precise, high-craft technical instrumentation, distinctive spatial organisation, tactile status language and purposeful motion without falling into generic terminal/mission-control clichés.
3. **The Failure Atlas** — a visual exploration of software systems, dependencies, breakpoints, root causes and repair; spatial storytelling and diagrams do the explanatory work.
4. **An independent wild card** — a bold, researched concept that does not simply combine the other three.

These are prompts for exploration, not templates. An agent may reject a territory if it finds a stronger direction.

### Concept document before code

Each concept agent must first create its own document before writing implementation code:

- `docs/frontend/concepts/CONCEPT-01-<slug>.md`
- `docs/frontend/concepts/CONCEPT-02-<slug>.md`
- `docs/frontend/concepts/CONCEPT-03-<slug>.md`
- optional fourth concept document if a fourth agent is launched.

Each concept document must include:

- concept name and one-sentence design thesis;
- target emotional response and what makes this experience memorable;
- the visual metaphor and how it maps to the product;
- art direction: palette, typography, composition, spacing, grid, borders/materials, imagery/illustration and motion;
- reference sources visited and the specific principles/patterns extracted (with URLs); include references that were unavailable or irrelevant rather than pretending to have inspected them;
- the first-screen/first-five-seconds experience, described visually rather than as long copy;
- a visual storyboard of the landing-page progression and how the narrative unfolds through layout, interaction and visual change;
- navigation and information architecture;
- representative desktop and mobile layouts;
- approach to participant, reviewer and admin workspaces;
- core reusable design primitives and tokens;
- accessibility and reduced-motion approach;
- performance strategy and asset budget;
- risks, trade-offs and why the concept avoids the team's anti-pattern list;
- a checklist mapping every required product workflow to a planned screen/state.

The concept doc must be substantive enough that a reviewer can understand the proposed experience without looking at code. It is not a generic moodboard or a list of adjectives.

### Independent implementation branches

After concept documents exist, have the lead agent check that they are materially different. It must then create one independent branch/worktree per concept from the same clean-room base. Each concept agent implements its **own complete frontend alternative** on its own branch/worktree. Do not have agents edit the same checkout or shared files concurrently.

Branch naming examples:

- `frontend/concept-01-incident-archive`
- `frontend/concept-02-recovery-instrument`
- `frontend/concept-03-failure-atlas`
- `frontend/concept-04-wildcard`

Every implementation must use the same backend integration contract and feature-parity checklist. The concepts are mutually exclusive alternatives, not layers to merge together. Do not auto-merge any of them.

If there are insufficient agent slots, run the concept agents sequentially while preserving separate branches and independent design direction. Do not reduce the number of concepts to one merely for convenience.

---

## 4. Frontend design direction and reference library

The result must feel **technically credible, editorial, cinematic, thoughtful and memorable**. The product is about investigating software failures and restoring broken systems. Use that subject matter as the source of the visual idea. Do not apply a random trendy style because it looks fashionable in isolation.

### User-provided inspiration library

Explore relevant sources from this list. Research should be selective and purposeful: record the actual pages/examples inspected, what was learned, and where that lesson appears in the concept. Do not claim to have reviewed a source that you did not access. Not every source needs to be used; the set is a library of potential inspiration, not a checklist to copy.

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

Use these as research inputs, not as a requirement to install every UI kit. Inspect typography, composition, transitions, navigation, art direction, visual storytelling, interaction feedback, illustration, sound and motion where relevant. Do not import a large component library simply because it is on the list.

### Explicit anti-pattern list

The team lead has specifically rejected these common visual shortcuts. Avoid them as default design solutions:

- harsh gradients;
- Lucide icons;
- pure white backgrounds;
- rainbow colouring;
- drop shadows as the main depth treatment;
- three feature cards in a row;
- emojis as interface icons;
- liquid glass;
- em dashes in interface copy;
- Inter, Geist or Space Grotesk as the primary typeface;
- coloured left stripes as the main component motif;
- fake testimonials;
- generic bento grids;
- decorative terminal windows that do not do anything;
- “it’s not X, it’s Y” copywriting formulas;
- checkmark bullets as a visual gimmick;
- three pricing tiers;
- fake product demos, fake screenshots or pretend-live UI;
- excessively soft corner radii;
- purple and black as the default palette;
- skeleton loaders;
- radial orbs and generic dot grids;
- sparkle icons;
- animated arrows;
- missing Terms of Service or Privacy Policy;
- hover animations as the primary interaction feedback;
- neon colours;
- basic pastel palettes.

This list does not prohibit every gradient, shadow, rounded corner, colour or animation. It prohibits lazy, generic solutions. Any deliberate use of a listed pattern must have a clear functional/art-direction reason and be reviewed by the lead design agent. Do not use Lucide.

### Apply Dieter Rams' ten principles

Translate these into actual design decisions:

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

Do not paste the principles into a document and call the work compliant. Use them during design critique: does the visual idea help the product, does each detail have a purpose, is the UI honest about system state, and can unnecessary weight or decoration be removed?

### What “storytelling” actually means here

Do not rely on paragraphs to create a narrative. The visual experience should carry the narrative. Consider:

- a strong opening composition that immediately communicates the event's character;
- a distinctive visual motif derived from debugging, investigation, system failure, evidence, repair or recovery;
- meaningful visual transitions between discovery, diagnosis, repair and verification;
- large-scale typography balanced with visual artefacts, diagrams, imagery or interactive elements;
- scroll progression with changing composition, not merely one column of headings and paragraphs;
- purposeful micro-interactions that reveal state, relationships or evidence;
- real interface/product previews, not fake dashboard screenshots;
- visual hierarchy that makes important actions immediately obvious;
- concise, specific copy that explains what visuals alone cannot;
- a clear conversion path into registration, rules, participation or the relevant next action.

A landing page must not become an unbroken wall of text. It must not become an unbroken wall of cards either. Compose sections with rhythm, variation, deliberate negative space and real visual content. Use diagrams, code-diff visualisations, dependency maps, issue timelines, annotated artefacts or custom illustration only when they clarify the subject. Do not decorate randomly.

The participant workspace is a different design problem from the public landing page. It should be a beautiful, high-performance work tool: clear, dense where needed, stable, predictable and efficient. Do not force the landing-page theatricality into every table, editor, form or admin screen.

---

## 5. Product surfaces and workflow parity

Use the actual specification and `FRONTEND_INTEGRATION_CONTRACT.md` to establish the required page inventory. At minimum, assess and implement the surfaces that actually exist in the backend/product specification:

### Public experience

- landing page for Fall Back / Bug Hunt CTF;
- event overview, date, schedule, eligibility/team information where confirmed;
- rules and competition format;
- FAQ/help/contact where real data exists;
- Privacy Policy and Terms of Service;
- registration/activation entry points, or clear sign-in/invitation flow according to the implemented auth model;
- status, announcements or event availability if exposed by the backend.

### Participant experience

- login/activation and session states;
- participant lobby and system/setup checks;
- event instructions and rules acknowledgement;
- event/round/stage state, server-authoritative countdown, pause/resume/extension messaging;
- assigned challenge/repository access and setup guidance;
- repository/file navigation or launch to the approved coding workspace as appropriate;
- structured bug/finding report creation, evidence and validation;
- drafts, autosave, submit confirmation/receipt, retry and idempotent resubmission behaviour;
- submission history and result visibility rules;
- team/participant status where supported;
- leaderboard/results/appeals as permitted by event state;
- announcements, connection status and degraded/offline behaviour.

### Reviewer / organiser / admin experience

- review queue with enough evidence and context to make a decision;
- accept full/partial, duplicate, reject invalid, unplanned valid finding and needs-second-review paths if those are the actual backend states;
- score/review breakdown and code-review rubric;
- challenge/event/round configuration only to the extent implemented;
- participant/team management and permissions;
- live operations: announcements, pause/resume/extend, kill switches and status;
- results, appeals, audit trail, exports and finalisation as supported;
- loading, empty, error, permission-denied and degraded states.

Do not invent screens for capabilities that do not exist. Do not conceal a missing backend feature behind a fake UI. Mark experimental or unavailable capabilities honestly.

### Required state coverage

Every meaningful workflow must handle:

- initial/loading state;
- empty state;
- validation errors;
- server errors and retryable errors;
- permission-denied state;
- offline/reconnecting state;
- stale data/degraded mode;
- success/receipt confirmation;
- disabled or unavailable capability;
- expired session;
- paused/closed/finalised event states.

No skeleton loaders. Use stable layouts and purposeful status/progress feedback. Do not show a spinner that hides meaningful content.

### Functional parity rule

All concept PRs must implement the same agreed feature surface and integrate with the same backend contract. The lead must not compare a complete concept with a landing-page-only mock-up. If a concept cannot implement a specific backend workflow, it must disclose it and may not be marked complete.

---

## 6. Technical implementation constraints

1. First understand the retained build infrastructure and choose the smallest maintainable frontend stack that fits it. Keep Vite if it is already the appropriate build tool; do not replace working infrastructure without evidence.
2. Use TypeScript if compatible with the current stack. Keep types aligned to the actual backend schemas.
3. Keep API access in a clear client/service layer. Avoid scattering raw `fetch` calls and endpoint strings across components.
4. Centralise auth/session handling, error parsing, request IDs, timeouts, cancellation, retry rules and idempotency behaviour.
5. Use server state and client state intentionally. Do not duplicate authoritative deadlines, roles, scores or event state in local storage.
6. Persist only what is safe and useful locally, such as non-sensitive preferences and clearly labelled draft buffers. Protect participant drafts against accidental data loss.
7. Use route-level code splitting where it helps. Avoid loading admin/reviewer modules into public pages unnecessarily.
8. Avoid unnecessary dependencies, large icon packs, excessive animation libraries, duplicated charting libraries and heavy UI kits.
9. Use semantic HTML and CSS before adding complex abstractions. Use an icon system only if it is coherent, licensed and permitted; do not use Lucide.
10. Keep frontend configuration separate from secrets. No API secrets or privileged credentials in client bundles.
11. Respect backend role/permission checks. Hiding a button is not authorization.
12. Avoid modifying backend behaviour merely to suit a component. Any backend/API change must be small, justified, tested and recorded.
13. Support modern Chrome/Chromium, Firefox, Safari/WebKit and Edge, with responsive behaviour on Windows, macOS and Linux browsers.
14. Ensure forms work with keyboard, touch and assistive technology. Never make hover the only way to discover an action.
15. Respect `prefers-reduced-motion`; keep motion optional and non-essential to task completion.

### Responsive design

Review at approximately 360, 390, 768, 1024, 1440 and 1920 CSS pixels. Mobile layouts should be intentionally composed, not merely desktop columns stacked. Public pages, lobby, rules, registration, results and leaderboard must work well on phones. The code-heavy workspace may be desktop-optimised, but must remain navigable and must explain any genuine minimum viewport requirement rather than clipping or hiding core actions.

### Typography and assets

- Choose typography with a clear rationale and suitable licence. Do not use Inter, Geist or Space Grotesk as the primary face.
- Use a considered typographic hierarchy, not arbitrary font-size inflation.
- Self-host/subset fonts when that improves performance and licensing clarity.
- Optimise raster images, SVGs and animations. Prefer custom vector/HTML/CSS visuals where they are crisp and lightweight.
- Do not use random stock-photo wallpaper to simulate art direction.
- If a supplied logo exists, preserve its shape and proportions. Do not redraw or distort a fixed logo. If no suitable logo exists, make a temporary wordmark/identity that can be replaced, and document that it is provisional.

---

## 7. Visual quality process: design, implement, inspect, revise

Every concept must follow this loop:

1. Write the concept document.
2. Define design tokens and a small set of primitives.
3. Build a high-fidelity landing-page opening and one representative authenticated workflow screen.
4. Run the app and inspect real browser screenshots at desktop and mobile widths.
5. Revise composition, proportion, typography, density, rhythm, visual contrast, asset quality and interactions.
6. Only after the direction works, expand it to all required surfaces.
7. Complete workflow integration and states.
8. Perform a visual and functional review with an independent reviewer agent.
9. Fix findings and capture final screenshots.

Do not treat a successful build as visual QA. Do not judge only from source code. Render pages in a real browser or Playwright and inspect them. Take screenshots of the real implementation at representative sizes. If browser automation is unavailable, record this limitation and use the best available manual visual inspection.

### Independent critique subagents

Use at least two independent review passes per finished concept:

- **Art-direction critic:** judges whether this is distinctive, coherent, memorable, and free from generic AI-template patterns; checks the first 5 seconds, narrative progression, typography, composition, visual assets and motion.
- **Product/usability critic:** checks whether participants, reviewers and organisers can actually complete tasks; examines hierarchy, information density, feedback, error handling, keyboard/touch use, accessibility and responsiveness.

Reviewers must receive the rendered screenshots and workflow evidence. Do not ask them to merely inspect code style. Require ranked findings with severity, screenshot/location, user impact and recommended correction. The concept agent must resolve critical/high issues before PR completion.

### Visual acceptance bar

A concept is not ready merely because it is “clean”, “modern” or “polished”. It must have:

- a recognisable design thesis that can be described without saying only “dark, minimal and modern”;
- a striking first screen with an intentional visual composition;
- meaningful variation and pacing across the landing page;
- a visual narrative communicated through layout, visual artefacts, interaction and progression rather than long text;
- a usable, distinctive participant workspace;
- reviewer/admin screens that feel part of the same system without sacrificing efficiency;
- consistent tokens and reusable components;
- polished responsive layouts;
- no obvious overflow, awkward empty space, arbitrary card repetition, generic hero/features/CTA template, placeholder imagery or decorative UI with no purpose;
- real content and honest system states.

---

## 8. Git, branches, commits, pushes and PRs

Git discipline is part of the deliverable. Do not work directly on `main` and do not push directly to `main`.

### Branch and worktree model

1. Create a protected, pushed clean-room base branch from the latest `main` after the reset commit. Example: `frontend/rebuild-base`.
2. Create one independent branch/worktree for each concept from that exact base.
3. Each concept branch must be self-contained: it includes the old frontend removal and its own replacement frontend, design/concept documentation, and tests. Do not cherry-pick another concept's implementation into it.
4. Keep concept branches isolated. Do not let agents push to one another's branches.
5. If a shared API contract or test harness is required, the lead agent owns it and communicates it to all concept agents. Avoid shared UI implementation that makes all concepts look alike.

### Granular commits

Commit at meaningful milestones, not one giant final commit. Suggested sequence:

- reset inventory and frontend deletion;
- concept document and design direction;
- build/configuration and design tokens;
- public landing-page composition;
- public pages and navigation;
- participant shell and primary workflow;
- draft/submission and feedback states;
- reviewer/admin workflows;
- responsive and accessibility work;
- tests, browser fixes and performance polish;
- final docs and PR preparation.

Use clear commit messages. Push regularly after coherent milestones. If push fails, preserve work locally, diagnose the real cause and document the branch/commit state. Do not claim something was pushed when it was not.

### One PR per concept

When a concept is complete, push its branch and open a separate PR **targeting `main`**. The user specifically wants to compare alternative concepts as PRs. Do not merge these PRs. They are mutually exclusive alternatives; the user/design lead chooses one to merge later.

Each PR must include:

- concept name and short thesis;
- link to its concept document;
- summary of the visual system and key interaction ideas;
- list of product workflows implemented;
- screenshots at desktop and mobile sizes (and preview URL if available);
- test/CI/build results;
- browser and accessibility verification performed;
- performance/bundle observations;
- known limitations and remaining gaps;
- clear note that this PR is an alternative to the other concept PRs and should not be merged alongside them.

Do not delete or close the other concept PRs. Do not auto-merge. The final report must list all PR URLs, branches and latest commit SHAs.

If GitHub credentials are unavailable, still prepare clean branches and complete PR descriptions in the repository, but clearly state that PR creation/push could not be completed and why.

---

## 9. Testing, accessibility, performance and compatibility

### Functional tests

Use the real backend or a documented test environment. At minimum, cover:

- public landing/rules/privacy/terms navigation;
- login/activation and expired-session handling;
- role-based route access and server permission errors;
- participant lobby/event state and server countdown;
- challenge/repository launch/access path;
- creating, editing, saving and submitting a report/finding;
- duplicate-click/retry/network interruption without duplicate submission;
- receipt/history and permitted result visibility;
- reviewer decision flow and score breakdown;
- admin announcement/pause/extend/kill-switch screens where implemented;
- leaderboard/results/appeals according to the real backend state;
- error, empty, offline, reconnecting and degraded states.

Do not use mocked data to pass tests for a feature that exists in the backend. Mocks may be used in isolated component tests, clearly separated from integration tests.

### Accessibility

Target WCAG 2.2 AA:

- semantic landmarks and headings;
- logical tab order and full keyboard operation;
- clearly visible focus;
- accessible labels and descriptions;
- sufficient contrast;
- screen-reader announcements for meaningful state changes, not every timer tick;
- proper form errors and validation association;
- reduced-motion support;
- usable touch targets;
- no colour-only status communication.

Run automated accessibility checks (for example axe) and perform a manual keyboard/screen-reader pass where tooling is available. Report what was tested.

### Performance

The frontend must not waste the backend's scarce resources or punish participants' devices/network:

- keep JS bundles lean and split by route/role;
- avoid unnecessary polling and duplicate requests;
- debounce search/filter input appropriately;
- paginate or virtualise genuinely large datasets;
- avoid uncontrolled rerenders and expensive derived calculations;
- optimise images and fonts;
- avoid large visual effects that cause scroll jank or GPU-heavy continuous animation;
- handle slow networks and request cancellation;
- measure build output and representative page performance rather than guess.

Set practical performance budgets based on the actual app. Record bundle sizes and any known bottlenecks. Do not claim a Lighthouse score unless it was measured on the built site.

### Browser/device matrix

Test current available versions of Chrome/Chromium, Firefox, Safari/WebKit and Edge. If a browser is unavailable in the environment, record it as not tested. Verify the layouts at the viewport widths in Section 6 and use real touch/keyboard testing where possible.

---

## 10. Documentation required from this execution

At minimum, create/update:

- `docs/frontend/FRONTEND_RESET_INVENTORY.md`
- `docs/frontend/FRONTEND_INTEGRATION_CONTRACT.md`
- `docs/frontend/FRONTEND_CONCEPT_COMPARISON.md` (compare all concepts fairly)
- `docs/frontend/FRONTEND_DESIGN_DIRECTION.md` or concept-specific equivalent
- `docs/frontend/concepts/CONCEPT-*.md` (one per concept, authored before implementation)
- `docs/frontend/FRONTEND_QA_AND_ACCESSIBILITY.md`
- `docs/frontend/FRONTEND_PERFORMANCE_REPORT.md`
- update `AGENTS.md` or the project-level agent guidance only if new frontend conventions/workflow need to be recorded; do not overwrite unrelated repository guidance.

The comparison document must compare the implemented alternatives, not just their concept docs. Include screenshots and a side-by-side assessment of distinctiveness, narrative quality, usability, visual polish, functional completeness, accessibility, responsiveness, performance and maintainability. Do not secretly rank a concept first without evidence.

---

## 11. Decision-making and ambiguity

You are expected to make decisions and keep executing. Do not keep asking the user for permission to choose a font, spacing scale, layout, component library or animation approach.

- Prefer reversible decisions and keep tokens/configuration centralised.
- Record major decisions, alternatives, trade-offs, risks and evidence in `AUTONOMOUS_DECISION_LOG.md` or the repository's existing decision log.
- If a requirement is ambiguous, use the product documents and backend contract, choose a reasonable implementation, and record the assumption.
- If the backend cannot support a specified workflow, do not fake it. Implement the strongest honest fallback and report the precise gap.
- If a reference site is unavailable, move on and record that; do not hallucinate its content.
- If a concept is visually weak, critique and improve it rather than rationalising it.
- Do not stop after writing concept documents. The task is execution, not a design research report.
- Do not ship one polished landing page with an incomplete participant/admin product. All concepts must meet the shared feature-parity bar.

---

## 12. Definition of done for each concept PR

A concept PR is ready only when all applicable items are true:

### Clean-room and source integrity
- [ ] Existing frontend source was not inspected before reset.
- [ ] The reset inventory documents exactly what was removed and preserved.
- [ ] Backend, migrations, data, auth and unrelated bug fixes remain intact.
- [ ] A recoverable pre-reset checkpoint exists.
- [ ] No secrets or real environment values were committed.

### Design and concept
- [ ] Concept document was committed before implementation code.
- [ ] Concept is materially different from the other alternatives.
- [ ] Inspiration research has actual references/URLs and extracted lessons.
- [ ] First-screen and full-page narrative rely on visual composition and interaction, not long text blocks.
- [ ] Anti-patterns and Dieter Rams criteria were reviewed.
- [ ] Actual browser screenshots were inspected and iterated.

### Functionality
- [ ] All workflows in the shared frontend feature matrix are implemented or honestly marked as unsupported by the backend.
- [ ] Real API integration is used for real product features.
- [ ] Auth, roles, permissions, deadlines, submission receipts and results reflect server truth.
- [ ] Loading, empty, error, offline, degraded, disabled and success states exist as relevant.
- [ ] No fake data, dead buttons, decorative controls or pretend-live functionality.

### Quality
- [ ] Production build succeeds.
- [ ] Lint/type checks pass.
- [ ] Relevant unit/component/integration/E2E tests pass.
- [ ] Accessibility checks are run and critical findings fixed.
- [ ] Responsive screenshots reviewed at required widths.
- [ ] Cross-browser verification performed where tooling exists.
- [ ] Bundle/performance observations documented.
- [ ] Independent art-direction and usability reviews completed; critical/high issues resolved.

### Git and handoff
- [ ] Granular commits exist and have been pushed.
- [ ] PR targets `main` and includes full description/evidence.
- [ ] PR says it is an alternative to the other concept PRs; no auto-merge.
- [ ] Latest branch commit SHA and verification evidence are recorded.

---

## 13. Final handoff

When all concepts are ready, provide a concise final report containing:

1. The reset summary and checkpoint/backup references.
2. The exact frontend files removed and infrastructure preserved.
3. The backend/API contract gaps discovered and any minimal changes made.
4. The concept names, theses and what makes each materially different.
5. The PR URLs, branches and latest commit SHAs.
6. A comparison of the concepts with screenshots/preview links.
7. Build, test, browser, responsive and accessibility verification results.
8. Performance/bundle observations.
9. Known limitations and exact follow-up tasks.
10. A recommendation based on evidence, without merging any concept PR.

Do not claim all PRs are ready if they are only half-implemented. Clearly distinguish complete, partially complete, blocked and untested.

---

## 14. Start now

Proceed in this order:

1. Confirm repository, branch, working tree and recoverable checkpoint. Preserve any existing user work.
2. Map the repository by paths/filenames only for the frontend area. Do not read frontend source.
3. Launch the reset custodian and backend/product contract auditor in parallel with strict file-access boundaries.
4. Commit and push the safe clean-room frontend reset on a dedicated base branch.
5. Launch at least three independent concept agents. Require their concept documents before implementation.
6. Review concept distinctiveness and approve the parallel branch plan.
7. Build each complete alternative in its own worktree/branch using the shared contract and feature matrix.
8. Iterate from browser screenshots and independent critiques.
9. Test, document, commit and push each concept granularly.
10. Open one separate PR per completed concept against `main`. Do not merge.
11. Deliver the final comparison and handoff report.

**The expected output is not a proposal for how the frontend might look. The expected output is multiple complete, working, visually exceptional frontend alternatives, each preserved in its own pushed branch and reviewable PR, with the existing backend and the user's non-frontend work intact.**

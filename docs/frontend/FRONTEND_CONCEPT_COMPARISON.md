# Frontend Concept Comparison — Implemented Alternatives

**Status:** all three concepts are **implemented, building, linting (0 errors) and
axe-clean (0 violations on every route)**. They are **mutually exclusive alternatives**:
the three PRs target `main` and **must not be merged together**. Pick one, merge it, close
the other two.

| # | Concept | Branch | PR |
|---|---|---|---|
| 01 | The Incident Archive | `frontend/concept-01-incident-archive` | see PR list |
| 02 | The Recovery Instrument | `frontend/concept-02-recovery-instrument` | see PR list |
| 03 | The Failure Atlas | `frontend/concept-03-failure-atlas` | see PR list |

Concept documents: `docs/frontend/concepts/CONCEPT-01..03-*.md` (authored before any
implementation code, on this base branch). QA evidence per concept:
`docs/frontend/FRONTEND_QA_AND_ACCESSIBILITY.md` + `FRONTEND_PERFORMANCE_REPORT.md`
+ `docs/frontend/screenshots/` on each branch.

## 1. Visual thesis, side by side

| | 01 Incident Archive | 02 Recovery Instrument | 03 Failure Atlas |
|---|---|---|---|
| Metaphor | Forensic case file / evidence docket | Avionics instrumentation / lab apparatus | Bathymetric fault map / structural survey |
| First screen | Buff paper docket card over dark slate, stamped EX- chips | Annunciator strips, telemetry registers, amber-on-black | Cartographic grid, contour field with a marked fault coordinate, Fraunces italic elevation headline |
| Narrative device | Exhibit numbering (EX-00…), case chronology | Status registers and phase "timing track" | Depth strata (S-01…S-04) and coordinate addressing (`COORD:routes/notes.js#L44-46`) |
| Landing rhythm | Two-column exhibits → 4 phase cards → scoring ledger table → CTA | Register rows → phase track → metric wedges → CTA | Full-bleed hero map → fracture specimen + protocol → stacked strata bands → equilibrium bar → treaty panels → entry gate |
| Workspace framing | "Evidence Repository & Filing Desk" (3 columns) | Instrument rack with annunciator state | "Strata Explorer / Fracture Viewer / Filing Docket" quadrants with coordinate rulers |
| Admin framing | Operations desk exhibits | Control-room panels | Command post with readiness matrix and hash-chain verification |
| Palette signature | #111215 + buff #F3EFE6 + stamp red/green/amber | #0E1013 chassis + amber/sage/crimson/cyan | #090E16 abyss + strata blues + shear red/copper/moss/hydro cyan |
| Type system | Fraunces + Archivo + IBM Plex Mono | Archivo + IBM Plex Mono | Fraunces (italic elevations) + Archivo + IBM Plex Mono |

The three do **not** converge on one dark dashboard: 01 mixes dark slate with warm buff
paper; 02 is a grey-black instrument chassis with amber accents and no serif; 03 is a
blue-black cartographic system with hairline grids, contour SVGs and coordinate
typography. None of them uses the team's rejected patterns (no Lucide, no emoji icons, no
bento grids, no skeleton loaders, no purple/black default, no rainbow, no glass).

## 2. Functional completeness (identical contract, verified per branch)

All three implement the same `FRONTEND_INTEGRATION_CONTRACT.md` surface: public landing /
rules / privacy / terms, login + activation (password complexity, rules ratification),
participant lobby (readiness matrix, announcements, server clock), workspace (file tree,
search, line-range selection, 12-taxonomy report, CTF flag tab, 3 s draft autosave with
version-conflict detection, idempotent submit, cooldown), filings log + dossier +
disputes, results + leaderboard with sealed states, review queue (claim/lock) + desk
(6 verdicts, 5-metric rubric), admin ops (telemetry, readiness gate, stage control,
broadcasts, CSV exports, audit verify, disputes) + challenge authoring (step-up, upload,
freeze, test results). Same shared client layer (`api.ts`/`types.ts`/`time.ts`).

Honest shared limitation: no PostgreSQL/Docker in the sandbox → the FastAPI backend could
not be started here. Public pages were verified against real 502 error paths; authenticated
flows were verified with intercepted-network fixtures for **visual QA only**. Live-backend
E2E (`scripts/e2e_journey.py`) remains a follow-up for all three.

## 3. Measured quality (post-hardening, 2026-11-23)

| Metric | 01 Archive | 02 Instrument | 03 Atlas |
|---|---|---|---|
| JS bundle (gzip) | 104.05 KB | **102.08 KB** | 107.10 KB |
| CSS (gzip) | 6.92 KB | **5.92 KB** | 7.28 KB |
| axe-core violations (all routes) | 0 (was 33+ + 2 critical) | 0 (was ~10/route + 2 critical) | 0 (was 18 on landing) |
| oxlint | 0 errors, 19 warnings | 0 errors, 19 warnings | 0 errors, 16 warnings |
| Route splitting | none (follow-up) | none (follow-up) | none (follow-up) |

The a11y hardening was applied to all three branches with the same technique
(text-safe accent tints; saturated bases kept for borders/fills/graphics; programmatic
labels on selects/sliders/textarea). Contrast ratios are documented per concept.

## 4. Usability assessment

- **01** is the most "documentary": strong reading rhythm, the buff docket separates
  formal content nicely; information density on the workspace is comfortable; scoring
  ledger table is the clearest of the three.
- **02** is the most "operational": the rack/annunciator language makes state glancable,
  and it has the smallest bundle. Risk: instrument metaphors can feel austere for the
  public landing; the strongest fit is the participant/reviewer tools.
- **03** carries the most narrative on the landing (map → specimen → strata → equilibrium
  → treaty) while keeping the workspace a calm three-quadrant tool; the coordinate motif
  reinforces the exact-line-span filing workflow (the product's core task) better than
  either alternative.

## 5. Recommendation

**Recommend merging Concept 03 (Failure Atlas)** for the event site: the cartographic
metaphor maps directly onto the product's central workflow (pinning faults to exact line
coordinates), the landing tells the story visually rather than through copy blocks, and
it matches the anti-pattern list most cleanly. **02** is the strongest fallback if bundle
size is the top priority; **01** is the safest editorial middle ground. This is a judgement
call based on the evidence above — the screenshots on each branch let the design lead make
the final call.

## 6. Verification status per branch

- Production build: pass (tsc + vite) on all three.
- oxlint: pass (0 errors).
- axe-core 4.10.2 on Chrome 158 headless: 0 violations on all routes.
- Browser screenshots: committed per branch (desktop 1440 + mobile 390).
- Firefox/Safari/Edge, screen-reader pass, live-backend E2E: **not run** (sandbox
  limits) — documented in each branch's QA doc.

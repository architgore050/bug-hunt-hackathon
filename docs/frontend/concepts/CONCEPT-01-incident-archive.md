# Concept 01: The Incident Archive
**Slug:** `incident-archive`  
**Author:** Clean-Room Concept Subagent 01  
**Target Branch:** `frontend/concept-01-incident-archive`  

---

## 1. Design Thesis & Emotional Response

> **Design Thesis:** An austere forensic audit docket where the hackathon is experienced as an urgent containment investigation into compromised production systems, told through archival typography, evidence-tagged exhibits, and tactile docket progression.

- **Target Emotional Response:** Gravitas, forensic curiosity, and methodical discovery. The participant feels like a senior systems investigator examining declassified case files and entering tamper-evident findings into a permanent record.
- **What Makes It Memorable:** It rejects the ubiquitous "cyberpunk neon hacker" aesthetic and "generic SaaS dashboard" in favor of an authoritative, high-contrast editorial case-file language. Dark matter meets cold-war paper dossiers: stark black-slate frames housing warm buff paper cards, stamped verification marks, and monospace telemetry.

---

## 2. Visual Metaphor & Art Direction

### 2.1 The Visual Metaphor: The Containment Docket
Every screen is structured as an **Exhibit (EX-##)** in a living forensic inquiry:
- The Landing page is the **Declassified Public Briefing** (Case File: Fall Back).
- The Lobby is the **Operational Status Ledger**.
- The Workspace is the **Evidence Examination Desk** with split folders for Source Material, Annotated Inspection, and the Filing Docket.
- Reports generate **Perforated Receipt Slips** sealed with cryptographic HMAC stamps.

### 2.2 Color Palette & Materiality
- **Base Environment:** Archival Dark Slate `#111215` (deep, matte carbon, non-reflective).
- **Surface Elevation (Cards/Panels):** Docket Buff `#F3EFE6` for high-priority exhibits and reading focus; Carbon Card `#1A1C20` for technical console shells; Slate Border `#2B2E35`.
- **Signal & Status:**
  - Archival Warning / Stamp: Terra Cotta `#C04A36`
  - Forensic Verified / Match: Muted Pine `#3E7259`
  - Active Investigation / Beacon: Warm Amber `#CF8B38`
  - Telemetry Accent: Blueprint Cyan `#4B7B9A`
  - Muted Inscriptions: Weathered Lead `#868A94`
- **Depth & Structure:** Built with crisp 1px borders, subtle inset bevels, paper-edge hairline rules, and high tonal contrast rather than muddy drop shadows or liquid glass.

### 2.3 Typographic System
- **Display & Headings:** `Fraunces` (warm, high-contrast, editorial serif with razor-sharp cuts and optical sizing). Used for exhibit titles, hero headlines, and authoritative section dividers.
- **Telemetry & Monospace:** `IBM Plex Mono` (structured, human, technical). Used for timestamps, receipt codes, code line numbers, hashes, and audit logs.
- **Body & Data:** `Archivo` (neutral, dense, legible grostesque). Used for dense form labels, instructions, tables, and system messages.
- *Strict Rule:* No Inter, no Geist, no Space Grotesk.

### 2.4 Composition, Spacing & Movement
- **Grid:** Asymmetric 12-column editorial grid with broad margins, deliberate white/dark space, and numbered docket indices (`01 / BRIEF`, `02 / TIMELINE`).
- **Motion:** Restrained, mechanical, paper-flick and stamp impacts. Micro-transitions (120ms ease-out) for tab switches and filing confirmation. Strict adherence to `prefers-reduced-motion` with instant crossfades.

---

## 3. Reference Sources & Principles Extracted

1. **Fonts In Use (Editorial Forensic Archives & Government Reports):** https://fontsinuse.com
   - *Lesson Extracted:* High-contrast serifs paired with cold monospaced tabular data create instant institutional authority. Section numbering with leading zeros (`01`, `02`) creates pacing.
2. **curated.design (High-craft brutalist & editorial web layouts):** https://curated.design
   - *Lesson Extracted:* Generous negative space around tight, border-contained text blocks makes technical documentation feel precious and deliberate.
3. **details.so (Micro-interaction & border craft):** https://details.so
   - *Lesson Extracted:* Hairline double-borders and corner ticks define distinct surfaces without relying on heavy box shadows.

---

## 4. The First Screen & Visual Storyboard

### 4.1 First 5 Seconds Experience
The visitor is met with a bold header: **FALL BACK / BUG HUNT CTF**, an authoritative status bar with an active server-synchronized time beacon (`UTC+05:30 [IST]`), and a striking headline in `Fraunces`: *"Systems fractured. Contain the fallout."*
Below it, an annotated triage docket displays live incident parameters:
- `EVENT_ID: FB-2026-11`
- `DURATION: 180 MIN`
- `STATUS: SEALED / ARMED`
- `SECTOR: SOFTWARE DEVELOPMENT CLUB, VIT BHOPAL`
No generic hero illustration or floating purple spheres. The authority of the typography and crisp status chips commands the screen.

### 4.2 Narrative Progression on Landing
1. **The Briefing:** Visual breakdown of the failure incident in an editorial docket layout.
2. **Phase Breakdown (P1 to P4):** Stepped chronological timeline showing Reconnaissance (30m) -> Root Cause Analysis (35m) -> Surgical Repair & CTF Side Quests (60m) -> Demonstration & Proof (25m).
3. **Scoring Formula (50/30/20):** Rendered as a balance sheet with clear mathematical weights, bonus caps, and invalid report penalties (-5).
4. **Rules of Engagement & Safe Harbor:** Authoritative bulleted articles in styled plain typography.
5. **Entry Docket:** Clear call to sign in or activate via invitation token.

---

## 5. Workspaces & Screen Architectures

### 5.1 Participant Lobby & Workspace
- **Lobby:** The central operations desk. Shows an oversized mechanical countdown clock, 4-point readiness checklist (API link, Team assignment, Accepted rules status, and Window state), active announcements with severity flags, and quick-action docket routes.
- **Workspace:** Three-column evidentiary desk:
  - Column 1: `Evidence Repository` — File hierarchy tree with inline line-count badges and real-time server-side regex/search.
  - Column 2: `Inspection Viewer` — Line-numbered code reader with multi-line click/drag selection, jump-to-line, and contrast syntax framing.
  - Column 3: `Filing Docket` — Vulnerability dossier form with target location, category dropdown (12 taxonomy values), severity selector, root-cause narrative, impact, and proof-of-concept evidence. Includes flag submission sub-tab and live draft status with 3-second optimistic persistence.

### 5.2 Reviewer & Admin Consoles
- **Review Queue:** Prioritized audit list with 10-minute claim locks, claim-conflict detection, and clear review status badges.
- **Review Desk:** Side-by-side comparison of participant finding vs. raw challenge source with rubric sliders (0.0 to 1.0) and decision stamp actions (`accept_full`, `accept_partial`, `duplicate`, `reject_invalid`, `unplanned_valid`, `needs_second_review`).
- **Admin Control Room:** Operational telemetry, stage control triggers with confirmation locks, announcement broadcast transmitter, CSV exports, and cryptographic SHA-256 audit chain verification.

---

## 6. Design Primitives & Tokens

- Tokens:
  - `--color-bg-canvas: #111215`
  - `--color-bg-surface: #181A1F`
  - `--color-bg-docket: #F3EFE6`
  - `--color-text-docket: #1A1C20`
  - `--color-text-primary: #ECEEF2`
  - `--color-text-muted: #868A94`
  - `--color-border: #2B2E35`
  - `--color-border-focus: #C04A36`
  - `--color-stamp-danger: #C04A36`
  - `--color-stamp-success: #3E7259`
  - `--color-stamp-warning: #CF8B38`
- Primitives:
  - `DocketCard`: Contained panel with exhibit header, index tag, and border frame.
  - `ExhibitStamp`: Rubber-stamp style badge for verification, receipts, and status.
  - `PerforatedReceipt`: Distinct visual receipt ticket with dashed cutline and HMAC code.
  - `CountdownClock`: Monospaced countdown with server-skew compensation and polite aria announcements.
  - `EvidenceViewer`: Plain-text code reader with range selector and accessible line targets.

---

## 7. Accessibility, Performance & Anti-Pattern Compliance

- **Accessibility:** WCAG 2.2 AA compliant. High contrast ratios (> 7:1 for text on docket, > 4.5:1 on dark canvas). Full keyboard navigation for code selection and table filtering. Live announcements via `aria-live="polite"`.
- **Performance:** Zero bloated icon libraries (inline handcrafted SVGs only). Sub-split routes via React Router. Tailwind CSS v4 utility classes.
- **Anti-Pattern Guard:** No Lucide, no emojis, no Inter/Geist, no purple/neon, no skeleton loaders, no em-dashes, no fake reviews or marketing fluff.

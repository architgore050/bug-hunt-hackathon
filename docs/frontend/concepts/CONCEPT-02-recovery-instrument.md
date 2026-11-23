# Concept 02: The Recovery Instrument
**Slug:** `recovery-instrument`  
**Author:** Clean-Room Concept Subagent 02  
**Target Branch:** `frontend/concept-02-recovery-instrument`  

---

## 1. Design Thesis & Emotional Response

> **Design Thesis:** A high-craft surgical diagnostic instrument inspired by Dieter Rams industrial apparatus and avionics test benches, where participants operate a high-precision calibration terminal to diagnose and repair broken software sub-assemblies.

- **Target Emotional Response:** Absolute focus, tactile confidence, and engineering rigor. The user feels like a flight test engineer or instrumentation specialist sitting in front of a calibrated laboratory rack.
- **What Makes It Memorable:** It eschews all web-design tropes (no floating glass cards, no purple glows, no decorative 3D blobs). Every line, bezel, divider, and annunciator serves an explicit measurement or operational purpose. High physical tactility, micro-grooved bezels, and mechanical toggle guards.

---

## 2. Visual Metaphor & Art Direction

### 2.1 The Visual Metaphor: The Calibrated Laboratory Console
The platform is organized as a modular 19-inch instrument rack:
- Top Rack: **Master Avionics & Clock Bar** (Power, Clock, Sync Beacon, Global Status).
- Middle Rack: **Measurement & Inspection Deck** (Oscilloscopic trace timelines, Line-by-line Signal Analyzer).
- Bottom Rack: **Diagnostic Filing & Actuation Bay** (Telemetry forms, Armed Stage Switches, Verification Relays).

### 2.2 Color Palette & Materiality
- **Chassis Base:** Milled Carbon `#0E1013` (ultra-matte, absorption black).
- **Module Enclosures:** Anodized Metal `#181B20` and Instrument Bay `#20242B`.
- **Bezel & Divider Lines:** Precision Grooved Edge `#2D333D` and Hairline Milled `#3A4250`.
- **Illuminated Indicators (Physical Annunciators, non-neon, matte phosphor):**
  - Calibrated / Operational: Avionics Amber `#E5A83B`
  - Nominal / Online: Signal Sage `#437A55`
  - Critical / Alarm: Safety Crimson `#BD3A3A`
  - Standby / Telemetry: Steel Blue `#467499`
  - Instrument Legend: Bone White `#EAECE8`
  - Secondary Inscription: Anodized Silver `#7F8896`
- **Surface Depth:** Realized through 1px crisp inset chamfers, recessed bay panels, and milled divider notches.

### 2.3 Typographic System
- **Structural Legends & Controls:** `Archivo` (set in tight, geometric, uppercase architectural labels with tracking and weight discipline).
- **Measurement Readouts & Hex Streams:** `IBM Plex Mono` (dense, tabular, fixed-width numeric calibration).
- *Strict Rule:* No Inter, no Geist, no Space Grotesk.

### 2.4 Composition, Spacing & Movement
- **Grid:** Rigorous modular instrumentation grid (horizontal rack strips with 4px/8px micro-increments).
- **Motion:** Mechanical detents, instantaneous state switches, zero elastic bounce, physical toggle snaps (80ms linear).

---

## 3. Reference Sources & Principles Extracted

1. **Dieter Rams Ten Principles of Good Design (Less, but better):**
   - *Lesson Extracted:* Every visual element must indicate status, boundary, or affordance. Eliminate all decorative chrome that does not inform the operator.
2. **details.so & Origin Kit (Tactile UI instrumentation):** https://details.so
   - *Lesson Extracted:* Micro-grooves and recessed panel borders create tangible tactile feedback without relying on heavy blurry shadows.
3. **Kinetics & Animation Dictionary (Mechanical precision transitions):**
   - *Lesson Extracted:* Status annunciators change state with sharp, discrete transitions that mimic mechanical relays.

---

## 4. The First Screen & Visual Storyboard

### 4.1 First 5 Seconds Experience
A horizontal instrument rack spans the screen:
- Top Rail: Precision bus readout showing `FREQ: 1.000 Hz`, `SERVER_SYNC: LOCK`, and an oversized 7-segment style monospaced countdown clock in amber phosphor.
- Central Dial/Module: A multi-channel telemetry breakdown of **EVENT: FALL BACK / BUG HUNT CTF**.
- Direct visual instruments show the four event phases as an oscilloscope timing track, demonstrating duration, overlap, and scoring distribution.

### 4.2 Narrative Progression on Landing
1. **Instrument Calibration Rack:** Direct telemetry readout of event parameters and team limits.
2. **Channel Timing Track (Phases P1-P4):** Step-by-step diagnostic breakdown of the competition timeline.
3. **Weighting Matrix (50/30/20):** Segmented signal gauges demonstrating functional review, automated checks, and CTF bonus limits.
4. **Safety & Protocols:** Technical specification articles covering Rules, Integrity, and Safe Harbor.
5. **Actuator Gate:** Two-stage armed button to "ENGAGE SYSTEM / SIGN IN".

---

## 5. Workspaces & Screen Architectures

### 5.1 Participant Console
- **Instrument Panel (Lobby):** Diagnostic rack with status LEDs, system clock delta indicator, 4-channel readiness relays (API, Team, Rules, Stage), and live broadcast log.
- **Diagnostic Desk (Workspace):**
  - Left Bay: Module Explorer (assigned files with byte sizes and line counts).
  - Center Bay: Signal Analyzer (syntax-framed code with precise line-detent selection and range indicators).
  - Right Bay: Incident Telemetry Filing (structured form with 12-channel category selector, severity potentiometer, root cause analyzer, and auto-buffered draft status).

### 5.2 Reviewer & Admin Instrumentation
- **Review Bay:** Calibration queue with lock timer relays (10 min counter) and side-by-side signal diffing.
- **Admin Command Console:** Armed stage toggles with two-step safety covers (Confirm before Arm/Seal/End), live database health indicators, and cryptographic audit verify switches.

---

## 6. Design Primitives & Tokens

- Tokens:
  - `--instr-chassis: #0E1013`
  - `--instr-bay: #181B20`
  - `--instr-panel: #20242B`
  - `--instr-border: #2D333D`
  - `--instr-amber: #E5A83B`
  - `--instr-green: #437A55`
  - `--instr-crimson: #BD3A3A`
  - `--instr-text: #EAECE8`
  - `--instr-muted: #7F8896`
- Primitives:
  - `InstrumentRack`: Modular recessed container with bezel frame and title badge.
  - `AnnunciatorBar`: Segmented status indicator with crisp on/off states.
  - `ArmedSwitch`: Two-step safety button with physical arming state.
  - `DetentCounter`: Micro-monospaced counter with server skew correction.
  - `SignalViewer`: Precision code analyzer with detent line selection.

---

## 7. Accessibility, Performance & Anti-Pattern Compliance

- **Accessibility:** High contrast ratios, strict ARIA landmarks (`role="region"`, `role="status"`), full keyboard shortcut navigation.
- **Performance:** Lightweight, no heavy canvas or GPU shaders, pure SVG and CSS layout.
- **Anti-Pattern Guard:** No Lucide, no emojis, no Inter/Geist, no rainbow gradients, no skeleton loaders, no em-dashes.

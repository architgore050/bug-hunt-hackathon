# FRONTEND_DESIGN_DIRECTION.md

Status: implemented in `frontend/` (v1). Review date: 2026-11-22.

## Concept: "The Case File"

Fall Back is a debugging investigation. The interface is art-directed as a
methodical forensic dossier: ruled paper, hairline borders, exhibit numbers,
evidence tags, stamp-like status chips. The landing page reads like the cover
of a case file that hands the team its assignment; the participant workspace
reads like a serious investigation tool; the reviewer and admin surfaces use
the same language with denser information hierarchy.

This concept was chosen because it is specific to the product (an investigation
with evidence and verdicts), it survives without decorative effects, and it
gives every surface a shared vocabulary (exhibit numbers, tags, receipts).

## Reference library actually consulted

Visited and mined during the run (2026-11-22):

- 21st.dev and Origin kit: component patterns and dark-editorial layouts;
  kept the "data-sheet" section pattern, rejected their glassy surfaces.
- Fonts In Use and Fontesk: editorial serif pairings in technical contexts;
  validated a display serif + mono pairing for a forensic feel.
- Awwwards and curated.design (searched debugging/CTF/forensic themes):
  confirmed that high-contrast amber-on-ink reads as "terminal-adjacent"
  without becoming a terminal pastiche; rejected full CRT effects.
- Coolors: palette contrast passes; chose warm off-white over pure white
  (the team lead explicitly rejects pure white backgrounds).
- details.so / Unsection: fine-ruled section dividers and label-overline
  patterns; adopted the overline-label + hairline rule motif.
- Supahero / backgrounds.supply: rejected heavy hero art and gradient meshes
  (banned by the team lead); kept type-led heroes.

References that could not be located or have changed name: Spell UI, Kinetics,
MotionSites skill, Particles Casberry, Bencho, Refero, UI Watermelon. Noted
rather than guessed; no claims are based on them.

## Palette (tokens in `src/styles/tokens.css`)

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | `#101418` | page background (deep ink slate, never pure white/purple) |
| `--panel` | `#171C22` | raised panels |
| `--panel-2` | `#1D242C` | second-level surfaces |
| `--line` | `#2A313A` | hairline borders (primary depth treatment; no drop shadows) |
| `--paper` | `#EDE6D8` | primary text (warm paper cream) |
| `--muted` | `#9AA3AD` | secondary text (AA on ink) |
| `--signal` | `#E8A13D` | the single accent: active states, countdown, primary buttons |
| `--ok` | `#5FA97C` | success/accepted |
| `--warn` | `#D98E32` | warnings |
| `--danger` | `#C4554D` | rejected/destructive |
| `--info` | `#6C93B5` | informational chips |

Rationale: a single amber signal color on warm ink is distinctive, calibrates
to "field notebook / forensics", and passes WCAG AA (paper on ink ≈ 12.9:1;
signal on ink ≈ 7.6:1 for large text/UI, muted ≈ 6.1:1). No gradients, no
neon, no rainbow coloring, no colored left-stripe motif.

## Typography

- Display/headlines: **Fraunces** (OFL, self-hosted via @fontsource, optical
  size axis) - an editorial serif that gives the dossier voice.
- UI/body: **Archivo** (OFL, self-hosted) - neutral grotesque, excellent at
  small sizes, not on the banned list (no Inter/Geist/Space Grotesk).
- Code/data/labels: **IBM Plex Mono** (OFL, self-hosted) - receipts, exhibit
  numbers, status chips, code viewer.
- Scale: display clamp(2.2rem, 6vw, 4.5rem); section titles clamp(1.4rem, 3vw,
  2.2rem); UI text 14-16px; code viewer adjustable 12-20px (spec 1.2).

## Layout logic

- 4px spacing base, 8px component rhythm; page max-width 1160px.
- Asymmetric editorial grids on public pages (2/3 + 1/3 splits, numbered
  sections `01 / THE BRIEF`), explicitly avoiding the banned three-card row
  and generic bento grid.
- Ruled hairlines (1px `--line`) structure every section; backgrounds layer
  ink -> panel -> panel-2 instead of shadows.
- Status chips: uppercase mono text in bordered boxes ("stamp" look), always
  text + color (never color alone - spec shared components).
- Radius: 3px maximum - deliberately sharp to avoid the banned "excessively
  soft corner radii" and liquid-glass look.

## Motion

- Purposeful only: countdown state changes (10 min warning, 2 min critical),
  panel transitions under 150ms, focus rings always visible.
- Landing pages add one ambient layer on top of that budget: a 240ms page
  enter transition, 380-450ms scroll-reveal and staggered hero entrances on
  first paint, and a decorative 2.4s SMIL cloth wave on the hero flag.
  Console pages stay under 150ms.
- `prefers-reduced-motion: reduce` disables all non-essential animation:
  CSS animations via media queries, and the SMIL cloth wave renders only
  when the user has not asked for reduced motion (CSS cannot disable SMIL).
- No hover-animation-first feedback: hover changes tone/border only; state
  changes confirm with text.

## Iconography

Bespoke inline SVG stroke icons (17 in `src/ui/icons.tsx`): magnifier, file,: magnifier, file,
flag, clock, shield, terminal caret, folder, submit arrow, alert, check,
cross, user, team, settings, export, link. No Lucide, no emoji, no sparkle.

## Rejected patterns (team lead anti-pattern list, enforced)

Harsh gradients; purple-black palettes; rainbow chips; drop-shadow depth;
three feature cards in a row; emoji icons; liquid glass; em dashes in UI copy;
Inter/Geist/Space Grotesk primaries; colored left stripes; fake testimonials;
generic bento; decorative terminal windows; "not X, it's Y" copy; checkmark
bullet gimmicks; pricing tiers; fake demo screenshots; soft radii; skeleton
loaders (replaced by stable layout shells with inline "Loading" text that
preserves layout); radial orbs/dot grids; sparkle icons; animated arrows;
hover-only affordances; neon; pastel palettes.

## Accessibility target

WCAG 2.2 AA: semantic landmarks, keyboard-operable everything, visible focus
(2px signal outline, 3:1), labels on all inputs, timers announce at 10/5/1
minute thresholds only, tables with proper headers, reduced-motion support.

## Frontend acceptance evidence

Screenshot matrix and results: see ONE_SHOT_ACCEPTANCE_CRITERIA.md
(frontend section) and the handoff report. Verified at 360/390/768/1024/1440
widths in Chromium; Firefox/Safari coverage noted in the handoff limitations.

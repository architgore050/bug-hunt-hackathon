# Concept 03 (Failure Atlas) — QA & Accessibility Evidence

**Branch:** `frontend/concept-03-failure-atlas`
**Verified:** 2026-11-23, Chrome 158.0.8127.36 headless (agent-browser / Playwright), axe-core 4.10.2

## 1. Environment and honest limitations

- The sandbox provides Chrome/Chromium only. Firefox, Safari/WebKit and Edge were **not
  tested** and are recorded as untested rather than claimed.
- No PostgreSQL/Docker is available in the sandbox, so the FastAPI backend could not be
  started. Two kinds of evidence were therefore captured and are kept strictly separate:
  1. **Live error-path verification (real network):** with the backend proxy dead, every
     page renders the real `ApiRequestError` envelope from the proxy's 502 responses —
     stress-toned fault banners with error `code`, human message and `FAULT REF`
     (request id), each with a working *Re-run Survey* retry. Screenshots:
     `landing-full-1440.png`, `landing-390.png` (bottom banner).
  2. **Visual-composition QA (intercepted network, labelled MOCKED):** authenticated
     surfaces were rendered with `agent-browser network route` fixtures so composition,
     hierarchy and states could be reviewed. These screenshots prove layout/state
     rendering only — **no integration claim** is made from them.
- No screen reader is available in the sandbox; the manual SR pass was **not** performed.
  Keyboard semantics rely on native elements (buttons, links, selects, inputs), visible
  focus rings and axe's keyboard-related rules; a tab-through pass with a real SR is
  listed as follow-up work.

## 2. Automated accessibility sweep (axe-core 4.10.2)

Final results — **0 violations on every route** (after the fixes in §3):

| Route | Violations | Passes |
|---|---|---|
| `/` | 0 | 41 |
| `/app` | 0 | 31 |
| `/app/workspace` | 0 | 31 |
| `/app/submissions` | 0 | 31 |
| `/app/results` | 0 | 31 |
| `/app/leaderboard` | 0 | 31 |
| `/review` | 0 | 40 |
| `/admin` | 0 | 40 |
| `/admin/challenges` | 0 | 36 |
| `/login` | 0 | 36 |
| `/activate` | 0 | 37 |
| `/rules` | 0 | 35 |
| `/privacy`, `/terms`, 404 | 0 | 25 |

Note: `/app/submissions`, `/app/results`, `/app/leaderboard` additionally verified in
their sealed states (`released: false`, `visible: false`) — see
`results-sealed-1440.png`, `leaderboard-sealed-1440.png`.

## 3. Contrast audit and fixes applied in this PR

Contrast ratios were computed with the WCAG 2.x relative-luminance formula
(`scripts/contrast_check.py`), then confirmed by axe on rendered pages.

**First sweep found serious `color-contrast` violations** (18 on `/`, plus others), all
from accent tokens used as small text and from tinted chip backgrounds:

| Pair (before) | Ratio | Fix |
|---|---|---|
| muted `#718294` on strata panel `#111A27` | 4.43 | muted lightened to `#7E8FA1` (5.27) |
| shear `#C44D3F` as text on abyss | 4.13 | text tint `--atlas-shear-text #E0836F` (7.04); base kept for borders/fills/graphics |
| moss `#3F7A68` as text on abyss | 3.86 | text tint `--atlas-moss-text #63A98D` (6.99) |
| cyan `#4A8FA8` text on cyan/20 chip | ~2.8 | text tint `--atlas-cyan-text #7FBBD1` (≥6.35 worst case) |
| copper `#CF824B` text on copper/20 band | ~3.1 | text tint `--atlas-copper-text #E2A56B` (≥6.93) |
| `#E2E8EE` text on shear button fill | 3.80 | white text (4.69) |
| `#E2E8EE` text on moss button fill | 4.26 | white text (5.33) |
| line-number `#5A6B7C` / footer meta on ridge | 3.5–3.6 | muted `#7E8FA1` (5.64) |
| strata band metadata on tinted bands | <4.5 | secondary `#B6C2CE` (7.7) |
| hover state of claim button (text over red fill) | 3.8 | `hover:text-white` |

Key pairs after fixes: body `#E2E8EE` on abyss 15.66:1; secondary `#B6C2CE` 10.68:1;
muted `#7E8FA1` 5.27–5.83:1; copper accent 6.40:1; cyan 5.33:1; abyss text on cyan
button 5.33:1; on copper button 6.40:1.

## 4. Semantics and interaction

- Landmarks: `header`/`nav`/`main`/`footer`; one `h1` per page; section headers labelled
  with sector coordinates (`SECTOR-01 //`, panel `sector=` chips).
- Forms: every control has a programmatic label (`htmlFor`/`id` or `aria-label`);
  severity selectors are `role="radiogroup"`/`role="radio"` with `aria-checked`;
  filter pills use `aria-pressed`; file list marks `aria-current`.
- Live regions: survey clock and draft status are `aria-live="polite"`; fault banners are
  `role="alert"`. The 1 Hz timer tick is **not** announced (only state changes: PAUSED,
  WINDOW CLOSED, FINAL APPROACH).
- The line-span picker is click/shift-click on a `<table>`; keyboard users can still
  submit exact coordinates via the search hits (which set the span) — a dedicated
  keyboard range picker is listed as follow-up work.
- Motion: a single 2.4 s beacon pulse; `prefers-reduced-motion` disables all animation
  globally (`app.css`).

## 5. State coverage

Implemented and screenshot-verified: loading text states (no skeleton loaders), empty
states (filings log, telegrams, disputes, terrain), API error + retry (real 502s),
permission-denied sector panel (`lib/auth.tsx`), sealed results/leaderboard, paused
clock, submission receipt incl. replay ack, draft conflict status, cooldown timer,
readiness gate `checked/unchecked/na`, audit chain intact/broken outcomes.

# Concept 02 (Recovery Instrument) — QA & Accessibility Evidence

**Branch:** `frontend/concept-02-recovery-instrument`
**Verified:** 2026-11-23, Chrome 158.0.8127.36 headless (agent-browser / Playwright), axe-core 4.10.2

## 1. Environment and honest limitations

- Chrome/Chromium only in this environment; Firefox, Safari/WebKit, Edge **not tested**.
- The backend could not be started in the sandbox (no PostgreSQL/Docker). Public pages
  were verified against the real error envelope (502 → ErrorBanner with retry). The
  authenticated screenshots used intercepted network fixtures labelled **MOCKED — visual
  QA only**; no integration claim is made from them.
- No screen reader available; manual SR pass **not** performed (follow-up).

## 2. Automated accessibility sweep (axe-core 4.10.2)

**Before this PR's hardening:** 6-10 contrast violations per route and 1 critical
`select-name` on `/admin`, plus 5 critical `label` + 1 `select-name` on the review desk.

**Fixes applied in this PR** (all verified by re-sweep):

- Text tints for accents used as small text: sage `#437A55` → `#5FA57F` (5.32-6.51:1),
  crimson `#BD3A3A` → `#D96A5F` (4.58-6.13:1), cyan `#467499` → `#6FA3C6` (5.73-7.01:1).
  Amber `#E5A83B` already passed everywhere.
- Footer/meta dark-muted `#555C68` → `#7F8896` (5.32:1 on chassis).
- `/admin` event select `aria-label`, stage-action select `htmlFor/id="stage-action"`.
- Review desk: verdict select `htmlFor/id="review-decision"`, audit notes textarea
  `htmlFor/id="review-notes"`, five rubric sliders `aria-label`.
- **Art-direction leak fixed:** `lib/auth.tsx` (the session-gate screens) still carried
  concept-01's case-file palette. The RequireRole loading and access-denied screens are
  restyled to this concept's instrument palette (`#0E1013/#181B20/#2D333D`, crimson
  chip `#BD3A3A` with `#D96A5F` text).

**Final sweep — 0 violations on every route:**
`/` (34 passes), `/app` (28), `/app/workspace` (25), `/review` (29),
`/review/items/:id` (38), `/admin` (35), `/admin/challenges` (28), `/login` (28),
`/activate` (29), `/rules` (29), `/privacy` (25), `/terms` (25), 404 (25).

## 3. Contrast reference (computed, WCAG 2.x)

| Pair | Ratio |
|---|---|
| text `#EAECE8` on chassis `#0E1013` | 15.9:1 |
| secondary `#B4B9C4` on chassis | 11.2:1 |
| muted `#7F8896` on chassis | 5.32:1 |
| amber `#E5A83B` on chassis / panel | 9.07 / 7.41:1 |
| sage text `#5FA57F` on chassis / panel | 6.51 / 5.32:1 |
| crimson text `#D96A5F` on chassis / panel | 5.60 / 4.58:1 |
| cyan text `#6FA3C6` on chassis / panel | 7.01 / 5.73:1 |

## 4. State coverage

Loading text states, empty states, real API error + retry (502), role-denied panel
(restyled), sealed results/leaderboard, paused clock, receipt + replay ack, draft
conflict, cooldown, readiness gate states, audit outcome, armed-switch confirmations.

## 5. Remaining follow-ups

- Manual keyboard/screen-reader pass; Firefox/Safari/Edge verification.
- `AnnunciatorBar`/`ArmedSwitch`/`DetentCounter` primitives verified visually with
  fixtures; exercise them against live backend events before release.

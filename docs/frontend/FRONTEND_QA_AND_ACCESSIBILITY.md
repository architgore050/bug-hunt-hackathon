# Concept 01 (Incident Archive) — QA & Accessibility Evidence

**Branch:** `frontend/concept-01-incident-archive`
**Verified:** 2026-11-23, Chrome 158.0.8127.36 headless (agent-browser / Playwright), axe-core 4.10.2

## 1. Environment and honest limitations

- Chrome/Chromium only in this environment; Firefox, Safari/WebKit, Edge **not tested**.
- The backend could not be started in the sandbox (no PostgreSQL/Docker). Public pages
  were verified against the real error envelope (the proxy's 502 renders the ErrorBanner
  with `HTTP_502`, request id and Retry — see `landing-full-1440.png`). Authenticated
  screenshots (`workspace-1440.png`, `landing-390.png` nav states) used intercepted
  network fixtures labelled **MOCKED — visual QA only**; no integration claim is made.
- No screen reader available; manual SR pass **not** performed (follow-up).

## 2. Automated accessibility sweep (axe-core 4.10.2)

**Before this PR's hardening:** 33 contrast violations on `/`, 9-10 on each authenticated
route, and 1 critical `select-name` violation (two unlabeled `<select>`s on `/admin`).

**Fixes applied in this PR** (all verified by re-sweep):

- Text tints for accents used as small text on dark surfaces: stamp-red `#C04A36` →
  `#E2715A` (5.27-6.01:1), stamp-green `#3E7259` → `#5EA57E` (5.93:1), stamp-cyan
  `#4B7B9A` → `#7BA6C4` (6.71:1), footer meta `#6A6E78` → `#868A94` (5.42:1). Bases are
  kept on the buff docket paper, where the original dark-on-light pair is correct.
- Readiness-gate state text on buff paper darkened for light-on-light failures:
  checked `#2A5240` (7.09:1), unchecked `#8F2F22` (6.50:1).
- Solid red fills (`bg-[#C04A36]`, buttons, logo tile) switch to white text (4.91:1 on
  the fill; 6.44:1 on the hover shade `#A83827`).
- `/admin` event `<select>` gets `aria-label="Select event"`; stage-action select gets
  `htmlFor/id="stage-action"` (fixes the axe **critical**).
- Review desk: verdict `<select>` gets `htmlFor/id="review-decision"`; the five rubric
  range inputs get `aria-label={Rubric score for <metric>}` (fixes 5 critical `label`
  violations + 1 `select-name`).

**Final sweep — 0 violations on every route:**
`/` (38 passes), `/app` (25), `/app/workspace` (25), `/app/submissions` (25),
`/app/results` (25), `/app/leaderboard` (25), `/review` (29), `/review/items/:id` (38),
`/admin` (35), `/admin/challenges` (28), `/login` (28), `/activate` (29), `/rules` (29),
`/privacy` (25), `/terms` (25), 404 (25).

## 3. Contrast reference (computed, WCAG 2.x)

| Pair | Ratio |
|---|---|
| body `#ECEEF2` on canvas `#111215` | 16.12:1 |
| secondary `#C4C8D2` on canvas | 11.18:1 |
| muted `#868A94` on canvas | 5.42:1 |
| red accent text `#E2715A` on canvas | 6.01:1 |
| green accent text `#5EA57E` on canvas | 6.39:1 |
| cyan accent text `#7BA6C4` on canvas | 7.22:1 |
| amber `#CF8B38` on canvas | 6.60:1 |
| white on red button `#C04A36` | 4.91:1 |
| docket text `#181A1F` on buff `#F3EFE6` | 15.17:1 |

## 4. State coverage

Loading text states, empty states (filings, telegrams), real API error + retry (502),
role-denied panel (`EX-403`), sealed results/leaderboard, paused clock, submission
receipt + replay ack, draft conflict, cooldown, readiness gate states, audit outcome.

## 5. Remaining follow-ups

- Manual keyboard/screen-reader pass on a real SR.
- Firefox/Safari/Edge verification.
- `auth.tsx` role-denial screens share this concept's styling across branches; concept-02
  restyled its own copy in its branch.

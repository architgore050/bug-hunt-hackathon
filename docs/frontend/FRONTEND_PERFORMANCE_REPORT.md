# Concept 03 (Failure Atlas) — Performance Report

**Branch:** `frontend/concept-03-failure-atlas`
**Measured:** 2026-11-23 on the production build (`npm run build`, vite 8, React 19).

## 1. Bundle budget (measured, gzip)

| Asset | Raw | Gzip |
|---|---|---|
| `index-*.js` (single initial chunk) | 384.0 KB | **107.10 KB** |
| `index-*.css` | 35.6 KB | **7.28 KB** |
| Fonts (self-hosted @fontsource, latin subset, woff) | ~20 KB each | 8 fonts in use |

First-load transfer is ~115 KB compressed plus the latin font subset. There are no
runtime-loaded icon packs, chart libraries, animation libraries or UI kits; the entire
visual system is CSS (survey grid, panel primitives) and two small inline SVGs
(`ContourField`, the topological system map) that paint once and never animate.

## 2. Deliberate non-optimisations and honest gaps

- **No route-level code splitting yet.** Admin/review modules ship inside the single
  initial bundle. Vite manual chunks or `React.lazy` per role is the obvious next step
  (~25-30% initial-JS reduction estimated, not measured). Recorded as follow-up, not
  claimed as done.
- No Lighthouse score is claimed (not measured in this environment).
- Images: the favicon is the only raster-ish asset; no stock photography, no sprites.

## 3. Network behaviour (contract-driven)

Polling cadences follow the contract exactly and are centralised at call sites:
`/v1/state` 5 s, `/v1/review/queue` 8 s, `/v1/submissions` 15 s,
`/v1/leaderboard` 20 s, `/v1/results` 30 s, `/v1/announcements` on the lobby's 5 s tick.
Draft autosave debounces at 3 s and only fires when filed content changes (version bumps
from save responses deliberately do not re-arm the effect, preventing a save loop).
Auth token refresh is a single-flight promise shared across concurrent 401 retries
(`lib/api.ts`). Search submits are explicit form submissions (no per-keystroke spam).

## 4. Rendering cost

- Zero continuous animations except the one 1.5 KB CSS beacon pulse; the survey grid is
  a static `background-image` gradient stack, GPU-cheap.
- Code viewer renders plain `<table>` rows (no virtualiser). Challenge files are capped
  by the platform (512 KiB upload; line-count shown per layer). A virtualised viewer is
  worth revisiting only if real files exceed a few thousand lines.
- Server clock sync is one `GET /v1/time` per countdown mount, offset-corrected locally;
  ticks are pure client arithmetic.
